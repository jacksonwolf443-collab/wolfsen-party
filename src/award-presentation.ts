import definitions from '../desktop/award-definitions.json';
export function presentAward(award:any){
 if(!award)return award;
 const definition=Object.values<any>(definitions).find(d=>d.id===award.id||d.title===award.title||d.legacyTitles?.includes(award.title));
 if(!definition)return award;
 const{legacyTitles,...display}=definition;return{...award,...display,...(award.podium&&award.description?{description:award.description}:{})};
}
export function awardSequence(summary:any){
 const awards=(summary.awards??[]).map(presentAward),podium=[definitions.points,definitions['points-second'],definitions['points-third']];
 if(!summary.players?.length)return awards;
 if(podium.every(d=>awards.some((a:any)=>a.id===d.id)))return awards;
 const rows=summary.points??summary.players??[],used=new Set<string>();let blocked=false;
 const top=podium.map(definition=>{
  if(blocked)return{...definition,podium:true,ids:[],candidateIds:[],needsPrevious:true,emptyReason:'请先确定上一名次。'};
  const remaining=rows.filter((p:any)=>!used.has(p.id)),value=Math.max(...remaining.map((p:any)=>p.score??0)),candidates=remaining.filter((p:any)=>(p.score??0)===value);
  if(candidates.length===1){used.add(candidates[0].id);return{...definition,podium:true,ids:[candidates[0].id],candidateIds:[candidates[0].id],value}}
  blocked=candidates.length>1;
  return{...definition,podium:true,ids:[],candidateIds:candidates.map((p:any)=>p.id),requiresPK:blocked,value,emptyReason:blocked?definition.title+'从以下几位选出一位，需现场出题，他们线下进行决斗PK。':'玩家记录不足，暂无该名次。'};
 });
 return[...top,...awards.filter((a:any)=>!podium.some(d=>d.id===a.id))];
}
