// API contracts use fake transport only. Original-head coverage lives in cover-composite-api.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs');
const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
function fixture(t,fetcher){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jungle-ai-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',fetcher});return{store,api}}
test('provider uses the configured region, workspace and model without exposing its key in settings',async t=>{
 let request;const {api}=fixture(t,async(url,options)=>{request={url,body:JSON.parse(options.body)};return Response.json({choices:[{message:{content:'连接成功'}}]})});
 const result=await api('ai/settings',{region:'singapore',workspace:'test-workspace',textModel:'chosen-model'},'PUT');
 assert.equal(result.hasKey,true);assert.equal(result.encryptedKey,undefined);
 assert.equal((await api('ai/test')).text,'连接成功');
 assert.equal(request.url,'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(request.body.model,'chosen-model');
});
test('blank release profiles cannot enable AI by importing a key into the settings payload',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wolfsen-ai-empty-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);
 const api=createBackend(store,{fetcher:()=>assert.fail('No network without a process credential')});
 const result=await api('ai/settings',{apiKey:'fake-legacy-value',encryptedKey:'fake-ciphertext',textModel:'qwen-plus'},'PUT');
 assert.equal(result.hasKey,false);
 assert.equal(result.apiKey,undefined);
 assert.equal(result.encryptedKey,undefined);
 assert.doesNotMatch(fs.readFileSync(store.file,'utf8'),/fake-legacy-value|fake-ciphertext/);
 assert.doesNotMatch(JSON.stringify(store.exportBackup()),/fake-legacy-value|fake-ciphertext/);
 await assert.rejects(()=>api('ai/test'),error=>error.status===428);
});
test('vision guesses receive canvas pixels without the saved answer or player details',async t=>{
 let body;const{api}=fixture(t,async(url,options)=>{assert.equal(url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');body=JSON.parse(options.body);return Response.json({choices:[{message:{content:'自行车'}}]})});
 
 await api('players',{name:'不应发送的玩家资料',number:'001'});
 await api('state',{kind:'draw',value:{topic:'绝不能泄露的正确答案'},version:0});
 const image='data:image/png;base64,'+png.toString('base64');assert.equal((await api('ai/guess',{image,topic:'绝不能泄露的正确答案'})).text,'自行车');
 assert.equal(body.model,'qwen3-vl-plus');assert.equal(body.messages[0].content[0].image_url.url,image);assert.ok(!JSON.stringify(body).includes('绝不能泄露'));assert.ok(!JSON.stringify(body).includes('不应发送'));
});
test('cover rejects missing original photos before a paid request',async t=>{
 const{api}=fixture(t,async()=>{throw Error('must not call provider')});const ids=[];for(let i=1;i<=2;i++)ids.push((await api('players',{name:'本人'+i,number:String(i)})).player.id);
 await assert.rejects(api('ai/cover',{ids}),/没有上传照片/);
});
