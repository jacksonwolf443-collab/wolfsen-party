export type CoverGroup={id:string;members:string[];cover?:string};
type RetryPhase='generate'|'save';
type QueueOptions<T extends CoverGroup>={groups:T[];current:(id:string)=>T|undefined;cancelled:()=>boolean;generate:(group:T)=>Promise<any>;save:(group:T,result:any)=>Promise<any>;onProgress?:(done:number,total:number,group:T)=>void;onFailure?:(group:T,error:any)=>void|Promise<void>;onRetry?:(group:T,retry:number,maxRetries:number,delayMs:number,phase:RetryPhase)=>void;concurrency?:number;replaceExisting?:boolean;pending?:Record<string,any>;retryDelay?:(ms:number)=>Promise<any>};
const generationRetries=10,saveRetries=3;
const errorText=(error:any)=>String(error?.message??error??'生成失败');
const isModerationFailure=(error:any)=>/green[\s_-]*net.*reject|reject(?:ed)?.*image|data.?inspection|content[_ -]?(?:filter|moderation)|safety[_ -]?(?:check|reject)|(?:内容|输入|图片).*审核|审核.*(?:拒绝|未通过|不通过)/i.test(errorText(error)+' '+String(error?.code??''));
const isObsoleteFailure=(error:any)=>Number(error?.status)===409||/活动已(?:经)?清空|旧.*(?:忽略|取消)|原组合|重新分配|已被更新|档案已变化|未到|已离场|未参与/.test(errorText(error));
const isTransientFailure=(error:any)=>{
 const status=Number(error?.status);
 if(isModerationFailure(error)||isObsoleteFailure(error)||[401,403,404,422,428].includes(status))return false;
 return[408,425,429].includes(status)||status>=500&&status<600||/\b(?:408|425|429|5\d\d)\b|time[ -]?out|timed out|temporar|service unavailable|too many requests|rate.?limit|throttl|network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|AI连接失败|超时|网络|限流|请求过于频繁|服务(?:暂时)?不可用/i.test(errorText(error)+' '+String(error?.code??''));
};
export async function runPairCoverQueue<T extends CoverGroup>({groups,current,cancelled,generate,save,onProgress,onFailure,onRetry,concurrency=2,replaceExisting=false,pending={},retryDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}:QueueOptions<T>){
 const candidates=groups.filter(g=>replaceExisting||!g.cover||pending[g.id]).map(group=>({group,members:JSON.stringify(group.members),cover:group.cover??''})),total=candidates.length;let cursor=0,done=0;
 const worker=async()=>{while(!cancelled()&&cursor<total){
  const entry=candidates[cursor++],{group}=entry;
  const stillCurrent=()=>{const live=current(group.id);return !!live&&JSON.stringify(live.members)===entry.members};
  const unchanged=()=>stillCurrent()&&(current(group.id)?.cover??'')===entry.cover;
  if(!stillCurrent())continue;
  if(!unchanged()||!replaceExisting&&current(group.id)?.cover&&!pending[group.id]){done++;onProgress?.(done,total,group);continue}
  let result=pending[group.id],phase:RetryPhase=result?'save':'generate',retry=0;
  while(!cancelled()&&unchanged()){
   try{
    if(phase==='generate'){result=await generate(group);phase='save';retry=0}
    if(cancelled()||!unchanged())break;
    await save(group,result);break;
   }catch(caught:any){
    if(cancelled()||!unchanged())break;
    const error:any=caught instanceof Error?caught:new Error(errorText(caught));
    const retryable=!isModerationFailure(error)&&!isObsoleteFailure(error)&&(phase==='save'||isTransientFailure(error));
    const maxRetries=phase==='generate'?generationRetries:saveRetries;
    if(retryable&&retry<maxRetries){const limited=phase==='generate'&&/rate.?limit|too many requests|throttl|限流|请求过于频繁/i.test(errorText(error)+' '+String(error?.code??'')),delay=Math.min(30000,Math.max(limited?5000:1000,1000*2**retry));retry++;onRetry?.(group,retry,maxRetries,delay,phase);await retryDelay(delay);continue}
    if(result)error.pending=result;
    if(isModerationFailure(error)){
     if(!error.moderationRejected)error.message=(/\(input\)|\binput\b|输入|原照片/i.test(errorText(error))?'服务端原照片审核未通过，请更换本组原照片后再生成；本组不会自动重试。':'服务端审核未通过，原结果已保留；请联系服务支持，本组不会自动重试。')+errorText(caught);
     error.moderationRejected=true;
    }
    else if(retryable)error.message=errorText(caught)+'（已自动重试'+maxRetries+'次，请检查网络或服务状态）';
    await onFailure?.(group,error);break;
   }
  }
  if(!cancelled()){done++;onProgress?.(done,total,group)}
 }};
 await Promise.all(Array.from({length:Math.min(total,Math.max(1,Math.min(2,concurrency)))},worker));return{done,total,cancelled:cancelled()};
}
