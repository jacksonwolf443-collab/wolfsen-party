const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,AppError,createBackend}=require('../desktop/store.cjs');
const {isEligible,setAttendance,assertMissionAvailable}=require('../desktop/attendance.cjs');
const legacyCheckIn=store=>store.commit(d=>{for(const p of d.players)p.attendance='present';return{}});

test('attendance is independent of participation, survives reopening, and safely pauses current selections',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-attendance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),api=createBackend(store);
 const {player:a}=await api('players',{name:'现场甲',number:'001'}),{player:b}=await api('players',{name:'现场乙',number:'002'});
 legacyCheckIn(store);assert.equal(isEligible({...a,attendance:undefined}),true,'old players without an attendance field remain eligible');
 assert.equal(isEligible({...a,active:0}),false);assert.equal(isEligible({...a,attendance:'away'}),false);
 const mission={id:'m',round:'r',actor:a.id,target:b.id,task:'认识彼此',code:'123456',completed_at:null};
 store.commit(d=>{d.missions=[mission];d.missionRound={id:'r',endsAt:Date.now()+60000,ended:false};return{}});
 await api('state',{kind:'draw',value:{player:a.id,endsAt:Date.now()+60000,history:['猫'],canvas:'original',scores:{[a.id]:3}},version:0});
 await api('state',{kind:'screen',value:{mode:'drawing',title:'正在作画'},version:0});
 const result=setAttendance(store,{id:a.id,version:0,attendance:'away'},AppError);
 assert.equal(result.player.active,1);assert.equal(result.player.attendance,'away');assert.equal(result.player.version,1);
 assert.deepEqual(store.data.missions,[mission],'leaving does not rewrite private task cards or completed history');
 assert.equal(store.state('draw').value.player,'');assert.equal(store.state('draw').value.endsAt,0);
 assert.equal(store.state('draw').value.canvas,'original');assert.deepEqual(store.state('draw').value.scores,{[a.id]:3});
 assert.equal(store.state('screen').value,null,'old projection is retired when attendance changes');
 assert.throws(()=>assertMissionAvailable(store.data,mission,AppError),/未到|离场/);
 assert.throws(()=>setAttendance(store,{id:a.id,version:0,attendance:'present'},AppError),/更新/);
 assert.throws(()=>setAttendance(store,{id:a.id,version:1,attendance:'invalid'},AppError),/出席/);
 const reopened=new Store(dir);assert.equal(reopened.player(a.id).attendance,'away');
 setAttendance(reopened,{id:a.id,version:1,attendance:'present'},AppError);
 assert.equal(isEligible(reopened.player(a.id)),true);assert.doesNotThrow(()=>assertMissionAvailable(reopened.data,mission,AppError));
 const restored=new Store(path.join(dir,'restore'));restored.restoreBackup(store.exportBackup());assert.equal(restored.player(a.id).attendance,'away');
});

test('real routes pause mid-round verification and exclude away people from later tasks, lottery and AI matching',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-attendance-routes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);let matched=[],analyses=[];
 const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',fetcher:async(_url,options)=>{
  const prompt=JSON.parse(options.body).messages[0].content;
  assert.ok(!prompt.includes('保留出席状态'),'departed player profile cannot enter either AI phase');
  if(prompt.includes('\nFINAL_PAIRS=')){const batch=JSON.parse(prompt.slice(prompt.indexOf('\nFINAL_PAIRS=')+13));analyses.push(...batch);return Response.json({choices:[{message:{content:JSON.stringify({reasons:batch.map(x=>({pair:x.pair,basis:'shared-interest',shared:'健身',a:{field:'interests',quote:'健身'},b:{field:'interests',quote:'健身'}}))})}}]});}
  const roster=JSON.parse(prompt.slice(prompt.indexOf('名单：')+3));matched=roster.map(p=>p.id);assert.ok(roster.every(p=>p.interests==='健身、摄影'));
  return Response.json({choices:[{message:{content:JSON.stringify({pairs:[matched.slice(0,2)],standby:matched.slice(2)})}}]});
 }});
 for(let i=0;i<4;i++)await api('players',{name:'验收参与者'+i,number:String(i),interests:'健身、摄影'});legacyCheckIn(store);
 await api('state',{kind:'taskBank',value:['认识一个新朋友'],version:0});await api('mission/start',{minutes:5});
 const mission=structuredClone(store.data.missions[0]);let target=store.player(mission.target);
 ({player:target}=await api('players/attendance',{id:target.id,version:target.version??0,attendance:'away'}));
 await assert.rejects(api('mission/verify',{actor:mission.actor,code:mission.code}),/未到|离场/);
 await assert.rejects(api('mission/approve',{id:mission.id}),/未到|离场/);
 assert.equal(store.data.missions.find(m=>m.id===mission.id).completed_at,null);
 assert.equal((await api('mission/list')).missions.length,4,'private task history is preserved when somebody leaves');
 ({player:target}=await api('players/attendance',{id:target.id,version:target.version,attendance:'present'}));
 await api('mission/verify',{actor:mission.actor,code:mission.code});assert.ok(store.data.missions.find(m=>m.id===mission.id).completed_at);
 ({player:target}=await api('players/attendance',{id:target.id,version:target.version,attendance:'away'}));
 ({player:target}=await api('players',{...target,interests:'保留出席状态'},'PUT'));assert.equal(target.attendance,'away','ordinary edits do not bring a departed person back');
 await api('mission/end');await api('mission/start',{minutes:5});
 assert.equal(store.data.missions.length,3);assert.ok(store.data.missions.every(m=>m.actor!==target.id&&m.target!==target.id));
 await assert.rejects(api('lottery/draw',{count:4,version:0}),/人数/);
 await api('lottery/draw',{count:3,version:0});assert.ok(store.state('lottery').value.people.every(p=>p.id!==target.id));
 const result=await api('ai/pairs');assert.equal(matched.length,3);assert.ok(!matched.includes(target.id));assert.equal(analyses.length,1);assert.ok(analyses.flatMap(x=>x.members).every(id=>matched.includes(id)));assert.equal(result.reasons[0].reasonSource,'ai');
});
test('an AI matching response is rejected if somebody leaves while the model is responding',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-attendance-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);let finish;
 const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',fetcher:async()=>new Promise(resolve=>finish=resolve)});
 for(let i=0;i<2;i++)await api('players',{name:'在场'+i,number:String(i)});legacyCheckIn(store);
 const people=structuredClone(store.data.players),pending=api('ai/pairs');await new Promise(r=>setImmediate(r));
 await api('players/attendance',{id:people[0].id,version:0,attendance:'away'});
 finish(Response.json({choices:[{message:{content:JSON.stringify({pairs:[people.map(p=>p.id)],standby:[]})}}]}));
 await assert.rejects(pending,/名单.*变化/);
});
