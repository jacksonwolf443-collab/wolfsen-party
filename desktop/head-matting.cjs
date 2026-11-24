'use strict';
const fs=require('node:fs'),path=require('node:path');
const sessions=new Map(),faceModels=new Map(),clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function validate(r){if(!r||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width*r.height>25000000||r.data?.length!==r.width*r.height*4)throw Error('头部原图像素无法读取')}
function original(r,warning){return{width:r.width,height:r.height,data:Buffer.from(r.data),mattingApplied:false,warning}}
function sample(data,width,height,x,y,channels=1,channel=0){
 x=clamp(x,0,width-1);y=clamp(y,0,height-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=x-x0,dy=y-y0;
 return data[(y0*width+x0)*channels+channel]*(1-dx)*(1-dy)+data[(y0*width+x1)*channels+channel]*dx*(1-dy)+data[(y1*width+x0)*channels+channel]*(1-dx)*dy+data[(y1*width+x1)*channels+channel]*dx*dy;
}
function createInput(r,width,height,{pixelFormat='BGRA'}={}){
 validate(r);const area=width*height,data=new Float32Array(area*3),channels=pixelFormat==='RGBA'?[0,1,2]:[2,1,0];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[c*area+y*width+x]=sample(r.data,r.width,r.height,(x+.5)*r.width/width-.5,(y+.5)*r.height/height-.5,4,channels[c])/127.5-1;
 return{data,dims:[1,3,height,width]};
}
function largestComponent(mask,width,height){
 const total=width*height,seen=new Uint8Array(total),queue=new Int32Array(total),keep=new Uint8Array(total);let best=0;
 for(let start=0;start<total;start++){
  if(seen[start]||mask[start]<.035)continue;let count=0,end=1;queue[0]=start;seen[start]=1;
  while(count<end){const index=queue[count++],x=index%width,y=Math.floor(index/width);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const next=ny*width+nx;if(!seen[next]&&mask[next]>=.035){seen[next]=1;queue[end++]=next}}
  }
  if(end>best){keep.fill(0);for(let i=0;i<end;i++)keep[queue[i]]=1;best=end}
 }
 return{keep,count:best};
}
function applyMatte(r,matte,{softEdges=false}={}){
 validate(r);const dims=matte?.dims,width=dims?.at(-1),height=dims?.at(-2),mask=matte?.data;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4000000||!mask||mask.length<width*height)throw Error('本机抠图蒙版无法读取');
 for(let i=0;i<width*height;i++)if(!Number.isFinite(Number(mask[i])))throw Error('本机抠图蒙版含无效像素');
 const component=largestComponent(mask,width,height);
 if(component.count<width*height*.015)return original(r,'自动抠图未找到可靠前景，已保留原图；可更换更清楚的照片后重试。');
 const filtered=new Float32Array(width*height);for(let i=0;i<filtered.length;i++)if(component.keep[i])filtered[i]=clamp(Number(mask[i]),0,1);
 const data=Buffer.from(r.data);let kept=0;
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  const value=sample(filtered,width,height,(x+.5)*width/r.width-.5,(y+.5)*height/r.height-.5),at=(y*r.width+x)*4;
  // A low, conservative threshold retains thin hair. The face core is opaque,
  // and binary alpha avoids premultiplication changing original face RGB.
  let alpha=value>=.075?255:0;
  if(softEdges&&value>=.035&&value<.45)alpha=Math.round(clamp((value-.035)/(.45-.035),0,1)*255);
  data[at+3]=Math.min(data[at+3],alpha);if(data[at+3])kept++;
 }
 if(kept<r.width*r.height*.015)return original(r,'自动抠图结果不完整，已保留原图；可更换更清楚的照片后重试。');
 return{width:r.width,height:r.height,data,mattingApplied:true,warning:component.count>width*height*.98?'原照片人物占比很高，保留了本人全部可见区域；边缘仍需检查。':''};
}
function inputSize(r,session){
 const metadata=Array.isArray(session.inputMetadata)?session.inputMetadata[0]:session.inputMetadata?.[session.inputNames[0]],shape=metadata?.shape||metadata?.dimensions;
 if(Number.isInteger(shape?.[2])&&Number.isInteger(shape?.[3]))return{width:shape[3],height:shape[2]};
 let width=r.width,height=r.height;if(Math.max(width,height)<512||Math.min(width,height)>512){const ratio=512/Math.min(width,height);width*=ratio;height*=ratio}
 if(Math.max(width,height)>1536){const ratio=1536/Math.max(width,height);width*=ratio;height*=ratio}
 return{width:Math.max(32,Math.floor(width/32)*32),height:Math.max(32,Math.floor(height/32)*32)};
}
function defaultModelPath(){
 const packaged=process.resourcesPath&&path.join(process.resourcesPath,'models','modnet_photographic.onnx');
 return packaged&&fs.existsSync(packaged)?packaged:path.join(__dirname,'..','assets','models','modnet_photographic.onnx');
}
function defaultFaceModelPath(){
 const packaged=process.resourcesPath&&path.join(process.resourcesPath,'models','blazeface','model.json');
 return packaged&&fs.existsSync(packaged)?packaged:path.join(__dirname,'..','assets','models','blazeface','model.json');
}
async function detectFace(r,{faceModelPath=defaultFaceModelPath(),pixelFormat='BGRA'}={}){
 validate(r);if(!fs.existsSync(faceModelPath))return null;
 const tf=require('@tensorflow/tfjs'),blaze=require('@tensorflow-models/blazeface');
 if(!faceModels.has(faceModelPath)){
  const pending=(async()=>{
   await tf.setBackend('cpu');await tf.ready();
   const definition=JSON.parse(fs.readFileSync(faceModelPath,'utf8')),base=path.dirname(faceModelPath),manifest=definition.weightsManifest||[],buffers=[];
   for(const group of manifest)for(const file of group.paths){const resolved=path.resolve(base,file);if(!resolved.startsWith(base+path.sep))throw Error('本地人脸模型权重路径无效');buffers.push(fs.readFileSync(resolved))}
   const joined=Buffer.concat(buffers),weightData=joined.buffer.slice(joined.byteOffset,joined.byteOffset+joined.byteLength);
   return blaze.load({modelUrl:tf.io.fromMemory({modelTopology:definition.modelTopology,weightSpecs:manifest.flatMap(group=>group.weights),weightData}),maxFaces:5,scoreThreshold:.45});
  })();faceModels.set(faceModelPath,pending);pending.catch(()=>{if(faceModels.get(faceModelPath)===pending)faceModels.delete(faceModelPath)});
 }
 const model=await faceModels.get(faceModelPath),scale=Math.min(1,512/Math.max(r.width,r.height)),width=Math.max(1,Math.round(r.width*scale)),height=Math.max(1,Math.round(r.height*scale)),data=new Uint8Array(width*height*3),channels=pixelFormat==='RGBA'?[0,1,2]:[2,1,0];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[(y*width+x)*3+c]=Math.round(sample(r.data,r.width,r.height,(x+.5)*r.width/width-.5,(y+.5)*r.height/height-.5,4,channels[c]));
 const tensor=tf.tensor3d(data,[height,width,3],'int32');let faces;try{faces=await model.estimateFaces(tensor,false,false,true)}finally{tensor.dispose()}
 faces=faces.filter(face=>Array.isArray(face.landmarks)&&face.landmarks.length>=6).sort((a,b)=>(b.bottomRight[0]-b.topLeft[0])*(b.bottomRight[1]-b.topLeft[1])-(a.bottomRight[0]-a.topLeft[0])*(a.bottomRight[1]-a.topLeft[1]));
 const face=faces[0];if(!face)return null;const point=p=>[p[0]*r.width/width,p[1]*r.height/height];
 return{topLeft:point(face.topLeft),bottomRight:point(face.bottomRight),landmarks:face.landmarks.map(point),probability:face.probability};
}
function refineHead(r,face){
 validate(r);const points=face?.landmarks;if(!Array.isArray(points)||points.length<6||points.some(p=>!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)))throw Error('本地面部关键点无法读取');
 let[eyeA,eyeB,nose,mouth,earA,earB]=points;if(eyeA[0]>eyeB[0])[eyeA,eyeB]=[eyeB,eyeA];
 const dx=eyeB[0]-eyeA[0],dy=eyeB[1]-eyeA[1],distance=Math.hypot(dx,dy);if(distance<4)throw Error('本地面部关键点过小');
 const origin=[(eyeA[0]+eyeB[0])/2,(eyeA[1]+eyeB[1])/2],u=[dx/distance,dy/distance];let v=[-u[1],u[0]];
 const dot=(p,axis)=>(p[0]-origin[0])*axis[0]+(p[1]-origin[1])*axis[1];if(dot(mouth,v)<0)v=v.map(n=>-n);
 const mouthY=dot(mouth,v),earWidth=Math.abs(dot(earA,u)-dot(earB,u)),radiusX=Math.max(distance*1.85,earWidth*.7),top=-distance*2.6,bottom=Math.max(distance*1.35,mouthY+distance*.5),centerY=(top+bottom)/2,radiusY=(bottom-top)/2;
 const alpha=Buffer.from(r.data);let left=r.width,right=-1,upper=r.height,lower=-1;
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  const point=[x+.5,y+.5],px=dot(point,u),py=dot(point,v),hairRadius=radiusX*(1+.12*clamp(-py/(distance*.7),0,1)),shape=Math.abs(px/hairRadius)**2.8+Math.abs((py-centerY)/radiusY)**2.8<=1,core=(px/(distance*1.03))**2+((py-mouthY*.38)/(distance*.99))**2<=1,at=(y*r.width+x)*4;
  if(!shape)alpha[at+3]=0;else if(core)alpha[at+3]=255;
  if(alpha[at+3]){left=Math.min(left,x);right=Math.max(right,x);upper=Math.min(upper,y);lower=Math.max(lower,y)}
 }
 // After removing shoulders, a piece of shirt or chair can become detached
 // beside the jaw. Remove detached lower fragments, while retaining separate
 // fine hair above the eye line instead of treating it as background noise.
 const silhouette=new Float32Array(r.width*r.height);for(let i=0;i<silhouette.length;i++)silhouette[i]=alpha[i*4+3]/255;
 const connected=largestComponent(silhouette,r.width,r.height);left=r.width;right=-1;upper=r.height;lower=-1;
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const index=y*r.width+x,at=index*4;if(alpha[at+3]&&!connected.keep[index]&&dot([x+.5,y+.5],v)>0)alpha[at+3]=0;if(alpha[at+3]){left=Math.min(left,x);right=Math.max(right,x);upper=Math.min(upper,y);lower=Math.max(lower,y)}}
 if(right-left<7||lower-upper<7)throw Error('本地头部精化未得到可靠区域');
 const width=right-left+1,height=lower-upper+1,data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++){const from=((upper+y)*r.width+left)*4;alpha.copy(data,y*width*4,from,from+width*4)}
 return{width,height,data,mattingApplied:r.mattingApplied??true,refinementApplied:true,refinementBounds:{left,top:upper,width,height},faceGeometry:{landmarks:points,eyeDistance:distance,rotationDeg:Math.atan2(u[1],u[0])*180/Math.PI,origin,radiusX,top,bottom},warning:''};
}
async function segmentHead(r,options={}){
 validate(r);
 try{
  const runtime=options.runtime||require('onnxruntime-node'),modelPath=options.modelPath||defaultModelPath();let session=options.session;
  if(!session){
   if(!fs.existsSync(modelPath))return original(r,'本机抠图模型暂不可用，已保留原图。');
   if(!sessions.has(modelPath)){const pending=runtime.InferenceSession.create(modelPath,{executionProviders:['cpu'],graphOptimizationLevel:'all',intraOpNumThreads:2,interOpNumThreads:1});sessions.set(modelPath,pending);pending.catch(()=>{if(sessions.get(modelPath)===pending)sessions.delete(modelPath)})}
   session=await sessions.get(modelPath);
  }
  const size=inputSize(r,session),input=createInput(r,size.width,size.height,options),feed=new runtime.Tensor('float32',input.data,input.dims),inference=await session.run({[session.inputNames[0]]:feed}),matte=inference[session.outputNames[0]];
  let result=applyMatte(r,matte,options);
  if(options.refineHead||options.facePrediction){
   try{const face=options.facePrediction||await detectFace(r,options);if(face)result=refineHead(result,face);else result={...result,refinementApplied:false,warning:'本机暂未定位到可靠面部关键点，已保留原有抠图；头部边缘需要检查。'}}catch{result={...result,refinementApplied:false,warning:'本机头部精化暂未完成，已保留原有抠图；头部边缘需要检查。'}}
  }
  return result;
 }catch{return original(r,'本机自动抠图暂未完成，已保留原图；可稍后重试或更换照片。')}
}
module.exports={segmentHead,createInput,applyMatte,defaultModelPath,defaultFaceModelPath,detectFace,refineHead};
