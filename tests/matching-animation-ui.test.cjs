const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);

test('matching rolls all eligible avatars, reveals authoritative pairs, then saves; errors and cancellation preserve old groups',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;global.confirm=()=>true;
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Pairs=require('../src/pair-activity.tsx').default;
  let response,requestCount=0,saveCount=0,lastError='',root=createRoot(document.getElementById('root'));
  const players=Array.from({length:5},(_,i)=>({id:'p'+i,name:'姓名'+i,number:String(i),photo:'source-'+i+'.png',interests:'旅行',trait:'开朗',active:1,consent:1,attendance:'present'}));
  players.push({...players[0],id:'away',name:'离场玩家',attendance:'away'},{...players[0],id:'inactive',name:'不参与玩家',active:0});
  const old={groups:[{id:'old',members:['p0','p1'],challenge:'旧挑战',cover:'',alive:true,votes:8}],standby:[],round:1};let savedState=old;const coverCalls=[];
  const match={pairs:[['p1','p4'],['p0','p3']],standby:['p2']};
  window.partyDesktop={call:async(route,body)=>{if(route==='ai/cover'){assert.ok(savedState.groups.some(g=>g.id===body.groupId&&JSON.stringify(g.members)===JSON.stringify(body.ids)),'automatic cover uses an adopted group ID and its exact members');coverCalls.push(body);return{ok:true,data:{photo:'cover-'+body.groupId+'.png'}}}assert.equal(route,'ai/pairs');requestCount++;return new Promise(resolve=>{response=resolve})}};
  function Harness(){
    const [bag,setBag]=React.useState({pairs:old}),[busy,setBusy]=React.useState('');
    const ctx={players,bag,busy,ai:{hasKey:true},event:{},tell(){},project:async()=>{},refresh:async()=>{},go(){},
      async run(label,f){setBusy(label);try{return await f()}catch(e){lastError=e.message}finally{setBusy('')}},
      async save(kind,value){saveCount++;savedState=typeof value==='function'?value(savedState):value;setBag(current=>({...current,[kind]:savedState}));}};
    return React.createElement(Pairs,{ctx});
  }
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const click=async label=>act(async()=>{const node=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===label);assert.ok(node,label);node.click();await flush()});
  const tick=async ms=>act(async()=>{t.mock.timers.tick(ms);await flush()});
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;delete global.confirm});
  await act(async()=>{root.render(React.createElement(Harness));await flush()});
  await click('AI兴趣匹配');
  assert.ok(document.querySelector('.matching-animation'),'avatar pool opens before the network responds');
  assert.equal(document.querySelectorAll('.matching-avatar').length,5,'every eligible player appears in the pool');
  assert.equal(document.querySelector('[data-player-id="away"]'),null,'departed players are excluded');
  assert.equal(document.querySelector('[data-player-id="inactive"]'),null,'non-participants are excluded');
  assert.equal(document.querySelector('.pair-grid'),null,'old result cards are hidden during animation');
  await act(async()=>{response({ok:true,data:match});await flush()});
  await tick(2999);assert.equal(saveCount,0);assert.equal(document.querySelector('.matching-animation').dataset.phase,'rolling');
  await tick(1);assert.equal(document.querySelector('.matching-animation').dataset.phase,'paired');
  const clusters=Array.from(document.querySelectorAll('.matching-cluster'));
  assert.deepEqual(clusters.map(x=>x.dataset.members),['p1,p4','p0,p3','p2'],'animated pairing uses the actual returned groups and standby');
  assert.equal(saveCount,0,'results are not persisted until the reveal finishes');
  await tick(6000);assert.equal(saveCount,0,'pairing also requires explicit adoption');assert.equal(coverCalls.length,0,'no paid cover request precedes confirmation');await click('确认采用本次配对');assert.equal(saveCount,3,'one adoption and two automatically generated covers save once each');assert.equal(coverCalls.length,2);assert.ok(savedState.groups.filter(g=>g.members.length===2).every(g=>g.cover==='cover-'+g.id+'.png'));assert.equal(savedState.groups.filter(g=>g.solo&&g.members.length===1&&g.cover==='').length,1);assert.equal(document.querySelector('.matching-animation'),null);
  const cards=document.querySelectorAll('.pair-grid .panel');assert.equal(cards.length,3);
  assert.ok(cards[0].textContent.includes('姓名1')&&cards[0].textContent.includes('姓名4'));
  await click('AI兴趣匹配');await act(async()=>{response({ok:false,error:'模拟连接失败'});await flush()});
  assert.equal(saveCount,3);assert.equal(coverCalls.length,2,'failed rematching does not regenerate existing successful covers');assert.equal(lastError,'模拟连接失败');assert.equal(document.querySelector('.matching-animation'),null);
  await click('AI兴趣匹配');await tick(9000);
  assert.equal(document.querySelector('.matching-animation').dataset.phase,'rolling','slow AI keeps rolling without inventing results');
  await act(async()=>{response({ok:true,data:match});await flush()});await tick(0);
  assert.equal(document.querySelector('.matching-animation').dataset.phase,'paired');await click('取消本次配对');
  await tick(10000);assert.equal(saveCount,3,'cancelled reveal does not overwrite old results');assert.equal(coverCalls.length,2,'cancelled matching cannot launch covers');
  await click('AI兴趣匹配');const late=response;await act(async()=>root.unmount());
  root=createRoot(document.getElementById('root'));await act(async()=>{late({ok:true,data:match});await flush()});
  await tick(10000);assert.equal(saveCount,3,'unmounted matching cannot persist a late network response');assert.equal(coverCalls.length,2,'late matching cannot launch covers after unmount');
  assert.equal(requestCount,4);
});

