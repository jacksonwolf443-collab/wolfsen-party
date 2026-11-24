'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const legacy={pairs:'天作之合',tails:'抢你的尾巴',draw:'你画，AI猜',missions:'今晚，请验收我'};
const current={pairs:'今晚谁最搭',tails:'线下决斗',draw:'毕加索在世',missions:'客官,YOU HAPPY？'};
const custom='主持人自填：天作之合、今晚验收我、你画，AI猜';
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'activity-names1113-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const store=new Store(directory),api=createBackend(store),players=[];for(let i=0;i<2;i++)players.push((await createCheckedInPlayer(api,{name:'玩家'+i,number:String(i+1),active:true})).player);
 await api('state',{kind:'pairs',version:0,value:{formatVersion:2,round:4,groups:[{id:'group',members:players.map(p=>p.id),alive:true}],tournament:{rounds:[],finalists:['group']}}});
 await api('game/win',{eventId:'pairs:4:group:word:1',activity:1,round:4,questionIndex:1,groupId:'group',playerIds:players.map(p=>p.id),task:custom,version:0});
 let summary=await api('pairs/summary/list');await api('pairs/summary/award',{eventId:summary.eventId,resetEpoch:summary.resetEpoch,fingerprint:summary.fingerprint,version:summary.award.version,groupIds:['group']});
 await api('state',{kind:'draw',version:0,value:{player:players[0].id,roundId:'draw-old',topic:custom,awarded:true}});
 await api('state',{kind:'tails',version:0,value:{settlements:[{id:'tail-old',winnerIds:[players[0].id],count:3,at:'2026-11-04'}]}});
 await api('state',{kind:'taskBank',version:0,value:[custom]});await api('mission/start',{minutes:20});await api('mission/approve',{id:store.data.missions[0].id});
 await api('scores/adjust',{playerId:players[0].id,delta:2,actionId:'custom-note',note:custom});
 return{directory,store,api,players};
}
function useLegacyNames(data){
 const oldText=(value,kind)=>typeof value==='string'?value.replaceAll(current[kind]??'__absent__',legacy[kind]??'__absent__'):value;
 for(const row of data.scoreHistory??[])if(row.type==='automatic'&&legacy[row.source?.kind]){const kind=row.source.kind;for(const key of ['sourceLabel','note'])row[key]=oldText(row[key],kind);row.source.activity=legacy[kind];if(row.eventId?.startsWith('pairs:champion:'))row.task=oldText(row.task,kind)}
 for(const record of data.autoScoreLedger??[]){const event=record.event,kind=event.kind;if(!legacy[kind])continue;event.activity=legacy[kind];if(event.sourceLabel)event.sourceLabel=oldText(event.sourceLabel,kind);if(event.reason==='pair-champion')event.task=oldText(event.task,kind)}
 for(const event of data.gameWinEvents??[])if(legacy[event.kind])event.activityName=legacy[event.kind];
 for(const event of data.selectionHistory??[])if(legacy[event.kind])event.activity=legacy[event.kind];
 return data;
}
test('new automatic sources, pair award and reset previews use exact current activity names',async t=>{
 const f=await fixture(t),summary=await f.api('summary/list');
 for(const [kind,label]of Object.entries(current)){
  const rows=f.store.data.scoreHistory.filter(row=>row.source?.kind===kind);assert.ok(rows.length,kind);assert.ok(rows.every(row=>row.source.activity===label&&row.sourceLabel.includes(label)),kind);
 }
 assert.equal(f.store.data.gameWinEvents[0].activityName,current.pairs);
 assert.ok(summary.players[0].scoreEvents.some(row=>row.sourceLabel==='今晚谁最搭冠军奖励'));
 for(const [number,label]of [[1,current.pairs],[3,current.tails],[4,current.draw],[7,current.missions]])assert.equal((await f.api('reset/preview',{scope:'activity:'+number})).title,'清空'+label+'全部内容');
 assert.equal(f.store.data.gameWinEvents[0].task,custom);assert.equal(f.store.data.scoreHistory.find(row=>row.actionId==='custom-note').note,custom);
});
test('legacy score provenance displays current labels without changing persisted state or user text on load',async t=>{
 const f=await fixture(t),old=useLegacyNames(structuredClone(f.store.data));
 old.states.screen={version:2,value:{mode:'drawing',title:custom,subtitle:custom,tag:custom,activity:4}};
 old.scoreHistory.find(row=>row.source?.kind==='missions').sourceLabel='今晚验收我 · 验收通过';
 const original=JSON.stringify(old,null,2)+'\n';fs.writeFileSync(f.store.file,original);const reopened=new Store(f.directory),api=createBackend(reopened);
 assert.equal(fs.readFileSync(f.store.file,'utf8'),original,'opening rename-only legacy data must not rewrite the file');
 assert.deepEqual(reopened.data,old,'opening must retain all saved provenance');
 const list=await api('scores/list'),summary=await api('summary/list'),wins=await api('game/win/list',{activity:1});
 assert.equal(wins.events[0].activityName,current.pairs);
 for(const [kind,label]of Object.entries(current))for(const row of list.history.filter(row=>row.source?.kind===kind)){assert.equal(row.source.activity,label);assert.ok(row.sourceLabel.includes(label));assert.ok(row.note.includes(label));if(!row.eventId?.startsWith('pairs:champion:'))assert.equal(row.task,old.scoreHistory.find(saved=>saved.actionId===row.actionId).task)}
 for(const p of summary.players){for(const row of [...p.winEvents,...p.scoreEvents,...p.selectionEvents])if(current[row.kind])assert.equal(row.activity,current[row.kind]);for(const row of p.scoreLedger.entries)assert.ok(!/天作之合|抢你的尾巴|你画，AI猜|今晚.?验收我/.test(row.sourceLabel)||row.type==='manual')}
 const detail=await api('scores/detail',{playerId:f.players[0].id});assert.equal(detail.entries.find(row=>row.actionId==='custom-note').note,custom);
 assert.ok(detail.entries.some(row=>row.sourceLabel==='今晚谁最搭冠军奖励'&&row.task==='今晚谁最搭活动累计积分最高组 · 每个人各加5分积分'));
 assert.equal((await api('screen')).title,custom);assert.deepEqual((await api('boot')).states.screen,old.states.screen);
 assert.equal(fs.readFileSync(f.store.file,'utf8'),original);assert.deepEqual(reopened.data,old);
});
test('revoking a legacy pair result preserves old history and generates current-name reversals with the same point rules',async t=>{
 const f=await fixture(t),old=useLegacyNames(structuredClone(f.store.data));fs.writeFileSync(f.store.file,JSON.stringify(old));
 const store=new Store(f.directory),api=createBackend(store),before=store.data.players.map(p=>p.score),count=old.scoreHistory.length;
 const result=await api('game/win/revoke',{eventId:'pairs:4:group:word:1',version:1});assert.equal(result.event.activityName,current.pairs);
 assert.deepEqual(store.data.scoreHistory.slice(0,count),old.scoreHistory);
 const reversals=store.data.scoreHistory.slice(count);assert.equal(reversals.length,4);assert.deepEqual(store.data.players.map(p=>p.score),before.map(score=>score-6));
 assert.ok(reversals.every(row=>row.delta<0&&row.source.activity===current.pairs&&row.sourceLabel.includes(current.pairs)));
 assert.deepEqual(new Store(f.directory).data.players.map(p=>p.score),store.data.players.map(p=>p.score));
});
