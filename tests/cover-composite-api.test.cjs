const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs'),{codec,solid,headGeometry}=require('./helpers/raster-fixture.cjs');
const{acceptedQuality}=require('./helpers/cover-quality-fixture.cjs');
async function fixture(t,{mismatch=false,holdFirstImage=false,headResult,layoutResult,headMatte}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-composite-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),requests=[],base=solid(1280,720,7),url='https://example.aliyuncs.com/test.png';let analyzed=0;
 let images=0,release=null;
 const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',imageCodec:codec,headMatte,fetcher:async(endpoint,options)=>{
  if(endpoint===url){requests.push({download:true,options});return new Response(base)}
  const b=JSON.parse(options.body);requests.push(b);
  if(b.input){images++;if(holdFirstImage&&images===1)await new Promise(resolve=>release=resolve);return Response.json({output:{choices:[{message:{content:[{image:url}]}}]}})}
  const prompt=b.messages[0].content.at(-1).text;const result=prompt.includes('抠图任务')?(analyzed++,typeof headResult==='function'?headResult(analyzed):headResult||{heads:[headGeometry]}):layoutResult||acceptedQuality({sceneMatches:!mismatch});
  return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
 }});
 const ids=[];for(const [i,c]of [110,210].entries()){const{key}=await api('upload',{bytes:solid(128,128,c),type:'image/png'});ids.push((await createCheckedInPlayer(api, {name:'本人'+i,number:String(i),photo:key})).player.id)}
 return{store,api,ids,requests,base,get analyzed(){return analyzed},get release(){return release}};
}
test('legacy face crops and head masks do not replace the two full original-photo inputs or alter the generated photo',async t=>{
 const f=await fixture(t),before=f.store.data.players.map(p=>fs.readFileSync(f.store.photoPath(p.photo)));
 f.store.commit(d=>{for(const p of d.players){p.facePhoto=p.photo;p.headCutout=p.photo;p.headSourceKey=p.photo;p.headGeometryVersion='auto-head-v6-refined'}return{}});
 const result=await f.api('ai/cover',{ids:f.ids});assert.equal(result.coverMethod,'whole-photo-v2');assert.equal(result.placements,undefined);assert.ok(result.sceneId);assert.equal(result.facePlacements,undefined);
 assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.base,'saved bytes remain the complete generated photo with no pasted original pixels');
 const request=f.requests.find(r=>r.input),images=request.input.messages[0].content.filter(c=>c.image);assert.deepEqual(images.map(c=>c.image),f.store.data.players.map(p=>f.store.photoData(p.photo)));assert.equal(images.length,2,'only the two full original references are used');
 assert.equal(request.parameters.prompt_extend,false);assert.equal(request.parameters.size,'1280*720');assert.equal(f.analyzed,0);
 f.store.data.players.forEach((p,i)=>assert.deepEqual(fs.readFileSync(f.store.photoPath(p.photo)),before[i]));
 const backup=f.store.exportBackup();for(const key of result.faceSources)assert.ok(backup.photos[key]);
});
test('a wrong scene is rejected instead of saving another generic beach cover',async t=>{const f=await fixture(t,{mismatch:true});await assert.rejects(f.api('ai/cover',{ids:f.ids}),/场景核对/);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0)});
test('a failed local matte stays retryable; a later successful reference is reused',async t=>{
 let calls=0;const f=await fixture(t,{headMatte:async raster=>({...raster,mattingApplied:++calls>1,warning:calls===1?'本地抠图暂未完成，可重试':''})});
 const first=await f.api('ai/head-reference',{id:f.ids[0]});assert.match(first.warning,/重试/);assert.notEqual(first.headGeometryVersion,'auto-head-v6-refined');
 const second=await f.api('ai/head-reference',{id:f.ids[0]});assert.equal(second.headGeometryVersion,'auto-head-v6-refined');assert.equal(second.referenceMethod,'automatic-head-matte');
 await f.api('ai/head-reference',{id:f.ids[0]});assert.equal(calls,2);
});
test('a superseded cover job cannot return an older scene after a newer request reserved another one',async t=>{
 const f=await fixture(t,{holdFirstImage:true});const older=f.api('ai/cover',{ids:f.ids});
 for(let n=0;n<50&&!f.release;n++)await new Promise(r=>setImmediate(r));assert.ok(f.release);
 await f.api('ai/cover',{ids:f.ids});f.release();await assert.rejects(older,/新生成|已失效/);
});
test('automatic selfie references tolerate a background person, missing outline, and normalized or pixel boxes',async t=>{
 const f=await fixture(t,{headResult:n=>n===1?{coordinate_system:'pixels',heads:[{bbox_xyxy:[0,0,12,28]},{bbox_xyxy:[25,5,120,125]}]}:{heads:[{box:[-.005,-.004,1.01,1.01]}]},layoutResult:{coordinate_system:'pixels',sceneMatches:true,heads:[{bbox_xyxy:[128,108,448,504]},{bbox_xyxy:[832,108,1152,504]}]}});
 for(const id of f.ids)await f.api('ai/head-reference',{id});assert.equal(f.analyzed,2);
 assert.ok(f.store.data.players.every(p=>p.headGeometryVersion==='auto-head-v4'));
 const first=codec.decode(fs.readFileSync(f.store.photoPath(f.store.data.players[0].headCutout)));assert.ok(first.width>80);assert.equal(first.data[(Math.floor(first.height/2)*first.width+Math.floor(first.width/2))*4],110,'the chosen prominent head still uses the original player pixels');
});
test('a saved manual reference is usable even when vision does not return a head; ordinary missing detections retry once',async t=>{
 const f=await fixture(t,{headResult:{heads:[]}});f.store.commit(d=>{for(const p of d.players)p.facePhoto=p.photo;return{}});
 for(const id of f.ids)await f.api('ai/head-reference',{id});assert.equal(f.analyzed,4,'at most two localization attempts per player');
 assert.ok(f.store.data.players.every(p=>p.headReferenceMethod==='manual-frame'));
 const noReference=await fixture(t,{headResult:{heads:[]}});await assert.rejects(noReference.api('ai/head-reference',{id:noReference.ids[0]}),/暂未找到可用头部/);assert.equal(noReference.analyzed,2);
 assert.equal(noReference.requests.filter(r=>r.input).length,0,'optional reference preparation does not generate a photo');
});
test('an old head cache is re-analyzed once after upgrading the tolerant localization algorithm',async t=>{
 const f=await fixture(t);for(const id of f.ids)await f.api('ai/head-reference',{id});assert.equal(f.analyzed,2);
 f.store.commit(d=>{d.players[0].headGeometryVersion='strict-v1';return{}});
 await f.api('ai/head-reference',{id:f.ids[0]});assert.equal(f.analyzed,3);assert.equal(f.store.data.players[0].headGeometryVersion,'auto-head-v4');
});
