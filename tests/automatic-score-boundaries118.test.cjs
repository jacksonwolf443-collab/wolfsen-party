'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
for(const {points,balance}of [{points:3,balance:-1000000000},{points:-3,balance:1000000000}])test('talent metadata correction at '+balance+' preserves its '+points+' contribution and audits a zero score change',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'score-boundary118-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new Store(directory),api=createBackend(store),{player}=await api('players',{name:'边界玩家',number:'1',active:true});await api('players/attendance',{id:player.id,version:player.version,attendance:'present'});
 const save=task=>api('talent/save',{partyEventId:store.data.event.id,resetEpoch:0,version:store.state('truth').version,id:'one-talent-record',round:1,playerIds:[player.id],reason:'custom',points,task});
 await save('更正前的项目');
 // Opening balances represent existing points from other sources. The current
 // player total is valid even if reverting this one contribution alone is not.
 store.commit(data=>{data.scoreOpeningBalances.push({playerId:player.id,balance:balance-points,createdAt:'2026-11-04'});data.players.find(p=>p.id===player.id).score=balance;return{}});
 await save('核对后的才艺项目');assert.equal(store.player(player.id).score,balance);
 const detail=await api('scores/detail',{playerId:player.id}),automatic=detail.entries.filter(x=>x.type==='automatic');assert.deepEqual(automatic.map(x=>x.delta),[0,points]);assert.equal(automatic[0].before,balance);assert.equal(automatic[0].after,balance);assert.equal(automatic[0].task,'核对后的才艺项目');assert.match(automatic[0].sourceLabel,/谁是最有趣开心的人.*自定积分/);assert.equal(automatic[1].task,'更正前的项目');assert.equal(detail.entries.reduce((sum,x)=>sum+x.delta,0),balance);
 const count=store.data.scoreHistory.length;await save('核对后的才艺项目');assert.equal(store.data.scoreHistory.length,count);const reopened=new Store(directory);assert.equal(reopened.player(player.id).score,balance);assert.equal(reopened.data.scoreHistory.length,count);assert.equal(reopened.data.autoScoreLedger[0].event.task,'核对后的才艺项目');assert.equal(reopened.data.autoScoreLedger[0].active,true);
});
for(const {points,next,balance}of [{points:3,next:4,balance:-1000000000},{points:-3,next:-4,balance:1000000000}])test('talent amount correction at '+balance+' applies only the valid net change and persists once',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'score-net118-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new Store(directory),api=createBackend(store),{player}=await api('players',{name:'边界玩家',number:'1',active:true});await api('players/attendance',{id:player.id,version:player.version,attendance:'present'});
 const save=amount=>api('talent/save',{partyEventId:store.data.event.id,resetEpoch:0,version:store.state('truth').version,id:'net-correction',round:1,playerIds:[player.id],reason:'custom',points:amount,task:'边界更正'});
 await save(points);store.commit(data=>{data.scoreOpeningBalances.push({playerId:player.id,balance:balance-points,createdAt:'2026-11-04'});data.players.find(p=>p.id===player.id).score=balance;return{}});
 await save(next);const expected=balance+next-points;assert.equal(store.player(player.id).score,expected);const detail=await api('scores/detail',{playerId:player.id}),automatic=detail.entries.filter(x=>x.type==='automatic');assert.deepEqual(automatic.map(x=>x.delta),[next-points,points]);assert.equal(automatic[0].before,balance);assert.equal(automatic[0].after,expected);assert.match(automatic[0].sourceLabel,/记录更正/);assert.equal(detail.entries.reduce((sum,x)=>sum+x.delta,0),expected);
 const count=store.data.scoreHistory.length;await save(next);assert.equal(store.data.scoreHistory.length,count);const reopened=new Store(directory);assert.equal(reopened.player(player.id).score,expected);assert.equal(reopened.data.scoreHistory.length,count);assert.equal(reopened.data.autoScoreLedger[0].event.points,next);
 const state=store.state('truth');await assert.rejects(save(-next),/积分/);assert.deepEqual(store.state('truth'),state);assert.equal(store.player(player.id).score,expected);
});
