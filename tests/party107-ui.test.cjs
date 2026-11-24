const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const {JSDOM}=require('jsdom');

for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},
}).outputText,file);

async function view(t,handler){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://party.test'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React;
 const root=require('react-dom/client').createRoot(document.getElementById('root'));
 const MobileAccess=require('../src/mobile-access.tsx').default;
 const calls=[];
 window.partyDesktop={call:async route=>{calls.push(route);return {ok:true,data:await handler(route)}}};
 t.after(async()=>{await act(()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 const flush=()=>new Promise(setImmediate);
 await act(async()=>{root.render(React.createElement(MobileAccess,{ctx:{busy:'',run:async(_,task)=>task()}}));await flush()});
 const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
 return {calls,button,click:label=>act(async()=>{const element=button(label);assert.ok(element);element.click();await flush()})};
}

test('fresh install shows blank custom settings and offers local play without auto-connecting',async t=>{
 const v=await view(t,route=>{
  assert.equal(route,'mobile/status');
  return {running:false,connected:[],fixed:{configured:false,state:'off'}};
 });
 assert.deepEqual(v.calls,['mobile/status']);
 assert.ok(v.button('开启局域网（同一 Wi-Fi）'));
 assert.equal(v.button('保存并连接').disabled,true);
 assert.equal(document.querySelector('input[type=url]').value,'');
 assert.equal(document.querySelector('input[type=password]').value,'');
 assert.equal(document.querySelector('.phone-entry img'),null);
});

test('importing one’s server is explicit, connects it, and displays the resulting QR',async t=>{
 let started=false;
 const v=await view(t,route=>{
  if(route==='mobile/fixed-start'){started=true;return {enabled:true}}
  if(route==='mobile/fixed-import')return {configured:true,url:'https://party.test'};
  assert.equal(route,'mobile/status');
  return started?{running:true,public:true,url:'https://party.test/#entry',qr:'data:image/png;base64,AA==',connected:[],fixed:{configured:true,state:'ready',url:'https://party.test'}}:{running:false,fixed:{configured:false,state:'off'}};
 });
 await v.click('导入连接文件');
 assert.deepEqual(v.calls,['mobile/status','mobile/fixed-import','mobile/fixed-start','mobile/status']);
 assert.ok(document.querySelector('.phone-entry img'));
 assert.match(document.body.textContent,/自建服务器已连接/);
});
