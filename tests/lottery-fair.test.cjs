const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-fair-lottery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),api=createBackend(store);for(let i=0;i<70;i++)await createCheckedInPlayer(api, {number:String(i+1),name:'参与者'+i});store.commit(d=>{d.selectionCounts=Object.fromEntries(d.players.map((p,i)=>[p.id,i<2?0:7]));return{}});return{store,api}}
test('70-person lottery previews the least selected two with honest reasons and commits each count once',async t=>{
 const {store,api}=await fixture(t),lowest=store.data.players.slice(0,2).map(p=>p.id).sort(),preview=await api('lottery/draw',{count:2,version:0,preview:true});assert.deepEqual(preview.people.map(p=>p.id).sort(),lowest);for(const p of preview.people){assert.equal(p.beforeCount,0);assert.equal(p.count,1);assert.match(p.reason,/还没|从未/);assert.equal(store.data.selectionCounts[p.id],0)}
 await api('lottery/commit',{token:preview.token,version:0});for(const id of lowest)assert.equal(store.data.selectionCounts[id],1);await assert.rejects(api('lottery/commit',{token:preview.token,version:1}),/失效/);for(const id of lowest)assert.equal(store.data.selectionCounts[id],1);
});
test('another game changing selection counts invalidates an in-flight fair lottery',async t=>{
 const {store,api}=await fixture(t),preview=await api('lottery/draw',{count:2,version:0,preview:true});store.commit(d=>{d.selectionCounts[preview.people[0].id]++;return{}});await assert.rejects(api('lottery/commit',{token:preview.token,version:0}),/次数|上场/);assert.equal(store.state('lottery').value,null);
});
test('cancelling a fair lottery leaves all appearance counts untouched',async t=>{
 const {store,api}=await fixture(t),before=structuredClone(store.data.selectionCounts),preview=await api('lottery/draw',{count:2,version:0,preview:true});await api('lottery/cancel',{token:preview.token});assert.deepEqual(store.data.selectionCounts,before);
});
