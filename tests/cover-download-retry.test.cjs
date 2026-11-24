const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript');
const {Store,AppError,validImage}=require('../desktop/store.cjs');
const {createCoverService}=require('../desktop/cover-service.cjs');
const {codec,solid}=require('./helpers/raster-fixture.cjs');
const {faceRegionReply,faceLocalizer}=require('./helpers/face-regions-fixture.cjs');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {runPairCoverQueue}=require('../src/pair-cover-queue.ts');
function fixture(t,download,{wait,providerFailure}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-cover-download-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('party-cover-download-'));fs.rmSync(dir,{recursive:true,force:true})});
 const store=new Store(dir),bytes=solid(1280,720,70),original=solid(128,128,70),url='https://example.aliyuncs.com/generated-once.png',delays=[],downloads=[];let generations=0,reviews=0;
 store.data.players=['a','b'].map(id=>({id,name:id,number:id,photo:store.upload(original,'image/png').key,active:1,attendance:'present'}));
 const group={id:'group',members:['a','b'],cover:'previous.png'};store.data.states.pairs={value:{groups:[group]},version:1};
 const cover=createCoverService({store,AppError,validImage,imageCodec:codec,faceLocalizer,isEligible:p=>p.attendance==='present',parseAIJSON:JSON.parse,
  provider:async(route,body)=>{if(route.includes('multimodal-generation')){generations++;if(providerFailure)throw providerFailure;return{output:{choices:[{message:{content:[{image:url}]}}]}}}const geometry=faceRegionReply(body);if(geometry)return{choices:[{message:{content:JSON.stringify(geometry)}}]};reviews++;return{choices:[{message:{content:'{"sceneMatches":true,"completePeople":true,"naturalBlend":true}'}}]}},
  fetcher:async(endpoint,options)=>{assert.equal(endpoint,url);assert.ok(options.signal);downloads.push(endpoint);return download(downloads.length,bytes)},
  retryDelay:async ms=>{delays.push(ms);if(wait)await wait(store)}
 });
 return{store,group,bytes,delays,downloads,generate:()=>cover({ids:group.members,groupId:group.id}),counts:()=>({generations,reviews})};
}

for(const status of [408,425,429,500,503,599])test('transient image download HTTP '+status+' retries the existing URL without generating again',async t=>{
 const f=fixture(t,(attempt,bytes)=>attempt===1?new Response('',{status}):new Response(bytes));
 const result=await f.generate();
 assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.bytes);assert.equal(f.downloads.length,2);assert.deepEqual(f.delays,[1000]);assert.deepEqual(f.counts(),{generations:1,reviews:1});assert.equal(f.group.cover,'previous.png');
});

for(const [name,code]of [['TypeError',''],['TimeoutError',''],['AbortError',''],['Error','ECONNRESET'],['Error','EAI_AGAIN']])test('image download '+(code||name)+' retries without repeating paid generation',async t=>{
 const f=fixture(t,(attempt,bytes)=>{if(attempt===1){const error=Error('fixture transport failure');error.name=name;if(code)error.code=code;throw error}return new Response(bytes)});
 const result=await f.generate();assert.ok(fs.existsSync(f.store.photoPath(result.photo)));assert.equal(f.downloads.length,2);assert.deepEqual(f.delays,[1000]);assert.deepEqual(f.counts(),{generations:1,reviews:1});
});

test('an interrupted image response body retries the same generated image',async t=>{
 const f=fixture(t,(attempt,bytes)=>attempt===1?{ok:true,arrayBuffer:async()=>{throw Object.assign(Error('stream interrupted'),{code:'ECONNRESET'})}}:new Response(bytes));
 const result=await f.generate();assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.bytes);assert.equal(f.downloads.length,2);assert.deepEqual(f.delays,[1000]);assert.equal(f.counts().generations,1);
});

test('exhausted downloads stop after three retries without allowing the outer queue to regenerate a paid image',async t=>{
 const f=fixture(t,()=>new Response('',{status:503})),failures=[];let outerRetries=0,saves=0;
 await runPairCoverQueue({groups:[f.group],replaceExisting:true,current:()=>f.group,cancelled:()=>false,generate:f.generate,save:async()=>saves++,retryDelay:async()=>assert.fail('outer generation must not retry an exhausted download'),onRetry:()=>outerRetries++,onFailure:(_,e)=>failures.push(e)});
 assert.equal(f.downloads.length,4);assert.deepEqual(f.delays,[1000,2000,4000]);assert.deepEqual(f.counts(),{generations:1,reviews:0});assert.equal(outerRetries,0);assert.equal(saves,0);assert.equal(failures.length,1);assert.match(failures[0].message,/下载.*重试3次/);assert.equal(f.group.cover,'previous.png');
});

for(const status of [400,401,403,404,410,422])test('permanent image download HTTP '+status+' is not retried',async t=>{
 const f=fixture(t,()=>new Response('',{status}));
 await assert.rejects(f.generate(),/图片下载失败/);assert.equal(f.downloads.length,1);assert.deepEqual(f.delays,[]);assert.deepEqual(f.counts(),{generations:1,reviews:0});
});

test('provider moderation refusal does not enter image download retries',async t=>{
 const f=fixture(t,()=>assert.fail('rejected generation has no image download'),{providerFailure:new AppError('Green net check rejected image (input)',500)});
 await assert.rejects(f.generate(),/Green net check rejected image/);assert.equal(f.downloads.length,0);assert.deepEqual(f.delays,[]);assert.deepEqual(f.counts(),{generations:1,reviews:0});
});

test('a moderation rejection thrown during download is never retried',async t=>{
 const f=fixture(t,()=>{throw new AppError('Green net check rejected image (output)',500)});
 await assert.rejects(f.generate(),/Green net check rejected image/);assert.equal(f.downloads.length,1);assert.deepEqual(f.delays,[]);assert.deepEqual(f.counts(),{generations:1,reviews:0});
});

for(const change of ['clear','photo','attendance','new-request'])test('download backoff stops when the job becomes obsolete: '+change,async t=>{
 const f=fixture(t,()=>new Response('',{status:503}),{wait:async store=>{
  if(change==='clear')store.data.states.pairs.value.groups=[];
  if(change==='photo')store.data.players[0].photo='replacement.png';
  if(change==='attendance')store.data.players[0].attendance='away';
  if(change==='new-request')store.data.coverSceneAssignments.group='replacement-scene';
 }});
 await assert.rejects(f.generate(),/重新分配|照片已更换|未到|已离场|已失效|旧结果/);assert.equal(f.downloads.length,1);assert.deepEqual(f.delays,[1000]);assert.deepEqual(f.counts(),{generations:1,reviews:0});
});
