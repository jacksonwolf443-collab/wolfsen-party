const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');

function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'party-cover-engine-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new Store(directory);return{directory,store,api:createBackend(store)}}
test('new saves default to the whole-photo editing engine',async t=>{
 const {store,api}=fixture(t);assert.equal(store.data.ai.imageModel,'qwen-image-3.0-pro');assert.equal(store.data.ai.coverEngineVersion,4);
 assert.equal((await api('boot')).ai.imageModel,'qwen-image-3.0-pro');
});
test('first boot upgrades only the old default image model and preserves player, photo and activity data while dropping old keys',async t=>{
 const legacy=fixture(t),{directory}=legacy,png=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
 const {key}=await legacy.api('upload',{bytes:png,type:'image/png'});const {player}=await legacy.api('players',{name:'保留玩家',number:'001',photo:key,interests:'潜水'});
 await legacy.api('state',{kind:'pairs',version:0,value:{groups:[{id:'g',members:[player.id,'historical'],cover:key,coverMethod:'original-head-composite-v1',votes:5,alive:true}],standby:[],round:4}});
 legacy.store.commit(d=>{d.ai={...d.ai,imageModel:'qwen-image-2.0-pro',region:'beijing',workspace:'keep-workspace',encryptedKey:'legacy-test-ciphertext'};delete d.ai.coverEngineVersion;return{}});
 const before=structuredClone(legacy.store.data),store=new Store(directory),api=createBackend(store),boot=await api('boot');
 assert.equal(boot.ai.imageModel,'qwen-image-3.0-pro');assert.equal(boot.ai.coverEngineVersion,4);assert.equal(boot.ai.hasKey,false);assert.equal(boot.ai.encryptedKey,undefined);
 assert.deepEqual(store.data.players,before.players);assert.deepEqual(store.data.states,before.states);assert.deepEqual(store.data.event,before.event);assert.deepEqual(store.data.missions,before.missions);
 assert.equal(store.data.ai.encryptedKey,undefined);assert.equal(store.data.ai.workspace,before.ai.workspace);assert.equal(store.data.ai.textModel,before.ai.textModel);assert.equal(store.data.ai.visionModel,before.ai.visionModel);
 assert.deepEqual(fs.readFileSync(store.photoPath(key)),png);assert.equal(new Store(directory).data.ai.imageModel,'qwen-image-3.0-pro');
 await api('ai/settings',{imageModel:'qwen-image-2.0-pro'});assert.equal((await api('boot')).ai.imageModel,'qwen-image-2.0-pro','a later deliberate model choice is not overwritten');
 assert.equal((await createBackend(new Store(directory))('boot')).ai.imageModel,'qwen-image-2.0-pro');
});
test('migration marks custom models without replacing them',async t=>{
 const {store,api}=fixture(t);store.commit(d=>{d.ai.imageModel='custom-image-model';delete d.ai.coverEngineVersion;return{}});
 const boot=await api('boot');assert.equal(boot.ai.imageModel,'custom-image-model');assert.equal(boot.ai.coverEngineVersion,4);
});
