'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');

async function fixture(t,count=4){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'party-reset115-api-'));
 t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));
 const store=new Store(path.join(profile,'data')),api=createBackend(store,{fetcher:()=>{throw Error('No network in reset API tests')}});
 const photo=store.upload(Buffer.from([137,80,78,71,13,10,26,10]),'image/png').key;
 const players=[];
 for(let i=0;i<count;i++){
  const {player}=await api('players',{number:String(i+1),name:'玩家'+i,photo,consent:1,active:1,interests:'摄影',wish:'极光'},'POST');
  assert.equal(player.attendance,'away');assert.equal(player.checkedInAt,null);
  players.push((await api('players/attendance',{id:player.id,version:player.version,attendance:'present'})).player);
 }
 const guard=()=>({partyEventId:store.data.event.id,resetEpoch:store.data.resetEpoch??0});
 const clear=async scope=>api('reset/confirm',{token:(await api('reset/preview',{scope})).token});
 return{profile,store,api,players,guard,clear,photo};
}
const conflict=error=>error.status===409;

test('reset API preview/cancel changes neither live data nor persisted files and cannot later confirm',async t=>{
 const {profile,store,api}=await fixture(t),before=structuredClone(store.data),main=fs.readFileSync(store.file),bak=fs.readFileSync(store.file+'.bak');
 const p=await api('reset/preview',{scope:'all'});assert.equal(p.counts.players,4);
 assert.deepEqual(await api('reset/cancel',{token:p.token}),{canceled:true});
 await assert.rejects(()=>api('reset/confirm',{token:p.token}),conflict);
 assert.deepEqual(store.data,before);assert.deepEqual(fs.readFileSync(store.file),main);assert.deepEqual(fs.readFileSync(store.file+'.bak'),bak);
 assert.equal(fs.existsSync(path.join(profile,'reset-backups')),false);
});

test('reset API refuses an outdated preview after a player signs out and makes no backup or mutation',async t=>{
 const {profile,store,api,players}=await fixture(t),p=await api('reset/preview',{scope:'scores'});
 await api('players/attendance',{id:players[0].id,version:store.player(players[0].id).version,attendance:'away'});
 const afterCheckOut=structuredClone(store.data);
 await assert.rejects(()=>api('reset/confirm',{token:p.token}),conflict);
 assert.deepEqual(store.data,afterCheckOut);assert.equal(fs.existsSync(path.join(profile,'reset-backups')),false);
});

test('single-game API reset retires old win IDs, returns only its points and permits a fresh current win',async t=>{
 const {store,api,players,guard,clear}=await fixture(t),ids=players.slice(0,2).map(p=>p.id);
 const pairValue={round:3,groups:[{id:'pair-g',members:ids,alive:true}],tournament:{finalists:['pair-g'],rounds:[]}};
 await api('state',{kind:'pairs',value:pairValue,version:0},'PUT');
 await api('game/win',{...guard(),eventId:'pairs:3:pair-g',activity:1,round:3,groupId:'pair-g',playerIds:ids,version:0});
 const old={...guard(),eventId:'truth-before-clear',activity:2,round:1,playerIds:[ids[0]],task:'真实故事',version:0};
 await api('game/win',old);assert.deepEqual(ids.map(id=>store.player(id).score),[2,1]);
 const pairBefore=store.state('pairs'),oldParty=store.data.event.id,result=await clear('activity:2');
 assert.equal(result.eventId,oldParty);assert.equal(result.resetEpoch,1);assert(fs.existsSync(path.join(result.backupPath,'完整备份.jungle')));
 assert.deepEqual(ids.map(id=>store.player(id).score),[1,1]);assert.deepEqual(store.state('pairs'),pairBefore);
 // This replay omits the new epoch entirely: the retired win UUID itself is forbidden.
 const {partyEventId,resetEpoch,...legacyReplay}=old;
 await assert.rejects(()=>api('game/win',legacyReplay),conflict);
 await assert.rejects(()=>api('game/win',{...old,...guard()}),conflict);
 await api('game/win',{...guard(),eventId:'truth-after-clear',activity:2,round:1,playerIds:[ids[0]],task:'新故事',version:0});
 assert.deepEqual(ids.map(id=>store.player(id).score),[2,1]);
 const reopened=new Store(store.directory),api2=createBackend(reopened);await assert.rejects(()=>api2('game/win',legacyReplay),conflict);
 assert.deepEqual(ids.map(id=>reopened.player(id).score),[2,1]);
});

