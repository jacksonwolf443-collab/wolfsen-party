const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
test('2v2 shuffle animates all 40 teams; cancel preserves state, accept saves20matches; future rounds locked and one loser per match',async t=>{
 const file=path.join(__dirname,'../src/pair-tournament.tsx');assert.ok(fs.existsSync(file),'tournament UI must exist');
 const {Store}=require('../desktop/store.cjs'),{createPairTournamentService}=require('../desktop/pair-tournament.cjs'),React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Tournament=require(file).default;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair-ui-only-')),store=new Store(dir),dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;global.confirm=()=>true;
 const ps=Array.from({length:80},(_,i)=>({id:'p'+i,name:'玩家'+i,number:String(i),active:1,consent:1,attendance:'present',photo:''}));store.data.players=ps;
 const original={groups:Array.from({length:40},(_,i)=>({id:'g'+i,members:['p'+i*2,'p'+(i*2+1)],alive:true})),round:1,challengeBank:['一起合唱'],standby:[]};store.putState('pairs',original,0);
 const service=createPairTournamentService({store,isEligible:p=>!!p&&p.attendance==='present',shuffle:a=>a});let refresh=()=>{},lastError='';const screens=[];
 window.partyDesktop={call:async(route,b)=>{try{if(route==='boot')return{ok:true,data:{states:{pairs:store.state('pairs')}}};return{ok:true,data:service(route.split('/').at(-1),b)}}catch(e){return{ok:false,error:e.message,status:e.status}}}};
 function Harness(){const [state,setState]=React.useState(original),[busy,setBusy]=React.useState('');refresh=()=>setState(store.state('pairs').value);const ctx={players:ps,bag:{pairs:state},busy,ai:{},tell(){},async refresh(){refresh()},async project(s){screens.push(s)},async run(label,f){setBusy(label);try{return await f()}catch(e){lastError=e.message}finally{setBusy('')}},async save(_kind,value){store.putState('pairs',typeof value==='function'?value(store.state('pairs').value):value,store.state('pairs').version);refresh()}};return React.createElement(Tournament,{ctx,state,bank:state.challengeBank,onBankChange(){},saveBank:async()=>{}});}
 const root=createRoot(document.getElementById('root')),flush=()=>new Promise(r=>setImmediate(r));const click=async text=>act(async()=>{const node=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text);assert.ok(node,text);node.click();await flush()});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();fs.rmSync(dir,{recursive:true,force:true});delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;delete global.confirm});
 await act(async()=>{root.render(React.createElement(Harness));await flush()});
 assert.equal(document.querySelectorAll('[aria-label^="挑战题库"]').length,20);
 await click('随机分配本轮2v2对战');assert.equal(document.querySelectorAll('.pair-pk-rolling-team').length,40);assert.equal(store.state('pairs').version,1);
 await click('取消本次对战抽签');await act(async()=>{t.mock.timers.tick(10000);await flush()});assert.equal(store.state('pairs').version,1);
 await click('随机分配本轮2v2对战');await act(async()=>{t.mock.timers.tick(3000);await flush()});assert.equal(document.querySelectorAll('.pair-pk-reveal-match').length,2);await click('采用本次对战');
 assert.equal(store.state('pairs').value.tournament.rounds[0].matches.length,20);assert.equal(document.querySelectorAll('.pair-pk-match').length,20);
 const next=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('进入第2步'));assert.equal(next.disabled,true);
 assert.equal(Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('更新本轮对战大屏')),false,'stage reads saved pair state automatically');
 const first=document.querySelector('.pair-pk-match'),losers=Array.from(first.querySelectorAll('button')).filter(b=>b.textContent==='标记为淘汰');assert.equal(losers.length,2);
 await act(async()=>{losers[0].click();await flush()});assert.ok(document.querySelector('.pair-pk-match').textContent.includes('已淘汰'));assert.equal(store.state('pairs').value.tournament.rounds[0].matches[0].loserId,'g0');assert.equal(lastError,'');
 const external=store.state('pairs');store.putState('pairs',{...external.value,challengeBank:['其他窗口已更新题库']},external.version);
 const staleButton=Array.from(document.querySelectorAll('.pair-pk-match')[1].querySelectorAll('button')).find(b=>b.textContent==='标记为淘汰');
 await act(async()=>{staleButton.click();await flush()});assert.match(lastError,/更新|刷新/);assert.equal(store.state('pairs').value.tournament.rounds[0].matches[1].status,'pending','stale screen cannot quietly adopt a newer version and write over it');
});

