const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
const {buildPartySummary}=require('../desktop/party-summary.cjs');
const players=scores=>scores.map((score,i)=>({id:'p'+i,name:'玩家'+i,number:String(i+1),photo:'',score,active:1,attendance:'present'}));
function fixture(t,scores){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-podium119-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.commit(d=>{d.players=players(scores);d.scoreOpeningBalances=d.players.filter(p=>p.score).map(p=>({playerId:p.id,balance:p.score}));return{}});return{store,api:createBackend(store)}}
const request=(s,awardId,playerId)=>({eventId:s.eventId,resetEpoch:s.resetEpoch,fingerprint:s.podium.fingerprint,version:s.podium.version,awardId,playerId});
test('a tied first place waits for offline PK, then each next award uses the highest remaining player without rank gaps',async t=>{
 const f=fixture(t,[10,10,7,7,0]),s=await f.api('summary/list');
 assert.deepEqual(s.awards.slice(0,3).map(a=>a.ids),[[],[],[]]);assert.deepEqual(s.awards[0].candidateIds,['p0','p1']);assert.equal(s.awards[0].requiresPK,true);assert.equal(s.awards[1].needsPrevious,true);
 const chosen=await f.api('awards/podium/resolve',request(s,'points','p1'));assert.deepEqual(chosen.awards.slice(0,3).map(a=>a.ids),[['p1'],['p0'],[]]);assert.deepEqual(chosen.awards[2].candidateIds,['p2','p3']);
 const final=await f.api('awards/podium/resolve',request(chosen,'points-third','p3'));assert.deepEqual(final.awards.slice(0,3).map(a=>a.ids),[['p1'],['p0'],['p3']]);assert.deepEqual(f.store.data.players.map(p=>p.score),[10,10,7,7,0]);
 const reopened=await createBackend(new Store(f.store.directory))('summary/list');assert.deepEqual(reopened.awards.slice(0,3).map(a=>a.ids),[['p1'],['p0'],['p3']]);
});
test('second-place ties remain unresolved until host selection and corrections invalidate later picks',async t=>{
 const f=fixture(t,[20,10,10,10]),s=await f.api('summary/list');assert.deepEqual(s.awards[0].ids,['p0']);assert.deepEqual(s.awards[1].candidateIds,['p1','p2','p3']);
 let chosen=await f.api('awards/podium/resolve',request(s,'points-second','p2'));chosen=await f.api('awards/podium/resolve',request(chosen,'points-third','p1'));
 chosen=await f.api('awards/podium/resolve',request(chosen,'points-second','p1'));assert.deepEqual(chosen.awards.slice(0,3).map(a=>a.ids),[['p0'],['p1'],[]]);assert.deepEqual(chosen.awards[2].candidateIds,['p2','p3']);
 await assert.rejects(f.api('awards/podium/resolve',request(s,'points-second','p3')),e=>e.status===409);
 await assert.rejects(f.api('awards/podium/resolve',request(chosen,'points-third','p0')),/候选/);
 const restarted=await f.api('awards/podium/restart',request(chosen));assert.deepEqual(restarted.awards[1].ids,[]);assert.equal(restarted.podium.hasChoices,false);
});
test('score, roster and reset changes reject stale PK confirmations and cannot revive old picks',async t=>{
 const f=fixture(t,[10,10,5]),s=await f.api('summary/list');let chosen=await f.api('awards/podium/resolve',request(s,'points','p0'));
 await f.api('scores/adjust',{actionId:'change',playerId:'p2',delta:5,note:'加分'});await assert.rejects(f.api('awards/podium/resolve',request(chosen,'points-second','p1')),e=>e.status===409);let now=await f.api('summary/list');assert.equal(now.awards[0].requiresPK,true);assert.equal(now.podium.hasChoices,false);
 f.store.commit(d=>{d.players.push({id:'new',name:'新玩家',number:'99',score:0});return{}});await assert.rejects(f.api('awards/podium/resolve',request(now,'points','p1')),e=>e.status===409);
 now=await f.api('summary/list');const preview=await f.api('reset/preview',{scope:'scores'});await f.api('reset/confirm',{token:preview.token});await assert.rejects(f.api('awards/podium/resolve',request(now,'points','p1')),e=>e.status===409);assert.equal((await f.api('summary/list')).podium.hasChoices,false);
});
test('the summary scoring ledger includes all automatic and manual entries, corrections and opening balances and reconciles exactly',()=>{
 const data={players:players([17,9]),states:{},scoreOpeningBalances:[{playerId:'p0',balance:10}],scoreHistory:[{type:'automatic',actionId:'a',playerId:'p0',delta:5,sourceLabel:'抢你的尾巴 · 冠军 +5分',task:'收集尾巴'},{type:'manual',actionId:'b',playerId:'p0',delta:4,note:'现场加分'},{type:'automatic',actionId:'c',playerId:'p0',delta:-2,sourceLabel:'抢你的尾巴 · 记录更正',task:'校正数量'},{type:'automatic',actionId:'d',playerId:'p0',delta:0,sourceLabel:'谁是最有趣开心的人 · 记录更正',task:'更正表演名称'}]};
 const s=buildPartySummary(data),p=s.players[0];assert.equal(p.scoreLedger.total,17);assert.deepEqual(p.scoreLedger.entries.map(e=>e.points),[10,5,4,-2,0]);assert.match(p.scoreLedger.entries[2].sourceLabel,/主持人.*现场加分/);assert.equal(p.scoreLedger.entries.reduce((n,e)=>n+e.points,0),p.score);assert.equal(s.players[1].scoreLedger.entries[0].points,9);assert.match(s.players[1].scoreLedger.entries[0].sourceLabel,/未保留明细|已有积分/);
 data.players[0].score=20;const reconciled=buildPartySummary(data).players[0].scoreLedger;assert.equal(reconciled.total,20);assert.equal(reconciled.entries.at(-1).points,3);assert.match(reconciled.entries.at(-1).sourceLabel,/校准/);
});
test('returning to the same scores cannot resurrect PK selections invalidated by an intervening correction',async t=>{const f=fixture(t,[10,10,5]),s=await f.api('summary/list');await f.api('awards/podium/resolve',request(s,'points','p0'));await f.api('scores/adjust',{actionId:'up',playerId:'p2',delta:1});await f.api('scores/adjust',{actionId:'down',playerId:'p2',delta:-1});const now=await f.api('summary/list');assert.equal(now.podium.hasChoices,false);assert.equal(now.awards[0].requiresPK,true);});
