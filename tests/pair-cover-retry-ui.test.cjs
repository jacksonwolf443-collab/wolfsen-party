const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{act}=React,flush=()=>new Promise(setImmediate);
async function fixture(t,groups,transport,beforeSave=()=>{}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const root=require('react-dom/client').createRoot(document.getElementById('root')),Pairs=require('../src/pair-activity.tsx').default,players=Array.from({length:6},(_,i)=>({id:'p'+i,name:'玩家'+i,number:String(i+1),photo:'source-'+i+'.png',active:1,attendance:'present'}));
 let state={groups,standby:[],round:1},event={id:require('node:crypto').randomUUID(),resetEpoch:0},clear,leave,reenter,changePhoto,changeScope,replaceGroups;const calls=[],notices=[];
 window.partyDesktop={call:async(route,body)=>{assert.equal(route,'ai/cover');calls.push(body);return transport(body,calls.length)}};
 function Harness(){const [pairs,setPairs]=React.useState(state),[shown,setShown]=React.useState(true),[busy,setBusy]=React.useState('');clear=()=>{state={...state,groups:[]};setPairs(state)};leave=()=>setShown(false);reenter=()=>setShown(true);changeScope=(patch)=>{event={...event,...patch};state={...state};setPairs(state)};replaceGroups=next=>{state={...state,groups:next};setPairs(state)};changePhoto=(id,photo)=>{players.find(p=>p.id===id).photo=photo;state={...state};setPairs(state)};return React.createElement(React.Fragment,null,React.createElement('span',{'data-busy':true},busy),shown&&React.createElement(Pairs,{ctx:{event,players,bag:{pairs},ai:{hasKey:true},busy,tell:s=>notices.push(s),run:async(label,fn)=>{setBusy(label);try{await fn()}catch(e){notices.push(e.message)}finally{setBusy('')}},save:async(_,input)=>{await beforeSave();state=typeof input==='function'?input(state):input;setPairs(state)},project:async()=>{},refresh:async()=>{}}}))}
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(async()=>{root.render(React.createElement(Harness));await flush()});
 const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text),click=async text=>act(async()=>{const node=button(text);assert.ok(node,text);node.click();await flush()}),tick=async(ms=1000)=>act(async()=>{t.mock.timers.tick(ms);await flush()});
 return{calls,notices,button,click,tick,state:()=>state,clear:()=>act(async()=>{clear();await flush()}),leave:()=>act(async()=>{leave();await flush()}),reenter:()=>act(async()=>{reenter();await flush()}),scope:patch=>act(async()=>{changeScope(patch);await flush()}),groups:next=>act(async()=>{replaceGroups(next);await flush()}),storage:()=>dom.window.localStorage,breakStorage:()=>Object.defineProperty(dom.window,'localStorage',{configurable:true,get(){throw Error('storage unavailable')}}),photo:(id,key)=>act(async()=>{changePhoto(id,key);await flush()})};
}
const group=(id,offset,cover='')=>({id,members:['p'+offset,'p'+(offset+1)],cover,challenge:'existing challenge',alive:true,votes:7});

test('batch automatically retries transient errors, explains permanent refusals and skips completed covers',async t=>{
 const callsByGroup={};const f=await fixture(t,[group('retry',0,'old.png'),group('rejected',2,'keep.png'),{...group('done',4,'done.png'),coverMethod:'whole-photo-v2'}],async body=>{const n=callsByGroup[body.groupId]=(callsByGroup[body.groupId]??0)+1;if(body.groupId==='retry'&&n===1)return{ok:false,error:'AI请求超时',status:408};if(body.groupId==='rejected')return{ok:false,error:'Green net check rejected image (input)',status:500};return{ok:true,data:{photo:'new.png',coverMethod:'whole-photo-v2'}}});
 await f.click('给所有组合生成合照');assert.match(document.querySelector('.pair-batch-progress').textContent,/重试.*1.*10/);assert.ok(document.querySelector('[data-busy]').textContent);
 await f.tick();assert.deepEqual(callsByGroup,{retry:2,rejected:1});assert.equal(f.state().groups[0].cover,'new.png');assert.equal(f.state().groups[0].votes,7);assert.equal(f.state().groups[1].cover,'keep.png');assert.equal(f.state().groups[2].cover,'done.png');assert.match(document.querySelector('.pair-batch-errors').textContent,/更换.*原照片/);assert.equal(f.button('重试失败组合'),undefined);assert.equal(document.querySelector('[data-busy]').textContent,'');await f.click('给所有组合生成合照');assert.deepEqual(callsByGroup,{retry:2,rejected:1},'another batch must not resubmit the same refused original photographs');
});

