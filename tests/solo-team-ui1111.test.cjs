const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const players=[0,1,2].map(i=>({id:'p'+i,name:'玩家'+i,number:String(i),active:1,attendance:'present',photo:'',interests:'摄影'}));
const solo={id:'solo',members:['p0'],solo:true,seats:2,alive:true};

test('solo finalist remains eligible and records only its real member in the heart round',()=>{
 const {buildHeartRows}=require('../src/pair-heart.tsx'),state={round:4,groups:[solo],tournament:{finalists:['solo']}},events=[{activity:1,round:4,groupId:'solo',playerIds:['p0'],questionIndex:1,status:'active'}],row=buildHeartRows(state,players,events)[0];
 assert.equal(row.eligible,true);assert.deepEqual(row.playerIds,['p0']);assert.equal(row.members.length,1);assert.equal(row.score,1);
 assert.equal(buildHeartRows(state,players.map(p=>p.id==='p0'?{...p,attendance:'away'}:p),events)[0].eligible,false);
});

test('third round labels a solo team and offers its normal qualifying result control',()=>{
 const PairTournament=require('../src/pair-tournament.tsx').default,state={round:3,groups:[solo],tournament:{rounds:[],finalists:['solo']}},ctx={players,busy:'',bag:{pairs:state}},html=renderToStaticMarkup(React.createElement(PairTournament,{ctx,state,bank:[],onBankChange(){},saveBank:async()=>{}})),doc=new JSDOM(html).window.document,team=doc.querySelector('[data-blindfold-group="solo"]');
 assert.match(team.textContent,/单人成队/);assert.match(team.textContent,/2个名额/);assert.equal(Array.from(team.querySelectorAll('button')).find(b=>b.textContent==='晋级第四轮').disabled,false);assert.equal(team.querySelectorAll('.avatar').length,1);
});

test('the adopted third-round solo card describes its actual one-person score',()=>{
 const Pairs=require('../src/pair-activity.tsx').default,state={formatVersion:2,round:3,groups:[{...solo,cover:'',challenge:'',votes:0}],standby:[],tournament:{rounds:[],finalists:['solo'],blindfoldResults:{solo:'advanced'}}},html=renderToStaticMarkup(React.createElement(Pairs,{ctx:{players,bag:{pairs:state},ai:{hasKey:false},busy:'',tell(){}}})),doc=new JSDOM(html).window.document,card=doc.querySelector('.pair-grid .pair-round-win');assert.ok(card);assert.match(card.textContent,/本人\+1分/);assert.doesNotMatch(card.textContent,/两人/);
});

test('all public pair projections retain a single real member and explicit solo seats',()=>{
 const {liveProjection}=require('../src/live-projection.ts');
 for(const round of [1,2,3,4]){
  const state={round,groups:[solo,{id:'pair',members:['p1','p2'],alive:true}],tournament:{finalists:['solo'],rounds:round<=2?[{number:round,matches:[{id:'m',teamIds:['solo','pair'],status:'pending'}]}]:[]}},output=liveProjection({activity:1,states:{pairs:{value:state}},players}),group=round<=2?output.matches[0].teams[0]:output.groups[0];
  assert.equal(group.solo,true);assert.equal(group.seats,2);assert.deepEqual(group.members.map(p=>p.id),['p0']);
 }
});

test('matching reveal presents an odd player as a solo team with two seats',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const {act}=React,root=require('react-dom/client').createRoot(document.getElementById('root')),Matching=require('../src/matching-animation.tsx').default,flush=()=>new Promise(setImmediate);
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 await act(async()=>{root.render(React.createElement(Matching,{players,result:{pairs:[['p1','p2'],['p0']],standby:[],reasons:[{members:['p0'],reason:'单人成队',reasonSource:'solo'}]},onComplete(){},onCancel(){}}));await flush()});
 await act(async()=>{t.mock.timers.tick(3000);await flush()});
 const team=document.querySelector('[data-members="p0"]');assert.match(team.textContent,/单人成队/);assert.match(team.textContent,/2个名额/);assert.equal(team.querySelectorAll('.avatar').length,1);assert.doesNotMatch(document.body.textContent,/待安排|待补位/);
});


test('solo stage introductions and 2v2 boards label two seats and never demand a pair cover',()=>{
 const {PairIntroduction}=require('../src/party-presentations.tsx'),{PairPKBoard}=require('../src/stage-live.tsx'),intro=renderToStaticMarkup(React.createElement(PairIntroduction,{title:'玩家0',people:[players[0]],solo:true,seats:2})),board=renderToStaticMarkup(React.createElement(PairPKBoard,{matches:[{id:'m',teamIds:['solo'],teams:[{...solo,members:[players[0]],name:'玩家0'}],bye:true}]}));
 assert.match(intro,/单人成队/);assert.match(intro,/2个名额/);assert.doesNotMatch(intro,/尚未生成合照/);assert.match(board,/单人成队/);assert.match(board,/2个名额/);
});

test('legacy standby conversion has an explicit versioned action before tournament draw',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const {act}=React,root=require('react-dom/client').createRoot(document.getElementById('root')),Tournament=require('../src/pair-tournament.tsx').default,flush=()=>new Promise(setImmediate),state={round:1,standby:['p0'],groups:[{id:'pair',members:['p1','p2'],alive:true}],challengeBank:['挑战'],round2Bank:[]},calls=[];let refreshed=0;
 window.partyDesktop={call:async(route,b)=>{calls.push({route,b});if(route==='boot')return{ok:true,data:{states:{pairs:{value:state,version:9}}}};if(route==='pairs/tournament/upgrade-solos')return{ok:true,data:{value:state,newGroups:[solo],notice:'单人成队已追加'}};throw Error(route)}};
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});
 const ctx={players,busy:'',event:{id:'party',resetEpoch:2},run:async(_,fn)=>fn(),refresh:async()=>{refreshed++},tell(){}};
 await act(async()=>{root.render(React.createElement(Tournament,{ctx,state,bank:['挑战'],onBankChange(){},saveBank:async()=>{}}));await flush()});
 const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='将旧待安排转为单人队');assert.ok(button);await act(async()=>{button.click();await flush()});
 assert.deepEqual(calls.find(c=>c.route==='pairs/tournament/upgrade-solos').b,{eventId:'party',resetEpoch:2,version:9});assert.equal(refreshed,1);assert.deepEqual(state.groups[0].members,['p1','p2']);
});
