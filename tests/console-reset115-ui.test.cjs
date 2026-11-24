'use strict';
// Real PartyConsole + Store/Backend. The activity observer only captures the
// actual Context instance; all save queues and reset handlers remain production code.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),{JSDOM}=require('jsdom');
const {Store,createBackend}=require('../desktop/store.cjs');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const activities=require('../src/activities.tsx'),RealActivities=activities.default;let observe=()=>{};
activities.default=props=>{observe(props.ctx);return React.createElement(RealActivities,props)};
const PartyConsole=require('../src/console.tsx').default;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};

async function fixture(t){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'console-reset115-')),store=new Store(path.join(profile,'data'));
 const photo=store.upload(fs.readFileSync(path.join(__dirname,'../assets/icon.png')),'image/png').key;
 store.commit(d=>{
  d.players=Array.from({length:3},(_,i)=>({id:'p'+i,number:String(i+1),name:'控制台玩家'+i,photo,active:1,consent:1,attendance:'present',checkedInAt:'2026-10-27T00:00:00Z',score:8,version:0}));
  d.ai.encryptedKey='isolated-encrypted-key';
  d.states={pairs:{version:3,value:{round:1,groups:[{id:'g',members:['p0','p1'],alive:true}],standby:['p2'],challengeBank:['比赛1'],round2Bank:['比赛2']}},tails:{version:4,value:{scores:{p0:2},endsAt:0}},fans:{version:1,value:{challengeBank:['挑战1']}},taskBank:{version:1,value:['验收任务']},screen:{version:2,value:{activity:3,mode:'score',title:'旧排名'}}};
  d.selectionCounts={p0:2,p1:1};d.selectionHistory=[{id:'selected',playerId:'p0',kind:'lottery',detail:'抽取'}];
  d.gameWinEvents=[{eventId:'before-ui-reset',activity:2,kind:'truth',round:1,groupId:null,playerIds:['p0'],status:'active',task:'真实故事',version:1}];
  d.manualAwards={version:5,records:{'partner-star':{winnerIds:['p0'],reason:'最佳搭档'}}};
  d.missionRound={id:'old-mission-round',ended:true,startedAt:1,endsAt:2};
  d.missions=[{id:'old-task',round:'old-mission-round',actor:'p0',target:'p1',task:'旧验收事件',code:'123456',completed_at:null}];
  return{};
 });
 const connection='{"url":"https://example.invalid","encryptedToken":"isolated-fixed-token"}';fs.writeFileSync(path.join(store.directory,'fixed-server.json'),connection);
 const api=createBackend(store,{fetcher:()=>{throw Error('No provider/network calls in console reset tests')}}),calls=[];
 const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});
 Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){}});
 t.mock.timers.enable({apis:['setTimeout']});
 let ctx=null,hold=null;observe=value=>{ctx=value};
 window.partyDesktop={call:async(route,b,method)=>{
  calls.push({route,b:structuredClone(b),method});
  try{if(hold)await hold(route,b,method);return{ok:true,data:await api(route,b,method)}}catch(e){return{ok:false,error:e.message,status:e.status}}
 }};
 const root=createRoot(document.getElementById('root')),flush=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate)};
 t.after(async()=>{await act(async()=>root.unmount());observe=()=>{};dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;fs.rmSync(profile,{recursive:true,force:true})});
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const click=async target=>{const element=typeof target==='string'?button(target):target;assert(element,'Control must exist: '+target);await act(async()=>{element.click();await flush()})};
 const tab=async number=>click([...document.querySelectorAll('.nav-item')].find(b=>b.querySelector('.nav-number')?.textContent===number));
 const settings=async()=>click([...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='AI 与本地存档'));
 await act(async()=>{root.render(React.createElement(PartyConsole));await flush()});
 return{profile,store,api,calls,connection,photo,button,click,tab,settings,flush,getCtx:()=>ctx,setHold:value=>{hold=value}};
}
function assertCleared(f,oldAI){
 const d=f.store.data;assert.equal(d.players.length,0);assert.deepEqual(d.ai,oldAI);assert.deepEqual(d.selectionCounts,{});assert.deepEqual(d.gameWinEvents,[]);assert.deepEqual(d.autoScoreLedger,[]);assert.deepEqual(d.scoreHistory,[]);assert.deepEqual(d.missions,[]);assert.equal(d.missionRound,null);assert.deepEqual(d.manualAwards.records,{});
 assert(Object.values(d.states).every(state=>state.value===null));
 assert.equal(fs.readFileSync(path.join(f.store.directory,'fixed-server.json'),'utf8'),f.connection);assert(fs.existsSync(f.store.photoPath(f.photo)));
}

