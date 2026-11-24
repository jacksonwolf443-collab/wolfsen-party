'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const raster=(width,height)=>{const data=Buffer.alloc(width*height*4);for(let i=0;i<data.length;i+=4)data.set([10,20,30,255],i);return{width,height,data}};
test('local FaceMesh preprocessing uses official192 RGB[0,1], square1.5crop, replicated padding and matching inverse coordinates',()=>{
 const {landmarkInput,decodeLandmarks}=require('../desktop/face-landmarks.cjs'),source=raster(192,192),before=Buffer.from(source.data),input=landmarkInput(source,[0,0,192,192]);assert.deepEqual(input.dims,[1,192,192,3]);const at=(96*192+96)*3;assert(Math.abs(input.data[at]-30/255)<1e-7);assert(Math.abs(input.data[at+1]-20/255)<1e-7);assert(Math.abs(input.data[at+2]-10/255)<1e-7);assert.equal(input.data[0],input.data[at],'official replicated padding retains the nearest original edge color');
 const output=new Float32Array(1404);for(let i=0;i<468;i++){output[i*3]=96;output[i*3+1]=96}output[0]=48;output[1]=144;const points=decodeLandmarks(output,input.transform);assert.deepEqual(points[0],[24,168]);assert.deepEqual(points[1],[96,96]);assert.deepEqual(source.data,before);
});
test('468-point skin geometry follows measured jaw and eyebrow chains without inventing forehead or hairline corners',()=>{
 const {faceGeometryMesh}=require('../desktop/face-landmarks.cjs'),points=Array.from({length:468},()=>[50,50]);points[33]=[30,40];points[133]=[40,40];points[362]=[60,42];points[263]=[70,42];points[13]=[49,64];points[14]=[51,66];points[152]=[50,88];points[127]=[20,38];points[356]=[80,38];points[70]=[25,28];points[300]=[75,28];points[10]=[10,10];
 const geometry=faceGeometryMesh(points,100,100);assert.deepEqual(geometry.eyeLeft,[350,400]);assert.deepEqual(geometry.eyeRight,[650,420]);assert.deepEqual(geometry.mouth,[500,650]);assert(geometry.outline.some(p=>p[0]===500&&p[1]===880));assert(geometry.outline.some(p=>p[0]===750&&p[1]===280));assert(!geometry.outline.some(p=>p[1]===100),'foreheadoval/hairline point10 never enters the skin mask');assert.equal(geometry.geometryMethod,'local-facemesh-v1');
 assert.throws(()=>faceGeometryMesh(points.slice(0,467),100,100),/468|关键点/);points[33]=[NaN,40];assert.throws(()=>faceGeometryMesh(points,100,100),/关键点/);
});
test('measured nose silhouette remains inside the local mask for a three-quarter face instead of cutting through visible lips',()=>{
 const {faceGeometryMesh}=require('../desktop/face-landmarks.cjs'),points=Array.from({length:468},()=>[50,50]);for(const i of [127,234,93])points[i]=[20,50];for(const i of [356,454,323])points[i]=[75,50];points[70]=[25,25];points[300]=[70,25];points[152]=[50,90];points[1]=[90,60];points[13]=[80,65];points[14]=[80,67];
 const geometry=faceGeometryMesh(points,100,100);assert(geometry.outline.some(p=>p[0]===900&&p[1]===600),'mask must include the actually measured projecting nose silhouette');
});
test('bundled local FaceMesh graph runs without network and rejects absent faces while releasing inference tensors',async()=>{
 const {localizeFace}=require('../desktop/face-landmarks.cjs'),tf=require('@tensorflow/tfjs'),source=raster(192,192),before=Buffer.from(source.data),facePrediction={topLeft:[32,32],bottomRight:[160,160],landmarks:[[70,80],[120,80]]};await assert.rejects(localizeFace(source,{facePrediction}),/置信度/);const count=tf.memory().numTensors;await assert.rejects(localizeFace(source,{facePrediction}),/置信度/);assert.equal(tf.memory().numTensors,count);assert.deepEqual(source.data,before);
});
test('local mesh selects a coarse normalized head box and returns landmarks in full raster coordinates',async()=>{
 const {localizeFace}=require('../desktop/face-landmarks.cjs'),tf=require('@tensorflow/tfjs'),source=raster(200,100),output=new Float32Array(468*3);for(let i=0;i<468;i++){output[i*3]=96;output[i*3+1]=96}
 let detected;const result=await localizeFace(source,{headBox:[500,0,500,1000],detectFace:async crop=>{detected=[crop.width,crop.height];return{topLeft:[20,10],bottomRight:[80,90],landmarks:[[35,35],[65,35]]}},model:{execute:()=>[tf.scalar(.99),tf.tensor1d(output)]}});
 assert.deepEqual(detected,[100,100]);assert.deepEqual(result.eyeLeft,[750,500]);
});
