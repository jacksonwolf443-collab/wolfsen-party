const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPartySummary,allWinEvents,victorySource}=require('../desktop/party-summary.cjs');
const players=scores=>scores.map((score,i)=>({id:'p'+i,name:'玩家'+i,number:String(i+1),photo:'original-'+i+'.png',score,active:1,attendance:'present'}));
test('the first three awards use the real first, second and third score ranks without changing scores',()=>{
 const data={players:players([4,20,8,13]),states:{},selectionCounts:{}},before=structuredClone(data),summary=buildPartySummary(data);
 assert.deepEqual(summary.awards.slice(0,3).map(a=>[a.id,a.title,a.reward,a.ids,a.value]),[
  ['points','今晚最强王者','由主持人自定',['p1'],20],['points-second','今晚的亚军','由主持人自定',['p3'],13],['points-third','今晚的季军','由主持人自定',['p2'],8]
 ]);assert.deepEqual(data,before);
});
test('equal score podium candidates wait for offline PK while the score leaderboard keeps its tied ranks',()=>{
 const summary=buildPartySummary({players:players([10,10,7,0]),states:{}}),podium=summary.awards.slice(0,3);
 assert.deepEqual(podium.map(a=>a.ids),[[],[],[]]);assert.deepEqual(podium[0].candidateIds,['p0','p1']);assert.equal(podium[0].requiresPK,true);assert.equal(podium[1].needsPrevious,true);assert.equal(summary.points[2].rank,3);
});
test('zero and negative scores are valid real results and absent ranks never invent winners',()=>{
 for(const scores of [[0],[-2,-5]]){const summary=buildPartySummary({players:players(scores),states:{}});assert.equal(summary.awards[0].ids[0],'p0');assert.equal(summary.awards[0].value,scores[0]);assert.deepEqual(summary.awards[2].ids,[]);assert.match(summary.awards[2].emptyReason,/不足|暂无/)}
 const empty=buildPartySummary({players:[],states:{}});assert.equal(empty.awards.length,0);
});
test('talent score-only events keep their exact provenance without becoming victories',()=>{
 const data={players:players([6,3]),states:{truth:{value:{formatVersion:2,entries:[{id:'participation',round:2,status:'active',playerIds:['p0','p1'],points:3,reason:'participation',task:'武术表演',updatedAt:'now'},{id:'recognition',round:2,status:'active',playerIds:['p0'],points:3,reason:'recognition',task:'武术表演',updatedAt:'now'}]}}}},summary=buildPartySummary(data),events=allWinEvents(data);
 assert.equal(events.length,3);assert(events.every(e=>e.scoreOnly));assert.match(victorySource(events[0]),/谁是最有趣开心的人.*第2轮.*参与表演/);assert(summary.wins.every(p=>p.wins===0));assert(summary.players.every(p=>p.winEvents.length===0));assert.equal(summary.players[0].scoreEvents.length,2);assert(summary.players[0].activities.includes('谁是最有趣开心的人'));assert(!summary.awards.some(a=>a.id==='wins'));
});
