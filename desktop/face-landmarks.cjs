'use strict';
// Local geometric landmarks only. This model produces no identity embedding,
// comparison, regenerated face or persistent player data.
const fs=require('node:fs'),path=require('node:path');
const {detectFace}=require('./head-matting.cjs');
const {extractHead,boxPixels}=require('./original-heads.cjs');
const models=new Map(),SIZE=192;
// Google MediaPipe semantic connections: lower face oval and upper eyebrows.
// Deliberately omit forehead/hairline oval points rather than guessing skin.
const SKIN_OUTLINE=[127,234,93,132,58,172,136,150,149,176,148,152,377,400,378,379,365,397,288,361,323,454,356,300,293,334,296,336,107,66,105,63,70];
// On a three-quarter face the projected nose and lips can extend beyond the
// mesh's oval. Include their measured silhouette; no forehead/hair points enter.
const SKIN_FEATURES=[1,2,98,327,97,326,168,6,61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
function skinHull(points){
 const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),unique=sorted.filter((p,i)=>!i||p[0]!==sorted[i-1][0]||p[1]!==sorted[i-1][1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[];
 for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
 for(const p of unique.toReversed()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function checkRaster(r){if(!r||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width*r.height>25000000||r.data?.length!==r.width*r.height*4)throw Error('本地面部关键点无法读取照片像素')}
function sample(r,x,y,channel){
 x=Math.max(0,Math.min(r.width-1,x));y=Math.max(0,Math.min(r.height-1,y));const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(r.width-1,x0+1),y1=Math.min(r.height-1,y0+1),dx=x-x0,dy=y-y0;
 const at=(px,py)=>r.data[(py*r.width+px)*4+channel];return at(x0,y0)*(1-dx)*(1-dy)+at(x1,y0)*dx*(1-dy)+at(x0,y1)*(1-dx)*dy+at(x1,y1)*dx*dy;
}
function landmarkInput(r,bbox,{pixelFormat='BGRA',rotation=0}={}){
 checkRaster(r);if(!Array.isArray(bbox)||bbox.length!==4||bbox.some(n=>!Number.isFinite(n))||bbox[2]-bbox[0]<8||bbox[3]-bbox[1]<8||!Number.isFinite(rotation))throw Error('本地人脸框太小或无效');
 const center=[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2],side=Math.max(bbox[2]-bbox[0],bbox[3]-bbox[1])*1.5,cos=Math.cos(rotation),sin=Math.sin(rotation),data=new Float32Array(SIZE*SIZE*3),channels=pixelFormat==='RGBA'?[0,1,2]:[2,1,0];
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const dx=(x/SIZE-.5)*side,dy=(y/SIZE-.5)*side,sx=center[0]+cos*dx-sin*dy,sy=center[1]+sin*dx+cos*dy;for(let c=0;c<3;c++)data[(y*SIZE+x)*3+c]=sample(r,sx,sy,channels[c])/255}
 return{data,dims:[1,SIZE,SIZE,3],transform:{center,side,rotation}};
}
function decodeLandmarks(output,{center,side,rotation}){
 if(!output||output.length!==468*3||Array.from(output).some(n=>!Number.isFinite(n)))throw Error('本地468面部关键点返回无效');const cos=Math.cos(rotation),sin=Math.sin(rotation),points=[];
 for(let i=0;i<468;i++){const dx=(output[i*3]/SIZE-.5)*side,dy=(output[i*3+1]/SIZE-.5)*side;points.push([center[0]+cos*dx-sin*dy,center[1]+sin*dx+cos*dy])}return points;
}
function faceGeometryMesh(points,width,height){
 if(!Array.isArray(points)||points.length!==468||points.some(p=>!Array.isArray(p)||p.length<2||p.slice(0,2).some(n=>!Number.isFinite(n))))throw Error('本地468面部关键点无法读取');
 const point=p=>[p[0]*1000/width,p[1]*1000/height],mid=(a,b)=>point([(points[a][0]+points[b][0])/2,(points[a][1]+points[b][1])/2]),eyes=[mid(33,133),mid(263,362)].sort((a,b)=>a[0]-b[0]),geometry={outline:skinHull([...SKIN_OUTLINE,...SKIN_FEATURES].map(i=>point(points[i]))),eyeLeft:eyes[0],eyeRight:eyes[1],mouth:mid(13,14),geometryMethod:'local-facemesh-v1'};
 if([...geometry.outline,geometry.eyeLeft,geometry.eyeRight,geometry.mouth].some(p=>p.some(n=>n<0||n>1000)))throw Error('本地面部轮廓超出照片，无法保留完整原脸');
 return geometry;
}
function defaultModelPath(){const packaged=process.resourcesPath&&path.join(process.resourcesPath,'models','facemesh','model.json');return packaged&&fs.existsSync(packaged)?packaged:path.join(__dirname,'..','assets','models','facemesh','model.json')}
async function loadModel(modelPath,tf){
 if(!models.has(modelPath)){const task=(async()=>{await tf.setBackend('cpu');await tf.ready();const json=JSON.parse(fs.readFileSync(modelPath,'utf8')),base=path.dirname(path.resolve(modelPath)),weights=Buffer.concat(json.weightsManifest.flatMap(group=>group.paths.map(file=>{const resolved=path.resolve(base,file);if(!resolved.startsWith(base+path.sep))throw Error('本地面部模型权重路径无效');return fs.readFileSync(resolved)})));return tf.loadGraphModel(tf.io.fromMemory({modelTopology:json.modelTopology,weightSpecs:json.weightsManifest.flatMap(group=>group.weights),weightData:weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength)}))})();models.set(modelPath,task);void task.catch(()=>{if(models.get(modelPath)===task)models.delete(modelPath)})}return models.get(modelPath);
}
async function localizeFace(r,options={}){
 checkRaster(r);const tf=options.tf||require('@tensorflow/tfjs'),detector=options.detectFace||detectFace;let prediction=options.facePrediction;
 if(!prediction&&options.headBox){const box=boxPixels(options.headBox,r.width,r.height),found=await detector(extractHead(r,{box:options.headBox}),options),offset=p=>[p[0]+box.x,p[1]+box.y];if(found)prediction={...found,topLeft:offset(found.topLeft),bottomRight:offset(found.bottomRight),landmarks:found.landmarks?.map(offset)}}
 else if(!prediction)prediction=await detector(r,options);
 if(!prediction?.topLeft||!prediction?.bottomRight)throw Error('本地未找到可靠人脸，请使用五官清楚的本人原照');
 let rotation=0;if(prediction.landmarks?.length>=2){const eyes=prediction.landmarks.slice(0,2).sort((a,b)=>a[0]-b[0]);rotation=Math.atan2(eyes[1][1]-eyes[0][1],eyes[1][0]-eyes[0][0])}
 const prepared=landmarkInput(r,[...prediction.topLeft,...prediction.bottomRight],{...options,rotation}),model=options.model||await loadModel(options.modelPath||defaultModelPath(),tf),input=tf.tensor4d(prepared.data,prepared.dims);let outputs;
 try{outputs=model.execute(input,['Identity_1','Identity_2']);const confidence=(await outputs[0].data())[0];if(!Number.isFinite(confidence)||confidence<(options.minConfidence??.8))throw Error('本地面部关键点置信度不足，不能可靠提取原脸');const points=decodeLandmarks(await outputs[1].data(),prepared.transform);return{...faceGeometryMesh(points,r.width,r.height),landmarks:points.map(p=>[p[0]*1000/r.width,p[1]*1000/r.height]),confidence}}finally{input.dispose();if(outputs)tf.dispose(outputs)}
}
module.exports={localizeFace,landmarkInput,decodeLandmarks,faceGeometryMesh,defaultModelPath};
