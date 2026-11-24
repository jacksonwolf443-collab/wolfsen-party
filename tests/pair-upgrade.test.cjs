const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const pairingPath='../desktop/ai-pairing.cjs',tournamentPath='../desktop/pair-tournament.cjs';
const pairing=fs.existsSync(path.join(__dirname,pairingPath))?require(pairingPath):{};
const tournament=fs.existsSync(path.join(__dirname,tournamentPath))?require(tournamentPath):{};
const eligible=p=>!!p&&p.active!==0&&p.consent!==0&&(!p.attendance||p.attendance==='present');
const people=n=>Array.from({length:n},(_,i)=>({id:'uuid-'+i,number:String(i+1),name:'不可用于匹配'+i,interests:i%2?'摄影':'徒步',wish:i%2?'想拍星空':'想走长线',active:1,consent:1,attendance:'present'}));
const groups=n=>Array.from({length:n},(_,i)=>({id:'g'+i,members:['uuid-'+i*2,'uuid-'+(i*2+1)],alive:true,cover:'photo'+i,votes:2}));
test('AI repair retains valid alias pairs, drops duplicates and fills 80 unique people using interests and wishes',()=>{
 assert.equal(typeof pairing.normalizePairing,'function','normalizer must be implemented');
 const ps=people(80),result=pairing.normalizePairing({pairs:[['P001','P003'],['P001','P004'],['bad','P005'],['uuid-1','uuid-3']],standby:['bad']},ps,{shuffle:a=>a});
 assert.equal(result.pairs.length,40);assert.deepEqual(result.standby,[]);
 assert.deepEqual(result.pairs.slice(0,2),[['uuid-0','uuid-2'],['uuid-1','uuid-3']]);
 const ids=result.pairs.flat();assert.equal(new Set(ids).size,80);assert.deepEqual([...ids].sort(),ps.map(p=>p.id).sort());
 for(const pair of result.pairs.slice(2))assert.equal(ps.find(p=>p.id===pair[0]).interests,ps.find(p=>p.id===pair[1]).interests);
});
test('odd AI completion promotes the valid leftover to a solo team without consuming an invalid pair member',()=>{
 assert.equal(typeof pairing.normalizePairing,'function');const ps=people(5);
 const r=pairing.normalizePairing({pairs:[['P001','unknown'],['P002','P002']],standby:['P005']},ps,{shuffle:a=>a});
 assert.deepEqual(r.standby,[]);assert.deepEqual(r.pairs.at(-1),['uuid-4']);assert.equal(r.pairs.length,3);assert.equal(new Set(r.pairs.flat()).size,5);
});
test('compact aliases retain priority even when a real player name or number looks like another alias',()=>{
 const ps=people(4);ps[2].name='P001';ps[3].number='P002';
 const r=pairing.normalizePairing({pairs:[['P001','P002']]},ps,{shuffle:a=>a});
 assert.deepEqual(r.pairs[0],['uuid-0','uuid-1']);
});
test('AI prompt uses compact aliases and interests/wishes without names; auth/network errors are never repaired',async()=>{
 assert.equal(typeof pairing.createAIPairing,'function');const ps=people(80),store={data:{players:ps}};let prompt='';
 const run=pairing.createAIPairing({store,isEligible:eligible,aiText:async text=>{prompt=text;return JSON.stringify({pairs:[['P001','P002']]})},parseAIJSON:JSON.parse,shuffle:a=>a});
 assert.equal((await run()).pairs.length,40);assert.ok(prompt.includes('P080'));assert.ok(prompt.includes('想拍星空'));assert.ok(!prompt.includes('不可用于匹配'));assert.ok(!prompt.includes('uuid-79'));
 const broken=pairing.createAIPairing({store,isEligible:eligible,aiText:async()=>{throw Error('401：密钥失效')},parseAIJSON:JSON.parse});
 await assert.rejects(broken(),/401：密钥失效/);
});
test('AI request rejects changed attendance even when a complete roster was returned',async()=>{
 assert.equal(typeof pairing.createAIPairing,'function');const ps=people(4),store={data:{players:ps}};
 const run=pairing.createAIPairing({store,isEligible:eligible,aiText:async()=>{ps[3].attendance='away';return '{"pairs":[["P001","P002"]]}'},parseAIJSON:JSON.parse});
 await assert.rejects(run(),/名单.*变化/);
});
function fixture(t,n=80){const{Store}=require('../desktop/store.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair-tournament-only-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.data.players=people(n);store.putState('pairs',{groups:groups(Math.floor(n/2)),standby:n%2?[store.data.players.at(-1).id]:[],round:1,challengeBank:['共同跳舞','一起摆拍'],round2Bank:['默契举牌']},0);return store;}
test('40 teams run 20 2v2 matches then only 20 winners run 10 matches; only final 10 reach blindfold',t=>{
 assert.equal(typeof tournament.createPairTournamentService,'function');const store=fixture(t),service=tournament.createPairTournamentService({store,isEligible:eligible,shuffle:a=>a});
 const prepare=()=>service('prepare',{version:store.state('pairs').version});
 const commit=p=>service('commit',{token:p.token,version:store.state('pairs').version});
 let preview=prepare();assert.equal(store.state('pairs').value.tournament,undefined,'preview is cancellable and has no saved effects');
 assert.equal(preview.matches.length,20);assert.ok(preview.matches.every(m=>m.teamIds.length===2));commit(preview);
 assert.throws(()=>service('advance',{version:store.state('pairs').version}),/未.*结束|结果/);
 const first=store.state('pairs').value.tournament.rounds[0];const winners=[];
 for(const m of first.matches){winners.push(m.teamIds[1]);service('result',{version:store.state('pairs').version,matchId:m.id,loserId:m.teamIds[0]});}
 service('advance',{version:store.state('pairs').version});preview=prepare();assert.equal(preview.matches.length,10);assert.deepEqual(new Set(preview.matches.flatMap(m=>m.teamIds)),new Set(winners));commit(preview);
 assert.throws(()=>service('result',{version:store.state('pairs').version,matchId:first.matches[0].id,loserId:first.matches[0].teamIds[1]}),/当前|锁定/);
 for(const m of preview.matches)service('result',{version:store.state('pairs').version,matchId:m.id,loserId:m.teamIds[0]});
 service('advance',{version:store.state('pairs').version});const final=store.state('pairs').value;
 assert.equal(final.round,3);assert.equal(final.tournament.finalists.length,10);assert.equal(final.groups.filter(g=>g.alive).length,10);
 assert.ok(final.groups.every(g=>g.cover.startsWith('photo')&&g.votes===2));assert.equal(new (require('../desktop/store.cjs').Store)(store.directory).state('pairs').value.tournament.finalists.length,10);
});
test('tournament previews reject stale versions or attendance changes and cancellation preserves results',t=>{
 assert.equal(typeof tournament.createPairTournamentService,'function');const store=fixture(t,12),service=tournament.createPairTournamentService({store,isEligible:eligible,shuffle:a=>a}),p=service('prepare',{version:1});
 service('cancel',{token:p.token});assert.throws(()=>service('commit',{version:1,token:p.token}),/取消|过期/);assert.equal(store.state('pairs').version,1);
 const p2=service('prepare',{version:1});store.data.players[0].attendance='away';assert.throws(()=>service('commit',{version:1,token:p2.token}),/名单|在场/);assert.equal(store.state('pairs').version,1);
 store.data.players[0].attendance='present';const p3=service('prepare',{version:1});store.putState('pairs',{...store.state('pairs').value,challengeBank:['新题']},1);assert.throws(()=>service('commit',{version:1,token:p3.token}),/更新|刷新/);
});
test('legacy eliminated groups remain eliminated; odd eligible teams have an explicit bye and balanced task reuse',t=>{
 assert.equal(typeof tournament.createPairTournamentService,'function');const store=fixture(t,16),legacy=store.state('pairs').value;legacy.groups[0].alive=false;store.data.players[2].attendance='away';legacy.groups[2].alive=false;store.putState('pairs',legacy,1);
 const service=tournament.createPairTournamentService({store,isEligible:eligible,shuffle:a=>a}),p=service('prepare',{version:2});
 assert.deepEqual(p.skipped,['g1']);assert.equal(p.matches.length,3);assert.equal(p.matches.filter(m=>m.bye).length,1);
 assert.equal(new Set(p.matches.flatMap(m=>m.teamIds)).size,5);assert.ok(!p.matches.flatMap(m=>m.teamIds).includes('g0'));
 const counts=p.matches.filter(m=>!m.bye).reduce((a,m)=>(a[m.task]=(a[m.task]??0)+1,a),{});assert.ok(Math.max(...Object.values(counts))-Math.min(...Object.values(counts))<=1);
});
test('exactly one loser per match, explicit forfeit for departed teams, and undo is blocked after advance',t=>{
 assert.equal(typeof tournament.createPairTournamentService,'function');const store=fixture(t,8),service=tournament.createPairTournamentService({store,isEligible:eligible,shuffle:a=>a}),p=service('prepare',{version:1});service('commit',{token:p.token,version:1});
 const m=p.matches[0];assert.throws(()=>service('result',{version:2,matchId:m.id,loserId:'other'}),/队伍/);
 service('result',{version:2,matchId:m.id,loserId:m.teamIds[0]});assert.throws(()=>service('result',{version:3,matchId:m.id,loserId:m.teamIds[1]}),/撤销|结果/);
 service('undo',{version:3,matchId:m.id});assert.equal(store.state('pairs').value.tournament.rounds[0].matches[0].loserId,null);
 store.data.players[0].attendance='away';assert.throws(()=>service('result',{version:4,matchId:m.id,loserId:m.teamIds[0]}),/离场|在场/);
 service('forfeit',{version:4,matchId:m.id,teamId:m.teamIds[0]});assert.equal(store.state('pairs').value.tournament.rounds[0].matches[0].status,'forfeit');
 const next=p.matches[1];service('result',{version:5,matchId:next.id,loserId:next.teamIds[0]});service('advance',{version:6});
 assert.throws(()=>service('undo',{version:7,matchId:m.id}),/当前|锁定/);
});
