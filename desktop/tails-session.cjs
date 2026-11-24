'use strict';
const crypto=require('node:crypto');
function createTailsService({store,isEligible,shuffle,AppError=Error}){
 const previews=new Map(),roster=()=>JSON.stringify(store.data.players.filter(isEligible).map(p=>[p.id,p.name,p.number,p.photo??'']).sort((a,b)=>a[0].localeCompare(b[0])));
 const makeGroups=()=>{const ids=shuffle(store.data.players.filter(isEligible).map(p=>p.id));if(ids.length<3)throw new AppError('至少需要3位已签到并参与的玩家');const groups=[];for(let i=0;i<3;i++)groups.push(ids.splice(0,Math.floor(ids.length/(3-i))+(ids.length%(3-i)?1:0)));return groups};
 const newRound=(groups,s)=>({formatVersion:3,roundId:crypto.randomUUID(),groups:structuredClone(groups),winners:[],awards:[],endsAt:Date.now()+3*60000,settlements:s.settlements??[]});
 return function tails(action,b={}){
  if(action==='cancel'){previews.delete(b.token);return{ok:true}}
  const state=store.state('tails'),s=state.value??{};
  if(b.eventId!==store.data.event.id||Number(b.version)!==state.version)throw new AppError('活动或分组已经更新，请重新读取后操作',409);
  if(action==='prepare'){
   const groups=makeGroups(),token=crypto.randomUUID();previews.clear();previews.set(token,{groups,version:state.version,eventId:store.data.event.id,resetEpoch:store.data.resetEpoch??0,roster:roster()});return{token,groups:structuredClone(groups)};
  }
  if(action==='commit'){
   const preview=previews.get(b.token);previews.delete(b.token);
   if(!preview)throw new AppError('本次分组已失效，请重新分组',409);
   if(preview.version!==state.version||preview.eventId!==store.data.event.id||preview.resetEpoch!==(store.data.resetEpoch??0))throw new AppError('活动或分组已经更新，请重新分组',409);
   if(preview.roster!==roster())throw new AppError('玩家名单或照片已变化，请重新分组',409);
   const value=newRound(preview.groups,s);return{...store.putState('tails',value,state.version),value};
  }
  if(action==='start'){
   const value=newRound(makeGroups(),s);previews.clear();
   return{...store.putState('tails',value,state.version),value};
  }
  if(action==='settle'){
   if(s.formatVersion!==3||s.groups?.length!==3)throw new AppError('请先将已签到玩家分为3组');
   const winners=b.winners;if(!Array.isArray(winners)||winners.length!==3||new Set(winners.map(w=>w.playerId)).size!==3)throw new AppError('请选择三组各自的冠军，玩家不能重复');
   winners.forEach((w,i)=>{if(!s.groups[i].includes(w.playerId))throw new AppError('请选择对应组的冠军');if(!isEligible(store.data.players.find(p=>p.id===w.playerId)))throw new AppError('冠军未签到或已离场');if(!Number.isSafeInteger(w.count)||w.count<0||w.count>1000000)throw new AppError('尾巴数请输入0至1000000之间的整数')});
   const tied=new Set(winners.map(w=>w.count)).size<3,order=b.rankOrder;
   if(tied&&(!Array.isArray(order)||new Set(order).size!==3||winners.some(w=>!order.includes(w.playerId))))throw new AppError('尾巴数相同，请由主持人指定加赛后的排名');
   const ranked=winners.map(w=>({...w})).sort((a,z)=>z.count-a.count||(order?.indexOf(a.playerId)??0)-(order?.indexOf(z.playerId)??0)).map((w,i)=>({...w,rank:i+1,points:3-i}));
   const settlement={id:s.roundId,ranked,at:s.settlements?.find(r=>r.id===s.roundId)?.at??new Date().toISOString()};
   const value={...s,winners:structuredClone(winners),awards:ranked,settlements:[...(s.settlements??[]).filter(r=>r.id!==s.roundId),settlement]};
   return{...store.putState('tails',value,state.version),value};
  }
  throw new AppError('没有这个抢尾巴操作');
 };
}
module.exports={createTailsService};