test('large-roster animation retains all 300 portraits and every exact pair without a per-pair delay',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),MatchingAnimation=require('../src/matching-animation.tsx').default;
  const root=createRoot(document.getElementById('root')),players=Array.from({length:300},(_,i)=>({id:'large'+i,name:'玩家'+i,number:String(i),active:1,photo:'',interests:'',trait:'',consent:1}));
  const result={pairs:Array.from({length:150},(_,i)=>[players[i*2].id,players[i*2+1].id]),standby:[]};
  let complete=0;const onComplete=()=>complete++,onCancel=()=>{};
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
  await act(async()=>{root.render(React.createElement(MatchingAnimation,{players,result,onComplete,onCancel}));await flush()});
  assert.equal(document.querySelectorAll('.matching-avatar').length,300);
  await act(async()=>{t.mock.timers.tick(3000);await flush()});
  assert.equal(document.querySelectorAll('.matching-cluster').length,150);
  assert.equal(new Set(Array.from(document.querySelectorAll('.matching-avatar')).map(x=>x.dataset.playerId)).size,300);
  assert.deepEqual(Array.from(document.querySelectorAll('.matching-cluster')).map(x=>x.dataset.members),result.pairs.map(x=>x.join(',')));
  await act(async()=>{t.mock.timers.tick(6000);await flush()});assert.equal(complete,0);await act(async()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='确认采用本次配对').click();await flush()});assert.equal(complete,1);
});

test('away pair history stays visible but cannot score, advance or project; attendance changes block a pending projection',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Pairs=require('../src/pair-activity.tsx').default;
  const root=createRoot(document.getElementById('root')),projections=[];
  let saves=0,lastError='',finishPhoto;
  const players=[0,1].map(i=>({id:'p'+i,name:'本人'+i,number:String(i),photo:'original'+i,interests:'摄影',trait:'友好',active:1,consent:1,attendance:i?'away':'present'}));
  const original={formatVersion:2,groups:[{id:'historical',members:['p0','p1'],challenge:'原来的挑战',cover:'cover1',alive:true,votes:8}],standby:[],round:3,tournament:{version:1,rounds:[],finalists:['historical']}};
  window.partyDesktop={call:async route=>{if(route==='game/win/list')return{ok:true,data:{events:[]}};assert.equal(route,'photo/data');return new Promise(resolve=>{finishPhoto=()=>resolve({ok:true,data:{data:'data:image/png;base64,stub'}})})}};
  function Harness({people}){
    const [bag,setBag]=React.useState({pairs:original});
    const ctx={players:people,bag,busy:'',ai:{hasKey:true},event:{},tell(){},refresh:async()=>{},go(){},
      async run(label,f){try{return await f()}catch(e){lastError=e.message}},
      async project(payload){projections.push(payload)},
      async save(kind,value){saves++;setBag(current=>({...current,[kind]:typeof value==='function'?value(current[kind]):value}));}};
    return React.createElement(Pairs,{ctx});
  }
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const render=async()=>act(async()=>{root.render(React.createElement(Harness,{people:[...players]}));await flush()});
  const click=async node=>act(async()=>{assert.ok(node);node.click();await flush()});
  const button=text=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===text);
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
  await render();
  const card=document.querySelector('.pair-members').closest('.panel');
  for(const text of ['重新生成本组合照','生成挑战'])assert.equal(Array.from(card.querySelectorAll('button')).find(x=>x.textContent.trim()===text).disabled,true,text+' is unavailable for away players');
  assert.equal(button('晋级第四轮').disabled,true,'a departed pair cannot be awarded a qualifying round3 victory');assert.equal(button('本轮淘汰').disabled,false,'host may explicitly eliminate a departed pair');
  assert.equal(button('更新舞台'),undefined);assert.equal(button('标记淘汰'),undefined,'modern groups use the current round result panel');await click(button('晋级第四轮'));
  assert.equal(card.querySelector('textarea').disabled,true);assert.equal(original.groups[0].votes,8,'old vote data remains untouched while current UI uses explicit victories');
  assert.ok(card.textContent.includes('原来的挑战')||card.querySelector('textarea').value==='原来的挑战');
  await click(button('介绍这一组'));assert.equal(button('更新舞台介绍'),undefined,'introduction has no redundant projection button');
  assert.ok(document.querySelector('.pair-introduction')||document.body.textContent.includes('本人0'),'archive introduction remains viewable');
  assert.equal(saves,0);assert.equal(projections.length,0);await click(button('返回全部组合'));assert.equal(projections.at(-1).mode,'pair-board');const priorProjections=projections.length;
  players[1]={...players[1],attendance:'present'};await render();await click(button('介绍这一组'));assert.ok(finishPhoto);
  players[1]={...players[1],attendance:'away'};await render();await act(async()=>{finishPhoto();await flush()});
  assert.equal(projections.length,priorProjections,'a player leaving during photo loading cannot be projected as a live group');
  assert.match(lastError,/未到|离场|未参与/);assert.equal(saves,0);
});