async function pairAuditFixture(t,state){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://pair-audit.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Pairs=require('../src/pair-activity.tsx').default,root=createRoot(document.getElementById('root'));
 const players=Array.from({length:80},(_,i)=>({id:'p'+i,name:'玩家'+i,number:String(i),active:1,consent:1,attendance:'present',photo:'',interests:'摄影',wish:'旅行'}));
 let saved=state;const screens=[],ctx={players,bag:{pairs:state},busy:'',ai:{hasKey:false},event:{},tell(){},async refresh(){},async project(s){screens.push(s)},async run(_label,f){return f()},async save(_kind,value){saved=typeof value==='function'?value(saved):value;ctx.bag.pairs=saved;await render()}};
 const flush=()=>new Promise(r=>setImmediate(r)),render=async()=>{root.render(React.createElement(Pairs,{ctx:{...ctx}}));await flush()};
 const click=async text=>act(async()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text);assert.ok(button,text);button.click();await flush()});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 await act(render);return{ctx,click,screens,render,saved:()=>saved};
}
const auditGroups=()=>Array.from({length:40},(_,i)=>({id:'g'+i,members:['p'+i*2,'p'+(i*2+1)],alive:true,cover:'',challenge:'',votes:0}));
test('modern pairs cannot use legacy alive toggles to remove teams before the first 2v2 draw',async t=>{
 await pairAuditFixture(t,{groups:auditGroups(),standby:[],round:1,formatVersion:2,challengeBank:['合唱']});
 const controls=Array.from(document.querySelectorAll('.pair-grid button')).filter(b=>['标记淘汰','恢复晋级'].includes(b.textContent.trim()));
 assert.equal(controls.length,0,'formatVersion2 must use match results only; no pre-draw arbitrary eliminations');
});
test('blindfold introduction navigation stays inside the 10 finalists and cannot project an eliminated team',async t=>{
 const finalists=Array.from({length:10},(_,i)=>'g'+(i*2+1)),groups=auditGroups().map(g=>({...g,alive:finalists.includes(g.id)}));
 const f=await pairAuditFixture(t,{groups,standby:[],round:3,formatVersion:2,tournament:{version:1,rounds:[],finalists,legacyEliminated:[]}});
 assert.equal(document.querySelectorAll('.pair-grid>.panel').length,10);
 await f.click('介绍这一组');await f.click('下一组');
 assert.deepEqual(f.screens.at(-1).people.map(p=>p.id),['p6','p7'],'second introduction must be finalist g3, never eliminated g2');
 assert.equal(f.screens.at(-1).round,3,'stage must know which round this profile belongs to');assert.equal(f.screens.at(-1).groupId,'g3');
 assert.match(document.querySelector('.intro-navigation').textContent,/2\s*\/\s*10/);
 await f.click('返回全部组合');const React=require('react');await React.act(async()=>document.querySelector('.round-tabs button').click());
 const screenCount=f.screens.length;await f.click('介绍这一组');
 assert.equal(f.screens.length,screenCount,'historical tab keeps eliminated profiles viewable but cannot put them into the active blindfold stage');
});
test('explicit pair introductions and returning to the automatic board carry their round for stale-screen protection',async t=>{
 const f=await pairAuditFixture(t,{groups:auditGroups(),standby:[],round:4,formatVersion:2,tournament:{version:1,rounds:[],finalists:['g1'],legacyEliminated:[]}});
 const React=require('react');await React.act(async()=>document.querySelector('.pair-heart-name').click());await f.click('返回全部组合');
 assert.deepEqual(f.screens.map(s=>[s.mode,s.round]),[['pair-profile',4],['pair-board',4]]);assert.equal(f.screens[0].groupId,'g1');
});
test('historical round tabs never advance state or bypass a partially settled second round',async t=>{
 const first=Array.from({length:20},(_,i)=>({id:'r1-'+i,teamIds:['g'+i*2,'g'+(i*2+1)],task:'首轮题',status:'settled',winnerId:'g'+(i*2+1),loserId:'g'+i*2,bye:false}));
 const second=Array.from({length:10},(_,i)=>({id:'r2-'+i,teamIds:['g'+(i*4+1),'g'+(i*4+3)],task:'次轮题',status:i?'pending':'settled',winnerId:i?null:'g3',loserId:i?null:'g1',bye:false}));
 const f=await pairAuditFixture(t,{groups:auditGroups(),standby:[],round:2,formatVersion:2,challengeBank:['合唱'],round2Bank:['默契'],tournament:{version:1,rounds:[{number:1,matches:first,skipped:[]},{number:2,matches:second,skipped:[]}],finalists:[],legacyEliminated:[]}});
 const tab=text=>Array.from(document.querySelectorAll('.round-tabs button')).find(b=>b.textContent.includes(text));
 assert.equal(document.querySelectorAll('.pair-pk-match').length,10);assert.equal(tab('我们最默契').disabled,true);
 const React=require('react');await React.act(async()=>{tab('我们最默契').click()});assert.equal(f.saved().round,2);
 await React.act(async()=>{tab('哪组最猛').click()});assert.equal(document.querySelectorAll('.pair-pk-match').length,20);
 const historicalAdvance=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('进入第2步'));assert.equal(historicalAdvance.disabled,true);await React.act(async()=>historicalAdvance.click());assert.equal(f.saved().round,2);
 await React.act(async()=>{tab('我们最猛').click()});assert.equal(document.querySelectorAll('.pair-pk-match').length,10);
 const advance=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('进入第3步'));assert.equal(advance.disabled,true);await React.act(async()=>advance.click());assert.equal(f.saved().round,2);
});
