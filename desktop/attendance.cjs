'use strict';
// Missing attendance is compatible with all older local archives.
function isEligible(player){return !!player&&!!player.active&&(player.attendance===undefined||player.attendance==='present')}
function assertMissionAvailable(data,mission,AppError){
 const people=[mission.actor,mission.target].map(id=>data.players.find(p=>p.id===id));
 if(people.some(p=>!isEligible(p)))throw new AppError('任务参与者未到、已离场或暂停参与，恢复到场后才可继续验收');
}
function setAttendance(store,body,AppError){
 const previous=store.player(body.id);
 if(!['present','away'].includes(body.attendance))throw new AppError('出席状态不正确');
 if(Number(body.version)!==Number(previous.version??0))throw new AppError('这位玩家已被更新，请重新读取档案再操作',409);
 return store.commit(data=>{
  const player=data.players.find(p=>p.id===previous.id);
  const timestamp=new Date().toISOString();
  player.attendance=body.attendance;player.attendanceUpdatedAt=timestamp;player.version=Number(player.version??0)+1;
  if(body.attendance==='present')player.checkedInAt=timestamp;
  else player.lastCheckOutAt=timestamp;
  if(body.attendance==='away'){
   const revise=(kind,edit)=>{const state=data.states[kind];if(!state?.value)return;const next=edit(structuredClone(state.value));if(next)data.states[kind]={value:next,version:state.version+1}};
   revise('draw',value=>value.player===player.id?{...value,player:'',endsAt:0}:null);
   revise('crop',value=>value.current===player.id?{...value,current:'',frame:'',revealed:false,rangePercent:10,step:1}:null);
   revise('truth',value=>value.cast?.includes(player.id)?{...value,cast:value.cast.filter(id=>id!==player.id),revealed:false}:null);
   revise('fans',value=>(value.a===player.id||value.b===player.id)?{...value,a:value.a===player.id?'':value.a,b:value.b===player.id?'':value.b}:null);
   // Retire a projection before it can expose an outdated live selection. Scores,
   // pair records, draw history and private task assignments stay in their archives.
   const screen=data.states.screen;if(screen?.value)data.states.screen={value:null,version:screen.version+1};
  }
  return{player};
 });
}
module.exports={isEligible,setAttendance,assertMissionAvailable};