test('explicit single-group generation shares automatic retry and preserves the old cover until success',async t=>{
 const other={...group('other',2,'other-original.png'),coverMethod:'whole-photo-v2'},f=await fixture(t,[{...group('one',0,'old.png'),coverMethod:'whole-photo-v2'},other],async(_,n)=>n===1?{ok:false,error:'服务暂时不可用',status:503}:{ok:true,data:{photo:'single-new.png',coverMethod:'whole-photo-v2'}});
 assert.equal(document.querySelectorAll('.pair-regenerate-cover').length,2,'each group with a photo has its own regeneration control');
 await f.click('重新生成本组合照');assert.equal(f.state().groups[0].cover,'old.png');assert.match(document.querySelector('.pair-batch-progress').textContent,/重试.*1.*10/);await f.tick();assert.equal(f.calls.length,2);assert(f.calls.every(b=>b.groupId==='one'&&JSON.stringify(b.ids)===JSON.stringify(['p0','p1'])),'only the clicked pair is regenerated');assert.equal(f.state().groups[0].cover,'single-new.png');assert.equal(f.state().groups[0].challenge,'existing challenge');assert.equal(f.state().groups[0].votes,7);assert.deepEqual(f.state().groups[1],other,'another group keeps its picture and game results');assert.equal(document.querySelector('[data-busy]').textContent,'');
});

for(const action of ['clear','leave'])test('single-group retry cannot resume after '+action,async t=>{
 const f=await fixture(t,[group('one',0)],async()=>({ok:false,error:'AI请求超时',status:408}));
 await f.click('生成合照');assert.equal(f.calls.length,1);assert.match(document.querySelector('.pair-batch-progress')?.textContent??'',/重试/);await f[action]();await f.tick();assert.equal(f.calls.length,1);if(action==='clear')assert.equal(f.state().groups.length,0);
});

test('a later save attempt reuses an already generated cover after automatic saving exhausts its budget',async t=>{
 let saves=0;const f=await fixture(t,[group('one',0,'old.png')],async()=>({ok:true,data:{photo:'generated-once.png',coverMethod:'whole-photo-v2'}}),()=>{if(++saves<=4)throw Error('暂时保存失败')});
 await f.click('重新生成本组合照');await f.tick(1000);await f.tick(2000);await f.tick(4000);assert.equal(saves,4);assert.equal(f.state().groups[0].cover,'old.png');assert.equal(f.calls.length,1);
 await f.click('重新生成本组合照');assert.equal(f.calls.length,1,'saving a previously paid result must not generate another image');assert.equal(saves,5);assert.equal(f.state().groups[0].cover,'generated-once.png');
});

test('a rejected group stays blocked until the host replaces an original photograph',async t=>{
 let allow=false;const f=await fixture(t,[group('one',0)],async()=>allow?{ok:true,data:{photo:'approved.png',coverMethod:'whole-photo-v2'}}:{ok:false,error:'Green net check rejected image (input)',status:400});
 await f.click('生成合照');assert.equal(f.calls.length,1);await f.click('生成合照');assert.equal(f.calls.length,1);assert.match(document.querySelector('.pair-batch-errors').textContent,/更换.*原照片/);
 await f.photo('p0','replacement-photo.png');allow=true;await f.click('生成合照');assert.equal(f.calls.length,2);assert.equal(f.state().groups[0].cover,'approved.png');
});

