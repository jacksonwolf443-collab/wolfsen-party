const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-draw-preview-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),api=createBackend(store);for(let i=0;i<4;i++)await createCheckedInPlayer(api, {name:'玩家'+i,number:String(i)});return{store,api}}
test('preview leaves saved result untouched, cancel discards it and commit saves exactly once',async t=>{
 const {store,api}=await fixture(t);const before=store.state('lottery');
 const canceled=await api('lottery/draw',{count:2,version:0,preview:true});assert.ok(canceled.token);assert.deepEqual(store.state('lottery'),before);
 await api('lottery/cancel',{token:canceled.token});await assert.rejects(api('lottery/commit',{token:canceled.token,version:0}),/失效/);
 const preview=await api('lottery/draw',{count:2,version:0,preview:true});assert.equal(new Set(preview.people.map(p=>p.id)).size,2);
 const result=await api('lottery/commit',{token:preview.token,version:0});assert.deepEqual(result.value.people,preview.people);assert.equal(result.version,1);
 await assert.rejects(api('lottery/commit',{token:preview.token,version:0}),/失效/);
});
test('preview rejects a changed eligible pool or changed activity version without overwriting',async t=>{
 const {store,api}=await fixture(t);const preview=await api('lottery/draw',{count:1,version:0,preview:true});
 const p=store.data.players.at(-1);await api('players/attendance',{id:p.id,version:p.version,attendance:'away'});
 await assert.rejects(api('lottery/commit',{token:preview.token,version:0}),/名单/);assert.equal(store.state('lottery').value,null);
 const second=await api('lottery/draw',{count:1,version:0,preview:true});await api('activity/reset',{number:8,version:0});
 await assert.rejects(api('lottery/commit',{token:second.token,version:0}),/更新/);assert.equal(store.state('lottery').value,null);
});
