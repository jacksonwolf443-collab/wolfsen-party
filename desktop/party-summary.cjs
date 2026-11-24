'use strict';
const crypto=require('node:crypto');
const awardDefinitions=require('./award-definitions.json');
const {talentScoreEvents}=require('./truth-session.cjs');
const {buildPodium}=require('./podium-awards.cjs');
const {displayScoreEntry}=require('./player-scores.cjs');
const {pairSummaryScoreEvents}=require('./pair-summary.cjs');
const {labels,displayActivityText,displayWinEvent}=require('./activity-labels.cjs');
const person=p=>({id:p.id,name:p.name,number:p.number,photo:p.photo??'',interests:p.interests??'',wish:p.wish??'',score:Number.isSafeInteger(p.score)?p.score:0,attendance:p.attendance??'present',active:p.active??0});
function recordSelectionDetails(data,ids,kind,value={}){
 data.selectionHistory??=[];
 for(const id of new Set(ids)){const p=data.players.find(p=>p.id===id);if(!p)continue;const detail=kind==='draw'?'本轮画手':kind==='fans'?(value.a===id?'A队队长':'B队队长'):kind==='crop'?'照片竞猜候选玩家':kind==='truth'?'才艺表演参与者':'随机抽取'+(value.people?.length??1)+'人';data.selectionHistory.push({id:crypto.randomUUID(),playerId:id,playerName:p.name,playerNumber:p.number,kind,activity:labels[kind]??kind,detail,at:new Date().toISOString()});}
}
function captureDrawSuccess(data,value){
 if(!value?.roundId||!value.player||!(value.awarded||value.celebration?.roundId===value.roundId))return;
 data.drawSuccessHistory??=[];if(data.drawSuccessHistory.some(x=>x.id===value.roundId))return;
 const p=data.players.find(x=>x.id===value.player);if(!p)return;data.drawSuccessHistory.push({id:value.roundId,playerId:p.id,name:p.name,number:p.number,photo:p.photo??'',task:String(value.topic??''),at:new Date().toISOString()});
}
function currentWins(data,kind,value){
 const events=[],ps=data.players??[],add=(id,playerId,task,at,source,round)=>{const p=ps.find(x=>x.id===playerId),snapshot=(source?.players??[]).find(x=>x.id===playerId);if(!playerId||!id)return;events.push({id:kind+':'+id+':'+playerId,playerId,name:p?.name??snapshot?.name??playerId,number:p?.number??snapshot?.number??'—',photo:p?.photo??snapshot?.photo??'',activity:labels[kind],kind,round:round??null,task:String(task??''),at:at??''});};
 if(kind==='pairs')for(const round of value?.tournament?.rounds??[])for(const m of round.matches??[]){if(m.status!=='settled'||m.bye||!m.winnerId)continue;for(const id of value.groups?.find(g=>g.id===m.winnerId)?.members??[])add(m.id,id,'第'+round.number+'轮 · '+m.task,round.startedAt,null,round.number);}
 if(kind==='crop')for(const r of value?.results??[])if(r.outcome==='guessed'&&r.winner)add(r.id??r.roundId,r.winner,'猜中 '+(ps.find(p=>p.id===r.current)?.name??'照片玩家'),r.at,null,r.roundId);
 if(kind==='fans')for(const series of [...(value?.seriesHistory??[]),value??{}])for(const r of series.rounds??[])for(const id of new Set(r.winnerIds??[]))add(r.id,id,'第'+r.number+'局 · '+r.task,r.at,r,r.number);
 if(kind==='tails')for(const r of value?.settlements??[]){if(r.ranked){for(const w of r.ranked){add(r.id,w.playerId,['冠军','亚军','季军'][w.rank-1]+' · 收集'+w.count+'条尾巴',r.at,null,r.id);Object.assign(events.at(-1),{points:w.points,rank:w.rank});}}else for(const id of r.winnerIds??[])add(r.id,id,'收集'+r.count+'条尾巴 · '+(r.winnerIds.length>1?'并列第一':'第一名'),r.at,null,r.id);}
 return events;
}
function allWinEvents(data){
 const events=[...(data.archivedWinEvents??[]),...talentScoreEvents(data),...pairSummaryScoreEvents(data)];for(const kind of ['pairs','crop','fans','tails'])events.push(...currentWins(data,kind,data.states?.[kind]?.value));
 for(const x of data.drawSuccessHistory??[])events.push({id:'draw:'+x.id+':'+x.playerId,playerId:x.playerId,name:x.name,number:x.number,photo:x.photo??'',kind:'draw',activity:labels.draw,round:x.id,task:x.task,at:x.at});
 const missions=new Map([...(data.missionHistory??[]),...(data.missions??[])].map(x=>[x.id,x]));for(const x of missions.values())if(x.completed_at)events.push({id:'missions:'+x.id+':'+x.actor,playerId:x.actor,name:x.actorName,number:x.actorNumber,kind:'missions',activity:labels.missions,round:x.round,task:String(x.task??''),at:x.completed_at});
 for(const x of data.gameWinEvents??[])if(x.status==='active')for(const id of new Set(x.playerIds??[])){const p=data.players.find(p=>p.id===id),snapshot=x.players?.find(p=>p.id===id);events.push({id:'game:'+x.eventId+':'+id,playerId:id,name:p?.name??snapshot?.name??id,number:p?.number??snapshot?.number??'—',photo:p?.photo??snapshot?.photo??'',kind:x.kind,activity:x.activityName??labels[x.kind],round:x.round,task:x.task??'',at:x.updatedAt??x.createdAt,genericEventId:x.eventId});}
 return [...new Map(events.map(x=>[x.id,displayWinEvent(x)])).values()];
}
function victorySource(event){if(event.sourceLabel)return displayActivityText(event.sourceLabel,event.kind);const round=event.round??(/^第(\d+)轮/.exec(event.task??'')?.[1]);if(event.kind==='pairs'){const names={1:'第一轮',2:'第二轮',3:'第三轮「蒙眼认搭子」',4:'第四轮「嘴替挑战」'};return labels.pairs+(names[round]??(round?'第'+round+'轮':''))+'胜利';}if(event.kind==='fans')return labels.fans+(round?'第'+round+'局':'')+'胜利';if(event.kind==='missions')return labels.missions+' · 验收通过';if(event.kind==='draw')return labels.draw+' · 作画成功';if(event.kind==='crop')return labels.crop+' · 猜中胜利';if(event.kind==='tails')return labels.tails+' · '+(event.rank?['冠军','亚军','季军'][event.rank-1]+' +'+event.points+'分':'结算胜利');return (labels[event.kind]??event.activity??'游戏')+(round?' · 第'+round+'轮':'')+'胜利';}
function archiveActivitySummary(data,kind,value){
 data.archivedWinEvents??=[];const known=new Set(data.archivedWinEvents.map(x=>x.id));for(const event of currentWins(data,kind,value))if(!known.has(event.id)){data.archivedWinEvents.push(event);known.add(event.id);}
}
function archiveMissions(data){
 data.missionHistory??=[];const known=new Set(data.missionHistory.map(x=>x.id));for(const x of data.missions??[])if(!known.has(x.id)){data.missionHistory.push({id:x.id,actor:x.actor,target:x.target,task:x.task,completed_at:x.completed_at??null,actorName:x.actorName,actorNumber:x.actorNumber,round:x.round});known.add(x.id);}
}
function scoringLedger(data,player){
 const entries=[];
 for(const opening of data.scoreOpeningBalances??[])if(opening.playerId===player.id&&Number.isSafeInteger(opening.balance)&&opening.balance)entries.push({id:'opening:'+player.id,type:'opening',sourceLabel:'迁移前已有积分',task:'旧存档中的积分余额，原分数已保留；具体项目未保留',points:opening.balance,at:opening.createdAt??''});
 for(const raw of data.scoreHistory??[])if(raw.playerId===player.id){const x=displayScoreEntry(raw);entries.push({id:x.actionId??'entry:'+entries.length,type:x.type??'manual',sourceLabel:x.sourceLabel??(x.note?'主持人调整 · '+x.note:'主持人手动调整'),task:String(x.task??''),points:Number.isSafeInteger(x.delta)?x.delta:0,at:x.createdAt??'',before:x.before,after:x.after})}
 const recorded=entries.reduce((sum,x)=>sum+x.points,0),difference=player.score-recorded;
 if(difference)entries.push({id:'balance:'+player.id,type:'balance',sourceLabel:entries.length?'账面净额校准':'未保留明细的已有积分',task:entries.length?'当前总分与已保留账本的差额；不补造具体获分项目':'旧版未保存具体得分来源，按当前实际积分保留余额',points:difference,at:''});
 const groups=new Map();for(const x of entries){const group=groups.get(x.sourceLabel)??{sourceLabel:x.sourceLabel,points:0,count:0};group.points+=x.points;group.count++;groups.set(x.sourceLabel,group)}
 return{entries,sources:[...groups.values()],total:entries.reduce((sum,x)=>sum+x.points,0)};
}
function buildPartySummary(data){
 const manualAwards=Object.values(awardDefinitions).filter(d=>d.source==='host').flatMap(definition=>{const record=data.manualAwards?.records?.[definition.id];if(record?.awardId!==definition.id||!Array.isArray(record.winnerIds)||!record.winnerIds.length)return[];return[{...definition,ids:[...new Set(record.winnerIds)],winners:structuredClone(record.winners??[]),reason:String(record.reason??''),updatedAt:record.updatedAt??''}]});
 const byId=new Map((data.players??[]).map(p=>[p.id,{...person(p),wins:0,selected:Number(data.selectionCounts?.[p.id])||0,completedMissions:0,winEvents:[],scoreEvents:[],selectionEvents:[],missionEvents:[],manualAwards:manualAwards.filter(a=>a.ids.includes(p.id)).map(a=>({id:a.id,title:a.title,reason:a.reason,source:'host',updatedAt:a.updatedAt}))}]));
 const wins=allWinEvents(data);
 const seen=new Set();for(const x of wins){if(seen.has(x.id))continue;seen.add(x.id);const p=byId.get(x.playerId);if(p){if(x.scoreOnly)p.scoreEvents.push({...x});else{p.wins++;p.winEvents.push({...x});}}}
 for(const x of data.selectionHistory??[]){const p=byId.get(x.playerId);if(p)p.selectionEvents.push({id:x.id,activity:labels[x.kind]??x.activity??'抽取',kind:x.kind,detail:x.kind==='truth'?'才艺表演参与者':x.detail??'',at:x.at??''});}
 const missionSeen=new Set();for(const x of [...(data.missionHistory??[]),...(data.missions??[])]){if(missionSeen.has(x.id))continue;missionSeen.add(x.id);const p=byId.get(x.actor);if(p&&x.completed_at){p.completedMissions++;p.missionEvents.push({id:x.id,task:String(x.task??''),at:x.completed_at});}}
 const players=[...byId.values()].map(p=>({...p,scoreLedger:scoringLedger(data,p),unknownSelections:Math.max(0,p.selected-p.selectionEvents.length),activities:[...new Set([...p.winEvents.map(x=>x.activity),...p.scoreEvents.map(x=>x.activity),...p.selectionEvents.map(x=>x.activity),...(p.completedMissions?[labels.missions]:[])])]}));
 const rank=(key)=>{let last,rank=0;return [...players].sort((a,b)=>b[key]-a[key]||String(a.number).localeCompare(String(b.number),'zh-CN',{numeric:true})).map((p,i)=>{if(last!==p[key])rank=i+1;last=p[key];return{...p,rank};});};
 const points=rank('score'),victories=rank('wins'),selections=rank('selected'),awards=[];
 const award=(title,rows,key,description)=>{const{legacyTitles,...definition}=typeof title==='string'?{title,description}:title;if(rows[0]?.[key]>0)awards.push({...definition,ids:rows.filter(p=>p[key]===rows[0][key]).map(p=>p.id),value:rows[0][key]});};
 const {awards:podiumAwards,podium}=buildPodium(data);if(points.length)awards.push(...podiumAwards);
 award(awardDefinitions.wins,victories,'wins');award(awardDefinitions.popularity,selections,'selected');award('任务通关王',rank('completedMissions'),'completedMissions','验收任务已通过次数最多');
 const diversity=[...players].sort((a,b)=>b.activities.length-a.activities.length);if(diversity[0]?.activities.length>=2)awards.push({title:'全场活跃玩家',description:'参与并留下记录的不同活动最多',value:diversity[0].activities.length,ids:diversity.filter(p=>p.activities.length===diversity[0].activities.length).map(p=>p.id)});
 awards.push(...manualAwards);
 return{eventId:data.event?.id??'',resetEpoch:data.resetEpoch??0,podium,generatedAt:new Date().toISOString(),players,points,wins:victories,selections,awards,note:'积分按本机已确认结果和主持人调整汇总。才艺参与表演与观众认同各加3分，仅记积分，不计胜场。撤销和更正按净额计入完整账本。轮空与离场晋级不算胜利。积分榜同分保留并列；冠军、亚军、季军每项仅一人，依次从尚未获奖的最高分玩家中确定，同分需线下决斗PK，由主持人确认，原积分不变。旧版未保存的项目明细不补造，余额单独列明。'};
}
module.exports={buildPartySummary,recordSelectionDetails,captureDrawSuccess,archiveActivitySummary,archiveMissions,currentWins,allWinEvents,victorySource,labels};
