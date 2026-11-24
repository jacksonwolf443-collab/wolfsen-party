const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAIPairing,verifiedReason}=require('../desktop/ai-pairing.cjs');
const eligible=p=>!!p&&p.active!==0;
async function explain(profiles,response){
 const players=profiles.map((p,i)=>({id:'person-'+i,active:1,...p}));let calls=0;
 const result=await createAIPairing({store:{data:{players}},isEligible:eligible,shuffle:a=>a,aiText:async()=>++calls===1?'{"pairs":[["P001","P002"]]}':typeof response==='string'?response:JSON.stringify(response)})();
 return{reason:result.reasons[0],players};
}
function assertRealEvidence(reason,players){
 assert.ok(reason.reasonEvidence.length>0);
 for(const e of reason.reasonEvidence){const p=players.find(p=>p.id===e.playerId);assert.ok(p);assert.ok((Array.isArray(p[e.field])?p[e.field].join('、'):p[e.field]).includes(e.quote));}
}
test('missing or malformed explanation uses the real shared hobby rather than reporting filled profiles as insufficient',async()=>{
 for(const response of [{reasons:[]},'not JSON',{reasons:[{pair:'G001',basis:'insufficient'}]}]){
  const {reason,players}=await explain([{interests:'健身、摄影',wish:'想学陶艺'},{interests:'摄影、电影',wish:'想走川藏线'}],response);
  assert.equal(reason.reasonSource,'profile');assert.match(reason.reason,/共同兴趣.*摄影/);assert.doesNotMatch(reason.reason,/资料不足|共同.*健身|共同.*电影/);assertRealEvidence(reason,players);
 }
});
test('unsupported model claims fall back to different real interests without inventing a common hobby',async()=>{
 const {reason,players}=await explain([{interests:'摄影'},{interests:'绘画'}],{reasons:[{pair:'G001',basis:'shared-interest',shared:'健身',a:{field:'interests',quote:'健身'},b:{field:'interests',quote:'健身'}}]});
 assert.equal(reason.reasonSource,'profile');assert.match(reason.reason,/摄影/);assert.match(reason.reason,/绘画/);assert.doesNotMatch(reason.reason,/资料不足|健身|共同兴趣/);assertRealEvidence(reason,players);
});
test('wish-only and mixed interest/wish profiles remain grounded conversation starters when the model omits a group',async()=>{
 for(const profiles of [[{wish:'想去潜水'},{wish:'想看极光'}],[{interests:['电影','读书']},{wish:'想学大提琴'}]]){
  const {reason,players}=await explain(profiles,{reasons:[]});assert.equal(reason.reasonSource,'profile');assert.doesNotMatch(reason.reason,/资料不足|共同心愿|共同兴趣/);assertRealEvidence(reason,players);for(const p of players)assert.ok(reason.reasonEvidence.some(e=>e.playerId===p.id));
 }
});
test('shared fallback hobbies use complete declared terms and do not treat generic words or negation as a shared interest',()=>{
 const ps=[{id:'a',interests:'喜欢健身'},{id:'b',interests:'不喜欢健身'}],reason=verifiedReason(null,['a','b'],ps);
 assert.equal(reason.reasonSource,'profile');assert.doesNotMatch(reason.reason,/共同兴趣/);assert.match(reason.reason,/不喜欢健身/);assertRealEvidence(reason,ps);
});
test('matching dislikes are quoted as discussion topics without becoming a claimed common hobby',async()=>{
 for(const interests of ['不喜欢健身','不太喜欢摄影','不怎么喜欢电影']){const {reason}=await explain([{interests},{interests}],{reasons:[]});
 assert.equal(reason.reasonSource,'profile');assert.doesNotMatch(reason.reason,/共同兴趣/);assert.ok(reason.reason.includes(interests));}
});
test('a model cannot turn an explicitly disliked hobby or unwanted wish into a shared preference by quoting only its noun',async()=>{
 for(const [field,basis,profiles]of [['interests','shared-interest',[{interests:'喜欢健身'},{interests:'不喜欢健身'}]],['wish','shared-wish',[{wish:'想去潜水'},{wish:'不想去潜水'}]]]){
  const shared=field==='wish'?'潜水':'健身',{reason,players}=await explain(profiles,{reasons:[{pair:'G001',basis,shared,a:{field,quote:shared},b:{field,quote:shared}}]});
  assert.equal(reason.reasonSource,'profile');assert.doesNotMatch(reason.reason,/共同兴趣|共同心愿/);assertRealEvidence(reason,players);
 }
});
test('reasonable structured aliases, reversed identified evidence and punctuation changes retain a verified AI analysis',async()=>{
 const {reason,players}=await explain([{interests:'健身、摄影'},{interests:'摄影、电影'}],{reasons:[{pair:'g1',basis:'shared_interest',shared:'摄影',evidence:[{playerId:'P002',field:'兴趣',quote:'摄影, 电影'},{playerId:'P001',field:'兴趣',quote:'健身, 摄影'}]}]});
 assert.equal(reason.reasonSource,'ai');assert.match(reason.reason,/摄影/);assertRealEvidence(reason,players);assert.deepEqual(reason.reasonEvidence.map(e=>e.playerId),['person-0','person-1']);
});
test('grouped facts addressed by actual alias members retain each supported AI fact',async()=>{
 const {reason,players}=await explain([{interests:'摄影、电影',wish:'想去潜水'},{interests:'摄影、电影',wish:'想去潜水'}],{reasons:[{members:['P002','P001'],facts:[{basis:'shared-interest',shared:'摄影',a:{field:'interests',quote:'摄影'},b:{field:'interests',quote:'摄影'}},{basis:'shared-wish',shared:'潜水',a:{field:'wish',quote:'潜水'},b:{field:'wish',quote:'潜水'}}]}]});
 assert.equal(reason.reasonSource,'ai');assert.match(reason.reason,/摄影/);assert.match(reason.reason,/潜水/);assertRealEvidence(reason,players);
});
test('a pair addressed by a reversed alias array keeps evidence attached to the correct person',async()=>{
 const {reason,players}=await explain([{interests:'摄影'},{interests:'电影'}],{reasons:[{pair:['P002','P001'],basis:'explore',a:{field:'interests',quote:'电影'},b:{field:'interests',quote:'摄影'}}]});
 assert.equal(reason.reasonSource,'ai');assert.deepEqual(reason.reasonEvidence,[{playerId:'person-0',field:'interests',quote:'摄影'},{playerId:'person-1',field:'interests',quote:'电影'}]);assertRealEvidence(reason,players);
});
test('unusable profiles use the requested game line with an explicit entertainment source and no invented evidence',async()=>{
 for(const profiles of [[{},{}],[{interests:'暂无',wish:'未填写'},{interests:'无'}],[{interests:'摄影'},{}]]){
  const {reason}=await explain(profiles,{reasons:[]});assert.equal(reason.reasonSource,'entertainment');assert.equal(reason.reason,'根据AI数据库分析两个人的长相可能互相存在吸引力');assert.deepEqual(reason.reasonEvidence,[]);
 }
});
test('a substring of an unfilled placeholder cannot serve as AI evidence of a real interest',async()=>{
 const {reason}=await explain([{interests:'未填写'},{interests:'摄影'}],{reasons:[{pair:'G001',basis:'explore',a:{field:'interests',quote:'填写'},b:{field:'interests',quote:'摄影'}}]});
 assert.equal(reason.reasonSource,'entertainment');assert.deepEqual(reason.reasonEvidence,[]);assert.doesNotMatch(reason.reason,/填写/);
});
