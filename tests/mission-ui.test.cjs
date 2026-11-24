const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ts=require('typescript');
const {JSDOM}=require('jsdom');
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const {Store,createBackend}=require('../desktop/store.cjs');
// Compile the real React component and its local imports for this Node test worker.
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const MissionActivity=require('../src/mission-activity.tsx').default;

test('deadline reveals settlement from the task bank and after reopening the activity',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jungle-mission-ui-'));
  const store=new Store(directory),api=createBackend(store);
  for(let i=1;i<=2;i++)await createCheckedInPlayer(api, {name:'界面测试'+i,number:String(i)}, 'POST');
  await api('state',{kind:'taskBank',value:['互相介绍'],version:0},'PUT');
  await api('mission/start',{minutes:1});
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
  window.partyDesktop={call:async(route,body,method)=>({ok:true,data:await api(route,body,method)})};
  const ctx={players:store.data.players,bag:{taskBank:['互相介绍']},busy:'',tell:()=>{},run:(_label,fn)=>fn(),save:async()=>{},project:async()=>{}};
  let root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;fs.rmSync(directory,{recursive:true,force:true});});
  t.mock.timers.enable({apis:['setInterval']});
  await act(async()=>root.render(React.createElement(MissionActivity,{ctx})));
  assert.ok(document.querySelector('.task-bank'),'the live round initially permits editing the task bank');
  store.commit(d=>{d.missionRound.endsAt=Date.now()-1;return{};});
  await act(async()=>{t.mock.timers.tick(3000);});
  assert.match(document.querySelector('.result-note')?.textContent??'',/界面测试1.*界面测试2|界面测试2.*界面测试1/,'deadline must expose the pending list without a manual tab switch');
  assert.ok(!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='补记通过'));
  await act(async()=>root.unmount());
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(MissionActivity,{ctx})));
  assert.match(document.querySelector('.result-note')?.textContent??'',/未验收通过名单/,'reopening an expired round should also show settlement');
});
