'use strict';
const crypto=require('node:crypto');
function createMissionSupplementService({store,isEligible,AppError,shuffle}){
 return{append(body={}){
  const data=store.data,round=store.round();
  if(body.eventId!==data.event.id)throw new AppError('活动已重置，请重新打开后再补发任务',409);
  if(!round||body.roundId!==round.id)throw new AppError('任务轮已变化，请重新读取后再补发',409);
  if(round.ended)throw new AppError('本轮已结束，不能再补发任务');
  const players=data.players.filter(isEligible);if(players.length<2)throw new AppError('至少需要2名已签到并参与的玩家');
  const assigned=new Set(data.missions.filter(m=>m.round===round.id).map(m=>m.actor)),newcomers=players.filter(p=>!assigned.has(p.id));
  if(body.actorIds!==undefined){if(!Array.isArray(body.actorIds)||!body.actorIds.length||new Set(body.actorIds).size!==body.actorIds.length||body.actorIds.some(id=>!newcomers.some(p=>p.id===id)))throw new AppError('请选择已签到且本轮尚无任务的玩家');newcomers.splice(0,newcomers.length,...newcomers.filter(p=>body.actorIds.includes(p.id)));}
  if(!newcomers.length)return{added:0,actorIds:[],roundId:round.id};
  const bank=(data.states.taskBank?.value??[]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());if(!bank.length)throw new AppError('请先填写并保存至少一道任务');
  const tasks=shuffle(bank),codes=new Set(data.missions.filter(m=>m.round===round.id).map(m=>m.code)),incoming=new Map(players.map(p=>[p.id,data.missions.filter(m=>m.round===round.id&&m.target===p.id).length]));
  const additions=shuffle(newcomers).map((actor,index)=>{const choices=shuffle(players.filter(p=>p.id!==actor.id)),least=Math.min(...choices.map(p=>incoming.get(p.id))),target=choices.find(p=>incoming.get(p.id)===least);incoming.set(target.id,incoming.get(target.id)+1);let code;do{code=String(crypto.randomInt(0,1000000)).padStart(6,'0')}while(codes.has(code));codes.add(code);return{id:crypto.randomUUID(),round:round.id,actor:actor.id,target:target.id,actorName:actor.name,actorNumber:actor.number,targetName:target.name,targetNumber:target.number,task:tasks[index%tasks.length],code,completed_at:null,supplemental:true,assignedAt:new Date().toISOString()}});
  return store.commit(next=>{if(next.event.id!==body.eventId||next.missionRound?.id!==round.id||next.missionRound.ended||Date.now()>=next.missionRound.endsAt)throw new AppError('任务轮已变化或结束，本次未补发',409);next.missions.push(...additions);return{added:additions.length,actorIds:additions.map(m=>m.actor),roundId:round.id}});
 }};
}
module.exports={createMissionSupplementService};
