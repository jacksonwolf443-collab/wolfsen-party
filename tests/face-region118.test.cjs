'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const raster=(width,height,colour)=>{const data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;data.set(typeof colour==='function'?colour(x,y):colour,at)}return{width,height,data}};
// All coordinates are normalized_1000; outline follows facial skin, not hair/head.
const face=(dx=0,dy=0)=>({outline:[[400+dx,200+dy],[600+dx,200+dy],[700+dx,350+dy],[700+dx,600+dy],[600+dx,800+dy],[500+dx,850+dy],[400+dx,800+dy],[300+dx,600+dy],[300+dx,350+dy]],eyeLeft:[400+dx,400+dy],eyeRight:[600+dx,400+dy],mouth:[500+dx,650+dy]});
const pixel=(r,x,y)=>[...r.data.subarray((y*r.width+x)*4,(y*r.width+x+1)*4)];
test('face core copies exact original channels while a narrow inward edge feathers and hair/background stay unchanged',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[10,20,30,255]),source=raster(100,100,(x,y)=>[100+x,y,220,255]),before=Buffer.from(background.data),original=Buffer.from(source.data);
 const result=compositeFaceRegions(background,[source],[face()],[face()]);
 assert.deepEqual(pixel(result,50,55),pixel(source,50,55));
 assert.deepEqual(pixel(result,40,40),pixel(source,40,40));
 const edge=pixel(result,30,50);assert(edge[0]>10&&edge[0]<130,'only the contour boundary may blend with the generated image');
 for(const [x,y]of [[0,0],[50,10],[29,50],[70,50],[50,90],[35,25]])assert.deepEqual(pixel(result,x,y),pixel(background,x,y),'outside the face contour, including hair and rectangular corners, is untouched');
 for(let y=0;y<100;y++)for(let x=0;x<100;x++){
  const py=y+.5,px=x+.5,left=py<35?40-(py-20)*2/3:py<60?30:py<80?30+(py-60)/2:40+(py-80)*2;
  if(py<20||py>85||px<left||px>100-left)assert.deepEqual(pixel(result,x,y),pixel(background,x,y),'every pixel outside the actual facial contour remains unchanged');
 }
 assert.deepEqual(background.data,before);assert.deepEqual(source.data,original);
 assert(result.placements[0].copiedPixels>1000);assert(result.placements[0].featheredPixels>0);assert.equal(result.placements[0].scale,1);
});
test('eye anchors create a uniform rotated similarity transform and core pixels use nearest source samples without colour interpolation',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(200,200,[8,8,8,255]),source=raster(100,100,(x,y)=>[x,y,203,255]),s=face(),angle=Math.PI/12,scale=.8,project=([x,y])=>{const px=x/10-50,py=y/10-40;return[(100+scale*(Math.cos(angle)*px-Math.sin(angle)*py))*5,(80+scale*(Math.sin(angle)*px+Math.cos(angle)*py))*5]},target={outline:s.outline.map(project),eyeLeft:project(s.eyeLeft),eyeRight:project(s.eyeRight),mouth:project(s.mouth)};
 const result=compositeFaceRegions(background,[source],[s],[target]),placement=result.placements[0];assert(Math.abs(placement.scale-.8)<1e-10);assert(Math.abs(placement.rotationDegrees-15)<1e-8);
 for(const [x,y]of [[98,88],[102,92],[97,97]]){const tx=x+.5-100,ty=y+.5-80,sx=50+(Math.cos(angle)*tx+Math.sin(angle)*ty)/scale,sy=40+(-Math.sin(angle)*tx+Math.cos(angle)*ty)/scale;assert.deepEqual(pixel(result,x,y),pixel(source,Math.floor(sx),Math.floor(sy)))}
 assert.deepEqual(pixel(result,100,45),pixel(background,100,45),'generated hair above the forehead remains');
});
test('two independently placed facial regions preserve subject order and never erase pixels between faces',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(200,100,[7,7,7,255]),sources=[raster(100,100,[60,70,80,255]),raster(100,100,[160,170,180,255])],sourceFaces=[face(),face()],targetFaces=sourceFaces.map((f,i)=>({...f,outline:f.outline.map(([x,y])=>[x/2+i*500,y]),eyeLeft:[f.eyeLeft[0]/2+i*500,f.eyeLeft[1]],eyeRight:[f.eyeRight[0]/2+i*500,f.eyeRight[1]],mouth:[f.mouth[0]/2+i*500,f.mouth[1]]}));
 const result=compositeFaceRegions(background,sources,sourceFaces,targetFaces);assert.deepEqual(pixel(result,50,55),[60,70,80,255]);assert.deepEqual(pixel(result,150,55),[160,170,180,255]);assert.deepEqual(pixel(result,100,55),[7,7,7,255]);assert.deepEqual(result.placements.map(p=>p.sourceIndex),[0,1]);
});
test('invalid face contours, repeated vertices, duplicate targets, incompatible pose and extreme scaling are rejected',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[7,7,7,255]),source=raster(100,100,[100,100,100,255]),f=face(),call=(s=f,t=f)=>compositeFaceRegions(background,[source],[s],[t]);
 assert.throws(()=>call({...f,outline:[[300,200],[700,200],[700,850],[300,850]]}),/轮廓|定位/);
 assert.throws(()=>call({...f,outline:[...f.outline,f.outline[2]]}),/重复|轮廓/);
 assert.throws(()=>call({...f,eyeLeft:f.eyeRight}),/眼|定位/);
 assert.throws(()=>call({...f,mouth:[500,200]}),/嘴|姿态|定位/);
 assert.throws(()=>call(f,{...f,mouth:[680,650]}),/姿态|嘴|对齐/);
 assert.throws(()=>call({...f,outline:f.outline.map(([x,y])=>[500+(x-500)*.02,500+(y-500)*.02]),eyeLeft:[498,498],eyeRight:[502,498],mouth:[500,503]}),/小|缩放|定位/);
 assert.throws(()=>compositeFaceRegions(background,[source,source],[f,f],[f,f]),/重叠|重复/);
 assert.throws(()=>compositeFaceRegions(background,[source],[f],[]),/数量|定位/);
 assert.throws(()=>compositeFaceRegions(raster(500,500,[1,2,3,255]),[source],[f],[f]),/缩放/);
});
test('self-crossing outlines and incompatible face-to-eye proportions cannot paste a head-shaped rectangle',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[7,7,7,255]),source=raster(100,100,[100,100,100,255]),f=face();
 const crossed={...f,outline:[f.outline[0],f.outline[4],f.outline[2],f.outline[6],f.outline[1],f.outline[5],f.outline[8]]};assert.throws(()=>compositeFaceRegions(background,[source],[crossed],[f]),/轮廓/);
 const wide={...f,outline:f.outline.map(([x,y])=>[500+(x-500)*2,y])};assert.throws(()=>compositeFaceRegions(background,[source],[f],[wide]),/比例|轮廓|匹配/);
});
test('transparent facial core fails without changing any input instead of blending generated face pixels into the identity region',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[7,7,7,255]),source=raster(100,100,[100,120,140,255]),original=Buffer.from(background.data);source.data[(55*100+50)*4+3]=128;
 assert.throws(()=>compositeFaceRegions(background,[source],[face()],[face()]),/核心像素|不透明/);assert.deepEqual(background.data,original);assert.deepEqual(pixel(source,50,55),[100,120,140,128]);
});
test('source validation rejects translucent facial edge pixels before any later enlargement can turn them into a core defect',()=>{
 const {validateFaceRegion}=require('../desktop/face-region.cjs'),source=raster(200,200,[100,120,140,255]);source.data[(100*200+61)*4+3]=128;
 assert.throws(()=>validateFaceRegion(source,face()),/不透明|像素不完整/);
});
test('three-point uniform alignment preserves a long original face without forcing its intrinsic mouth ratio onto generated proportions',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[7,8,9,255]),source=raster(100,100,(x,y)=>[100+x,y,220,255]),base=face(),longFace={...base,outline:base.outline.map(([x,y])=>[x,400+(y-400)*1.3]),mouth:[500,750]},before=Buffer.from(background.data);
 const result=compositeFaceRegions(background,[source],[longFace],[base]),placement=result.placements[0];assert(Math.abs(placement.scale-47/61)<1e-9);assert(Math.abs(placement.rotationDegrees)<1e-9);assert(placement.landmarkResiduals.every(error=>error<=3.6));assert.deepEqual(pixel(result,50,60),pixel(source,50,67),'the face remains a uniformly transformed sample of original channels');assert.deepEqual(pixel(result,10,10),[7,8,9,255]);assert.deepEqual(background.data,before);
});
test('three-point alignment rejects severe proportions and keeps both original and generated landmarks clear of the feathered boundary',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),background=raster(100,100,[7,8,9,255]),source=raster(100,100,[100,120,140,255]),base=face(),longFace={...base,outline:base.outline.map(([x,y])=>[x,400+(y-400)*1.3]),mouth:[500,750]};
 assert.throws(()=>compositeFaceRegions(background,[source],[longFace],[{...base,mouth:[500,480]}]),/五官|对齐|姿态/);
 const narrowEdge={...base,outline:[[400,200],[600,200],[700,350],[700,600],[600,800],[500,850],[400,800],[390,600],[390,350]]};assert.throws(()=>compositeFaceRegions(background,[source],[base],[narrowEdge]),/五官|边界|轮廓/);
});
test('landmark clearance also checks actual nearest source sampling so enlarged edge pixels cannot feather an eye',()=>{
 const {compositeFaceRegions}=require('../desktop/face-region.cjs'),source=raster(100,100,[100,120,140,255]),background=raster(400,400,[7,8,9,255]),edge={outline:[[400,200],[600,200],[700,350],[700,600],[600,800],[500,850],[400,800],[398,600],[398,350]],eyeLeft:[409,400],eyeRight:[600,400],mouth:[500,650]};
 // The continuous eye center is 4.4 target pixels inside the contour, but its
 // nearest original sample is only 2.8 pixels inside a 3-pixel feather band.
 const gridBoundary={outline:[[400,200],[600,200],[710,350],[710,600],[600,800],[500,850],[400,800],[400,600],[400,350]],eyeLeft:[410,400],eyeRight:[610,400],mouth:[510,650]};
 for(const geometry of [edge,gridBoundary])assert.throws(()=>compositeFaceRegions(background,[source],[geometry],[geometry]),/五官|像素|边界/);
});
