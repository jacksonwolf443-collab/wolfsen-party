const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);

test('lottery rolls all eligible portraits and highlights exactly the authoritative draw before committing; errors and cancellation keep the saved result',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Lottery=require('../src/lottery-activity.tsx').default;
 const root=createRoot(document.getElementById('root')),players=Array.from({length:5},(_,i)=>({id:'p'+i,name:'抽取玩家'+i,number:String(i),photo:i?'portrait'+i:'',active:1,consent:1,attendance:'present'}));
 players.push({...players[0],id:'away',attendance:'away'},{...players[0],id:'inactive',active:0});
 let finishRequest,commits=0,previews=0,lastError='',setPeople,refreshes=0;const cancelled=[];
 let saved={count:1,people:[players[0]]},version=1;
 window.partyDesktop={call:async(route,body)=>{
  if(route==='lottery/draw'){assert.equal(body.preview,true);assert.equal(body.count,2);previews++;return new Promise(resolve=>{finishRequest=resolve})}
  if(route==='lottery/cancel'){cancelled.push(body.token);return{ok:true,data:{canceled:true}}}
  if(route==='lottery/commit'){commits++;assert.equal(body.version,version);saved={count:2,people:[players[1],players[3]]};version++;return{ok:true,data:{value:saved,version}}}
  throw new Error('Unexpected route '+route);
 }};
 function Harness(){
  const [people,updatePeople]=React.useState(players),[bag,setBag]=React.useState({lottery:saved,lotteryVersion:version}),[busy,setBusy]=React.useState('');setPeople=updatePeople;
  return React.createElement(Lottery,{ctx:{players:people,bag,busy,ai:{},event:{},tell(){},project:async()=>{},save:async()=>{},go(){},resetActivity:async()=>{},
   async run(label,f){setBusy(label);try{return await f()}catch(e){lastError=e.message}finally{setBusy('')}},
   async refresh(){refreshes++;setBag({lottery:saved,lotteryVersion:version})}}});
 }
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const flush=()=>new Promise(resolve=>setImmediate(resolve)),button=label=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===label);
 const click=async label=>act(async()=>{const control=button(label);assert.ok(control,label);control.click();await flush()});
 const tick=async ms=>act(async()=>{t.mock.timers.tick(ms);await flush()});
 const respond=async data=>act(async()=>{finishRequest({ok:true,data});await flush()});
 const preview=token=>({token,count:2,people:[players[1],players[3]]});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(async()=>{root.render(React.createElement(Harness));await flush()});
 await act(async()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()});
 assert.equal(document.querySelectorAll('.lottery-person').length,1);
 await click('随机抽取');assert.equal(document.querySelectorAll('.lottery-pool-avatar').length,5);assert.equal(document.querySelectorAll('.lottery-person').length,0,'old results are hidden throughout animation');
 assert.equal(document.querySelector('[data-player-id="away"]'),null);assert.equal(document.querySelector('[data-player-id="inactive"]'),null);
 assert.ok(document.querySelector('[data-player-id="p0"] .avatar'),'players without images remain in the pool with their initials');
 await respond(preview('draw1'));await tick(2999);assert.equal(commits,0);assert.equal(document.querySelector('.lottery-animation').dataset.phase,'rolling');
 await tick(1);assert.equal(document.querySelector('.lottery-animation').dataset.phase,'revealed');assert.deepEqual(Array.from(document.querySelectorAll('.lottery-pool-avatar.selected')).map(x=>x.dataset.playerId),['p1','p3']);
 assert.equal(commits,0);await tick(6000);assert.equal(commits,0,'revealed result waits indefinitely for adoption');await click('确认名单，继续活动');assert.equal(commits,1);assert.equal(refreshes,1);assert.equal(document.querySelector('.lottery-animation'),null);assert.equal(document.querySelectorAll('.lottery-person').length,2);
 await click('随机抽取');await respond(preview('cancel-reveal'));await tick(3000);await click('取消本次抽取');await tick(10000);assert.equal(commits,1);assert.ok(cancelled.includes('cancel-reveal'));assert.equal(document.querySelectorAll('.lottery-person').length,2);
 await click('随机抽取');await click('取消本次抽取');await respond(preview('cancel-late'));await tick(10000);assert.equal(commits,1);assert.ok(cancelled.includes('cancel-late'),'late preview token is discarded after cancellation');
 await click('随机抽取');await act(async()=>{finishRequest({ok:false,error:'抽取服务失败'});await flush()});assert.equal(lastError,'抽取服务失败');assert.equal(document.querySelector('.lottery-animation'),null);assert.equal(commits,1);
 await click('随机抽取');await respond(preview('roster-change'));await act(async()=>{setPeople(current=>current.map(p=>p.id==='p3'?{...p,attendance:'away'}:p));await flush()});await tick(10000);assert.equal(commits,1,'a player leaving while rolling cancels the draw');assert.ok(cancelled.includes('roster-change'));assert.equal(document.querySelector('.lottery-animation'),null);
 await click('随机抽取');const late=finishRequest;await act(async()=>root.unmount());await act(async()=>{late({ok:true,data:preview('unmounted')});await flush()});await tick(10000);assert.equal(commits,1);assert.ok(cancelled.includes('unmounted'));assert.equal(previews,6);
});

test('a 300-player lottery rolls every portrait and pages through the complete revealed300 before one adoption',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Animation=require('../src/lottery-animation.tsx').default;
 const root=createRoot(document.getElementById('root')),players=Array.from({length:300},(_,i)=>({id:'large'+i,name:'玩家'+i,number:String(i),photo:'',active:1,consent:1}));let completed=0;
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});const flush=()=>new Promise(resolve=>setImmediate(resolve));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(async()=>{root.render(React.createElement(Animation,{players,count:300,result:{people:players},onComplete:()=>completed++,onCancel(){},saving:false}));await flush()});
 assert.equal(document.querySelectorAll('.lottery-pool-avatar').length,300);await act(async()=>{t.mock.timers.tick(3000);await flush()});assert.equal(document.querySelectorAll('.lottery-pool-avatar.selected').length,10);const seen=new Set();for(let page=0;page<30;page++){document.querySelectorAll('.lottery-pool-avatar.selected').forEach(node=>seen.add(node.dataset.playerId));if(page<29)await act(async()=>{document.querySelector('[aria-label="抽取名单下一页"]').click();await flush()})}assert.equal(seen.size,300,'all300 selected people remain reachable through pages');
 await act(async()=>{t.mock.timers.tick(6000);await flush()});assert.equal(completed,0);await act(async()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='确认名单，继续活动').click();await flush()});assert.equal(completed,1);
});