test('real Console previews the actual current/global scope, cancel preserves files, and explicit global confirmation starts at zero while retaining AI/connection',async t=>{
 const f=await fixture(t),ai=structuredClone(f.store.data.ai),before=structuredClone(f.store.data),main=fs.readFileSync(f.store.file),bak=fs.readFileSync(f.store.file+'.bak');
 await f.click('清空当前界面全部内容');
 assert.equal(f.calls.filter(c=>c.route==='reset/preview').at(-1).b.scope,'players');
 let dialog=document.querySelector('[role="dialog"]');assert(dialog);assert.match(dialog.textContent,/清空全部玩家及关联数据/);assert.match(dialog.textContent,/玩家\s*3/);assert.match(dialog.textContent,/保留题库|保留.*题库/);
 await f.click('取消');assert.equal(document.querySelector('[role="dialog"]'),null);
 assert.deepEqual(f.store.data,before);assert.deepEqual(fs.readFileSync(f.store.file),main);assert.deepEqual(fs.readFileSync(f.store.file+'.bak'),bak);assert.equal(fs.existsSync(path.join(f.profile,'reset-backups')),false);
 await f.settings();await f.click('清空目前所有内容');
 assert.equal(f.calls.filter(c=>c.route==='reset/preview').at(-1).b.scope,'all');dialog=document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/AI密钥与AI设置/);assert.match(dialog.textContent,/固定服务器连接配置/);assert.match(dialog.textContent,/题库条目\s*4/);
 assert.equal(f.store.data.players.length,3,'the preview must not clear anything');
 await f.click('确认清空全部活动资料');assert.equal(document.querySelector('[role="dialog"]'),null);assertCleared(f,ai);
 assert.notEqual(f.store.data.event.id,before.event.id);assert.equal(f.store.data.resetEpoch,1);assert.equal(f.store.data.manualAwards.version,6);
 assert.equal(document.querySelectorAll('.player-card').length,0);assert.match(document.body.textContent,/清空已完成，已保留清空前备份/);
 const backup=path.join(f.profile,'reset-backups',fs.readdirSync(path.join(f.profile,'reset-backups'))[0]);assert.deepEqual(fs.readFileSync(path.join(backup,'data/party.json')),main);assert(fs.existsSync(path.join(backup,'完整备份.jungle')));
 assert.equal(new Store(f.store.directory).data.players.length,0);
});

test('a pre-reset async job cannot write a late result through its captured real Console context using refreshed versions',async t=>{
 const f=await fixture(t);await f.tab('03');const previous=f.getCtx(),pending=deferred(),oldAI=structuredClone(f.store.data.ai);
 assert(previous);let rejected=false,job;
 await act(async()=>{job=previous.run('隔离测试的延迟结果',async()=>{await pending.promise;try{await previous.save('tails',{scores:{p0:999},lateResult:true},true)}catch(error){rejected=true;throw error}});await f.flush()});
 await f.settings();await f.click('清空目前所有内容');await f.click('确认清空全部活动资料');assertCleared(f,oldAI);
 const writes=f.calls.filter(c=>c.route==='state').length,after=structuredClone(f.store.data);
 await act(async()=>{pending.resolve();await job;await f.flush()});
 assert.equal(rejected,true);assert.equal(f.calls.filter(c=>c.route==='state').length,writes,'generation check must reject before sending a save with the new version');
 assert.deepEqual(f.store.data,after);assertCleared(f,oldAI);assert.match(document.body.textContent,/活动已清空，旧操作的结果已忽略/);
});

test('real Console queue rechecks its generation at execution; a concurrent save invalidates the reset preview rather than permitting a stale queued overwrite',async t=>{
 const f=await fixture(t);await f.tab('03');const old=f.getCtx();await f.settings();await f.click('清空目前所有内容');const gate=deferred(),oldAI=structuredClone(f.store.data.ai);let intercepted=false;
 f.setHold(async(route,b)=>{if(route==='state'&&b.kind==='tails'&&!intercepted){intercepted=true;await gate.promise}});
 let first,second;
 await act(async()=>{
  first=old.save('tails',{scores:{p0:3},queueTag:'first'},true).then(()=>({ok:true}),error=>({error}));
  second=old.save('tails',{scores:{p0:999},queueTag:'stale-second'},true).then(()=>({ok:true}),error=>({error}));
  await f.flush();
 });
 assert(intercepted);assert.equal(f.calls.filter(c=>c.route==='state').length,1);
 await f.click('确认清空全部活动资料');
 await act(async()=>{gate.resolve();await Promise.all([first,second]);await f.flush()});
 const outcomes=await Promise.all([first,second]);assert.equal(outcomes[0].ok,true);assert.match(outcomes[1].error.message,/活动已清空/);
 assert.equal(f.calls.filter(c=>c.route==='state').length,1,'the second queued save must revalidate after clearing starts');assert.equal(f.store.state('tails').value.queueTag,'first');
 assert.equal(f.store.data.players.length,3,'changed data must force a new explicit preview');assert.match(document.querySelector('[role="dialog"]').textContent,/资料已发生变化/);
 assert.equal(fs.existsSync(path.join(f.profile,'reset-backups')),false);
 f.setHold(null);await f.click('重新查看范围');await f.click('确认清空全部活动资料');assertCleared(f,oldAI);
 assert.equal(f.calls.filter(c=>c.route==='state'&&c.b.value?.queueTag==='stale-second').length,0);
});
