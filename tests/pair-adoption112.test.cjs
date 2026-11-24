const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
// Real console save queue + real Store; no model or network calls.
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),{JSDOM}=require('jsdom');
const{Store,createBackend}=require('../desktop/store.cjs');
for(const ext of['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{act}=React;
const people=count=>Array.from({length:count},(_,i)=>({id:'p'+i,number:String(i+1),name:'玩家'+i,photo:'',interests:'健身、摄影',wish:'一起看极光',attendance:'present',active:1,consent:1,version:0}));
const fingerprint=players=>JSON.stringify(players.filter(p=>p.active&&p.attendance==='present').map(p=>[p.id,p.name,p.number,p.photo,p.interests??'',p.wish??'']).sort((a,b)=>a[0].localeCompare(b[0])));
function fixture(t,count=4){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair-adoption112-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.data.players=people(count);store.persist();return{store,api:createBackend(store)}}
async function consoleView(t,count,beforeAdoption){
 const{store,api}=fixture(t,count),dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;global.confirm=()=>true;
 const root=require('react-dom/client').createRoot(document.getElementById('root')),Console=require('../src/console.tsx').default,flush=()=>new Promise(r=>setImmediate(r)),writes=[];let changed=false;
 window.partyDesktop={call:async(route,body,method)=>{try{if(route==='state'&&body.kind==='pairs'&&body.value?.groups?.length){writes.push(structuredClone(body));if(!changed){changed=true;await beforeAdoption?.(store,api)}}return{ok:true,data:await api(route,body,method)}}catch(e){return{ok:false,error:e.message,status:e.status}}}};
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;delete global.confirm});
 const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text),click=async el=>act(async()=>{assert.ok(el);el.click();await flush()});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});await act(async()=>{root.render(React.createElement(Console));await flush()});await click(Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.startsWith('01')));await click(button('随机配对'));await act(async()=>{t.mock.timers.tick(3000);await flush()});assert.equal(store.state('pairs').value,null);await click(button('确认采用本次配对'));return{store,api,writes};
}
for(const mutation of['attendance','added-player','profile'])test('confirmed matching rejects '+mutation+' changes between the console queue and actual Store write',async t=>{
 const{store,writes}=await consoleView(t,4,async(store,api)=>{if(mutation==='attendance')await api('players/attendance',{id:'p0',version:0,attendance:'away'});else if(mutation==='added-player')await createCheckedInPlayer(api, {number:'99',name:'新到场玩家',active:1,consent:1}, 'POST');else await api('players',{...store.player('p0'),wish:'刚刚修改的心愿'},'PUT')});
 assert.equal(writes.length,1,'one explicit confirmation attempts one save');assert.equal(store.state('pairs').value,null,'stale roster must not become saved groups');assert.equal(store.state('pairs').version,0);assert.match(document.querySelector('.toast')?.textContent??'',/名单|档案/);assert.equal(document.querySelector('.matching-animation'),null,'rejected adoption returns to controls');
});
test('72 actual players adopt once through the same console queue with the original roster snapshot',async t=>{
 const{store,writes}=await consoleView(t,72);assert.equal(writes.length,1);assert.equal(writes[0].matchedRosterSnapshot,fingerprint(store.data.players));const state=store.state('pairs');assert.equal(state.version,1);assert.equal(state.value.groups.length,36);assert.equal(new Set(state.value.groups.flatMap(g=>g.members)).size,72);assert.deepEqual(state.value.standby,[]);
});
test('matching adoption retains activity-version CAS and does not overwrite a concurrent saved result',async t=>{
 const external={groups:[],standby:[],round:1,challengeBank:['外部保存的题库']};const{store}=await consoleView(t,4,async(store,api)=>{await api('state',{kind:'pairs',value:external,version:0},'PUT')});assert.deepEqual(store.state('pairs').value,external);assert.equal(store.state('pairs').version,1);assert.match(document.querySelector('.toast')?.textContent??'',/更新|刷新/);
});
test('state route validates an explicitly supplied roster snapshot while keeping legacy internal state callers compatible',async t=>{
 const{store,api}=fixture(t,72),snapshot=fingerprint(store.data.players),value={groups:[],standby:[],round:1,challengeBank:['保留题库']};
 await api('state',{kind:'pairs',value,version:0},'PUT');await api('scores/adjust',{playerId:'p0',delta:1,actionId:'pair-roster-score-only'});await api('state',{kind:'pairs',value,version:1,matchedRosterSnapshot:snapshot},'PUT');assert.equal(store.state('pairs').version,2,'score-only refresh does not change matched profiles');
 await assert.rejects(api('state',{kind:'pairs',value,version:2,matchedRosterSnapshot:'stale'}),/名单|档案/);await assert.rejects(api('state',{kind:'pairs',value,version:2,matchedRosterSnapshot:null}),/名单|档案/);assert.equal(store.state('pairs').version,2,'failed validation must not write or advance version');
});
