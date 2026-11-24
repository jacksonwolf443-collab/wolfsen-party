'use strict';
const crypto=require('node:crypto');
const defaultChallenges=[
 '全队俯卧撑：双方各派相同人数，1分钟内全队完成的规范俯卧撑总数更多的一队获胜。',
 '接力跑：双方派出相同人数，按相同路线接力，全部队员先完成的一队获胜。',
 '同步深蹲：双方各派相同人数，1分钟内同步完成的规范深蹲轮数更多的一队获胜。',
 '传递气球：双方派出相同人数，按主持人规定的方式接力传递，先完成全部接力的一队获胜。',
 '应援合拍：双方用30秒准备一段全队应援动作，完成后由现场观众投票决定胜方。'
];
const copy=value=>structuredClone(value),text=value=>String(value??'').trim().slice(0,2000);
function recalculate(value){value.scoreA=value.rounds.filter(r=>r.winnerSide==='A').length;value.scoreB=value.rounds.filter(r=>r.winnerSide==='B').length;value.winner=value.scoreA>=3?'A':value.scoreB>=3?'B':null;return value;}
function migrateFansState(input){
 const source=copy(input??{}),modern=source.formatVersion===2,bank=source.challengeBank??(source.challenges?String(source.challenges).split(/\r?\n/).filter(Boolean):defaultChallenges);
 const value={...source,formatVersion:2,seriesId:modern&&source.seriesId?source.seriesId:crypto.randomUUID(),a:String(source.a??''),b:String(source.b??''),sloganA:text(source.sloganA),sloganB:text(source.sloganB),teamA:Array.isArray(source.teamA)?source.teamA:source.a?[source.a]:[],teamB:Array.isArray(source.teamB)?source.teamB:source.b?[source.b]:[],challengeBank:Array.from({length:5},(_,i)=>text(bank[i])),rounds:modern&&Array.isArray(source.rounds)?source.rounds:[],seriesHistory:Array.isArray(source.seriesHistory)?source.seriesHistory:[]};
 if(!modern&&input&&(source.scoreA||source.scoreB))value.legacyPrevious={scoreA:Number(source.scoreA)||0,scoreB:Number(source.scoreB)||0,challenges:String(source.challenges??''),note:'旧版三局两胜成绩，仅保留供查看；本次五局三胜从0比0开始。'};
 return recalculate(value);
}
function createFansService({store,isEligible,AppError=Error}){
 const fail=(message,status=400)=>{throw new AppError(message,status)},participant=id=>store.data.players.find(p=>p.id===id);
 const safe=p=>({id:p.id,name:p.name,number:p.number,photo:p.photo??''});
 return function fans(action,b={}){
  const state=store.state('fans');if(Number(b.version)!==state.version)fail('该活动已被更新，请刷新后再操作',409);
  const value=migrateFansState(state.value),write=()=>({...store.putState('fans',value,state.version),value:copy(value)});
  const captains=()=>{if(!value.a||!value.b||value.a===value.b)fail('请选择两位不同的队长');if(!isEligible(participant(value.a))||!isEligible(participant(value.b)))fail('队长未到、已离场或未参与，请先调整在场状态')};
  if(action==='partition'){
   const teamA=b.teamA,pool=store.data.players.filter(isEligible).map(p=>p.id);
   if(!Array.isArray(teamA)||!teamA.length||new Set(teamA).size!==teamA.length||teamA.some(id=>!pool.includes(id)))fail('请选择已签到且不重复的A组玩家');
   const teamB=pool.filter(id=>!teamA.includes(id));if(!teamB.length)fail('请至少为B组留一位玩家');
   if(b.roster&&JSON.stringify(b.roster.slice().sort())!==JSON.stringify(pool.slice().sort()))fail('签到名单已变化，请重新确认A组',409);
   const a=teamA.includes(b.a)?b.a:teamA.includes(value.a)?value.a:teamA[0],other=teamB.includes(b.b)?b.b:teamB.includes(value.b)?value.b:teamB[0];
   if(value.rounds.length&&(a!==value.a||other!==value.b))fail('已开始比赛，换队长请先重开决赛');
   Object.assign(value,{a,b:other,teamA:[...teamA],teamB,partitionRoster:[...pool]});return write();
  }
  if(action==='configure'){
   const a=String(b.a??value.a),other=String(b.b??value.b);if(!a||!other||a===other)fail('请选择两位不同的队长');
   if(value.rounds.length&&(a!==value.a||other!==value.b))fail('本场已经开始，修改队长请先重开决赛；原比分不会直接套用给新队长');
   if(!isEligible(participant(a))||!isEligible(participant(other)))fail('只能选择在场的队长');
   const teamA=[...new Set([a,...(Array.isArray(b.teamA)?b.teamA:value.teamA).map(String)])],teamB=[...new Set([other,...(Array.isArray(b.teamB)?b.teamB:value.teamB).map(String)])];
   if(teamA.some(id=>teamB.includes(id)))fail('同一位玩家不能重复加入两队');
   if([...teamA,...teamB].some(id=>!isEligible(participant(id))))fail('队员未到或已离场，请取消其队员勾选');
   Object.assign(value,{a,b:other,teamA,teamB,sloganA:b.sloganA===undefined?value.sloganA:text(b.sloganA),sloganB:b.sloganB===undefined?value.sloganB:text(b.sloganB)});
   if(b.challengeBank!==undefined){if(!Array.isArray(b.challengeBank))fail('挑战题库格式不正确');value.challengeBank=Array.from({length:5},(_,i)=>text(b.challengeBank[i]));}
   return write();
  }
  if(action==='result'){
   if(value.winner||value.rounds.length>=5)fail('本场五局三胜已经结束，请先撤销上一局或重开决赛');captains();
   if(Number(b.round)!==value.rounds.length+1)fail('本局轮次已变化，请刷新后再记录',409);
   if(!['A','B'].includes(b.winnerSide))fail('请选择本局获胜队伍');
   const ids=[...new Set([...value.teamA,...value.teamB])];if(ids.some(id=>!isEligible(participant(id))))fail('有队员已离场，请先在队员名单中取消勾选后再记录本局');
   const task=value.challengeBank[value.rounds.length];if(!task)fail('请先填写本局PK项目');
   value.rounds.push({id:crypto.randomUUID(),number:value.rounds.length+1,task,winnerSide:b.winnerSide,winnerIds:[...(b.winnerSide==='A'?value.teamA:value.teamB)],loserIds:[...(b.winnerSide==='A'?value.teamB:value.teamA)],teamA:[...value.teamA],teamB:[...value.teamB],players:ids.map(id=>safe(participant(id))),at:new Date().toISOString()});
   recalculate(value);if(value.winner)value.completedAt=new Date().toISOString();return write();
  }
  if(action==='undo'){
   if(!value.rounds.length)fail('还没有可撤销的比赛结果');value.rounds.pop();delete value.completedAt;recalculate(value);return write();
  }
  if(action==='reset'){
   if(!b.confirmed)fail('请确认重开决赛，当前逐局成绩会保留在历史记录中');
   if(value.rounds.length)value.seriesHistory.push({seriesId:value.seriesId,a:value.a,b:value.b,teamA:[...value.teamA],teamB:[...value.teamB],scoreA:value.scoreA,scoreB:value.scoreB,winner:value.winner,rounds:copy(value.rounds),completedAt:value.completedAt??null,closedAt:new Date().toISOString()});
   value.seriesId=crypto.randomUUID();value.rounds=[];delete value.completedAt;recalculate(value);return write();
  }
  fail('没有这个决赛操作');
 };
}
function fansProjection(input,players){
 const value=migrateFansState(input),find=id=>players.find(p=>p.id===id),safe=p=>p?{id:p.id,name:p.name,number:p.number,photo:p.photo??''}:null;
 return{activity:6,mode:'battle',title:value.winner?'王不见王 · 决赛胜利':'王不见王 · 五局三胜',tag:'五局三胜 · 先得3分获胜',subtitle:value.winner?(find(value[value.winner==='A'?'a':'b'])?.name??value.winner+'队')+'的应援队获胜':'第 '+(value.rounds.length+1)+' 局 / 最多5局',body:value.winner?'全队一起喊出队长的名字！':value.challengeBank[value.rounds.length]??'',winner:value.winner,seriesId:value.seriesId,people:['A','B'].map(side=>({...safe(find(value[side==='A'?'a':'b'])),name:find(value[side==='A'?'a':'b'])?.name??side+'队',score:value[side==='A'?'scoreA':'scoreB'],slogan:value[side==='A'?'sloganA':'sloganB'],team:side,members:value[side==='A'?'teamA':'teamB'].map(id=>safe(find(id))).filter(Boolean)})),rounds:copy(value.rounds)};
}
module.exports={defaultChallenges,migrateFansState,createFansService,fansProjection};
