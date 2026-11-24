'use strict';
const crypto=require('node:crypto');
const {appendSupplementalEntrants}=require('./pair-tournament.cjs');
const {profilePairReason}=require('./ai-pairing.cjs');
const {teamMetadata,randomPairing,soloReason}=require('./pair-team-rules.cjs');
const copy=value=>structuredClone(value);
function randomize(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a;}
function unmatchedPlayers(data,isEligible){const used=new Set((data.states.pairs?.value?.groups??[]).flatMap(g=>g.members??[]));return data.players.filter(p=>isEligible(p)&&!used.has(p.id));}
function createPairSupplementService({store,isEligible,AppError=Error,aiPairing,hasAI=()=>false,shuffle=randomize}){
 const previews=new Map(),inflight=new Map();
 const fail=(text,status=400)=>{throw new AppError(text,status)};
 const fingerprint=()=>{const state=store.state('pairs'),groupIds=new Set((state.value?.groups??[]).flatMap(g=>g.members??[]));return JSON.stringify({eventId:store.data.event?.id,version:state.version,value:state.value,people:store.data.players.filter(p=>groupIds.has(p.id)||isEligible(p)).map(p=>[p.id,p.name,p.number,p.photo??'',p.interests??'',p.wish??'',p.active,p.attendance,p.checkedInAt,p.version]).sort((a,b)=>a[0].localeCompare(b[0]))});};
 const check=b=>{const state=store.state('pairs');if(!b.eventId||b.eventId!==store.data.event?.id)fail('派对已更换，本次补配已失效，请重新读取活动',409);if(Number(b.version)!==state.version)fail('搭档或比赛已更新，请刷新后重新补配',409);return state;};
 return async function supplement(action,b={}){
  if(action==='cancel'){previews.delete(b.token);return{cancelled:true};}
  if(action==='commit'){
   const pending=previews.get(b.token);previews.delete(b.token);
   if(!pending||Date.now()-pending.createdAt>10*60000)fail('本次补配已取消、已使用或已失效，请重新补配');
   const state=check(b);if(pending.snapshot!==fingerprint())fail('已签到名单、档案或原组合已变化，本次补配未保存，请重新补配',409);
   if(pending.preview.version!==state.version)fail('搭档或比赛已更新，请重新补配',409);
   const saved=store.putState('pairs',pending.value,state.version);
   return{...saved,value:copy(pending.value),newGroups:copy(pending.preview.newGroups),standby:[...pending.value.standby],mode:pending.preview.mode,notice:pending.preview.notice};
  }
  if(action!=='prepare')fail('没有这个补配操作');
  const state=check(b),snapshot=fingerprint(),value=copy(state.value??{groups:[],standby:[],round:1});
  let players=copy(unmatchedPlayers(store.data,isEligible));
  if(b.mode==='manual'){
   if(!Array.isArray(b.ids)||b.ids.length!==2||new Set(b.ids).size!==2||b.ids.some(id=>!players.some(p=>p.id===id)))fail('手动搭档请选择两名已签到且尚未组队的玩家');
   players=b.ids.map(id=>players.find(p=>p.id===id));
  }
  if(!players.length)fail('当前没有已签到且尚未组成搭档的玩家');
  const mode=b.mode??(value.pairingMode==='random'||!hasAI()?'random':'ai');
  if(!['random','ai','manual'].includes(mode))fail('请选择随机或AI补配');
  const requestKey=snapshot+'\0'+mode+'\0'+JSON.stringify(b.ids??[]);
  const issue=prepared=>{if(snapshot!==fingerprint())fail('已签到名单、档案或原组合已变化，请重新补配',409);const token=crypto.randomUUID(),preview={...copy(prepared.preview),token};for(const [key,p]of previews)if(Date.now()-p.createdAt>10*60000)previews.delete(key);if(previews.size>50)previews.delete(previews.keys().next().value);previews.set(token,{snapshot,value:copy(prepared.value),preview:copy(preview),createdAt:Date.now()});return preview;};
  // Share a still-running analysis, but each caller owns its cancellation token.
  // A late reply from a cancelled dialog must not invalidate a newer dialog.
  if(inflight.has(requestKey))return issue(await inflight.get(requestKey));
  const preparing=(async()=>{
   let result;
   if(mode==='manual')result={pairs:[players.map(p=>p.id)],standby:[],reasons:[]};
   else if(players.length===1)result={pairs:[[players[0].id]],standby:[],reasons:[]};
   else if(mode==='ai'){if(typeof aiPairing!=='function')fail('AI匹配服务尚未就绪');result=await aiPairing({candidateIds:players.map(p=>p.id)});}
   else result=randomPairing(players,{shuffle});
   if(snapshot!==fingerprint())fail('已签到名单、档案或原组合已变化，请重新补配',409);
   if(!result||!Array.isArray(result.pairs)||!Array.isArray(result.standby??[]))fail('补配名单校验失败，原组合没有修改');
   // Accept the provider's legacy standby field only as a real one-person team.
   result={...result,pairs:[...(result.pairs??[]),...(result.standby??[]).map(id=>[id])],standby:[]};
   const members=result.pairs.flat(),expected=players.map(p=>p.id);
   if(result.pairs.some(p=>!Array.isArray(p)||![1,2].includes(p.length))||members.length!==expected.length||new Set(members).size!==expected.length||members.some(id=>!expected.includes(id))||result.pairs.filter(ids=>ids.length===1).length!==players.length%2)fail('补配名单校验失败，原组合没有修改');
   const newGroups=result.pairs.map(ids=>{const reason=ids.length===1?{reason:soloReason,reasonSource:'solo',reasonEvidence:[]}:result.reasons?.find(r=>r.members?.length===2&&r.members.every(id=>ids.includes(id))&&typeof r.reason==='string'&&r.reason.trim())??(mode==='ai'?profilePairReason(ids,players):null);return{id:crypto.randomUUID(),members:[...ids],...teamMetadata(ids),challenge:'',cover:'',alive:true,votes:0,matchReason:reason?.reason??(mode==='manual'?'本组由主持人手动指定。':'本次为随机补配，未按兴趣或心愿推断共同点。'),matchReasonSource:reason?.reasonSource??(mode==='manual'?'host':'random'),matchReasonEvidence:reason?.reasonEvidence??[]};});
   const candidates=new Set(expected),next={...value,groups:[...(value.groups??[]),...newGroups],standby:[...(value.standby??[]).filter(id=>!candidates.has(id)),...result.standby]};
   const plan=appendSupplementalEntrants(next,newGroups.map(g=>g.id),{shuffle,AppError});
   const preview={eventId:store.data.event.id,version:state.version,mode,round:next.round??1,candidateIds:expected,pairs:copy(result.pairs),standby:[],reasons:newGroups.map(g=>({members:g.members,reason:g.matchReason,reasonSource:g.matchReasonSource})),newGroups:copy(newGroups),matches:copy(plan.matches),notice:'只补配已签到且从未进入已有组合的人；已有搭档、合照和比赛结果保留。'+plan.notice+(newGroups.some(g=>g.solo)?' 奇数最后一位单人成队，按2个名额参赛。':'')};
   return{value:plan.value,preview};
  })();
  inflight.set(requestKey,preparing);
  try{return issue(await preparing)}finally{if(inflight.get(requestKey)===preparing)inflight.delete(requestKey);}
 };
}
module.exports={createPairSupplementService,unmatchedPlayers};
