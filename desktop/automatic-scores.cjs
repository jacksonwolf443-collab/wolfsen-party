'use strict';
const crypto=require('node:crypto');
const {allWinEvents,victorySource,captureDrawSuccess}=require('./party-summary.cjs');
const {invalidatePairSummaryAward}=require('./pair-summary.cjs');
const {isPairTeamEligible}=require('./pair-team-rules.cjs');
const {labels,voiceActivityKinds,displayWinEvent,displayGameWinEvent}=require('./activity-labels.cjs');
const MAX_SCORE=1000000000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reconcileAutomaticScores(data,ErrorType=Error){
 let changed=invalidatePairSummaryAward(data);
 if(data.autoScoreVersion!==1){data.autoScoreVersion=1;data.autoScoreLedger=[];data.scoreOpeningBalances=(data.players??[]).map(p=>({playerId:p.id,balance:(Number(p.score)||0)-(data.scoreHistory??[]).filter(x=>x.playerId===p.id).reduce((a,x)=>a+(Number(x.delta)||0),0),createdAt:new Date().toISOString()})).filter(x=>x.balance);changed=true;}
 data.autoScoreLedger??=[];data.scoreHistory??=[];data.scoreOpeningBalances??=[];
 const drawHistoryLength=data.drawSuccessHistory?.length??0;captureDrawSuccess(data,data.states?.draw?.value);if((data.drawSuccessHistory?.length??0)!==drawHistoryLength)changed=true;
 const wanted=new Map(allWinEvents(data).map(x=>[x.id,x])),records=new Map(data.autoScoreLedger.map(x=>[x.id,x]));
 // Corrections audit their net change, retaining the original contribution's
 // history without checking an artificial reversal balance at a valid boundary.
 const apply=(record,active,event,correctionDelta)=>{event=displayWinEvent(event);const player=data.players.find(p=>p.id===event.playerId);if(!player)return;const delta=correctionDelta??(active?1:-1)*(event.points??1),before=Number(player.score)||0,after=before+delta;if(!Number.isSafeInteger(after)||Math.abs(after)>MAX_SCORE)throw new ErrorType('累计积分不能超过正负1000000000分，请先调整积分再确认结果');const revision=(Number(record.revision)||0)+1,sourceLabel=(event.sourceLabel??victorySource(event))+(correctionDelta!==undefined?' · 记录更正':active?'':' · 撤销'),entry={type:'automatic',actionId:'auto-'+crypto.createHash('sha256').update(event.id).digest('hex').slice(0,32)+'-'+revision,playerId:player.id,playerName:player.name,playerNumber:player.number,delta,before,after,note:sourceLabel,sourceLabel,task:String(event.task??''),eventId:event.id,source:{kind:event.kind,activity:event.activity,round:event.round??null,reason:active?(event.reason??'victory'):'reversal',genericEventId:event.genericEventId??null},createdAt:new Date().toISOString()};player.score=after;player.version=Number(player.version??0)+1;data.scoreHistory.push(entry);Object.assign(record,{id:event.id,active,event:structuredClone(event),revision,lastActionId:entry.actionId});changed=true;};
 // Display-name changes do not alter the original saved scoring evidence or
 // create a zero-point correction. Real result/task changes still reconcile.
 for(const [id,event]of wanted){let record=records.get(id);if(!record){record={id,active:false,revision:0,event:structuredClone(event)};data.autoScoreLedger.push(record);records.set(id,record)}const previous=displayWinEvent(record.event);if(record.active&&(record.event.points??1)!==(event.points??1))apply(record,true,event,(event.points??1)-(record.event.points??1));else if(record.active&&event.scoreOnly&&['task','round','reason','sourceLabel'].some(key=>previous[key]!==event[key]))apply(record,true,event,0);else if(!record.active)apply(record,true,event);else if(JSON.stringify(previous)!==JSON.stringify(event)){record.event=structuredClone(event);changed=true;}}
 for(const record of data.autoScoreLedger)if(record.active&&!wanted.has(record.id))apply(record,false,record.event);
 return changed;
}
function roundKey(value){const text=String(value??1).normalize('NFKC').trim();return /^\d+$/.test(text)?String(Number(text)):text;}
function pairQuestionIndex(event){return event.activity===1&&Number(event.round)===4?Number(event.questionIndex??1):null;}
function createGameWins(store,{isEligible,AppError=Error}){
 const kinds={1:'pairs',2:'truth',3:'tails',4:'draw',5:'crop',6:'fans',7:'missions',...voiceActivityKinds},fail=(m,status=400)=>{throw new AppError(m,status)};
 const checkScope=({partyEventId,resetEpoch},requireScope,message)=>{
  const data=store.data;
  if(((requireScope||partyEventId!==undefined)&&partyEventId!==data.event.id)||
     ((requireScope||resetEpoch!==undefined)&&resetEpoch!==(data.resetEpoch??0)))fail(message,409);
 };
 const checkEligible=playerIds=>{if(playerIds.some(id=>!isEligible(store.data.players.find(p=>p.id===id))))fail('获胜玩家未到、离场或未参与，请重新选择');};
 const checkBlindfold=event=>{if(event.activity===1&&Number(event.round)===3&&Object.prototype.hasOwnProperty.call(store.state('pairs').value?.tournament?.blindfoldResults??{},event.groupId))fail('请在第三轮晋级/淘汰面板更正本组结果',409)};
 const list=(b={})=>({events:(store.data.gameWinEvents??[]).filter(x=>b.activity===undefined||Number(b.activity)===x.activity).map(displayGameWinEvent)});
 const win=(body={})=>{
  const activity=Number(body.activity),kind=kinds[activity],voice=!!voiceActivityKinds[activity];
  const suppliedId=String(body.eventId??''),eventId=voice?suppliedId.toLowerCase():suppliedId;
  const staleMessage='活动已清空，旧胜利确认已忽略';
  if((store.data.retiredGameWinEventIds??[]).includes(voice?eventId:body.eventId))fail(staleMessage,409);
  checkScope(body,voice,staleMessage);
  const validId=voice?typeof body.eventId==='string'&&UUID.test(eventId):/^[\p{L}\p{N}_:.-]{1,200}$/u.test(eventId);
  if(!validId)fail('请提供有效的本轮胜利编号');
  if(!kind)fail('请选择有效的游戏活动');
  if(!voice&&![1,2].includes(activity))fail('该游戏已有自动结果计分，请使用对应游戏的确认结果按钮');
  if(voice&&(!Number.isSafeInteger(body.round)||body.round<1))fail('本轮编号无效');
  const roundInput=body.round??1;
  if(!['string','number'].includes(typeof roundInput)||typeof roundInput==='number'&&(!Number.isSafeInteger(roundInput)||roundInput<1))fail('本轮编号无效');
  const key=roundKey(roundInput),round=/^\d+$/.test(key)?Number(key):key;
  if(!key||key.length>100||typeof round==='number'&&(!Number.isSafeInteger(round)||round<1))fail('本轮编号无效');
  const submittedPlayers=Array.isArray(body.playerIds)?body.playerIds:[];
  if(voice&&(submittedPlayers.length!==1||typeof submittedPlayers[0]!=='string'))fail('每轮请选择一位获胜玩家');
  const playerIds=[...new Set(submittedPlayers.map(String))].sort();
  if(!voice){
   if(!playerIds.length||playerIds.length>store.data.players.length)fail('请选择本轮获胜的玩家');
   checkEligible(playerIds);
  }
  const groupId=body.groupId?String(body.groupId):null;
  if((activity===2||voice)&&body.groupId!==undefined&&body.groupId!==null)fail((voice?'本活动':'当事人游戏')+'每轮统一登记，不使用额外分组编号');
  const questionIndex=pairQuestionIndex({activity,round,questionIndex:body.questionIndex});
  checkBlindfold({activity,round,groupId});
  if(activity===1){const state=store.state('pairs').value,g=state?.groups?.find(g=>g.id===groupId),baseId='pairs:'+round+':'+groupId;if(![3,4].includes(Number(round)))fail('今晚谁最搭第一、二轮自动计分，请仅记录第三或第四轮胜利');if(Number(round)!==Number(state?.round)||!g||g.alive===false||!state?.tournament?.finalists?.includes(groupId))fail('只能为当前轮次仍在晋级名单中的搭档记录胜利',409);if(!isPairTeamEligible(g,store.data.players,isEligible))fail('本队成员或单人成队标记不正确，请核对队伍');if(Number(round)===4&&(!Number.isSafeInteger(questionIndex)||questionIndex<1||questionIndex>8))fail('心有灵犀每组共8题，请登记第1至8题');const validId=Number(round)===4?(eventId===baseId+':word:'+questionIndex||questionIndex===1&&eventId===baseId):eventId===baseId;if(!validId||JSON.stringify([...g.members].sort())!==JSON.stringify(playerIds))fail('搭档胜利必须包含本队全部实际成员，并使用对应本轮或题目的编号');}
  const events=store.data.gameWinEvents??[];
  const collision=events.find(x=>x.activity===activity&&roundKey(x.round)===roundKey(round)&&(x.groupId??null)===groupId&&x.eventId!==eventId&&(questionIndex===null||pairQuestionIndex(x)===questionIndex));
  if(collision)fail('本轮或本题已有获胜记录，请刷新后更正同一条结果，不能重复登记',409);
  const previous=events.find(x=>x.eventId===eventId),task=String(body.task??'').trim().slice(0,2000);
  const sameRound=previous&&previous.activity===activity&&String(previous.round)===String(round)&&previous.groupId===groupId;
  const same=sameRound&&JSON.stringify(previous.playerIds)===JSON.stringify(playerIds)&&previous.task===task&&previous.status==='active';
  if(same)return{event:displayGameWinEvent(previous),players:structuredClone(store.data.players.filter(p=>playerIds.includes(p.id))),duplicate:true};
  if(Number(body.version??0)!==Number(previous?.version??0))fail('本轮结果已更新，请刷新后再修改',409);
  if(previous&&!sameRound)fail('胜利编号已被其他轮次使用',409);
  // A successful retry reports the persisted result even if its winner has since left.
  if(voice)checkEligible(playerIds);
  const now=new Date().toISOString(),event={eventId,activity,kind,activityName:labels[kind],round,groupId,...(questionIndex===null?{}:{questionIndex}),playerIds,players:playerIds.map(id=>{const p=store.player(id);return{id:p.id,name:p.name,number:p.number,photo:p.photo??''}}),task,status:'active',version:Number(previous?.version??0)+1,createdAt:previous?.createdAt??now,updatedAt:now};
  return store.commit(data=>{data.gameWinEvents??=[];const i=data.gameWinEvents.findIndex(x=>x.eventId===eventId);if(i<0)data.gameWinEvents.push(event);else data.gameWinEvents[i]=event;return{event,players:data.players.filter(p=>playerIds.includes(p.id)),duplicate:false}});
 };
 const revoke=(body={})=>{
  const events=store.data.gameWinEvents??[],voiceId=typeof body.eventId==='string'?body.eventId.toLowerCase():null;
  const event=events.find(x=>x.eventId===body.eventId)??events.find(x=>voiceActivityKinds[x.activity]&&x.eventId===voiceId);
  checkScope(body,!!voiceActivityKinds[event?.activity],'活动已清空，旧胜利操作已忽略');
  if(!event)fail('找不到这轮胜利记录',404);
  checkBlindfold(event);
  if(event.activity===1){const state=store.state('pairs').value,group=state?.groups?.find(g=>g.id===event.groupId);if(Number(state?.round)!==Number(event.round)||!group||group.alive===false||!state?.tournament?.finalists?.includes(event.groupId)||JSON.stringify([...(group.members??[])].sort())!==JSON.stringify([...(event.playerIds??[])].sort()))fail('只能撤销当前晋级搭档的本轮胜利，历史结果已锁定',409);}
  if(event.status==='revoked'&&Number(body.version)<=event.version)return{event:displayGameWinEvent(event),duplicate:true};
  if(Number(body.version)!==event.version)fail('本轮结果已更新，请刷新后再撤销',409);
  return store.commit(data=>{const current=data.gameWinEvents.find(x=>x.eventId===event.eventId);current.status='revoked';current.version++;current.updatedAt=new Date().toISOString();return{event:displayGameWinEvent(current),duplicate:false}});
 };
 return{list,win,revoke};
}
module.exports={reconcileAutomaticScores,createGameWins};
