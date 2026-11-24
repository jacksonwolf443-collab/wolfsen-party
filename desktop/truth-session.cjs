'use strict';
const TITLE='谁是最有趣开心的人';
const REASONS={participation:'参与表演',recognition:'观众认同',custom:'主持人自定积分'};
const stateValue=value=>value?.formatVersion===2?value:{formatVersion:2,currentRound:1,entries:[]};
function talentScoreEvents(data){
 const value=stateValue(data.states?.truth?.value),events=[];
 for(const entry of value.entries??[])if(entry.status==='active')for(const playerId of new Set(entry.playerIds??[])){const player=data.players.find(p=>p.id===playerId)??entry.players?.find(p=>p.id===playerId);events.push({id:'talent:'+entry.id+':'+playerId,playerId,name:player?.name??playerId,number:player?.number??'—',photo:player?.photo??'',kind:'truth',activity:TITLE,round:entry.round,task:entry.task,points:entry.points,reason:entry.reason,scoreOnly:true,at:entry.updatedAt,sourceLabel:TITLE+' · 第'+entry.round+'轮 · '+REASONS[entry.reason],genericEventId:entry.id})}
 return events;
}
function createTruthService({store,isEligible,AppError=Error}){
 const fail=(message,status=400)=>{throw new AppError(message,status)};
 const list=()=>({value:structuredClone(stateValue(store.state('truth').value)),version:store.state('truth').version});
 return function talent(action,body={}){
  if(action==='list')return list();
  if(!['save','revoke'].includes(action))fail('没有这个才艺活动操作',404);
  if(body.partyEventId!==store.data.event.id||body.resetEpoch!==(store.data.resetEpoch??0))fail('活动已经更新或清空，请重新读取后操作',409);
  const state=store.state('truth'),value=stateValue(state.value),id=String(body.id??'');
  if(!/^[\p{L}\p{N}_:.-]{1,200}$/u.test(id))fail('请提供有效的积分记录编号');
  const previous=(value.entries??[]).find(x=>x.id===id);
  let entry;
  if(action==='revoke'){
   if(!previous)fail('找不到这条才艺积分记录',404);
   if(previous.status==='revoked')return{...list(),entry:structuredClone(previous),duplicate:true};
   entry={...previous,status:'revoked'};
  }else{
   const playerIds=[...new Set((Array.isArray(body.playerIds)?body.playerIds:[]).map(String))].sort(),points=typeof body.points==='number'?body.points:typeof body.points==='string'&&/^[+-]?\d+$/.test(body.points.trim())?Number(body.points.trim()):NaN,round=Number(body.round),reason=String(body.reason??'custom'),task=String(body.task??'').trim().slice(0,2000);
   if(!playerIds.length)fail('请选择至少一位已签到玩家');
   if(playerIds.some(id=>!isEligible(store.data.players.find(p=>p.id===id))))fail('只能为已签到且参与的玩家登记，所选玩家未到或已离场');
   if(!Number.isSafeInteger(points)||!points||Math.abs(points)>1000000)fail('积分请输入非零整数，单次最多正负1000000分');
   if(!Number.isSafeInteger(round)||round<1)fail('轮次请输入正整数');
   if(!Object.hasOwn(REASONS,reason))fail('请选择有效的计分项目');
   if(reason!=='custom'&&points!==3)fail('参与表演和观众认同各加3分，其他分值请选择自定积分');
   if(reason!=='custom'&&(value.entries??[]).some(x=>x.id!==id&&x.round===round&&x.reason===reason&&x.playerIds?.some(p=>playerIds.includes(p))))fail('本轮该玩家已有这项积分记录，请更正原记录，不能重复登记',409);
   entry={id,round,playerIds,points,reason,task,status:'active',players:playerIds.map(id=>{const p=store.player(id);return{id:p.id,name:p.name,number:p.number,photo:p.photo??''}})};
   if(previous&&['round','points','reason','task','status'].every(key=>entry[key]===previous[key])&&JSON.stringify(playerIds)===JSON.stringify(previous.playerIds))return{...list(),entry:structuredClone(previous),duplicate:true};
  }
  if(Number(body.version)!==state.version)fail('才艺积分已更新，请重新读取后更正',409);
  if(previous&&Number(body.entryVersion??previous.version)!==previous.version)fail('这条积分已更新，请重新读取后更正',409);
  const now=new Date().toISOString();entry={...entry,version:(previous?.version??0)+1,createdAt:previous?.createdAt??now,updatedAt:now};
  const next={...value,formatVersion:2,currentRound:Math.max(value.currentRound??1,entry.round),entries:[...(value.entries??[]).filter(x=>x.id!==id),entry]};
  return{...store.putState('truth',next,state.version),value:next,entry,duplicate:false};
 };
}
module.exports={createTruthService,talentScoreEvents,TITLE,REASONS};
