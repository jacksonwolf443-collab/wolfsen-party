'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
async function fixture(t,{solo=false,tie=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pair-summary119-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new Store(directory),api=createBackend(store),players=[];
 for(let i=0;i<6;i++)players.push((await createCheckedInPlayer(api,{name:'搭档'+i,number:String(i+1),active:1,consent:1})).player);
 const groups=[{id:'a',members:players.slice(0,solo?1:2).map(p=>p.id),...(solo?{solo:true,seats:2}:{}),alive:true},{id:'b',members:players.slice(2,4).map(p=>p.id),alive:true},{id:'c',members:players.slice(4,6).map(p=>p.id),alive:false}];
 await api('state',{kind:'pairs',version:0,value:{round:4,groups,standby:[],formatVersion:2,tournament:{version:1,finalists:['a','b'],rounds:[{number:1,matches:[{id:'first',status:'settled',winnerId:'a',loserId:'c',teamIds:['a','c'],task:'第一轮真实胜利'},{id:'bye',status:'bye',winnerId:'b',teamIds:['b'],bye:true}]},{number:2,matches:[{id:'second',status:'settled',winnerId:tie?'b':'a',loserId:'c',teamIds:[tie?'b':'a','c'],task:'第二轮真实胜利'}]}]}}});
 const add=(groupId,questionIndex)=>api('game/win',{eventId:'pairs:4:'+groupId+':word:'+questionIndex,activity:1,round:4,groupId,questionIndex,playerIds:groups.find(g=>g.id===groupId).members,task:'猜中第'+questionIndex+'词',version:0});
 const request=summary=>({eventId:summary.eventId,resetEpoch:summary.resetEpoch,fingerprint:summary.fingerprint,version:summary.award.version,groupId:'a'});
 return{directory,store,api,players,groups,add,request};
}
test('summary counts one team point per actual result and excludes unrelated/manual scores and reward itself',async t=>{
 const f=await fixture(t);await f.add('a',1);await f.add('a',2);await f.api('scores/adjust',{playerId:f.players[2].id,delta:20,note:'其他积分',version:f.store.player(f.players[2].id).version,actionId:'unrelated-points'});
 const s=await f.api('pairs/summary/list');assert.equal(s.rows.find(r=>r.groupId==='a').total,4);assert.deepEqual(s.rows.find(r=>r.groupId==='a').categories.map(c=>c.points),[1,1,0,2]);assert.equal(s.rows.find(r=>r.groupId==='b').total,0);assert.deepEqual(s.candidateIds,['a']);assert.equal(s.award.active,false);
 const before=f.store.player(f.players[0].id).score;await f.api('pairs/summary/award',f.request(s));assert.equal(f.store.player(f.players[0].id).score,before+5);assert.equal((await f.api('pairs/summary/list')).rows[0].total,4);
 const detail=await f.api('scores/detail',{playerId:f.players[0].id});assert.ok(detail.entries.some(x=>x.delta===5&&x.sourceLabel==='今晚谁最搭冠军奖励'));
 const all=await f.api('summary/list');assert.equal(all.players.find(p=>p.id===f.players[0].id).wins,4);assert.ok(all.players.find(p=>p.id===f.players[0].id).scoreEvents.some(x=>x.points===5&&x.scoreOnly));
});
test('award is idempotent across retries/reopen and revoke safely applies only a single five point reversal',async t=>{
 const f=await fixture(t),s=await f.api('pairs/summary/list'),body=f.request(s),before=f.store.player(f.players[0].id).score;await f.api('pairs/summary/award',body);const count=f.store.data.scoreHistory.length;assert.equal((await f.api('pairs/summary/award',body)).duplicate,true);assert.equal(f.store.data.scoreHistory.length,count);assert.equal(new Store(f.directory).player(f.players[0].id).score,before+5);
 const awarded=await f.api('pairs/summary/list');await f.api('pairs/summary/revoke',f.request(awarded));assert.equal(f.store.player(f.players[0].id).score,before);assert.equal((await f.api('pairs/summary/revoke',f.request(awarded))).duplicate,true);assert.equal(f.store.player(f.players[0].id).score,before);
});
test('score corrections invalidate an award and stale confirmations cannot silently award again',async t=>{
 const f=await fixture(t);await f.add('a',1);const s=await f.api('pairs/summary/list');await f.api('pairs/summary/award',f.request(s));const event=f.store.data.gameWinEvents.find(e=>e.groupId==='a');await f.api('game/win/revoke',{eventId:event.eventId,version:event.version});assert.equal(f.store.player(f.players[0].id).score,2);const latest=await f.api('pairs/summary/list');assert.equal(latest.award.active,false);assert.equal(latest.award.stale,true);await assert.rejects(f.api('pairs/summary/award',f.request(s)),/更新|改变|重新/);await f.api('pairs/summary/award',f.request(latest));assert.equal(f.store.player(f.players[0].id).score,7);
});
test('restoring an old activity result after correction never resurrects its stale reward without host confirmation',async t=>{
 const f=await fixture(t);await f.add('a',1);const s=await f.api('pairs/summary/list');await f.api('pairs/summary/award',f.request(s));const event=structuredClone(f.store.data.gameWinEvents.find(e=>e.groupId==='a'));await f.api('game/win/revoke',{eventId:event.eventId,version:event.version});await f.api('game/win',{...event,version:event.version+1});const latest=await f.api('pairs/summary/list');assert.equal(latest.fingerprint,s.fingerprint);assert.equal(latest.award.active,false);assert.equal(latest.award.stale,true);assert.equal(f.store.player(f.players[0].id).score,3);assert.equal(new Store(f.directory).player(f.players[0].id).score,3);await f.api('pairs/summary/award',f.request(latest));assert.equal(f.store.player(f.players[0].id).score,8);
});
test('all tied top groups receive five points for each real player after one explicit confirmation',async t=>{
 const f=await fixture(t,{tie:true}),s=await f.api('pairs/summary/list');assert.deepEqual(s.candidateIds,['a','b']);assert.equal(s.requiresPK,false);assert.equal(s.award.complete,false);assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[1,1,1,1,0,0]);
 await assert.rejects(f.api('pairs/summary/award',{...f.request(s),groupIds:['a']}),/全部|最高/);await assert.rejects(f.api('pairs/summary/award',{...f.request(s),groupIds:['a','b','c']}),/最高/);
 const body={...f.request(s),groupIds:['a','b']},awarded=await f.api('pairs/summary/award',body);assert.deepEqual(awarded.award.groupIds,['a','b']);assert.equal(awarded.award.complete,true);assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[6,6,6,6,0,0]);assert.equal(f.store.data.scoreHistory.filter(x=>x.delta===5).length,4);
 const count=f.store.data.scoreHistory.length;assert.equal((await f.api('pairs/summary/award',body)).duplicate,true);assert.equal(f.store.data.scoreHistory.length,count);const reopened=new Store(f.directory);assert.deepEqual(f.players.map(p=>reopened.player(p.id).score),[6,6,6,6,0,0]);assert.deepEqual((await f.api('pairs/summary/list')).rows.map(x=>x.total),[1,1,0]);
 const whole=await f.api('summary/list');for(const player of whole.players.slice(0,4)){assert.equal(player.wins,1);assert.equal(player.scoreEvents.filter(x=>x.points===5).length,1)}
 await f.api('pairs/summary/revoke',f.request(awarded));assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[1,1,1,1,0,0]);assert.equal((await f.api('pairs/summary/revoke',f.request(awarded))).duplicate,true);
});
test('a solo team tied for first earns one five point reward while every other tied member also earns five',async t=>{
 const f=await fixture(t,{solo:true,tie:true}),s=await f.api('pairs/summary/list');await f.api('pairs/summary/award',{...f.request(s),groupIds:['a','b']});assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[6,0,6,6,0,0]);assert.equal(f.store.data.scoreHistory.filter(x=>x.delta===5).length,3);
});
test('a correction reverses every tied-group reward without removing unrelated manual points',async t=>{
 const f=await fixture(t,{tie:true});await f.add('a',1);await f.add('b',1);let s=await f.api('pairs/summary/list');await f.api('pairs/summary/award',{...f.request(s),groupIds:['a','b']});await f.api('scores/adjust',{playerId:f.players[2].id,delta:9,note:'保留手动分',version:f.store.player(f.players[2].id).version,actionId:'tied-unrelated'});
 const event=f.store.data.gameWinEvents.find(e=>e.groupId==='a');await f.api('game/win/revoke',{eventId:event.eventId,version:event.version});assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[1,1,11,2,0,0]);s=await f.api('pairs/summary/list');assert.equal(s.award.active,false);assert.equal(s.award.stale,true);assert.deepEqual(s.candidateIds,['b']);await f.api('pairs/summary/award',{...f.request(s),groupId:'b',groupIds:['b']});assert.deepEqual(f.players.map(p=>f.store.player(p.id).score),[1,1,16,7,0,0]);
});
test('legacy single-winner awards remain credited on reopen and expanding to every tie adds only missing players',async t=>{
 const f=await fixture(t,{tie:true}),s=await f.api('pairs/summary/list');f.store.commit(data=>{data.pairSummaryAward={id:'legacy-champion',version:3,eventId:s.eventId,status:'active',fingerprint:s.fingerprint,groupId:'b',playerIds:f.groups[1].members,resolvedByPK:true,updatedAt:'2026-10-01T00:00:00.000Z'};return{}});await f.api('scores/adjust',{playerId:f.players[2].id,delta:9,note:'保留原积分',version:f.store.player(f.players[2].id).version,actionId:'legacy-unrelated'});
 const reopened=new Store(f.directory),api=createBackend(reopened),before=await api('pairs/summary/list');assert.deepEqual(f.players.map(p=>reopened.player(p.id).score),[1,1,15,6,0,0]);assert.equal(before.award.active,true);assert.equal(before.award.complete,false);assert.deepEqual(before.award.groupIds,['b']);const existingCredits=reopened.data.scoreHistory.filter(x=>x.playerId===f.players[2].id&&x.delta===5).length;
 const request={...f.request(before),groupIds:['a','b']},updated=await api('pairs/summary/award',request);assert.equal(updated.award.complete,true);assert.deepEqual(f.players.map(p=>reopened.player(p.id).score),[6,6,15,6,0,0]);assert.equal(reopened.data.scoreHistory.filter(x=>x.playerId===f.players[2].id&&x.delta===5).length,existingCredits);assert.equal((await api('pairs/summary/award',request)).duplicate,true);
 await api('pairs/summary/revoke',f.request(updated));assert.deepEqual(f.players.map(p=>reopened.player(p.id).score),[1,1,10,1,0,0]);
});
test('a solo team occupying two seats receives a single individual reward',async t=>{
 const f=await fixture(t,{solo:true}),s=await f.api('pairs/summary/list'),before=f.store.player(f.players[0].id).score;await f.api('pairs/summary/award',f.request(s));assert.equal(f.store.player(f.players[0].id).score,before+5);assert.equal(f.store.data.scoreHistory.filter(x=>x.delta===5).length,1);
});
test('resetting another activity preserves the champion bonus while clearing pairs removes only pair contributions',async t=>{
 const f=await fixture(t),s=await f.api('pairs/summary/list');await f.api('pairs/summary/award',f.request(s));await f.api('scores/adjust',{playerId:f.players[0].id,delta:9,note:'手动保留分',version:f.store.player(f.players[0].id).version,actionId:'manual-retained'});
 let preview=await f.api('reset/preview',{scope:'activity:2'});await f.api('reset/confirm',{token:preview.token});assert.equal(f.store.player(f.players[0].id).score,16);assert.equal((await f.api('pairs/summary/list')).award.active,true);
 preview=await f.api('reset/preview',{scope:'activity:1'});await f.api('reset/confirm',{token:preview.token});assert.equal(f.store.player(f.players[0].id).score,9);assert.equal((await f.api('pairs/summary/list')).award.active,false);assert.equal(f.store.data.pairSummaryAward?.status,'revoked');
});
