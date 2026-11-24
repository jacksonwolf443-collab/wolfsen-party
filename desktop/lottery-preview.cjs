'use strict';
const crypto=require('node:crypto');
const {fairPlayers}=require('./party-selection.cjs');
function createLotteryPreview({store,isEligible,shuffle,AppError}){
 const pending=new Map();
 const roster=()=>JSON.stringify(store.data.players.filter(isEligible).map(p=>[p.id,p.name,p.number,p.photo]).sort((a,b)=>a[0].localeCompare(b[0])));
 const counts=()=>JSON.stringify(store.data.players.filter(isEligible).map(p=>[p.id,Number(store.data.selectionCounts?.[p.id])||0]).sort((a,b)=>a[0].localeCompare(b[0])));
 const checkVersion=version=>{if(Number(version)!==store.state('lottery').version)throw new AppError('该活动已被更新，请重新抽取',409)};
 return{
  draw(b){const pool=store.data.players.filter(isEligible),count=Number(b.count);if(!Number.isSafeInteger(count)||count<1||count>pool.length)throw new AppError('抽取人数必须是1至'+pool.length+'之间的整数');
   if(b.ids!==undefined&&(!Array.isArray(b.ids)||b.ids.length!==count||new Set(b.ids).size!==count||b.ids.some(id=>!pool.some(p=>p.id===id))))throw new AppError('手动名单须为已签到玩家且不能重复');
   checkVersion(b.version);const previous=store.state('lottery').value,chosen=b.ids?b.ids.map(id=>pool.find(p=>p.id===id)):fairPlayers(pool,store.data.selectionCounts??{},count,shuffle),value={count,drawnAt:Math.max(Date.now(),(Number(previous?.drawnAt)||0)+1),people:chosen.map(({id,name,number,photo})=>{const beforeCount=Number(store.data.selectionCounts?.[id])||0;return{id,name,number,photo,beforeCount,count:beforeCount+1,reason:b.ids?'主持人手动指定本轮玩家':beforeCount===0?'今晚还没被抽中过，优先请你上场':'今晚被抽中次数较少，同次数玩家中随机选出'}})};
   if(!b.preview)return{...store.putState('lottery',value,b.version),value};
   // Only the newest preview can be committed. It is never part of a backup or save.
   pending.clear();const token=crypto.randomUUID();pending.set(token,{value,roster:roster(),counts:counts(),version:store.state('lottery').version});return{token,...structuredClone(value)};
  },
  cancel(b){pending.delete(b.token);return{ok:true}},
  commit(b){const p=pending.get(b.token);pending.delete(b.token);if(!p)throw new AppError('本次抽签已失效，请重新抽取',409);
   checkVersion(b.version);if(p.version!==store.state('lottery').version)throw new AppError('该活动已被更新，请重新抽取',409);
   if(p.roster!==roster())throw new AppError('玩家名单已变化，请重新抽取',409);
   if(p.counts!==counts())throw new AppError('今晚的上场次数已变化，请重新抽取',409);
   return{...store.putState('lottery',p.value,p.version),value:structuredClone(p.value)};
  }
 };
}
module.exports={createLotteryPreview};
