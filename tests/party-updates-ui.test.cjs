const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
// Real React + local store, fake AI transport and canvas. No live AI or native pixel claim.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ts=require('typescript');
const {JSDOM}=require('jsdom');
const {Store,createBackend}=require('../desktop/store.cjs');
const {codec:imageCodec,solid}=require('./helpers/raster-fixture.cjs');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);

test('batch cover generation preserves results while automatically retrying, drawing controls and ten crop steps work',async t=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'birthday-updates-')),dir=path.join(tempRoot,'data');
  const dom=new JSDOM('<div id="root"></div>',{url:'https://jungle.test'});
  global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const png=solid(128,128,110),dataURL='data:image/png;base64,'+png.toString('base64');
  const draws=[],fills=[];
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(...args){fills.push(args)},drawImage(...args){draws.push(args)}});
  dom.window.HTMLCanvasElement.prototype.toDataURL=()=>dataURL;
  let holdImage=false,finishImage=null;
  global.Image=class{width=1000;height=600;set src(value){this.source=value;if(holdImage){holdImage=false;finishImage=()=>this.onload?.()}else queueMicrotask(()=>this.onload?.())}};
  const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),PartyConsole=require('../src/console.tsx').default;
  const store=new Store(dir);let covers=0,structureChecks=0,guesses=0,challenge=0,pendingGuess=null,delayGuess=false;
  const api=createBackend(store,{imageCodec,getAIKey:()=> 'test-only-placeholder',fetcher:async(url,options)=>{
    if(url==='https://example.aliyuncs.com/result.png')return new Response(solid(1280,720,7));
    const body=JSON.parse(options.body);
    if(body.input){covers++;if(covers===1)return Response.json({message:'测试失败'}, {status:500});return Response.json({output:{choices:[{message:{content:[{image:'https://example.aliyuncs.com/result.png'}]}}]}});}
    if(body.model==='qwen3-vl-plus'){
      const prompt=body.messages[0].content.at(-1).text;
      if(prompt.includes('sceneMatches')){structureChecks++;const images=body.messages[0].content.filter(x=>x.type==='image_url');assert.equal(images.length,1,'the structure review receives the final whole photograph');const final=imageCodec.decode(Buffer.from(images[0].image_url.url.split(',')[1],'base64'));assert.equal(final.data[0],7);assert.equal(final.data[(210*1280+400)*4],7,'review receives the generated photograph without copied facial pixels');return Response.json({choices:[{message:{content:JSON.stringify({sceneMatches:true,completePeople:true,naturalBlend:true,issue:''})}}]});}
      guesses++;if(delayGuess)return new Promise(resolve=>pendingGuess=()=>resolve(Response.json({choices:[{message:{content:'过期猜测'}}]})));return Response.json({choices:[{message:{content:'自行车'}}]});
    }
    const prompt=body.messages[0].content;
    return Response.json({choices:[{message:{content:prompt.includes('默契挑战')?'挑战'+(++challenge):'两人在海边玩沙滩排球'}}]});
  }});
  
  const ids=[];for(let i=0;i<4;i++){const {key}=await api('upload',{bytes:png,type:'image/png'});ids.push((await createCheckedInPlayer(api, {name:'玩家'+i,number:String(i),photo:key,consent:true}, 'POST')).player.id);}
  await api('state',{kind:'pairs',version:0,value:{groups:[{id:'g1',members:ids.slice(0,2),cover:store.data.players[0].photo,challenge:'旧挑战',votes:7,alive:true},{id:'g2',members:ids.slice(2),cover:'',challenge:'',votes:2,alive:false}],standby:[],round:1}},'PUT');
  let failChallengeSave=false;
  window.partyDesktop={call:async(route,body,method)=>{try{if(route==='state'&&body.kind==='pairs'&&failChallengeSave){failChallengeSave=false;throw Error('模拟保存失败')}return{ok:true,data:route==='desktop/fullscreen'?{}:await api(route,body,method)}}catch(e){return{ok:false,error:e.message,status:e.status??500}}}};
  let root=createRoot(document.getElementById('root'));
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:Date.now()});
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.Image;delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;fs.rmSync(tempRoot,{recursive:true,force:true});});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const click=async element=>{assert.ok(element,'target control exists');await act(async()=>{element.click();await flush()})};
  const button=text=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===text);
  const tab=async prefix=>click(Array.from(document.querySelectorAll('.nav-item')).find(x=>x.textContent.startsWith(/^\d+$/.test(prefix)?require('../src/domain.ts').displayNumber(Number(prefix)).toString().padStart(2,'0'):prefix)));
  const change=async(element,value)=>act(async()=>{const proto=element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));await flush()});
  const settle=async()=>{for(let i=0;i<20&&document.querySelector('.busy-strip');i++)await act(flush);assert.equal(document.querySelector('.busy-strip'),null,'operation completes')};
  await act(async()=>{root.render(React.createElement(PartyConsole));await flush()});
  await tab('01');await click(button('给所有组合生成合照'));
  let groups=store.data.states.pairs.value.groups;
  assert.equal(covers,2);assert.equal(structureChecks,1,'only the generated successful group reaches the final structure review');assert.equal(groups[0].cover,store.data.players[0].photo,'failure preserves previous cover');assert.match(groups[1].cover,/^cover-/);const savedCover=imageCodec.decode(fs.readFileSync(store.photoPath(groups[1].cover)));assert.equal(savedCover.data[0],7);assert.equal(savedCover.data[(210*1280+400)*4],7);assert.equal(savedCover.data[(210*1280+880)*4],7);assert.equal(groups[1].coverMethod,'whole-photo-v2');
  assert.equal(groups[0].votes,7);assert.equal(groups[1].alive,false);
  await act(async()=>{t.mock.timers.tick(1000);await flush()});await settle();assert.equal(covers,3,'automatically retry only the failed group');assert.equal(structureChecks,2,'the retried generated photo passes its own structure review');assert.ok(store.data.states.pairs.value.groups.every(x=>/^cover-/.test(x.cover)),'both generated photographs are saved after automatic retry');assert.equal(button('重试失败组合'),undefined,'recoverable cover failures need no additional click');
  failChallengeSave=true;
  await click(button('可选：AI逐组出题'));await settle();groups=store.data.states.pairs.value.groups;
  assert.deepEqual(groups.map(x=>x.challenge),['旧挑战','挑战2'],'failed save must not leak into the next group save');
  await click(button('重试失败组合'));await settle();groups=store.data.states.pairs.value.groups;
  assert.equal(challenge,2,'retry a failed save without another paid generation');
  assert.deepEqual(groups.map(x=>x.challenge),['挑战1','挑战2']);
  assert.ok(new Store(dir).data.states.pairs.value.groups.every(x=>x.cover&&x.challenge),'each group is persisted');
  await tab('04');assert.equal(document.querySelector('.check-label input').checked,true);
  await change(document.querySelector('select'),ids[0]);await change(document.querySelector('input[placeholder="由观众现场出题"]'),'自行车');
  await click(button('开始60秒'));await act(async()=>{t.mock.timers.tick(4000);await flush()});
  assert.equal(guesses,1);assert.match(document.querySelector('.ai-guess-spotlight').textContent,/AI猜：自行车/);
  assert.ok(document.querySelector('.drawing-celebration'));assert.equal(store.state('draw').value.celebration.canvas,dataURL,'celebration freezes the successful artwork');assert.equal(store.state('draw').value.celebration.guess,'自行车');await click(button('继续本轮'));await click(button('开始60秒'));delayGuess=true;await click(button('让AI猜一次'));assert.ok(pendingGuess);
  const fillCount=fills.length;await click(button('清空画布'));assert.ok(fills.length>fillCount);
  assert.ok(document.querySelector('.busy-strip'),'clearing the canvas must not hide a still-running AI request');
  await act(async()=>{pendingGuess();await flush()});await settle();
  assert.ok(!document.querySelector('.ai-guess-spotlight').textContent.includes('过期猜测'),'clear discards an in-flight result for erased pixels');
  assert.equal(store.data.states.draw.value.canvas,dataURL);assert.equal(store.data.states.screen.value.image,dataURL);
  await click(button('结束'));const count=guesses;await act(async()=>{t.mock.timers.tick(4000);await flush()});assert.equal(guesses,count);
  assert.equal(document.querySelector('.check-label input').checked,true,'auto remains the preference for next round');
  await click(button('开始60秒'));pendingGuess=null;
  await act(async()=>{t.mock.timers.tick(4000);await flush()});assert.ok(pendingGuess,'automatic guess remains in flight');
  await click(button('清空当前界面全部内容'));assert.match(document.querySelector('[role="dialog"]').textContent,/毕加索在世/);await click(button('确认清空本界面'));await settle();
  assert.equal(store.state('draw').value,null);assert.equal(store.state('screen').value,null);
  await act(async()=>{pendingGuess();await flush()});
  assert.equal(store.state('draw').value,null,'late automatic guess cannot resurrect cleared activity');
  assert.equal(store.state('screen').value,null,'late automatic guess cannot resurrect cleared projection');
  assert.equal(document.querySelector('.ai-guess-spotlight strong').textContent,'等待作画');
  await tab('05');await click(button('抽取10位玩家'));await act(async()=>{t.mock.timers.tick(3000);await flush()});await act(async()=>{t.mock.timers.tick(6000);await flush()});await click(button('确认名单，继续活动'));await settle();assert.equal(document.querySelectorAll('.crop-roster-card').length,4,'available photo pool is smaller than10');await click(button('抽取下一张'));await settle();
  for(let percent=10;percent<=100;percent+=10){
    const crop=store.data.states.crop.value;assert.equal(crop.rangePercent,percent);assert.equal(crop.revealed,percent===100);
    assert.ok(button('扩大范围（'+percent+'%）'));
    if(percent<100){assert.equal(document.querySelector('.revealed-answer'),null);await click(button('扩大范围（'+percent+'%）'));await settle();}
  }
  assert.ok(document.querySelector('.revealed-answer'));assert.equal(button('扩大范围（100%）').disabled,true);
  const crops=draws.filter(args=>args.length===9);assert.equal(crops[0][3],100);assert.equal(crops.at(-1)[3],1000);
  await click(button('所有人都没猜中'));await settle();await tab('01');holdImage=true;await tab('05');assert.ok(finishImage);
  await click(button('抽取下一张'));await settle();const afterNewPhoto=draws.length;
  await act(async()=>{finishImage();await flush()});
  assert.equal(draws.length,afterNewPhoto,'late restore must not overwrite a new crop');
  await act(async()=>root.unmount());await api('players',{id:store.data.states.crop.value.current},'DELETE');
  root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(PartyConsole));await flush()});
  const beforeRestore=draws.length;await tab('05');
  assert.equal(draws.length,beforeRestore,'removed player photo must not be restored');assert.match(document.querySelector('.crop-placeholder').textContent,/不可用/);
});

