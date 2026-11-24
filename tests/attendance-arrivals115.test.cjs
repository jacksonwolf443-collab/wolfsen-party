'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{Store,createBackend}=require('../desktop/store.cjs');
test('arbitrary single arrivals and repeated check-out/check-in never require a fixed batch or reassign an existing partner',async t=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'single-arrivals115-'));t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));const store=new Store(path.join(profile,'data')),api=createBackend(store),ids=[];
 for(let i=0;i<6;i++)ids.push((await api('players',{name:'逐人到场'+i,number:String(i),active:true})).player.id);
 const attendance=async(id,status)=>api('players/attendance',{id,version:store.player(id).version,attendance:status});
 await attendance(ids[0],'present');await attendance(ids[1],'present');await api('state',{kind:'pairs',version:0,value:{groups:[{id:'original',members:ids.slice(0,2),alive:true,cover:'',challenge:'原挑战'}],standby:[],round:1,pairingMode:'random',challengeBank:['本轮项目'],round2Bank:['第二轮项目']}});
 await api('state',{kind:'taskBank',version:0,value:['讲一个故事']});await api('mission/start',{minutes:20});const initialRound=structuredClone(store.data.missionRound);
 for(let i=2;i<6;i++){
  const oldGroups=structuredClone(store.state('pairs').value.groups),oldTasks=structuredClone(store.data.missions);await attendance(ids[i],'present');
  const current=store.state('pairs'),preview=await api('pairs/supplement/prepare',{eventId:store.data.event.id,version:current.version,mode:'random'});assert.equal(preview.candidateIds.length,1);assert(preview.candidateIds.includes(ids[i]));
  const result=await api('pairs/supplement/commit',{eventId:store.data.event.id,version:preview.version,token:preview.token});assert.deepEqual(result.value.groups.slice(0,oldGroups.length),oldGroups);assert.equal(result.value.standby.length,0);assert.equal(result.newGroups.length,1);assert.equal(result.newGroups[0].solo,true);assert.equal(result.newGroups[0].seats,2);
  const mission=await api('mission/supplement',{eventId:store.data.event.id,roundId:initialRound.id});assert.equal(mission.added,1);assert.deepEqual(store.data.missions.slice(0,oldTasks.length),oldTasks);assert.deepEqual(store.data.missionRound,initialRound);
 }
 assert.equal(store.state('pairs').value.groups.length,5);assert.equal(new Set(store.state('pairs').value.groups.flatMap(g=>g.members)).size,6);const finalPairs=store.state('pairs'),finalMissions=structuredClone(store.data.missions);
 for(const id of [ids[0],ids[3],ids[5]]){await attendance(id,'away');assert.equal(store.player(id).attendance,'away');await attendance(id,'present');assert.equal(store.player(id).attendance,'present');assert.equal((await api('mission/supplement',{eventId:store.data.event.id,roundId:initialRound.id})).added,0)}
 assert.deepEqual(store.state('pairs'),finalPairs);assert.deepEqual(store.data.missions,finalMissions);await assert.rejects(api('pairs/supplement/prepare',{eventId:store.data.event.id,version:finalPairs.version,mode:'random'}),/没有/);assert(store.data.players.every(p=>p.score===0));
});
