const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {runPairCoverQueue}=require('../src/pair-cover-queue.ts');
const group=id=>({id,members:[id+'-a',id+'-b'],cover:''});
const error=(message,status)=>Object.assign(new Error(message),{status});
const flush=()=>new Promise(setImmediate);

test('transient cover failures retry with increasing delays and save success once',async()=>{
 const groups=[group('one')],delays=[],retries=[],saved=[];let calls=0;
 const result=await runPairCoverQueue({groups,current:id=>groups.find(g=>g.id===id),cancelled:()=>false,generate:async()=>{if(++calls<3)throw error('AI请求超时',408);return{cover:'new.png'}},save:async(g,patch)=>{saved.push(patch);g.cover=patch.cover},retryDelay:async ms=>{delays.push(ms)},onRetry:(g,n,max)=>retries.push([g.id,n,max])});
 assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);assert.deepEqual(retries,[['one',1,10],['one',2,10]]);assert.deepEqual(saved,[{cover:'new.png'}]);assert.deepEqual(result,{done:1,total:1,cancelled:false});
});

test('ten automatic retries exhaust the budget, preserve the previous result and continue other groups',async()=>{
 const groups=[{...group('bad'),cover:'previous.png'},group('next')],calls=[],failures=[],delays=[];
 const result=await runPairCoverQueue({groups,replaceExisting:true,concurrency:1,current:id=>groups.find(g=>g.id===id),cancelled:()=>false,generate:async g=>{calls.push(g.id);if(g.id==='bad')throw error('service unavailable',503);return{cover:'next.png'}},save:async(g,p)=>{g.cover=p.cover},retryDelay:async ms=>delays.push(ms),onFailure:(g,e)=>failures.push([g.id,e])});
 assert.deepEqual(calls,[...Array(11).fill('bad'),'next']);assert.deepEqual(delays,[1000,2000,4000,8000,16000,30000,30000,30000,30000,30000]);assert.equal(groups[0].cover,'previous.png');assert.equal(groups[1].cover,'next.png');assert.equal(failures.length,1);assert.match(failures[0][1].message,/10.*重试|重试.*10/);assert.equal(result.done,2);
});

test('rate limiting can recover on the tenth retry with capped waits and no extra saves',async()=>{
 const g=group('late-success'),delays=[],failures=[];let calls=0,saves=0;
 await runPairCoverQueue({groups:[g],current:()=>g,cancelled:()=>false,generate:async()=>{if(++calls<=10)throw error('Requests rate limit exceeded',429);return{cover:'eventual.png'}},save:async(_,p)=>{saves++;g.cover=p.cover},retryDelay:async ms=>delays.push(ms),onFailure:(_,e)=>failures.push(e)});
 assert.equal(calls,11);assert.equal(saves,1);assert.equal(g.cover,'eventual.png');assert.equal(failures.length,0);assert.equal(delays.length,10);assert.ok(delays.every(ms=>ms>=5000&&ms<=30000));
});

test('input moderation refusal never retries even with a server status and continues the next group',async()=>{
 const groups=[group('rejected'),group('next')],calls=[],failures=[];
 await runPairCoverQueue({groups,concurrency:1,current:id=>groups.find(g=>g.id===id),cancelled:()=>false,generate:async g=>{calls.push(g.id);if(g.id==='rejected')throw error('千问调用失败：Green net check rejected image (input)',500);return{cover:'next.png'}},save:async(g,p)=>{g.cover=p.cover},retryDelay:async()=>assert.fail('moderation must never wait for a retry'),onFailure:(g,e)=>failures.push(e.message)});
 assert.deepEqual(calls,['rejected','next']);assert.match(failures[0],/原照片.*审核|审核.*原照片/);assert.match(failures[0],/更换/);assert.equal(groups[1].cover,'next.png');
});

test('output moderation refusal is permanent without blaming the original input photographs',async()=>{
 const g=group('one'),failures=[];let calls=0;
 await runPairCoverQueue({groups:[g],current:()=>g,cancelled:()=>false,generate:async()=>{calls++;throw error('Green net check rejected image (output)',500)},save:async()=>assert.fail('rejected output is never saved'),retryDelay:async()=>assert.fail('rejected output is never retried'),onFailure:(_,e)=>failures.push(e)});
 assert.equal(calls,1);assert.match(failures[0].message,/服务端审核/);assert.doesNotMatch(failures[0].message,/原照片审核|更换.*原照片/);assert.equal(failures[0].moderationRejected,true);
});

test('failed save is retried from the generated result without another paid generation',async()=>{
 const g=group('one');let calls=0,saves=0;const retries=[];
 await runPairCoverQueue({groups:[g],current:()=>g,cancelled:()=>false,generate:async()=>{calls++;return{cover:'saved.png'}},save:async(_,p)=>{if(++saves<3)throw Error('暂时保存失败');g.cover=p.cover},retryDelay:async()=>{},onRetry:(_,n,max,ms,phase)=>retries.push(phase)});
 assert.equal(calls,1);assert.equal(saves,3);assert.equal(g.cover,'saved.png');assert.deepEqual(retries,['save','save']);
});

for(const mode of ['cancel','removed','replaced','completed'])test('retry does not submit an old group after '+mode,async()=>{
 const g=group('one');let current=g,stopped=false,calls=0,saves=0,resume;
 const running=runPairCoverQueue({groups:[g],current:()=>current,cancelled:()=>stopped,generate:async()=>{calls++;throw error('too many requests',429)},save:async()=>saves++,retryDelay:()=>new Promise(resolve=>{resume=resolve})});
 await flush();assert.ok(resume,'the transient failure enters automatic backoff');
 if(mode==='cancel')stopped=true;if(mode==='removed')current=undefined;if(mode==='replaced')current={...g,members:['different-a','different-b']};if(mode==='completed')current={...g,cover:'already-saved.png'};
 resume();await running;assert.equal(calls,1);assert.equal(saves,0);
});

test('new queue skips completed groups and never retries an unknown permanent generation error',async()=>{
 const groups=[{...group('saved'),cover:'done.png'},group('invalid'),group('next')],calls=[],failures=[];
 await runPairCoverQueue({groups,concurrency:1,current:id=>groups.find(g=>g.id===id),cancelled:()=>false,generate:async g=>{calls.push(g.id);if(g.id==='invalid')throw error('请先重新配置密钥',401);return{cover:'next.png'}},save:async(g,p)=>{g.cover=p.cover},retryDelay:async()=>assert.fail('permanent failures do not retry'),onFailure:g=>failures.push(g.id)});
 assert.deepEqual(calls,['invalid','next']);assert.deepEqual(failures,['invalid']);assert.equal(groups[0].cover,'done.png');
});
