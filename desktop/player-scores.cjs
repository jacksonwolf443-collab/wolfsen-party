'use strict';
const MAX_DELTA=1000000,MAX_SCORE=1000000000;
const {labels,displayActivityText}=require('./activity-labels.cjs');
function displayScoreEntry(entry){const result=structuredClone(entry),kind=result.source?.kind;if(labels[kind]){for(const key of ['note','sourceLabel'])result[key]=displayActivityText(result[key],kind);if(result.source.activity)result.source.activity=labels[kind];if(String(result.eventId??'').startsWith('pairs:champion:'))result.task=displayActivityText(result.task,'pairs')}return result}
function scoreValue(player,ErrorType=Error){const value=player?.score===undefined?0:player.score;if(!Number.isSafeInteger(value)||Math.abs(value)>MAX_SCORE)throw new ErrorType('玩家积分存档无效');return value}
function normalizeScoreData(data,ErrorType=Error){for(const p of data.players??[]){scoreValue(p,ErrorType);if(p.score===undefined)p.score=0}if(data.scoreHistory===undefined)data.scoreHistory=[];if(!Array.isArray(data.scoreHistory))throw new ErrorType('积分记录存档无效');return data}
function comparePlayers(a,b){return scoreValue(b)-scoreValue(a)||String(a.number).localeCompare(String(b.number),'zh-CN',{numeric:true})||String(a.number).localeCompare(String(b.number))||String(a.id).localeCompare(String(b.id))}
function rankPlayers(players){let previous,rank=0;return [...players].sort(comparePlayers).map((p,i)=>{const score=scoreValue(p);if(i===0||score!==previous)rank=i+1;previous=score;return{...structuredClone(p),score,rank}})}
function createPlayerScores(store,ErrorType=Error){
 const list=()=>({players:rankPlayers(store.data.players),history:[...(store.data.scoreHistory??[])].reverse().map(displayScoreEntry)});
 const detail=(body={})=>{const player=store.data.players.find(p=>p.id===String(body.playerId??''));if(!player)throw new ErrorType('找不到这位玩家',404);const entries=(store.data.scoreHistory??[]).filter(x=>x.playerId===player.id).map(displayScoreEntry).map(x=>({...x,type:x.type??'manual',sourceLabel:x.sourceLabel??(x.note?'主持人调整 · '+x.note:'主持人手动调整'),task:x.task??''}));for(const opening of store.data.scoreOpeningBalances??[])if(opening.playerId===player.id&&opening.balance)entries.unshift({type:'opening',actionId:'opening-'+player.id,playerId:player.id,delta:opening.balance,before:0,after:opening.balance,sourceLabel:'迁移前已有积分',task:'旧存档中的积分余额，原分数已保留',createdAt:opening.createdAt});return{player:structuredClone(player),score:scoreValue(player,ErrorType),entries:entries.reverse()};};
 const adjust=(body={})=>{
  const actionId=typeof body.actionId==='string'?body.actionId.trim():'';
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(actionId)||actionId.startsWith('auto-'))throw new ErrorType('请提供有效的积分操作编号');
  const delta=typeof body.delta==='number'?body.delta:typeof body.delta==='string'&&/^[+-]?\d+$/.test(body.delta.trim())?Number(body.delta.trim()):NaN;
  if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>MAX_DELTA)throw new ErrorType('积分调整请输入非零整数，单次最多正负1000000分');
  const playerId=String(body.playerId??''),previous=(store.data.scoreHistory??[]).find(x=>x.actionId===actionId);
  if(previous){if(previous.playerId!==playerId||previous.delta!==delta)throw new ErrorType('积分操作编号已使用，不能重复用于其他调整',409);return{duplicate:true,player:structuredClone(store.data.players.find(p=>p.id===playerId)??null),entry:structuredClone(previous)}}
  const player=store.data.players.find(p=>p.id===playerId);if(!player)throw new ErrorType('找不到这位玩家',404);
  const before=scoreValue(player,ErrorType),after=before+delta;if(!Number.isSafeInteger(after)||Math.abs(after)>MAX_SCORE)throw new ErrorType('累计积分不能超过正负1000000000分');
  const entry={type:'manual',actionId,playerId,playerName:player.name,playerNumber:player.number,delta,before,after,note:String(body.note??'').trim().slice(0,200),createdAt:new Date().toISOString()};
  return store.commit(data=>{const current=data.players.find(p=>p.id===playerId);current.score=after;current.version=Number(current.version??0)+1;(data.scoreHistory??=[]).push(entry);return{player:current,entry,duplicate:false}});
 };
 return{list,adjust,detail};
}
module.exports={MAX_DELTA,MAX_SCORE,scoreValue,normalizeScoreData,rankPlayers,createPlayerScores,displayScoreEntry};
