const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const React=require('react'),{act}=React,{Store,createBackend}=require('../desktop/store.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fans-celebration118-')),store=new Store(dir),api=createBackend(store);
 store.data.players=Array.from({length:6},(_,i)=>({id:'p'+i,number:String(i+1),name:'原名'+i,photo:'original-'+i+'.png',active:1,consent:1,attendance:'present'}));
 await api('fans/configure',{version:0,a:'p0',b:'p1',teamA:['p0','p2','p4'],teamB:['p1','p3','p5']});
 const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const root=require('react-dom/client').createRoot(document.getElementById('root'));
 window.partyDesktop={call:async(route,body,method)=>{try{return{ok:true,data:await api(route,body,method)}}catch(e){return{ok:false,error:e.message,status:e.status}}}};
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT;fs.rmSync(dir,{recursive:true,force:true})});
 return{store,api,root,render:async element=>act(async()=>{root.render(element);await flush()}),click:async node=>act(async()=>{assert(node);node.click();await flush()})};
}
for(const side of ['A','B'])test(side+' round win celebrates every frozen teammate only after persistence, refresh and projection; result remains until dismissed',async t=>{
 const f=await fixture(t),Fans=require('../src/fans-activity.tsx').default;let releaseRefresh,releaseProjection;
 const refreshGate=new Promise(resolve=>releaseRefresh=resolve),projectionGate=new Promise(resolve=>releaseProjection=resolve);
 function Harness(){
  const [players,setPlayers]=React.useState(f.store.data.players.map(p=>({...p}))),[bag,setBag]=React.useState({fans:f.store.state('fans').value}),[scores,setScores]=React.useState('');
  return React.createElement(React.Fragment,null,React.createElement('output',{'data-scores':true},scores),React.createElement(Fans,{ctx:{players,bag,busy:'',run:async(_,fn)=>fn(),tell(){},refresh:async()=>{await refreshGate;const boot=await f.api('boot');setPlayers(boot.players);setBag({fans:boot.states.fans.value});setScores(boot.players.map(p=>p.id+':'+p.score).join(','))},project:async value=>{await projectionGate;await f.api('state',{kind:'screen',value,version:0},'PUT')}}}));
 }
 await f.render(React.createElement(Harness));await f.click(document.querySelector('[aria-label="记录'+side+'队本局获胜"]'));
 assert.equal(f.store.state('fans').value.rounds.length,1,'round was persisted before animation');assert.equal(document.querySelector('.fans-celebration'),null,'refresh is still pending');
 for(const p of f.store.data.players){p.name='新名'+p.id;p.photo='changed-'+p.id+'.png'}
 await act(async()=>{releaseRefresh();await flush()});assert.equal(document.querySelector('.fans-celebration'),null,'projection must finish before showing victory');
 await act(async()=>{releaseProjection();await flush()});
 const dialog=document.querySelector('.fans-celebration');assert.ok(dialog,'saved round should open congratulations');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.match(dialog.textContent,new RegExp(side+'队.*获胜'));
 const ids=side==='A'?['p0','p2','p4']:['p1','p3','p5'];assert.deepEqual([...dialog.querySelectorAll('[data-winner-id]')].map(n=>n.dataset.winnerId),ids);
 for(const id of ids){const i=Number(id.slice(1)),card=dialog.querySelector('[data-winner-id="'+id+'"]');assert.match(card.textContent,new RegExp('原名'+i));assert.equal(card.querySelector('img').getAttribute('src'),'party-photo://local/original-'+i+'.png');assert.match(document.querySelector('[data-scores]').textContent,new RegExp(id+':1'));}
 assert.equal(f.store.state('screen').value.people[side==='A'?0:1].score,1,'scoreboard projection uses saved round result');
 t.mock.timers.enable({apis:['setTimeout','setInterval']});await act(async()=>{t.mock.timers.tick(60000);await flush()});assert.ok(document.querySelector('.fans-celebration'),'congratulations must not auto-close');
 await f.click(dialog.querySelector('button'));assert.equal(document.querySelector('.fans-celebration'),null);assert.equal(f.store.state('fans').value.rounds.length,1,'dismissal never records a second win');
});
test('failed round persistence never opens congratulations or changes recorded score',async t=>{
 const f=await fixture(t),Fans=require('../src/fans-activity.tsx').default;let error='';
 const players=f.store.data.players.map(p=>({...p})),value=f.store.state('fans').value;f.store.data.players[3].attendance='away';
 await f.render(React.createElement(Fans,{ctx:{players,bag:{fans:value},busy:'',run:async(_,fn)=>{try{await fn()}catch(e){error=e.message}},tell(){},refresh:async()=>{throw Error('refresh must not run')},project:async()=>{throw Error('projection must not run')}}}));
 await f.click(document.querySelector('[aria-label="记录B队本局获胜"]'));assert.match(error,/离场/);assert.equal(document.querySelector('.fans-celebration'),null);assert.equal(f.store.state('fans').value.rounds.length,0);
});
test('failed scoreboard projection keeps the saved round without announcing a synchronized victory',async t=>{
 const f=await fixture(t),Fans=require('../src/fans-activity.tsx').default;let error='';
 await f.render(React.createElement(Fans,{ctx:{players:f.store.data.players,bag:{fans:f.store.state('fans').value},busy:'',run:async(_,fn)=>{try{await fn()}catch(e){error=e.message}},tell(){},refresh:async()=>{},project:async()=>{throw Error('舞台保存失败')}}}));
 await f.click(document.querySelector('[aria-label="记录A队本局获胜"]'));assert.equal(error,'舞台保存失败');assert.equal(document.querySelector('.fans-celebration'),null);assert.equal(f.store.state('fans').value.rounds.length,1);
});
