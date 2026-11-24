'use strict';
const definitions=Object.values(require('./award-definitions.json')).filter(d=>d.source==='host');
const allowed=new Set(definitions.map(d=>d.id));
function manualAwardsState(data,AppError=Error){
 const state=data.manualAwards??{version:0,records:{}};
 if(!Number.isSafeInteger(state.version)||state.version<0||!state.records||typeof state.records!=='object'||Array.isArray(state.records))throw new AppError('手工奖项存档格式不正确，请保留存档并重新读取');
 return state;
}
function createManualAwardsService({store,AppError=Error}){
 const fail=(message,status=400)=>{throw new AppError(message,status)};
 const list=()=>{const state=manualAwardsState(store.data,AppError);return{eventId:store.data.event.id,version:state.version,records:structuredClone(state.records),definitions:structuredClone(definitions)}};
 const check=body=>{
  if(typeof body.eventId!=='string'||body.eventId!==store.data.event.id)fail('活动已重置，请重新打开手工奖项后操作',409);
  const state=manualAwardsState(store.data,AppError);if(!Number.isSafeInteger(body.version)||body.version!==state.version)fail('手工奖项已被更新，请刷新后再保存',409);
  if(!allowed.has(body.awardId))fail('没有这个可编辑的手工奖项',404);
  if(state.version===Number.MAX_SAFE_INTEGER)fail('奖项版本已达到上限，请保留存档并重建活动');
  return state;
 };
 const save=(body={})=>{
  const state=check(body),ids=body.winnerIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>store.data.players.length||ids.some(id=>typeof id!=='string'||!store.data.players.some(p=>p.id===id))||new Set(ids).size!==ids.length)fail('请至少选择一位现有玩家，名单不能重复；已离场玩家也可以获奖');
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>1000)fail('请填写1至1000字的评选理由');
  const record={awardId:body.awardId,winnerIds:[...ids],winners:ids.map(id=>{const p=store.data.players.find(p=>p.id===id);return{id:p.id,name:p.name,number:p.number,photo:p.photo??''}}),reason:body.reason.trim(),source:'host',updatedAt:new Date().toISOString(),eventId:store.data.event.id};
  store.commit(data=>{data.manualAwards={version:state.version+1,records:{...state.records,[body.awardId]:record}};return{}});return list();
 };
 const clear=(body={})=>{const state=check(body),records={...state.records};delete records[body.awardId];store.commit(data=>{data.manualAwards={version:state.version+1,records};return{}});return list()};
 return{list,save,clear};
}
module.exports={createManualAwardsService,manualAwardsState};
