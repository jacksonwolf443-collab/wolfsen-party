'use strict';

// This module localizes no identity and generates no pixels. Its caller supplies
// actual facial skin contours and eye/mouth centers in normalized_1000 units.
// Hair, ears, neck, clothing and all pixels outside both contours remain intact.
const EPS=1e-7;
const length=([x,y])=>Math.hypot(x,y);
const subtract=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function checkRaster(raster){
 if(!raster||!Number.isSafeInteger(raster.width)||!Number.isSafeInteger(raster.height)||raster.width<1||raster.height<1||raster.width*raster.height>25000000||!(raster.data instanceof Uint8Array)||raster.data.length!==raster.width*raster.height*4)throw Error('人脸照片像素无法读取或尺寸过大');
}
function segmentDistance(point,a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
 return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
}
function boundaryDistance(point,outline){
 let distance=Infinity;for(let i=0;i<outline.length;i++)distance=Math.min(distance,segmentDistance(point,outline[i],outline[(i+1)%outline.length]));return distance;
}
function inside(point,outline){
 let hit=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){
  const a=outline[i],b=outline[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }return hit;
}
function segmentIntersects(a,b,c,d){
 const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
 if(((ac>EPS&&ad< -EPS)||(ac< -EPS&&ad>EPS))&&((ca>EPS&&cb< -EPS)||(ca< -EPS&&cb>EPS)))return true;
 return Math.abs(ac)<EPS&&segmentDistance(c,a,b)<EPS||Math.abs(ad)<EPS&&segmentDistance(d,a,b)<EPS||Math.abs(ca)<EPS&&segmentDistance(a,c,d)<EPS||Math.abs(cb)<EPS&&segmentDistance(b,c,d)<EPS;
}
function area(outline){let total=0;for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];total+=a[0]*b[1]-a[1]*b[0]}return Math.abs(total)/2}
function bounds(outline){const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys);return{left,top,right:Math.max(...xs),bottom:Math.max(...ys)}}
function overlaps(a,b){
 const aa=bounds(a),bb=bounds(b);if(aa.right<bb.left||bb.right<aa.left||aa.bottom<bb.top||bb.bottom<aa.top)return false;
 if(inside(a[0],b)||inside(b[0],a))return true;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentIntersects(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;
 return false;
}
function faceGeometry(face,raster){
 const point=value=>{if(!Array.isArray(value)||value.length!==2||value.some(n=>!Number.isFinite(n)||n<0||n>1000))throw Error('人脸定位必须使用0至1000的坐标');return[value[0]*raster.width/1000,value[1]*raster.height/1000]};
 if(!face||!Array.isArray(face.outline))throw Error('缺少真实人脸轮廓定位');
 const raw=face.outline.map(point);if(raw.length>1&&length(subtract(raw[0],raw.at(-1)))<EPS)raw.pop();
 if(raw.length<6||raw.length>64)throw Error('人脸轮廓需要6至64个有序顶点，不能使用头部矩形');
 for(let i=0;i<raw.length;i++)for(let j=i+1;j<raw.length;j++){
  if(length(subtract(raw[i],raw[j]))<EPS)throw Error('人脸轮廓存在重复顶点');
  if(j===i+1||i===0&&j===raw.length-1)continue;
  if(segmentIntersects(raw[i],raw[(i+1)%raw.length],raw[j],raw[(j+1)%raw.length]))throw Error('人脸轮廓交叉，无法安全保留本人像素');
 }
 const eyeLeft=point(face.eyeLeft),eyeRight=point(face.eyeRight),mouth=point(face.mouth),eyeVector=subtract(eyeRight,eyeLeft),eyeDistance=length(eyeVector),box=bounds(raw),faceArea=area(raw),width=box.right-box.left,height=box.bottom-box.top;
 if(eyeDistance<6||eyeVector[0]<=0)throw Error('双眼定位过小或左右顺序错误');
 const angle=Math.atan2(eyeVector[1],eyeVector[0]);if(Math.abs(angle)>Math.PI/4)throw Error('人脸姿态倾斜过大，请使用接近正面的照片');
 if(width/eyeDistance<1.5||width/eyeDistance>3.8||height/eyeDistance<1.8||height/eyeDistance>4.8||faceArea/(width*height)<.48||faceArea/(width*height)>.94)throw Error('人脸轮廓比例无效，不能使用整颗头部或矩形');
 if([eyeLeft,eyeRight,mouth].some(p=>!inside(p,raw)))throw Error('双眼或嘴部定位不在人脸轮廓内');
 const center=[(eyeLeft[0]+eyeRight[0])/2,(eyeLeft[1]+eyeRight[1])/2],mouthVector=subtract(mouth,center),mouthX=(mouthVector[0]*Math.cos(angle)+mouthVector[1]*Math.sin(angle))/eyeDistance,mouthY=(-mouthVector[0]*Math.sin(angle)+mouthVector[1]*Math.cos(angle))/eyeDistance;
 if(Math.abs(mouthX)>.4||mouthY<.35||mouthY>1.8)throw Error('嘴部定位或人脸姿态不适合原像素合成');
 return{outline:raw,eyeLeft,eyeRight,mouth,center,eyeDistance,angle,area:faceArea,mouthX,mouthY};
}

function validateFaceRegion(raster,face){
 checkRaster(raster);const geometry=faceGeometry(face,raster),box=bounds(geometry.outline);
 // Validate the entire visible face before paid generation. A translucent
 // source edge can become a core pixel when enlarged; reject it up front.
 for(let y=Math.floor(box.top);y<Math.ceil(box.bottom);y++)for(let x=Math.floor(box.left);x<Math.ceil(box.right);x++)if(raster.data[(y*raster.width+x)*4+3]!==255&&inside([x+.5,y+.5],geometry.outline))throw Error('原脸像素不完整，请使用不透明的原照片');
 return{outline:face.outline.map(p=>[...p]),eyeLeft:[...face.eyeLeft],eyeRight:[...face.eyeRight],mouth:[...face.mouth]};
}
function landmarkSimilarity(source,target){
 const originals=[source.eyeLeft,source.eyeRight,source.mouth],destinations=[target.eyeLeft,target.eyeRight,target.mouth],center=points=>[0,1].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/points.length),sourceCenter=center(originals),targetCenter=center(destinations);
 let dot=0,turn=0,denominator=0;
 for(let i=0;i<originals.length;i++){const x=originals[i][0]-sourceCenter[0],y=originals[i][1]-sourceCenter[1],u=destinations[i][0]-targetCenter[0],v=destinations[i][1]-targetCenter[1];dot+=x*u+y*v;turn+=x*v-y*u;denominator+=x*x+y*y}
 // Least squares over all three landmarks supplies one rotation and one scale.
 // Intrinsic face proportions remain original; there is no facial warping.
 const a=dot/denominator,b=turn/denominator,scale=Math.hypot(a,b),angle=Math.atan2(b,a),forward=([x,y])=>[targetCenter[0]+a*(x-sourceCenter[0])-b*(y-sourceCenter[1]),targetCenter[1]+b*(x-sourceCenter[0])+a*(y-sourceCenter[1])],landmarkResiduals=originals.map((p,i)=>length(subtract(forward(p),destinations[i])));
 return{scale,angle,forward,sourceCenter,targetCenter,landmarkResiduals,originals,destinations};
}
function compositeFaceRegions(background,sources,sourceFaces,targetFaces){
 checkRaster(background);
 if(!Array.isArray(sources)||sources.length<1||sources.length>8||!Array.isArray(sourceFaces)||!Array.isArray(targetFaces)||sources.length!==sourceFaces.length||sources.length!==targetFaces.length)throw Error('原照片、原脸定位和目标人脸定位数量不一致');
 sources.forEach(checkRaster);
 const originals=sources.map((r,i)=>faceGeometry(sourceFaces[i],r)),targets=targetFaces.map(f=>faceGeometry(f,background));
 for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++)if(overlaps(targets[i].outline,targets[j].outline))throw Error('目标人脸定位重复或重叠，请重新生成合照');
 const data=Buffer.from(background.data),placements=[];
 for(let index=0;index<sources.length;index++){
  const source=sources[index],s=originals[index],t=targets[index],fit=landmarkSimilarity(s,t),{scale,angle,forward,sourceCenter,targetCenter,landmarkResiduals}=fit,cos=Math.cos(angle),sin=Math.sin(angle);
  if(scale<.025||scale>4)throw Error('原脸与目标人脸缩放比例过大，请重新生成自然大小的合照');
  if(Math.abs(angle)>Math.PI/6||landmarkResiduals.some(error=>error>t.eyeDistance*.18))throw Error('原脸与目标人脸姿态不匹配，五官无法自然对齐');
  const mapped=s.outline.map(forward),mappedArea=s.area*scale*scale,areaRatio=mappedArea/t.area;
  if(areaRatio<.62||areaRatio>1.62)throw Error('原脸与目标人脸轮廓比例不匹配');
  const box=bounds(t.outline),featherWidth=Math.max(1,Math.min(3,t.eyeDistance*.06));
  const clearOfEdge=point=>inside(point,t.outline)&&inside(point,mapped)&&Math.min(boundaryDistance(point,t.outline),boundaryDistance(point,mapped))>=featherWidth+1;
  const coreSamples=point=>{
   for(let y=Math.floor(point[1]-.5);y<=Math.ceil(point[1]-.5);y++)for(let x=Math.floor(point[0]-.5);x<=Math.ceil(point[0]-.5);x++){
    const pixel=[x+.5,y+.5],dx=pixel[0]-targetCenter[0],dy=pixel[1]-targetCenter[1],sourcePoint=[sourceCenter[0]+(cos*dx+sin*dy)/scale,sourceCenter[1]+(-sin*dx+cos*dy)/scale],sample=[Math.floor(sourcePoint[0])+.5,Math.floor(sourcePoint[1])+.5];
    if(!inside(pixel,t.outline)||!inside(sourcePoint,s.outline)||!inside(sample,s.outline)||Math.min(boundaryDistance(pixel,t.outline),boundaryDistance(sourcePoint,s.outline)*scale,boundaryDistance(sample,s.outline)*scale)<featherWidth)return false;
   }
   return true;
  };
  // A continuous landmark can be clear while nearest-neighbor rounding moves
  // its sampled pixel into the feather band, especially during enlargement.
  if([...fit.originals.map(forward),...fit.destinations].some(point=>!clearOfEdge(point)||!coreSamples(point)))throw Error('原脸或目标五官靠近轮廓边界，无法完整保留原始五官像素');
  let copiedPixels=0,featheredPixels=0,targetPixels=0,intersectionPixels=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(let y=Math.max(0,Math.floor(box.top));y<Math.min(background.height,Math.ceil(box.bottom));y++)for(let x=Math.max(0,Math.floor(box.left));x<Math.min(background.width,Math.ceil(box.right));x++){
   const targetPoint=[x+.5,y+.5];if(!inside(targetPoint,t.outline))continue;targetPixels++;
   const dx=targetPoint[0]-targetCenter[0],dy=targetPoint[1]-targetCenter[1],sx=sourceCenter[0]+(cos*dx+sin*dy)/scale,sy=sourceCenter[1]+(-sin*dx+cos*dy)/scale,sampleX=Math.floor(sx),sampleY=Math.floor(sy),sample=[sampleX+.5,sampleY+.5];
   if(sampleX<0||sampleY<0||sampleX>=source.width||sampleY>=source.height||!inside([sx,sy],s.outline)||!inside(sample,s.outline))continue;
   intersectionPixels++;
   const from=(sampleY*source.width+sampleX)*4,to=(y*background.width+x)*4,edgeDistance=Math.min(boundaryDistance(targetPoint,t.outline),boundaryDistance([sx,sy],s.outline)*scale,boundaryDistance(sample,s.outline)*scale),opacity=Math.min(1,edgeDistance/featherWidth);
   if(opacity<=0)continue;
   if(opacity>=1){
    // Core channels are copied verbatim. No interpolation, recoloring, smoothing
    // or alpha blending may alter the original person's facial pixels.
    if(source.data[from+3]!==255)throw Error('原脸核心像素不完整，请使用不透明的原照片');
    for(let channel=0;channel<4;channel++)data[to+channel]=source.data[from+channel];copiedPixels++;
   }else{
    const alpha=opacity*source.data[from+3]/255;if(alpha<=0)continue;
    const destinationAlpha=background.data[to+3]/255,outAlpha=alpha+destinationAlpha*(1-alpha);
    for(let channel=0;channel<3;channel++)data[to+channel]=Math.round((source.data[from+channel]*alpha+background.data[to+channel]*destinationAlpha*(1-alpha))/outAlpha);
    data[to+3]=Math.round(outAlpha*255);featheredPixels++;
   }
   left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
  }
  const targetCoverage=intersectionPixels/targetPixels,sourceCoverage=Math.min(1,intersectionPixels/mappedArea);
  if(copiedPixels<12||targetCoverage<.68||sourceCoverage<.68)throw Error('原脸与目标轮廓有效重合不足，已停止合成以保留本人完整面部');
  placements.push({sourceIndex:index,scale,rotationDegrees:angle*180/Math.PI,sourceEyeDistance:s.eyeDistance,targetEyeDistance:t.eyeDistance,mouthAlignmentError:landmarkResiduals[2],landmarkResiduals,maxLandmarkError:Math.max(...landmarkResiduals),copiedPixels,featheredPixels,totalPixels:copiedPixels+featheredPixels,sourceCoverage,targetCoverage,featherWidth,left,top,width:right-left,height:bottom-top});
 }
 return{width:background.width,height:background.height,data,placements};
}
module.exports={compositeFaceRegions,validateFaceRegion};
