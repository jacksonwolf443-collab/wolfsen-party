const{test}=require('node:test'),assert=require('node:assert/strict');
const{buildPartySummary,recordSelectionDetails,captureDrawSuccess,archiveActivitySummary}=require('../desktop/party-summary.cjs');
const player=id=>({id,name:'玩家'+id,number:id,photo:'',active:1,score:0});
const data=()=>({players:['a','b','c','d'].map(player),states:{},selectionCounts:{a:5,b:1},missions:[],scoreHistory:[]});
test('summary ranks real points, confirmed wins and counted selections; historical unknown details stay unknown',()=>{
 const d=data();d.players[1].score=7;recordSelectionDetails(d,['a'],'lottery',{drawnAt:1});d.states.pairs={value:{groups:[{id:'t1',members:['a','b']},{id:'t2',members:['c','d']}],tournament:{rounds:[{number:1,matches:[{id:'m1',status:'settled',winnerId:'t1',task:'接力跑'},{id:'bye',status:'bye',winnerId:'t1'}]}]}}};
 const s=buildPartySummary(d);assert.equal(s.points[0].id,'b');assert.equal(s.wins[0].wins,1);assert.equal(s.selections[0].id,'a');assert.equal(s.selections[0].unknownSelections,4);assert.equal(s.selections[0].selectionEvents[0].activity,'随机抽取玩家');assert(s.awards.some(x=>x.id==='wins'&&x.title==='今晚胜利次数最多'));assert(!JSON.stringify(s).includes('encryptedKey'));
});
test('undo removes current match victories and archiving preserves only the final confirmed result',()=>{
 const d=data(),v={groups:[{id:'x',members:['a','b']}],tournament:{rounds:[{number:1,matches:[{id:'m',status:'settled',winnerId:'x',task:'默契'}]}]}};d.states.pairs={value:v};assert.equal(buildPartySummary(d).wins[0].wins,1);v.tournament.rounds[0].matches[0].status='pending';assert.equal(buildPartySummary(d).wins[0].wins,0);v.tournament.rounds[0].matches[0].status='settled';archiveActivitySummary(d,'pairs',v);d.states.pairs={value:null};assert.equal(buildPartySummary(d).wins[0].wins,1);archiveActivitySummary(d,'pairs',v);assert.equal(buildPartySummary(d).wins[0].wins,1);
});
test('AI success and host acceptance in the same drawing round count once, survive reset, and contain no private code',()=>{
 const d=data();captureDrawSuccess(d,{roundId:'r1',player:'a',topic:'食堂',celebration:{roundId:'r1'}});captureDrawSuccess(d,{roundId:'r1',player:'a',topic:'食堂',awarded:true});d.missions=[{id:'mission',actor:'b',target:'a',task:'说一句祝福',code:'123456',completed_at:'now'}];const s=buildPartySummary(d);assert.equal(s.wins.find(x=>x.id==='a').wins,1);assert.equal(s.players.find(x=>x.id==='b').completedMissions,1);assert(!JSON.stringify(s).includes('123456'));
});
test('fans five-round histories and photo quiz use actual winner IDs without counting forfeits or twice',()=>{
 const d=data();d.states.fans={value:{seriesId:'series',rounds:[{id:'f1',winnerIds:['a','b'],task:'俯卧撑',at:'now'}],seriesHistory:[]}};d.states.crop={value:{results:[{id:'c1',current:'c',winner:'a',outcome:'guessed',at:'now'},{id:'c2',current:'d',outcome:'nobody'}]}};const s=buildPartySummary(d);assert.equal(s.players.find(x=>x.id==='a').wins,2);assert.equal(s.players.find(x=>x.id==='b').wins,1);assert.equal(s.players.find(x=>x.id==='c').wins,0);
});
