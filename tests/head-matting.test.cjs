const {test}=require('node:test'),assert=require('node:assert/strict');
const {createInput,applyMatte,segmentHead,refineHead}=require('../desktop/head-matting.cjs');
const portrait=(w,h)=>{const data=Buffer.alloc(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=15;data[i+1]=80;data[i+2]=210;data[i+3]=255}return{width:w,height:h,data}};
test('MODNet input converts native BGRA to RGB without altering the source portrait',()=>{
 const source=portrait(40,60),before=Buffer.from(source.data),input=createInput(source,32,64);
 assert.deepEqual(input.dims,[1,3,64,32]);assert.ok(Math.abs(input.data[0]-(210/127.5-1))<1e-6);assert.ok(Math.abs(input.data[32*64]-(80/127.5-1))<1e-6);assert.ok(Math.abs(input.data[32*64*2]-(15/127.5-1))<1e-6);assert.deepEqual(source.data,before);
});
test('matting removes the portrait background while retaining original face and hair colors exactly',()=>{
 const source=portrait(64,64),before=Buffer.from(source.data),mask=new Float32Array(64*64);
 for(let y=6;y<60;y++)for(let x=12;x<53;x++)mask[y*64+x]=x===12?.18:.8;
 // A detached background object must not be copied into the new scene.
 for(let y=2;y<5;y++)for(let x=1;x<4;x++)mask[y*64+x]=.9;
 const result=applyMatte(source,{data:mask,dims:[1,1,64,64]});assert.equal(result.mattingApplied,true);
 assert.equal(result.data[3],0);assert.equal(result.data[(3*64+2)*4+3],0);assert.equal(result.data[(30*64+30)*4+3],255);
 assert.ok(result.data[(20*64+12)*4+3]>0,'fine hair/soft foreground edges remain');
 for(let i=0;i<source.data.length;i+=4)assert.deepEqual(result.data.subarray(i,i+3),source.data.subarray(i,i+3),'RGB is always copied verbatim, never generated, retouched or recolored');assert.deepEqual(source.data,before);
});
test('empty or invalid masks preserve the original reference with an explicit warning',()=>{
 const source=portrait(32,32),result=applyMatte(source,{data:new Float32Array(32*32),dims:[1,1,32,32]});assert.equal(result.mattingApplied,false);assert.match(result.warning,/保留原图/);assert.deepEqual(result.data,source.data);
 assert.throws(()=>applyMatte(source,{data:Float32Array.from([NaN]),dims:[1,1,1,1]}),/蒙版/);
});
test('segmentHead respects model input metadata and falls back safely when local inference fails',async()=>{
 const source=portrait(40,60),matte=Float32Array.from({length:32*64},(_,i)=>i%32>5&&i%32<27?.9:0);let feed;
 const session={inputNames:['portrait'],outputNames:['alpha'],inputMetadata:[{shape:[1,3,64,32]}],run:async feeds=>{feed=feeds.portrait;return{alpha:{data:matte,dims:[1,1,64,32]}}}};
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims})}}
 const result=await segmentHead(source,{session,runtime:{Tensor}});assert.deepEqual(feed.dims,[1,3,64,32]);assert.equal(result.mattingApplied,true);
 const failed=await segmentHead(source,{session:{...session,run:async()=>{throw Error('local test failure')}},runtime:{Tensor}});assert.equal(failed.mattingApplied,false);assert.match(failed.warning,/保留原图/);assert.deepEqual(failed.data,source.data);
});
test('landmark refinement removes shirt and chair foreground while preserving the real face core and source colors',()=>{
 const source=portrait(180,240);source.mattingApplied=true;
 const face={topLeft:[47,45],bottomRight:[136,155],landmarks:[[69,85],[111,95],[86,115],[82,135],[40,101],[139,123]],probability:[.99]};
 const result=refineHead(source,face);assert.equal(result.refinementApplied,true);assert.ok(result.height<source.height-30,'shoulders and shirt below the chin are excluded');
 const {left,top}=result.refinementBounds,inside=(x,y)=>x<left||y<top||x>=left+result.width||y>=top+result.height?0:result.data[((y-top)*result.width+x-left)*4+3];
 assert.equal(inside(5,170),0,'chair beside the jaw is excluded without narrowing the hair region');assert.equal(inside(90,225),0,'shirt well below the chin is excluded');
 for(const [x,y]of face.landmarks)assert.equal(inside(x,y),255,'eyes, nose, mouth and ears stay opaque');
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++)assert.deepEqual(result.data.subarray((y*result.width+x)*4,(y*result.width+x)*4+3),source.data.subarray(((top+y)*source.width+left+x)*4,((top+y)*source.width+left+x)*4+3));
 assert.equal(source.data[3],255,'source is unchanged');
});
