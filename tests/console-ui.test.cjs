// Isolated React/DOM integration test, not a native-window or canvas-pixel test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ts=require('typescript');
const {JSDOM}=require('jsdom');
const {Store,createBackend}=require('../desktop/store.cjs');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);

test('player forms save two numbered photos, seven tabs render, and roster/activity state survive a fresh app mount',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jungle-console-ui-'));
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
  // jsdom has no drawing surface. Only initial blank-canvas mounting is stubbed;
  // this suite deliberately makes no claim about drawing, cropping or image pixels.
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){}});
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
  const PartyConsole=require('../src/console.tsx').default;
  let store=new Store(dir),api=createBackend(store),root=createRoot(document.getElementById('root'));
  t.mock.timers.enable({apis:['setTimeout']});
  const fullscreen=[];
  window.partyDesktop={call:async(route,body,method)=>{
    try{return{ok:true,data:route==='desktop/fullscreen'?(fullscreen.push(body?.enabled),{fullscreen:body?.enabled}):await api(route,body,method)};}
    catch(e){return{ok:false,error:e.message};}
  }};
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;fs.rmSync(dir,{recursive:true,force:true});});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const click=async element=>{assert.ok(element,'target control must exist');await act(async()=>{element.click();await flush();});};
  const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text);
  const input=async(element,value)=>{assert.ok(element);await act(async()=>{Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});};
  const tab=async prefix=>click(Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.startsWith(prefix)));
  await act(async()=>{root.render(React.createElement(PartyConsole));await flush();});
  const image=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
  for(const [number,name] of [['001','表单测试甲'],['1','表单测试乙'],['002','表单测试丙']]){
    await click(button('新增玩家'));
    assert.ok(Array.from(document.querySelectorAll('form input[type=checkbox]')).every(x=>x.checked),'new players default to participating and photo consent');
    await input(document.querySelector('input[placeholder="001"]'),number);
    await input(document.querySelector('input[placeholder="怎么称呼这位玩家？"]'),name);
    const fileInput=document.querySelector('input[type=file]');
    Object.defineProperty(fileInput,'files',{value:[new File([image],'test-photo.png',{type:'image/png'})],configurable:true});
    await act(async()=>fileInput.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
    await act(async()=>{document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();});
    assert.equal(document.querySelector('[role=dialog]'),null,'successful save closes the player form');
    assert.equal(store.data.players.at(-1).attendance,'away','registration alone does not sign in a participant');
    await click(button('签到'));
    assert.equal(store.data.players.at(-1).attendance,'present','the host explicitly signs in this game participant');
  }
  assert.deepEqual(store.data.players.map(p=>p.number),['001','1','002']);
  for(const p of store.data.players)assert.deepEqual(fs.readFileSync(store.photoPath(p.photo)),image);
  await tab('01');await click(button('随机配对'));
  await act(async()=>{t.mock.timers.tick(3000);await flush();});
  await act(async()=>{t.mock.timers.tick(3500);await flush();});
  assert.equal(store.state('pairs').value,null,'revealed pairs remain a preview until adopted');await click(button('确认采用本次配对'));
  assert.equal(store.data.states.pairs.value.groups.length,2);
  await tab('03');await click(button('分为3组并开始'));
  await act(async()=>{t.mock.timers.tick(3200);await flush();});
  assert.equal(store.state('tails').value,null,'group animation holds a preview until confirmed');
  await click(button('确认分组并开始本轮'));
  for(let i=0;i<3;i++){await input(document.querySelectorAll('.tails-awards select')[i],store.state('tails').value.groups[i][0]);await input(document.querySelectorAll('.tails-awards input[type=number]')[i],String(3-i));}
  await click(button('确认前三名并计分（3 / 2 / 1）'));assert.deepEqual(store.data.players.map(p=>p.score).sort(),[1,2,3]);
  for(let i=1;i<=7;i++){await tab(String(i).padStart(2,'0'));assert.ok(document.querySelector('.activity-header h1')?.textContent);}
  await tab('01');await click(button('介绍这一组'));await click(button('舞台模式'));
  assert.ok(document.querySelector('.stage'));assert.equal(fullscreen.at(-1),true);
  await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.stage'),null);assert.equal(fullscreen.at(-1),false);
  await act(async()=>root.unmount());
  store=new Store(dir);api=createBackend(store);root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(PartyConsole));await flush();});
  assert.deepEqual(Array.from(document.querySelectorAll('.player-info h3')).map(n=>n.textContent),['表单测试甲','表单测试乙','表单测试丙']);
  assert.equal(document.querySelectorAll('.player-portrait img').length,3);
  await tab('01');assert.equal(document.querySelectorAll('.pair-members').length,2);
  await tab('03');assert.equal(document.querySelectorAll('.tails-awards .panel').length,3);assert.deepEqual(store.data.players.map(p=>p.score).sort(),[1,2,3]);
});
