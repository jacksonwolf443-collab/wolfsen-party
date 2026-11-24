'use strict';
const {normalizeHead}=require('./head-geometry.cjs');
// Opaque pixels are copied verbatim. Neither this module nor its codec calls an image model.
function checkRaster(r){if(!r||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width*r.height>25000000||r.data?.length!==r.width*r.height*4)throw Error('照片像素无法读取或尺寸过大')}
function boxPixels(box,w,h){
 if(!Array.isArray(box)||box.length!==4||box.some(n=>!Number.isFinite(n))||box[2]<=0||box[3]<=0)throw Error('头部定位无效');
 const x=Math.max(0,Math.min(w,Math.floor(box[0]*w/1000))),y=Math.max(0,Math.min(h,Math.floor(box[1]*h/1000)));
 const right=Math.max(0,Math.min(w,Math.ceil((box[0]+box[2])*w/1000))),bottom=Math.max(0,Math.min(h,Math.ceil((box[1]+box[3])*h/1000)));
 if(right<=x||bottom<=y)throw Error('头部定位不在照片范围内');
 return{x,y,width:right-x,height:bottom-y};
}
function extractHead(source,geometry){
 checkRaster(source);geometry=normalizeHead(geometry,source.width,source.height);const b=boxPixels(geometry.box,source.width,source.height);
 const data=Buffer.alloc(b.width*b.height*4);
 // Preserve every source pixel in the bounding region, including hair and
 // visible obstructions. Retaining some source background is preferable to
 // trusting a generated outline that can remove half of the player's face.
 for(let y=0;y<b.height;y++){const from=((b.y+y)*source.width+b.x)*4;source.data.copy(data,y*b.width*4,from,from+b.width*4)}
 return{width:b.width,height:b.height,data};
}
function compositeHeads(background,heads,boxes,eraseMasks){
 checkRaster(background);if(heads.length!==2||boxes.length!==2)throw Error('需要两位本人的头部定位');heads.forEach(checkRaster);
 if(eraseMasks!==undefined){if(!Array.isArray(eraseMasks)||eraseMasks.length!==2)throw Error('需要两位生成头部的前景蒙版');eraseMasks.forEach(checkRaster)}
 const bounds=boxes.map((b,index)=>({...boxPixels(b,background.width,background.height),mask:eraseMasks?.[index]})).sort((a,b)=>a.x-b.x);
 if(bounds[0].x+bounds[0].width>bounds[1].x&&Math.min(bounds[0].y+bounds[0].height,bounds[1].y+bounds[1].height)>Math.max(bounds[0].y,bounds[1].y))throw Error('两人头部定位重叠，请重新生成场景');
 const data=Buffer.from(background.data),placements=[];
 // The optional generated-head matte limits erasure to the actual foreground
 // silhouette. Background corners stay untouched, avoiding rectangular fill
 // bands around a transparent original head. Legacy callers retain full erase.
 const erase=bounds.map(b=>{
  const rows=new Map(),include=(y,left,right)=>{if(y<0||y>=background.height)return;left=Math.max(0,left);right=Math.min(background.width,right);const previous=rows.get(y);rows.set(y,previous?{left:Math.min(previous.left,left),right:Math.max(previous.right,right)}:{left,right})};
  if(!b.mask){const px=Math.max(2,Math.ceil(b.width*.08)),py=Math.max(2,Math.ceil(b.height*.08));for(let y=Math.max(0,b.y-py);y<b.y+b.height;y++)include(y,b.x-px,b.x+b.width+px);return rows}
  for(let y=0;y<b.height;y++){
   let first=b.width,last=-1;
   for(let x=0;x<b.width;x++){
    const mx=Math.min(b.mask.width-1,Math.floor((x+.5)*b.mask.width/b.width)),my=Math.min(b.mask.height-1,Math.floor((y+.5)*b.mask.height/b.height)),alpha=b.mask.data[(my*b.mask.width+mx)*4+3];
    const core=((x/b.width-.5)/.25)**2+((y/b.height-.6)/.29)**2<=1;
    if(alpha>=32||core){first=Math.min(first,x);last=x}
   }
   if(last>=first)for(let dy=-1;dy<=1;dy++)if(y+dy<b.height)include(b.y+y+dy,b.x+first-1,b.x+last+2);
  }
  return rows;
 });
 const occupied=(x,y)=>erase.some(rows=>{const row=rows.get(y);return row&&x>=row.left&&x<row.right});
 for(const rows of erase)for(const[y,row]of rows){
  let left=row.left-1,right=row.right;while(left>=0&&occupied(left,y))left--;while(right<background.width&&occupied(right,y))right++;
  if(left<0&&right>=background.width)throw Error('头部定位没有可用背景边缘，已停止原脸合成');
  if(left<0)left=right;if(right>=background.width)right=left;
  for(let x=row.left;x<row.right;x++){const at=(y*background.width+x)*4,fromL=(y*background.width+left)*4,fromR=(y*background.width+right)*4,t=right===left?0:(x-left)/(right-left);for(let c=0;c<3;c++)data[at+c]=Math.round(background.data[fromL+c]*(1-t)+background.data[fromR+c]*t);data[at+3]=255}
 }
 for(let n=0;n<2;n++){
  const head=heads[n],b=bounds[n],scale=Math.min(b.width/head.width,b.height/head.height),width=Math.max(1,Math.round(head.width*scale)),height=Math.max(1,Math.round(head.height*scale));
  const left=b.x+Math.floor((b.width-width)/2),top=b.y+b.height-height;let copied=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const sx=Math.min(head.width-1,Math.floor(x/scale)),sy=Math.min(head.height-1,Math.floor(y/scale)),from=(sy*head.width+sx)*4;
   // No feathering, recoloring, retouching or interpolation of a face pixel.
   if(head.data[from+3]===255){head.data.copy(data,((top+y)*background.width+left+x)*4,from,from+4);copied++}
  }
  if(!copied)throw Error('没有可合成的本人头部像素');placements.push({left,top,width,height,sourceWidth:head.width,sourceHeight:head.height,copiedPixels:copied});
 }
 return{width:background.width,height:background.height,data,placements};
}
module.exports={extractHead,compositeHeads,boxPixels};
