'use strict';
const crypto=require('node:crypto');
const {isPairTeamEligible}=require('./pair-team-rules.cjs');
const ROUND_NAMES=['哪组最猛','我们最猛','我们最默契','心有灵犀'];
const unique=ids=>[...new Set((ids??[]).map(String))];
const sameMembers=(a,b)=>JSON.stringify(unique(a).sort())===JSON.stringify(unique(b).sort());
const person=p=>({id:p.id,name:p.name,number:p.number,photo:p.photo??''});
function summaryBase(data){
 const state=data.states?.pairs?.value,players=data.players??[],rows=(state?.groups??[]).map(group=>({groupId:group.id,playerIds:unique(group.members),members:unique(group.members).map(id=>players.find(p=>p.id===id)).filter(Boolean).map(person),categories:ROUND_NAMES.map((label,index)=>({round:index+1,label,points:0,events:[]})),total:0})),byId=new Map(rows.map(row=>[row.groupId,row]));
 const add=(groupId,round,id,task)=>{const row=byId.get(groupId),category=row?.categories[round-1];if(!category||category.events.some(x=>x.id===id))return;category.events.push({id,task:String(task??'')});category.points++;row.total++;};
 for(const round of state?.tournament?.rounds??[])if([1,2].includes(Number(round.number)))for(const match of round.matches??[])if(match.status==='settled'&&!match.bye&&match.winnerId)add(match.winnerId,Number(round.number),'match:'+match.id,match.task);
 for(const event of data.gameWinEvents??[]){const round=Number(event.round),row=byId.get(event.groupId);if(event.status!=='active'||Number(event.activity)!==1||![3,4].includes(round)||!row||!sameMembers(event.playerIds,row.playerIds))continue;if(round===3)add(row.groupId,3,'round3:'+row.groupId,event.task);else{const question=Number(event.questionIndex??1);if(Number.isInteger(question)&&question>=1&&question<=8)add(row.groupId,4,'word:'+row.groupId+':'+question,event.task);}}
 rows.sort((a,b)=>b.total-a.total||String(a.groupId).localeCompare(String(b.groupId)));
 const top=rows[0]?.total??0,candidateIds=top>0?rows.filter(row=>row.total===top).map(row=>row.groupId):[];
 // Only activity results and team identity determine the champion. Global
 // scores, this reward, player profile changes and other games never feed back.
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([data.event?.id??'',Number(state?.round??1),rows.map(row=>[row.groupId,row.playerIds,row.categories.map(c=>[c.round,c.events])])])).digest('hex');
 return{rows,candidateIds,top,fingerprint};
}
// Legacy awards contain one groupId. Keep their original score-event IDs and
// credit until the host confirms all leaders; expanding the record then adds
// only the missing players rather than reversing and reissuing existing points.
function awardedGroups(award){return Array.isArray(award?.groups)?award.groups:award?.groupId?[{groupId:award.groupId,playerIds:award.playerIds}]:[];}
function validAward(data,base=summaryBase(data)){
 const award=data.pairSummaryAward,groups=awardedGroups(award),groupIds=groups.map(group=>group.groupId);
 if(award?.status!=='active'||award.eventId!==data.event?.id||award.fingerprint!==base.fingerprint||!groups.length||new Set(groupIds).size!==groups.length)return false;
 if(Array.isArray(award.groups)&&(!sameMembers(award.groupIds,base.candidateIds)||!sameMembers(groupIds,base.candidateIds)||!sameMembers(award.playerIds,groups.flatMap(group=>group.playerIds??[]))))return false;
 return groups.every(group=>{const row=base.rows.find(x=>x.groupId===group.groupId);return base.candidateIds.includes(group.groupId)&&row&&sameMembers(group.playerIds,row.playerIds)&&row.playerIds.length&&row.playerIds.every(id=>(data.players??[]).some(p=>p.id===id));});
}
function pairSummaryScoreEvents(data){
 if(!validAward(data))return[];const award=data.pairSummaryAward;
 return unique(awardedGroups(award).flatMap(group=>group.playerIds??[])).map(id=>{const p=data.players.find(p=>p.id===id);return{...person(p),id:'pairs:champion:'+award.id+':'+id,playerId:id,kind:'pairs',activity:'今晚谁最搭',round:5,task:'今晚谁最搭活动累计积分最高组 · 每个人各加5分积分',at:award.updatedAt,points:5,scoreOnly:true,reason:'pair-champion',sourceLabel:'今晚谁最搭冠军奖励'};});
}
function invalidatePairSummaryAward(data){if(data.pairSummaryAward?.status!=='active'||validAward(data))return false;data.pairSummaryAward={...data.pairSummaryAward,status:'stale',version:(Number(data.pairSummaryAward.version)||0)+1,updatedAt:new Date().toISOString()};return true;}
function buildPairSummary(data){
 const base=summaryBase(data),record=data.pairSummaryAward,active=validAward(data,base),groups=awardedGroups(record),groupIds=groups.map(group=>group.groupId);
 return{eventId:data.event?.id??'',resetEpoch:data.resetEpoch??0,round:Number(data.states?.pairs?.value?.round??1),...base,players:(data.players??[]).map(person),requiresPK:false,award:{version:record?.version??0,active,complete:active&&sameMembers(groupIds,base.candidateIds),stale:record?.status==='stale'||record?.status==='active'&&!active,groupId:record?.groupId??null,groupIds,playerIds:record?.playerIds??[],resolvedByPK:!!record?.resolvedByPK},note:'仅累计本次今晚谁最搭第一至第四轮已确认的活动得分。每次真实胜利或猜中为该组记1分，不把两位搭档的个人分重复相加；轮空、其他游戏、主持人手动分和冠军奖励不参与排名。所有并列最高分组的每位实际成员各加5分，单人成队只给本人加一次。'};
}
function createPairSummaryService({store,isEligible,AppError=Error}){
 const fail=(message,status=400)=>{throw new AppError(message,status)},list=()=>buildPairSummary(store.data);
 const guard=(body,summary)=>{if(body.eventId!==summary.eventId||Number(body.resetEpoch)!==summary.resetEpoch)fail('活动已更换或清空，请重新打开今晚谁最搭总结',409);if(body.fingerprint!==summary.fingerprint)fail('活动得分或分组已更新，请按最新记录重新揭晓',409);};
 const award=(body={})=>{
  const summary=list();guard(body,summary);const previous=store.data.pairSummaryAward;
  if(body.groupIds!==undefined&&(!Array.isArray(body.groupIds)||!sameMembers(body.groupIds,summary.candidateIds)))fail('请确认全部当前累计活动得分最高的组合');
  if(body.groupId!==undefined&&body.groupId!==null&&!summary.candidateIds.includes(String(body.groupId)))fail('请选择当前累计活动得分最高的候选组合');
  if(previous?.status==='active'&&summary.award.complete)return{...summary,duplicate:true};
  if(Number(body.version)!==summary.award.version)fail('冠军奖励已更新，请刷新后再确认',409);
  if(summary.round!==4)fail('请先完成前面的环节，再在第四轮后揭晓总结');
  if(!summary.candidateIds.length)fail('还没有已确认的今晚谁最搭活动得分，不能生成冠军');
  const groups=summary.candidateIds.map(groupId=>{const row=summary.rows.find(x=>x.groupId===groupId),group=store.data.states?.pairs?.value?.groups?.find(g=>g.id===groupId);if(!isPairTeamEligible(group,store.data.players,isEligible))fail('获奖组有未签到、已离场或未参与玩家，或队伍名额不正确，请先核对状态');return{groupId,playerIds:row.playerIds};});
  store.commit(data=>{data.pairSummaryAward={id:previous?.id??crypto.randomUUID(),version:summary.award.version+1,formatVersion:2,eventId:summary.eventId,status:'active',fingerprint:summary.fingerprint,groupId:groups.length===1?groups[0].groupId:null,groupIds:summary.candidateIds,groups,playerIds:unique(groups.flatMap(group=>group.playerIds)),resolvedByPK:false,updatedAt:new Date().toISOString()};return{};});return{...list(),duplicate:false};
 };
 const revoke=(body={})=>{const summary=list();guard(body,summary);const previous=store.data.pairSummaryAward;if(!previous||previous.status==='revoked')return{...summary,duplicate:true};if(Number(body.version)!==summary.award.version)fail('冠军奖励已更新，请刷新后再撤销',409);store.commit(data=>{data.pairSummaryAward={...previous,status:'revoked',version:previous.version+1,updatedAt:new Date().toISOString()};return{};});return{...list(),duplicate:false};};
 return(action,body)=>{if(action==='list')return list();if(action==='award')return award(body);if(action==='revoke')return revoke(body);fail('没有这个今晚谁最搭总结操作',404);};
}
module.exports={ROUND_NAMES,buildPairSummary,pairSummaryScoreEvents,invalidatePairSummaryAward,createPairSummaryService};