test('failed-only button retries just failed teams, lists names and keeps successful and solo teams',async t=>{
 const solo={id:'solo',members:['p4'],solo:true,seats:2,cover:'',alive:true,challenge:''};let success=false;
 const f=await fixture(t,[group('bad',0),{...group('done',2,'kept.png'),coverMethod:'whole-photo-v2'},solo],async body=>success?{ok:true,data:{photo:'recovered.png',coverMethod:'whole-photo-v2'}}:{ok:false,status:401,error:'请核对百炼配置'});
 await f.click('给所有组合生成合照');assert.deepEqual(f.calls.map(c=>c.groupId),['bad']);assert.ok(f.state().groups[0].coverFailure);assert.equal(f.button('给生成失败的组再次生成合照').disabled,false);
 success=true;await f.click('给生成失败的组再次生成合照');assert.deepEqual(f.calls.map(c=>c.groupId),['bad','bad']);assert.equal(f.state().groups[0].cover,'recovered.png');assert.equal(f.state().groups[0].coverFailure,null);assert.equal(f.state().groups[1].cover,'kept.png');assert.match(document.querySelector('.pair-cover-retry-list').textContent,/玩家0.*玩家1/);assert.doesNotMatch(document.querySelector('.pair-cover-retry-list').textContent,/玩家2|玩家3|玩家4/);assert.equal(f.button('给生成失败的组再次生成合照').disabled,true);
});

test('saved failure metadata exposes a retry after reopening the activity',async t=>{
 const f=await fixture(t,[{...group('persisted',0,'old.png'),coverFailure:{message:'网络超时'}}],async()=>({ok:true,data:{photo:'reopened.png',coverMethod:'whole-photo-v2'}}));
 assert.equal(f.button('给生成失败的组再次生成合照')?.disabled,false);await f.click('给生成失败的组再次生成合照');assert.equal(f.calls.length,1);assert.equal(f.state().groups[0].cover,'reopened.png');
});

test('old versions with no persisted failure metadata can retry only groups still lacking a successful cover',async t=>{
 const f=await fixture(t,[group('old-failure',0),{...group('finished',2,'keep.png'),coverMethod:'whole-photo-v2'}],async()=>({ok:true,data:{photo:'legacy-recovered.png',coverMethod:'whole-photo-v2'}}));
 assert.equal(f.button('给生成失败的组再次生成合照')?.disabled,false);await f.click('给生成失败的组再次生成合照');assert.deepEqual(f.calls.map(c=>c.groupId),['old-failure']);assert.equal(f.state().groups[1].cover,'keep.png');
});

for(const storageAvailable of[true,false])test('paid pending cover survives actual unmount and reentry '+(storageAvailable?'using durable paths':'when storage is unavailable'),async t=>{
 let saves=0;const f=await fixture(t,[{...group('paid',0,'old.png'),coverMethod:'whole-photo-v2'}],async()=>({ok:true,data:{photo:'paid-once.png',coverMethod:'whole-photo-v2',scene:'朋友合照'}}),()=>{if(++saves<=4)throw Error('暂时保存失败')});if(!storageAvailable)f.breakStorage();
 await f.click('重新生成本组合照');await f.tick(1000);await f.tick(2000);await f.tick(4000);assert.equal(saves,4);assert.equal(f.calls.length,1);assert.equal(f.state().groups[0].cover,'old.png');if(storageAvailable)assert.match([...Array(f.storage().length)].map((_,i)=>f.storage().getItem(f.storage().key(i))).join(''),/paid-once\.png/);
 await f.leave();await f.reenter();assert.equal(f.button('给生成失败的组再次生成合照').disabled,false);await f.click('给生成失败的组再次生成合照');assert.equal(f.calls.length,1,'resume only saves the already paid result');assert.equal(saves,5);assert.equal(f.state().groups[0].cover,'paid-once.png');assert.equal(f.button('给生成失败的组再次生成合照').disabled,true);if(storageAvailable)assert.doesNotMatch([...Array(f.storage().length)].map((_,i)=>f.storage().getItem(f.storage().key(i))).join(''),/paid-once\.png/);
});

