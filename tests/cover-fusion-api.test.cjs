const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs'),{codec,solid}=require('./helpers/raster-fixture.cjs');
const{acceptedQuality}=require('./helpers/cover-quality-fixture.cjs');
async function fixture(t,{quality=acceptedQuality(),hold=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-fusion-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),requests=[],generated=solid(1280,720,7),url='https://test.aliyuncs.com/complete-photo.png';let release;
 const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',imageCodec:codec,headMatte:async()=>{throw Error('Complete photos must not pass through head matting')},fetcher:async(endpoint,options)=>{
  if(endpoint===url)return new Response(generated);const body=JSON.parse(options.body);requests.push(body);
  if(body.input){if(hold)await new Promise(resolve=>release=resolve);return Response.json({output:{choices:[{message:{content:[{image:url}]}}]}})}
  return Response.json({choices:[{message:{content:JSON.stringify(quality)}}]});
 }});const ids=[];for(const[i,c]of [110,210].entries()){const {key}=await api('upload',{bytes:solid(128,128,c),type:'image/png'});ids.push((await createCheckedInPlayer(api, {name:'本人'+i,number:String(i),photo:key})).player.id)}
 return{store,api,ids,requests,generated,get release(){return release}};
}
test('complete group photos use two original full portraits and save the generated photograph unchanged',async t=>{
 const f=await fixture(t),originals=f.store.data.players.map(p=>fs.readFileSync(f.store.photoPath(p.photo)));
 const result=await f.api('ai/cover',{ids:f.ids});assert.equal(result.coverMethod,'whole-photo-v2');assert.equal(result.placements,undefined);assert.equal(result.facePlacements,undefined);
 const finalBytes=fs.readFileSync(f.store.photoPath(result.photo));assert.deepEqual(finalBytes,f.generated,'the entire AI photograph is saved without source-face patches or re-encoding');
 const generation=f.requests.find(r=>r.input),content=generation.input.messages[0].content;assert.equal(content.filter(c=>c.image).length,2);
 content.filter(c=>c.image).forEach((c,i)=>assert.equal(c.image,f.store.photoData(f.store.data.players[i].photo)));
 assert.equal(generation.parameters.size,'1280*720');assert.equal(generation.parameters.prompt_extend,false);
 const reviews=f.requests.filter(r=>r.messages);assert.equal(reviews.length,1,'only the completed photograph is reviewed');assert.equal(reviews[0].messages[0].content.find(c=>c.type==='image_url').image_url.url,'data:image/png;base64,'+f.generated.toString('base64'));
 f.store.data.players.forEach((p,i)=>assert.deepEqual(fs.readFileSync(f.store.photoPath(p.photo)),originals[i]));
});
test('visible cut-paste seams or incomplete people are rejected and do not replace an existing cover',async t=>{
 for(const quality of [{sceneMatches:true,completePeople:true,naturalBlend:false},{sceneMatches:true,completePeople:false,naturalBlend:true}]){
  const f=await fixture(t,{quality});await assert.rejects(f.api('ai/cover',{ids:f.ids}),/融合|完整|衔接/);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0);
 }
});
test('a departure while generating a complete photo discards its late result',async t=>{
 const f=await fixture(t,{hold:true}),job=f.api('ai/cover',{ids:f.ids});for(let i=0;i<20&&!f.release;i++)await new Promise(r=>setImmediate(r));assert.ok(f.release);
 await f.api('players/attendance',{id:f.ids[0],version:f.store.player(f.ids[0]).version,attendance:'away'});f.release();await assert.rejects(job,/未到|离场/);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0);
});
