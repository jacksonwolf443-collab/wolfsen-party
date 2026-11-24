'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createBackend}=require('../desktop/store.cjs'),{codec,solid}=require('./helpers/raster-fixture.cjs'),{createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
async function fixture(t,{imageCodec=codec,generated=solid(1280,720,7),review={sceneMatches:true,completePeople:true,naturalBlend:true},reviewError=false,onReview}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whole-photo-cover119-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),calls=[],url='https://test.aliyuncs.com/whole-photo.png';
 const api=createBackend(store,{getAIKey:()=> 'test-only-placeholder',imageCodec,
  faceLocalizer:()=>assert.fail('whole-photo generation must not locate or paste source faces'),headMatte:()=>assert.fail('whole-photo generation must not matte a source head'),
  fetcher:async(endpoint,options)=>{if(endpoint===url)return new Response(generated);const body=JSON.parse(options.body);calls.push({endpoint,body});if(body.input)return Response.json({output:{choices:[{message:{content:[{image:url}]}}]}});if(onReview)await onReview(store);if(reviewError)return Response.json({error:{code:'InvalidModel',message:'review unavailable'}},{status:400});return Response.json({choices:[{message:{content:typeof review==='string'?review:JSON.stringify(review)}}]})}});
 await api('ai/settings',{region:'singapore',workspace:'saved-workspace',imageModel:'qwen-image-2.1-turbo',visionModel:'configured-review-model'});
 const ids=[];for(const[i,colour]of [110,210].entries()){const raster=codec.decode(solid(128,160,colour));
  // A literal dark phone rectangle covers the source nose/mouth. It remains a valid reference.
  for(let y=64;y<146;y++)for(let x=44;x<96;x++)raster.data.fill(0,(y*128+x)*4,(y*128+x)*4+3);
  const photo=(await api('upload',{bytes:codec.encode(raster),type:'image/png'})).key;
  ids.push((await createCheckedInPlayer(api,{name:'本人'+i,number:String(i+1),photo})).player.id);
 }
 return{store,api,ids,calls,generated};
}
test('phone-covered full originals generate one coherent photo without face visibility, landmarks, crop boards or pixel replacement',async t=>{
 const f=await fixture(t),before=structuredClone(f.store.data.players),aiBefore=structuredClone(f.store.data.ai),originals=before.map(p=>fs.readFileSync(f.store.photoPath(p.photo)));
 const result=await f.api('ai/cover',{ids:f.ids});
 assert.equal(result.coverMethod,'whole-photo-v2');assert.equal(result.facePlacements,undefined);assert.equal(result.quality.originalFacePixels,undefined);
 assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.generated,'the model whole-photo bytes must be saved without copying or patching any face');
 assert.deepEqual(f.store.data.players,before);assert.deepEqual(f.store.data.ai,aiBefore);before.forEach((p,i)=>assert.deepEqual(fs.readFileSync(f.store.photoPath(p.photo)),originals[i]));
 const generation=f.calls.find(c=>c.body.input),images=generation.body.input.messages[0].content.filter(c=>c.image);
 assert.equal(images.length,2);images.forEach((c,i)=>assert.equal(c.image,f.store.photoData(before[i].photo)));assert.equal(generation.body.model,'qwen-image-2.1-turbo');
 assert.equal(generation.endpoint,'https://saved-workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
 assert.equal(generation.body.parameters.negative_prompt,undefined,'keep chosen model compatibility');assert.equal(f.calls.length,2,'only generation and final structural review are needed');
 const review=f.calls.find(c=>c.body.messages);assert.equal(review.body.model,'configured-review-model');assert.equal(review.body.messages[0].content.find(c=>c.type==='image_url').image_url.url,'data:image/png;base64,'+f.generated.toString('base64'));
});
test('a decode-only validator is sufficient because no output raster is composited or re-encoded',async t=>{
 const f=await fixture(t,{imageCodec:{decode:codec.decode}}),result=await f.api('ai/cover',{ids:f.ids});assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.generated);
});
test('a failed or unreadable structural checker preserves a valid whole photo without paid regeneration or claiming a completed review',async t=>{
 for(const options of [{reviewError:true},{review:'not valid JSON'},{review:{}}]){const f=await fixture(t,options),result=await f.api('ai/cover',{ids:f.ids});assert.deepEqual(fs.readFileSync(f.store.photoPath(result.photo)),f.generated);assert.equal(result.quality.reviewStatus,'unavailable');assert.equal(result.quality.completePeople,undefined);assert.equal(f.calls.filter(c=>c.body.input).length,1)}
});
test('an explicit major structural defect remains retryable and is never saved as an accepted photo',async t=>{
 for(const defect of ['sceneMatches','completePeople','naturalBlend']){const f=await fixture(t,{review:{sceneMatches:true,completePeople:true,naturalBlend:true,[defect]:false}});await assert.rejects(f.api('ai/cover',{ids:f.ids}),e=>e.status===503);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0)}
});
test('a plausible image signature cannot make malformed or truncated model bytes pass the image decoder',async t=>{
 const invalid=[Buffer.from([137,80,78,71,13,10,26,10]),solid(1280,720,7).subarray(0,40)];
 for(const generated of invalid){const f=await fixture(t,{generated,reviewError:true});await assert.rejects(f.api('ai/cover',{ids:f.ids}),/无法读取/);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0);assert.equal(f.calls.length,1,'malformed bytes never reach the optional review')}
});
test('an unavailable review cannot bypass photo, attendance, reset or newer-request guards',async t=>{
 for(const change of ['photo','attendance','reset','new-request']){const f=await fixture(t,{reviewError:true,onReview:store=>{if(change==='photo')store.data.players[0].photo='changed.png';if(change==='attendance')store.data.players[0].attendance='away';if(change==='reset')store.data.coverSceneAssignments={};if(change==='new-request'){const key=[...store.data.players.map(p=>p.id)].sort().join('|');store.data.coverSceneAssignments[key]='new-scene'}}});await assert.rejects(f.api('ai/cover',{ids:f.ids}),/照片已更换|未到|已离场|已失效|旧结果/);assert.equal(fs.readdirSync(f.store.photos).filter(n=>n.startsWith('cover-')).length,0)}
});