test('a newly generated paid path is recoverable while its first save is in backoff',async t=>{
 let saves=0;const f=await fixture(t,[{...group('early',0,'old.png'),coverMethod:'whole-photo-v2'}],async()=>({ok:true,data:{photo:'early-paid.png',coverMethod:'whole-photo-v2'}}),()=>{if(++saves===1)throw Error('暂时保存失败')});await f.click('重新生成本组合照');assert.equal(saves,1);assert.match([...Array(f.storage().length)].map((_,i)=>f.storage().getItem(f.storage().key(i))).join(''),/early-paid\.png/);await f.leave();await f.tick(1000);await f.reenter();await f.click('给生成失败的组再次生成合照');assert.equal(f.calls.length,1);assert.equal(saves,2);assert.equal(f.state().groups[0].cover,'early-paid.png');
});

for(const changed of['event','reset','photo','members','old-cover','re-pair'])test('paid pending recovery is rejected after '+changed+' changes',async t=>{
 let saves=0;const original={...group('guarded',0,'old.png'),coverMethod:'whole-photo-v2'},f=await fixture(t,[original],async(_,n)=>({ok:true,data:{photo:'paid-'+n+'.png',coverMethod:'whole-photo-v2'}}),()=>{if(++saves<=4)throw Error('暂时保存失败')});await f.click('重新生成本组合照');await f.tick(1000);await f.tick(2000);await f.tick(4000);assert.equal(f.calls.length,1);await f.leave();
 if(changed==='event')await f.scope({id:'another-party'});if(changed==='reset')await f.scope({resetEpoch:1});if(changed==='photo')await f.photo('p0','new-original.png');if(changed==='members')await f.groups([{...original,members:['p2','p3']}]);if(changed==='old-cover')await f.groups([{...original,cover:'another-cover.png'}]);if(changed==='re-pair')await f.groups([{...original,id:'new-group'}]);await f.reenter();assert.equal(f.button('给生成失败的组再次生成合照').disabled,true,'stale generated patch is never offered for saving');await f.click('重新生成本组合照');assert.equal(f.calls.length,2,'a new context generates a fresh result');assert.equal(f.state().groups[0].cover,'paid-2.png');
});

for(const changed of['photo','members','old-cover','event','reset'])test('a queued cover save rechecks '+changed+' when the functional write actually executes',async t=>{
 let release,entered=0;const gate=new Promise(resolve=>release=resolve),original={...group('queued',0,'old.png'),coverMethod:'whole-photo-v2'},f=await fixture(t,[original],async()=>({ok:true,data:{photo:'stale-paid.png',coverMethod:'whole-photo-v2'}}),async()=>{if(++entered===1)await gate});await f.click('重新生成本组合照');assert.equal(entered,1);assert.equal(f.state().groups[0].cover,'old.png');
 if(changed==='photo')await f.photo('p0','replacement-photo.png');if(changed==='members')await f.groups([{...original,members:['p2','p3']}]);if(changed==='old-cover')await f.groups([{...original,cover:'newly-accepted.png'}]);if(changed==='event')await f.scope({id:'new-queued-party'});if(changed==='reset')await f.scope({resetEpoch:1});await act(async()=>{release();await flush()});assert.equal(f.calls.length,1);assert.equal(f.state().groups[0].cover,changed==='old-cover'?'newly-accepted.png':'old.png','the stale generated patch must never replace current state');
});
