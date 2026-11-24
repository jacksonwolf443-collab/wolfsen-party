'use strict';
const crypto=require('node:crypto');
const definitions=require('./award-definitions.json');
const podiumDefinitions=[definitions.points,definitions['points-second'],definitions['points-third']];
function podiumFingerprint(data){return crypto.createHash('sha256').update(JSON.stringify([data.event?.id??'',data.resetEpoch??0,(data.players??[]).map(p=>[p.id,p.number,p.name,p.photo??'',p.score??0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))])).digest('hex')}
function invalidatePodiumChoices(data,AppError=Error){const state=data.podiumAwards;if(!state?.fingerprint||!Object.keys(state.choices??{}).length)return false;const fingerprint=podiumFingerprint(data);if(state.fingerprint===fingerprint)return false;const previous=Number.isSafeInteger(state.version)?state.version:0;if(previous>=Number.MAX_SAFE_INTEGER)throw new AppError('颁奖版本已达到上限，请保留存档后检查');data.podiumAwards={version:previous+1,fingerprint,choices:{}};return true}
function buildPodium(data){
 const fingerprint=podiumFingerprint(data),state=data.podiumAwards??{},valid=state.fingerprint===fingerprint,choices=valid?state.choices??{}:{},used=new Set();let blocked=false;
 const awards=podiumDefinitions.map((definition,index)=>{
  const {legacyTitles,...display}=definition,base={...display,description:'依次从尚未获奖的最高分玩家中确定',podium:true,ids:[],candidateIds:[]};
  if(blocked)return{...base,needsPrevious:true,emptyReason:'请先确定上一名次，再从尚未获奖的最高分玩家中选出本名次。'};
  const remaining=(data.players??[]).filter(p=>!used.has(p.id));if(!remaining.length)return{...base,emptyReason:'玩家记录不足，暂无该名次。'};
  const value=Math.max(...remaining.map(p=>p.score??0)),candidateIds=remaining.filter(p=>(p.score??0)===value).sort((a,b)=>String(a.number).localeCompare(String(b.number),'zh-CN',{numeric:true})||String(a.id).localeCompare(String(b.id))).map(p=>p.id),pick=choices[definition.id]?.playerId,winner=candidateIds.length===1?candidateIds[0]:candidateIds.includes(pick)?pick:null;
  const place=['冠军','亚军','季军'][index],explanation=(index?'排除已获奖玩家后，剩余玩家的最高积分为':'全场最高积分为')+' '+value+' 分'+(candidateIds.length>1?'；'+candidateIds.length+' 位玩家同分，由主持人根据线下决斗PK结果确认唯一'+place+'。':'，据此成为今晚的'+place+'。');
  if(winner)used.add(winner);else blocked=true;
  return{...base,value,candidateIds,ids:winner?[winner]:[],requiresPK:!winner,resolvedByPK:!!winner&&candidateIds.length>1,explanation,...(!winner?{emptyReason:definition.title+'从以下几位选出一位，需现场出题，他们线下进行决斗PK。'}:{})};
 });
 return{awards,podium:{fingerprint,version:Number.isSafeInteger(state.version)?state.version:0,hasChoices:Object.keys(choices).length>0,stale:!!state.fingerprint&&!valid}};
}
function createPodiumAwardsService({store,AppError=Error}){
 const fail=(message,status=400)=>{throw new AppError(message,status)};
 const check=body=>{const result=buildPodium(store.data);if(body.eventId!==store.data.event.id||body.resetEpoch!==(store.data.resetEpoch??0)||body.fingerprint!==result.podium.fingerprint)fail('积分、玩家名单或活动已更新，请重新读取后确认PK结果',409);if(!Number.isSafeInteger(body.version)||body.version!==result.podium.version)fail('颁奖PK结果已更新，请刷新后操作',409);if(result.podium.version>=Number.MAX_SAFE_INTEGER)fail('颁奖版本已达到上限，请保留存档后检查');return result};
 const summary=()=>require('./party-summary.cjs').buildPartySummary(store.data);
 const resolve=(body={})=>{const current=check(body),index=podiumDefinitions.findIndex(d=>d.id===body.awardId),award=current.awards[index];if(!award)fail('没有这个积分名次',404);if(award.needsPrevious)fail('请先确认上一名次',409);if(award.candidateIds.length<2||!award.candidateIds.includes(body.playerId))fail('请选择本名次同分候选中的一位线下PK胜出者');store.commit(data=>{const choices=data.podiumAwards?.fingerprint===current.podium.fingerprint?{...data.podiumAwards.choices}:{};for(const d of podiumDefinitions.slice(index))delete choices[d.id];choices[body.awardId]={playerId:body.playerId,decidedAt:new Date().toISOString()};data.podiumAwards={version:current.podium.version+1,fingerprint:current.podium.fingerprint,choices};return{}});return summary()};
 const restart=(body={})=>{const current=check(body);store.commit(data=>{data.podiumAwards={version:current.podium.version+1,fingerprint:current.podium.fingerprint,choices:{}};return{}});return summary()};
 return{resolve,restart};
}
module.exports={buildPodium,podiumFingerprint,createPodiumAwardsService,invalidatePodiumChoices};
