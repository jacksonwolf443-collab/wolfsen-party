const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{JSDOM}=require('jsdom');
const players=Array.from({length:4},(_,i)=>({id:'p'+i,name:'玩家'+i,number:String(i+1),photo:'original-'+i+'.png',attendance:'present',active:1}));
const groups=[0,1].map(i=>({id:'g'+i,members:['p'+(i*2),'p'+(i*2+1)],alive:i===1,challenge:'',cover:'',votes:0}));
const ctx={players,bag:{pairs:{groups,standby:[],round:1,formatVersion:2}},ai:{hasKey:false},event:{id:'event'},busy:'',run(){},save(){},tell(){},project(){},refresh(){}};
test('eliminated pair archive stays readable with an explicit large result while winning pair has no elimination stamp',()=>{
 const Pairs=require('../src/pair-activity.tsx').default,doc=new JSDOM(renderToStaticMarkup(React.createElement(Pairs,{ctx}))).window.document;
 const eliminated=doc.querySelector('.pair-eliminated-card');assert(eliminated);assert(!eliminated.classList.contains('dimmed'));assert.equal(eliminated.querySelector('[data-elimination-stamp]').textContent,'本轮淘汰');assert.equal(doc.querySelectorAll('.pair-grid [data-elimination-stamp]').length,1);assert.equal(eliminated.querySelectorAll('.pair-members img').length,2);
});
test('stage match marks only actual loser with the same high contrast four-character result',()=>{
 const {PairPKBoard}=require('../src/stage-live.tsx'),matches=[{id:'m',status:'completed',winnerId:'g1',loserId:'g0',task:'现场挑战',teams:groups.map(g=>({...g,members:g.members.map(id=>players.find(p=>p.id===id))}))}],doc=new JSDOM(renderToStaticMarkup(React.createElement(PairPKBoard,{matches}))).window.document;
 assert.equal(doc.querySelector('.pk-board-team.eliminated [data-elimination-stamp]').textContent,'本轮淘汰');assert.equal(doc.querySelectorAll('[data-elimination-stamp]').length,1);assert.equal(doc.querySelector('.pk-board-team.winner [data-elimination-stamp]'),null);
});
