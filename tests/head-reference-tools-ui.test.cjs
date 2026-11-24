const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);

test('head references prepare every uploaded photograph sequentially, continue past failures, retry only failed players, and stop after the current player',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Tools=require('../src/head-reference-tools.tsx').default,root=createRoot(document.getElementById('root'));
 const players=[{id:'a',name:'半身自拍',photo:'half',active:1},{id:'b',name:'全身照',photo:'body',active:1},{id:'away',name:'离场者',photo:'photo',active:1,attendance:'away'},{id:'empty',name:'无照片',photo:'',active:1}];
 let mode='initial',refreshes=0,pending;const calls=[];
 window.partyDesktop={call:async(route,body)=>{assert.equal(route,'ai/head-reference');calls.push(body.id);if(mode==='pending')return new Promise(resolve=>pending=resolve);return body.id==='a'&&mode==='initial'?{ok:false,error:'模拟识别失败'}:{ok:true,data:{id:body.id,headCutout:'head-'+body.id,referenceMethod:'automatic'}}}};
 const ctx={players,ai:{hasKey:true},busy:'',tell(){},async refresh(preserve){assert.equal(preserve,true);refreshes++},async run(_label,fn){return fn()}};
 const flush=()=>new Promise(r=>setImmediate(r)),button=label=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===label),click=async label=>act(async()=>{const control=button(label);assert.ok(control,label);control.click();await flush()});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(async()=>{root.render(React.createElement(Tools,{ctx,label:'自动识别所有照片'}));await flush()});assert.equal(calls.length,0,'opening the page never starts paid work');
 await click('自动识别所有照片');assert.deepEqual(calls,['a','b','away']);assert.equal(refreshes,1);assert.ok(document.body.textContent.includes('模拟识别失败'));assert.ok(document.body.textContent.includes('3 / 3'));
 mode='retry';await click('重试失败玩家');assert.deepEqual(calls,['a','b','away','a']);assert.equal(refreshes,2);assert.equal(button('重试失败玩家'),undefined);
 mode='pending';await click('自动识别所有照片');await click('停止后续玩家');await act(async()=>{pending({ok:true,data:{id:'a',headCutout:'head-a'}});await flush()});assert.deepEqual(calls,['a','b','away','a','a']);assert.equal(refreshes,3);
 await click('自动识别所有照片');await act(async()=>root.unmount());await act(async()=>{pending({ok:true,data:{id:'a',headCutout:'head-a'}});await flush()});assert.deepEqual(calls,['a','b','away','a','a','a']);assert.equal(refreshes,4,'current result is refreshed even when leaving the page');
});

test('activity preparation skips away players and disables paid controls without an AI key',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Tools=require('../src/head-reference-tools.tsx').default,root=createRoot(document.getElementById('root')),calls=[];
 const ctx={players:[{id:'a',name:'在场者',photo:'half',active:1},{id:'away',name:'离场者',photo:'photo',active:1,attendance:'away'},{id:'inactive',name:'不参与',photo:'photo',active:0}],ai:{hasKey:false},busy:'',tell(){},async refresh(){},async run(_label,fn){return fn()}};
 window.partyDesktop={call:async(_route,body)=>{calls.push(body.id);return{ok:true,data:{headCutout:'head'}}}};
 const flush=()=>new Promise(r=>setImmediate(r));t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(async()=>{root.render(React.createElement(Tools,{ctx,label:'自动准备全部人脸参考',eligibleOnly:true}));await flush()});assert.equal(document.querySelector('button').disabled,true);assert.equal(calls.length,0);
 await act(async()=>{root.render(React.createElement(Tools,{ctx:{...ctx,ai:{hasKey:true}},label:'自动准备全部人脸参考',eligibleOnly:true}));await flush()});await act(async()=>{document.querySelector('button').click();await flush()});assert.deepEqual(calls,['a']);
});
