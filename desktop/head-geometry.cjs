'use strict';
// Vision providers may return unit coordinates, 0..1000 coordinates, or pixels.
// Convert their metadata first; never confuse a failed detection with a guessed face.
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function roundedOutline([x,y,w,h]){
 // A model-supplied silhouette can cut straight through hair or a face even
 // when its total area looks plausible. Keep the entire rectangular region.
 return[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
}
function arrayBox(head){
 if(Array.isArray(head))return{values:head,format:'xywh'};
 if(!head||typeof head!=='object')throw Error('头部定位无法读取');
 for(const key of ['bbox_xyxy','box_xyxy'])if(Array.isArray(head[key]))return{values:head[key],format:'xyxy',explicitFormat:true};
 for(const key of ['box','bbox','bounds'])if(Array.isArray(head[key]))return{values:head[key],format:head.coordinate_format||head.box_format||head.bbox_format||(key==='bbox'?'xyxy':'xywh')};
 if(['x','y','width','height'].every(k=>Number.isFinite(head[k])))return{values:[head.x,head.y,head.width,head.height],format:'xywh',explicitFormat:true};
 if(['x1','y1','x2','y2'].every(k=>Number.isFinite(head[k])))return{values:[head.x1,head.y1,head.x2,head.y2],format:'xyxy',explicitFormat:true};
 throw Error('头部定位无法读取');
}
function normalizeHead(head,width,height,metadata={}){
 const raw=arrayBox(head),values=raw.values;if(values.length!==4||values.some(n=>!Number.isFinite(n)))throw Error('头部定位无效');
 const options={...metadata,...(Array.isArray(head)?{}:head)},system=String(options.coordinate_system||options.coordinateSystem||options.units||options.coordinate_units||'').toLowerCase();
 let sx=1,sy=1;
 if(/pixel|像素/.test(system)){sx=1000/width;sy=1000/height}
 else if(Number.isFinite(options.coordinate_scale)&&options.coordinate_scale>0){sx=sy=1000/options.coordinate_scale}
 else if(options.scale===1||['unit','normalized_0_1','normalized_0..1','0-1','0_1','0..1'].includes(system)||((!system||system==='normalized')&&Math.max(...values.map(Math.abs))<=1.5)){sx=sy=1000}
 let [x,y,w,h]=values,format=String(raw.explicitFormat?raw.format:options.coordinate_format||options.box_format||options.bbox_format||raw.format).toLowerCase();
 if(format.includes('xyxy')||format==='ltrb'){w-=x;h-=y}
 if(w<=0||h<=0)throw Error('头部定位无效');
 x*=sx;y*=sy;w*=sx;h*=sy;
 const coordinateOverflow=Math.max(0,-x,-y,x+w-1000,y+h-1000);
 // Accept boundary truncation and minor rounding overflow without rejecting selfies.
 const right=clamp(x+w,0,1000),bottom=clamp(y+h,0,1000);x=clamp(x,0,1000);y=clamp(y,0,1000);w=right-x;h=bottom-y;
 if(w<=0||h<=0)throw Error('头部定位不在照片范围内');
 const box=[x,y,w,h];
 return{box,outline:roundedOutline(box),outlineFallback:true,outlineMethod:'original-box',coordinateOverflow};
}
function candidates(result){if(Array.isArray(result))return result;if(Array.isArray(result?.heads))return result.heads;if(Array.isArray(result?.faces))return result.faces;return result?.box||result?.bbox||result?.bbox_xyxy?[result]:[]}
function selectProminentHead(result,width,height){
 const heads=[];for(const head of candidates(result))try{heads.push(normalizeHead(head,width,height,result))}catch{}
 // Main selfie subjects occupy more image area than people at the edge/background.
 heads.sort((a,b)=>b.box[2]*b.box[3]-a.box[2]*a.box[3]);return heads[0]||null;
}
function normalizeHeadLayout(result,width,height){
 const raw=candidates(result);if(raw.length!==2)throw Error('生成场景需要两个人的头部定位');
 const convert=(xyxy=false)=>{
  const heads=raw.map(h=>normalizeHead(xyxy?{...h,coordinate_format:'xyxy'}:h,width,height,xyxy?{...result,coordinate_format:'xyxy'}:result));
  if(heads.some(h=>h.coordinateOverflow>20))throw Error('头部定位超出画面');
  const boxes=heads.map(h=>h.box).sort((a,b)=>a[0]+a[2]/2-b[0]-b[2]/2);
  const[a,b]=boxes;if(a[0]+a[2]>b[0]&&Math.min(a[1]+a[3],b[1]+b[3])>Math.max(a[1],b[1]))throw Error('两人头部定位重叠');
  return boxes;
 };
 try{return convert()}catch(error){
  // Legacy Qwen responses sometimes echoed our xywh label while emitting
  // native xyxy numbers. Only reinterpret an invalid/overlapping layout, and
  // still require two valid, non-overlapping boxes after the correction.
  const format=String(result?.coordinate_format||result?.box_format||result?.bbox_format||'xywh');
  if(!format.includes('xywh')||!raw.every(h=>Array.isArray(h?.box)&&!h.bbox_xyxy&&!h.box_xyxy))throw error;
  try{return convert(true)}catch{throw error}
 }
}
module.exports={normalizeHead,selectProminentHead,normalizeHeadLayout,roundedOutline};