test('global API reset rejects old party identity and epoch even with fresh state versions or a new win UUID',async t=>{
 const f=await fixture(t),old=f.guard();await f.api('state',{kind:'truth',value:{cast:[f.players[0].id]},version:0},'PUT');
 await f.clear('all');assert.equal(f.store.data.players.length,0);assert.notEqual(f.store.data.event.id,old.partyEventId);
 const {player}=await f.api('players',{number:'new',name:'重开玩家',active:1},'POST');
 await f.api('players/attendance',{id:player.id,version:player.version,attendance:'present'});
 const version=f.store.state('truth').version,before=structuredClone(f.store.data);
 await assert.rejects(()=>f.api('state',{kind:'truth',value:{cast:[player.id]},version,eventId:old.partyEventId,resetEpoch:f.guard().resetEpoch},'PUT'),conflict);
 await assert.rejects(()=>f.api('state',{kind:'truth',value:{cast:[player.id]},version,eventId:f.store.data.event.id,resetEpoch:old.resetEpoch},'PUT'),conflict);
 await assert.rejects(()=>f.api('state',{kind:'truth',value:{cast:[player.id]}},'PUT'),conflict);
 const win={eventId:'never-before-recorded-old-dialog',activity:2,round:1,playerIds:[player.id],version:0};
 await assert.rejects(()=>f.api('game/win',{...win,...old}),conflict);
 await assert.rejects(()=>f.api('game/win',{...win,partyEventId:f.store.data.event.id,resetEpoch:old.resetEpoch}),conflict);
 assert.deepEqual(f.store.data,before);
 await f.api('game/win',{...win,...f.guard()});assert.equal(f.store.player(player.id).score,1);
});

test('all API selection preview types issued before a global reset cannot repopulate an empty event',async t=>{
 const {store,api,players,clear}=await fixture(t),ids=players.map(p=>p.id);
 await api('state',{kind:'pairs',version:0,value:{round:1,groups:[{id:'g1',members:ids.slice(0,2),alive:true},{id:'g2',members:ids.slice(2),alive:true}],challengeBank:['新对战'],round2Bank:['第二轮']}},'PUT');
 const previews=[
  ['lottery/commit',await api('lottery/draw',{count:2,preview:true,version:0}),0],
  ['draw/commit',await api('draw/select',{version:0,preview:true}),0],
  ['crop/commit',await api('crop/select',{version:0}),0],
  ['pairs/tournament/commit',await api('pairs/tournament/prepare',{version:1}),1]
 ];
 await clear('all');const empty=structuredClone(store.data);
 for(const [route,preview,version]of previews)await assert.rejects(()=>api(route,{token:preview.token,version}));
 assert.deepEqual(store.data,empty);assert.equal(store.data.players.length,0);assert.deepEqual(store.data.selectionCounts,{});
});

test('API global reset preserves connection and model settings and reloads an empty roster on restart',async t=>{
 const {store,api,clear}=await fixture(t);
 store.commit(d=>{d.ai.textModel='qwen-test-fixture';return{}});
 const connection='{"encryptedToken":"isolated-connection","url":"https://example.invalid"}';
 fs.writeFileSync(path.join(store.directory,'fixed-server.json'),connection);
 const ai=structuredClone(store.data.ai),result=await clear('all'),eventId=result.eventId;
 for(let i=0;i<3;i++){
  const next=new Store(store.directory),boot=await createBackend(next)('boot');
  assert.equal(boot.players.length,0);assert.equal(boot.event.id,eventId);assert.deepEqual(next.data.ai,ai);
  assert.equal(fs.readFileSync(path.join(next.directory,'fixed-server.json'),'utf8'),connection);
  assert.equal(Object.values(next.data.states).filter(s=>s.value!==null).length,0);
 }
 assert.equal((await api('boot')).players.length,0);
});

test('signed-out API players are excluded, then late check-ins enter selection pools and supplemental tasks without rewriting existing assignments',async t=>{
 const {store,api,players}=await fixture(t,4),early=players.slice(0,2),late=players.slice(2);
 for(const p of late)await api('players/attendance',{id:p.id,version:store.player(p.id).version,attendance:'away'});
 const eligible=new Set(early.map(p=>p.id));
 const crop=await api('crop/select',{version:0});assert.equal(crop.count,2);assert(crop.pool.every(p=>eligible.has(p.id)));await api('crop/cancel',{token:crop.token});
 await assert.rejects(()=>api('lottery/draw',{count:3,preview:true,version:0}));
 const first=await api('lottery/draw',{count:2,preview:true,version:0});assert(first.people.every(p=>eligible.has(p.id)));await api('lottery/cancel',{token:first.token});
 await api('state',{kind:'taskBank',value:['验收事件'],version:0},'PUT');await api('mission/start',{minutes:20});
 const original=structuredClone(store.data.missions),round=structuredClone(store.data.missionRound);assert.equal(original.length,2);
 for(const p of late)await api('players/attendance',{id:p.id,version:store.player(p.id).version,attendance:'present'});
 const now=await api('lottery/draw',{count:4,preview:true,version:0});assert.equal(now.people.length,4);await api('lottery/cancel',{token:now.token});
 const added=await api('mission/supplement',{eventId:store.data.event.id,roundId:round.id});assert.equal(added.added,2);
 assert.deepEqual(store.data.missions.slice(0,2),original);assert.deepEqual(store.data.missionRound,round);
 assert.equal(new Set(store.data.missions.map(m=>m.actor)).size,4);assert(store.data.missions.every(m=>m.actor!==m.target));
 assert.equal((await api('mission/supplement',{eventId:store.data.event.id,roundId:round.id})).added,0);
});
