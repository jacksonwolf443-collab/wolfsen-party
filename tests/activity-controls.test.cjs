const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-controls-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);return{dir,store,api:createBackend(store)}}
test('each reset clears only its activity, invalidates stale writes and leaves players/photos/settings intact',async t=>{
  for(const [number,kind] of ['pairs','truth','tails','draw','crop','fans','taskBank','lottery'].entries()){
    const {store,api,dir}=fixture(t);const {key}=await api('upload',{bytes:png,type:'image/png'});
    await api('players',{name:'保留本人',number:'001',photo:key});
    for(const k of ['pairs','truth','tails','draw','crop','fans','taskBank','lottery'])await api('state',{kind:k,value:{marker:k},version:0});
    store.commit(d=>{d.missionRound={id:'r',ended:false,endsAt:Date.now()+60000};d.missions=[{round:'r',actor:'a',target:'b',code:'123456'}];return{}});
    const before=structuredClone(store.data);
    await api('state',{kind:'screen',value:{activity:number+1,mode:'pair',image:'old'},version:0});
    await api('activity/reset',{number:number+1,version:1});
    assert.equal(store.state(kind).value,null);assert.equal(store.state(kind).version,2);
    await assert.rejects(api('state',{kind,value:{late:true},version:1}),/更新/);
    for(const k of Object.keys(before.states))if(k!==kind)assert.deepEqual(store.state(k),before.states[k]);
    assert.equal((await api('screen')).mode,'welcome');assert.deepEqual(store.data.players,before.players);assert.deepEqual(store.data.ai,before.ai);
    assert.deepEqual(fs.readFileSync(store.photoPath(key)),png);assert.equal(new Store(dir).state(kind).value,null);
    if(number===6){assert.equal(store.data.missionRound,null);assert.deepEqual(await api('mission/cards'),[]);await assert.rejects(api('mission/verify',{actor:'a',code:'123456'}),/结束/)}
    else assert.deepEqual(store.data.missions,before.missions);
    await assert.rejects(api('activity/reset',{number:number+1,version:1}),/更新/);
  }
});
test('random draw validates counts, excludes inactive players, never repeats within a draw and persists photos through backup',async t=>{
  const {api,store,dir}=fixture(t);const {key}=await api('upload',{bytes:png,type:'image/png'});
  for(let i=0;i<71;i++)await createCheckedInPlayer(api, {name:'抽签'+i,number:String(i),photo:key,active:i!==70});
  for(const count of [0,-1,1.5,'2x',71])await assert.rejects(api('lottery/draw',{count,version:0}),/人数/);
  for(const [version,count] of [1,2,70].entries()){
    await api('lottery/draw',{count,version});const result=store.state('lottery').value;
    assert.equal(result.people.length,count);assert.equal(new Set(result.people.map(p=>p.id)).size,count);
    assert.ok(result.people.every(p=>p.name!=='抽签70'&&p.photo===key));
  }
  const expected=store.state('lottery');assert.deepEqual(new Store(dir).state('lottery'),expected);
  await assert.rejects(api('lottery/draw',{count:2,version:0}),/更新/);
  for(const p of [...store.data.players])await api('players',{id:p.id},'DELETE');
  const backup=store.exportBackup();assert.ok(backup.photos[key],'draw snapshot photos are backed up even after roster removal');
  const copy=new Store(path.join(dir,'restore'));copy.restoreBackup(backup);assert.deepEqual(copy.state('lottery'),expected);assert.deepEqual(fs.readFileSync(copy.photoPath(key)),png);
});
test('face reference is versioned, survives ordinary profile edits/backups and is cleared when the source photo changes',async t=>{
  const {api,store,dir}=fixture(t);const {key:original}=await api('upload',{bytes:png,type:'image/png'});const {key:face}=await api('upload',{bytes:png,type:'image/png'});
  let {player}=await api('players',{name:'本人',number:'001',photo:original});
  await assert.rejects(api('players/face',{id:player.id,version:0,sourcePhoto:'different',photo:face}),/照片/);
  ({player}=await api('players/face',{id:player.id,version:0,sourcePhoto:original,photo:face}));assert.equal(player.facePhoto,face);
  await assert.rejects(api('players/face',{id:player.id,version:0,sourcePhoto:original,photo:face}),/更新/);
  ({player}=await api('players',{...player,interests:'跑步'},'PUT'));assert.equal(player.facePhoto,face);
  store.commit(d=>{Object.assign(d.players[0],{headCutout:face,headSourceKey:face,headGeometryVersion:'auto-head-v3',headReferenceMethod:'automatic-head',headReferenceWarning:'参考提示',headGeometry:{box:[0,0,1000,1000]}});return{}});
  ({player}=await api('players',{...player,interests:'游泳'},'PUT'));assert.equal(player.headGeometryVersion,'auto-head-v3');assert.equal(player.headCutout,face);assert.deepEqual(player.headGeometry,{box:[0,0,1000,1000]});
  const copy=new Store(path.join(dir,'copy'));copy.restoreBackup(store.exportBackup());assert.equal(copy.data.players[0].facePhoto,face);assert.deepEqual(fs.readFileSync(copy.photoPath(face)),png);
  ({player}=await api('players',{...player,photo:face},'PUT'));assert.equal(player.facePhoto,'');
});
test('backups tolerate a removed member in a projected pair and preserve remaining original photos',async t=>{
 const {api,store,dir}=fixture(t);const {key}=await api('upload',{bytes:png,type:'image/png'});
 await api('state',{kind:'screen',version:0,value:{mode:'pair-profile',activity:1,people:[null,{id:'removed-later',name:'本人',number:'001',photo:key}]}});
 const backup=store.exportBackup(),copy=new Store(path.join(dir,'restored'));copy.restoreBackup(backup);
 assert.equal(copy.state('screen').value.people[0],null);assert.deepEqual(fs.readFileSync(copy.photoPath(key)),png);
});
test('reset preserves a different legacy projection and clears an identifiable projection of its own activity',async t=>{
 const {api,store}=fixture(t);
 await api('state',{kind:'screen',version:0,value:{mode:'missions',title:'任务结算'}});
 await api('activity/reset',{number:3,version:0});assert.equal(store.state('screen').value.mode,'missions');
 await api('activity/reset',{number:7,version:0});assert.equal(store.state('screen').value,null);
});
