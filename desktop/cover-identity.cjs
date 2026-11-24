'use strict';
const fs=require('node:fs');
const {extractHead}=require('./original-heads.cjs');
const {selectProminentHead}=require('./head-geometry.cjs');

// This board is an INPUT reference, never the delivered photograph. Every
// visible source pixel is copied without retouching, matting or generation.
const referenceGlyphs={
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 A:['01110','10001','10001','11111','10001','10001','10001'],
 B:['11110','10001','10001','11110','10001','10001','11110'],
 L:['10000','10000','10000','10000','10000','10000','11111'],
 E:['11111','10000','10000','11110','10000','10000','11111'],
 F:['11111','10000','10000','11110','10000','10000','10000'],
 T:['11111','00100','00100','00100','00100','00100','00100'],
 R:['11110','10001','10001','11110','10100','10010','10001'],
 I:['11111','00100','00100','00100','00100','00100','11111'],
 G:['01110','10001','10000','10111','10001','10001','01110'],
 H:['10001','10001','10001','11111','10001','10001','10001']
};
function referenceLabel(data,width,cell,label){
 const scale=7,left=cell*640+Math.floor((640-(label.length*6-1)*scale)/2),top=19;
 for(let y=0;y<88;y++)for(let x=cell*640;x<(cell+1)*640;x++){const at=(y*width+x)*4;data[at]=20;data[at+1]=45;data[at+2]=34}
 for(let n=0;n<label.length;n++){const glyph=referenceGlyphs[label[n]];if(!glyph)continue;for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(glyph[y][x]==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const at=((top+y*scale+dy)*width+left+n*6*scale+x*scale+dx)*4;data[at]=245;data[at+1]=250;data[at+2]=235}}
}
function referenceBoard(rasters,imageCodec){
 if(rasters.length!==2)throw Error('需要两张人物参考');const width=1280,height=640,data=Buffer.alloc(width*height*4);
 for(let at=0;at<data.length;at+=4){data[at]=data[at+1]=data[at+2]=232;data[at+3]=255}
 rasters.forEach((r,i)=>{if(!r||!r.width||!r.height||r.data?.length!==r.width*r.height*4)throw Error('人物参考照片无法读取');referenceLabel(data,width,i,i?'B RIGHT 2':'A LEFT 1');const scale=Math.min(600/r.width,520/r.height),w=Math.max(1,Math.round(r.width*scale)),h=Math.max(1,Math.round(r.height*scale)),left=i*640+Math.floor((640-w)/2),top=88+Math.floor((552-h)/2);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(r.width-1,Math.floor(x/scale)),sy=Math.min(r.height-1,Math.floor(y/scale));r.data.copy(data,((top+y)*width+left+x)*4,(sy*r.width+sx)*4,(sy*r.width+sx)*4+4)}});
 return'data:image/png;base64,'+imageCodec.encode({width,height,data}).toString('base64');
}
function createAppearanceReferences({store,imageCodec,vision}){
 const cache=new Map();
 const remember=(key,raster,method)=>{cache.set(key,{raster,method});let bytes=0;for(const entry of cache.values())bytes+=entry.raster.data.length;while(cache.size>160||bytes>64*1024*1024){const first=cache.keys().next().value;bytes-=cache.get(first).raster.data.length;cache.delete(first)}};
 return async sources=>{
  if(!imageCodec)return{image:null,methods:['original-photo','original-photo']};
  const rasters=sources.map(p=>imageCodec.decode(fs.readFileSync(store.photoPath(p.photo)))),references=[...rasters],methods=['original-photo','original-photo'],missing=[];
  sources.forEach((p,index)=>{const key=[p.id,p.photo,p.facePhoto??'',JSON.stringify(p.headGeometry??null),p.headSourceKey??''].join('|');if(cache.has(key)){const saved=cache.get(key);references[index]=saved.raster;methods[index]=saved.method;return}if(p.facePhoto&&fs.existsSync(store.photoPath(p.facePhoto))){references[index]=imageCodec.decode(fs.readFileSync(store.photoPath(p.facePhoto)));methods[index]='saved-original-closeup';remember(key,references[index],methods[index]);return}if(p.headSourceKey===p.photo&&p.headGeometry){try{references[index]=extractHead(rasters[index],p.headGeometry);methods[index]='cached-original-closeup';remember(key,references[index],methods[index]);return}catch{}}
   missing.push({index,key});
  });
  if(missing.length){
   const result=await vision('参考照片定位任务：下面每张图各选面积最大、最突出的主体本人，忽略背景路人。仅定位原图已有的头发、头部、脸、下巴和少量颈部，不识别真实身份，不描述或重画五官。半身照、歪头和原有遮挡可以保留，不要求双耳都可见。严格JSON {"subjects":[{"index":1,"bbox_xyxy":[左,上,右,下]}]}，index是本请求图片从1开始的顺序。每张图最多一项，四坐标为原图0至1000的左上和右下坐标，保守包围全部头发和下巴，不能裁掉五官或发型。确实找不到主体头部时该图不要返回坐标，绝对不要猜。',missing.map(x=>store.photoData(sources[x.index].photo)));
   for(let n=0;n<missing.length;n++){const item=missing[n],candidates=Array.isArray(result?.subjects)?result.subjects.filter(x=>x?.index===n+1):[];if(candidates.length!==1)continue;const geometry=selectProminentHead({coordinate_system:'normalized_1000',coordinate_format:'xyxy',heads:candidates},rasters[item.index].width,rasters[item.index].height);if(!geometry||geometry.coordinateOverflow>20)continue;try{const raster=extractHead(rasters[item.index],geometry);if(raster.width<16||raster.height<16)continue;references[item.index]=raster;methods[item.index]='automatic-original-closeup';remember(item.key,raster,methods[item.index])}catch{}}
  }
  while(cache.size>160)cache.delete(cache.keys().next().value);
  return{image:methods.some(x=>x!=='original-photo')?referenceBoard(references,imageCodec):null,methods};
 };
}
function assertAppearanceQuality(quality,AppError){
 if(quality?.distinctPeople!==true)throw new AppError('合照两位玩家的外观区分未通过核对，原合照已保留；请重试');
 const appearance={};for(const [side,reference,label]of [['left',1,'左侧'],['right',2,'右侧']]){const p=quality?.appearance?.[side];if(!p||p.reference!==reference||p.faceVisible!==true||p.facialFeaturesConsistent!==true||p.hairConsistent!==true||p.skinToneConsistent!==true||typeof p.confidence!=='number'||!Number.isFinite(p.confidence)||p.confidence<.85||p.confidence>1)throw new AppError('合照'+label+'玩家的长相、发型或肤色与原照片的外观一致性未通过核对，或面部不够清楚；原合照已保留，请重试或换用清晰本人照片');appearance[side]={reference,faceVisible:true,facialFeaturesConsistent:true,hairConsistent:true,skinToneConsistent:true,confidence:p.confidence};}
 return appearance;
}
function bodyGeometryPrompt({width,height}){
 return'最终合照单图定位任务。你只收到唯一一张完整照片，只定位这张图里的两个人，不比较其他照片，不评价身份或帅气，不重画图片。图像宽'+width+'像素、高'+height+'像素。所有坐标均相对于这一张整图，coordinateSystem必须为normalized_1000：x=横向像素/'+width+'*1000，y=纵向像素/'+height+'*1000，左上角[0,0]，右下角[1000,1000]。不要把像素坐标直接当归一化坐标。\n按观众所见从左到右给出left和right两人。逐人先找头发最高处和下巴最低处，再找左右头发/耳朵边缘，head=[左,上,右,下]必须只紧包真实可见的完整头发至下巴；不能包含脖子、肩膀、胸口、躯干或头上空白，不能把整个人/上半身框当头框。头框左右边应贴近头发或耳缘，底边必须停在下巴，不得延伸到衣领。\nshoulderLeft/shoulderRight分别为该人观众所见左/右肩关节外端点[x,y]，不是衣袖外沿，也不是头框左右角。hipCenter为骨盆/胯部中心[x,y]，不要使用膝盖或画框底。footLeft/footRight分别为该人观众所见左/右鞋子接触地面的最低鞋底点[x,y]，两脚必须分别定位。鞋底不是脚踝、膝盖或地面阴影，不能使用画框底当脚底，也不能把缺失的脚想象出来。本人的完整高度将从头框顶边量到较低鞋底，画面里的人即使很小也要按本人身高核对头身比。confidence是头、肩、胯和左右鞋底全部位置均可可靠定位的把握，取0到1；缺少可见身体或遮挡无法定位时返回低于0.85，不能为通过比例检查而编造坐标。这里只记录客观位置，不能为了修正比例而缩小头框或扩大肩线。\n仅返回严格JSON {"geometry":{"coordinateSystem":"normalized_1000","left":{"head":[左,上,右,下],"shoulderLeft":[x,y],"shoulderRight":[x,y],"hipCenter":[x,y],"footLeft":[x,y],"footRight":[x,y],"confidence":0到1数字},"right":{"head":[左,上,右,下],"shoulderLeft":[x,y],"shoulderRight":[x,y],"hipCenter":[x,y],"footLeft":[x,y],"footRight":[x,y],"confidence":0到1数字}}}。所有位置必须是0—1000的数值，不能用文字。';
}
function assertBodyMeasurements(geometry,dimensions,AppError){
 const fail=message=>{throw new AppError('合照'+message+'未通过比例测量核对；原合照已保留，请重试')};
 if(geometry?.coordinateSystem!=='normalized_1000')fail('身体坐标');
 const width=dimensions?.width,height=dimensions?.height;if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)fail('图像尺寸');
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000);
 const distance=(a,b)=>Math.hypot((a[0]-b[0])*width/1000,(a[1]-b[1])*height/1000),measurements={coordinateSystem:'normalized_1000'};
 const heights=[];
 for(const [side,label]of [['left','左侧'],['right','右侧']]){
  const p=geometry[side];if(!p||typeof p.confidence!=='number'||p.confidence<.85||p.confidence>1||!Number.isFinite(p.confidence)||!Array.isArray(p.head)||p.head.length!==4||!point(p.head.slice(0,2))||!point(p.head.slice(2))||!point(p.shoulderLeft)||!point(p.shoulderRight)||!point(p.hipCenter)||!point(p.footLeft)||!point(p.footRight))fail(label+'头部、肩胯、左右鞋底坐标或测量置信度');
  const [x1,y1,x2,y2]=p.head,headWidth=(x2-x1)*width/1000,headHeight=(y2-y1)*height/1000,shoulderWidth=distance(p.shoulderLeft,p.shoulderRight),shoulderCenter=[(p.shoulderLeft[0]+p.shoulderRight[0])/2,(p.shoulderLeft[1]+p.shoulderRight[1])/2],torsoHeight=distance(shoulderCenter,p.hipCenter);
  if(headWidth<=0||headHeight<=0||shoulderWidth<=0||p.shoulderLeft[0]>=p.shoulderRight[0]||p.hipCenter[1]<=shoulderCenter[1]||y2>shoulderCenter[1]+15||p.footLeft[1]<=p.hipCenter[1]||p.footRight[1]<=p.hipCenter[1])fail(label+'头部、肩线、躯干或鞋底结构');
  const personHeight=Math.max(p.footLeft[1],p.footRight[1])-y1;
  const values={headFrameHeight:(y2-y1)/1000,personFrameHeight:personHeight/1000,headToPersonHeight:(y2-y1)/personHeight,headsTall:personHeight/(y2-y1),headWidthToShoulderWidth:headWidth/shoulderWidth,headHeightToShoulderWidth:headHeight/shoulderWidth,torsoToHeadHeight:torsoHeight/headHeight};
  // These broad framing/shape guards catch clear synthetic distortions. They
  // are not a clinical standard or a claim of precise human measurements.
  if(values.headFrameHeight<.10||values.headFrameHeight>.19)fail(label+'头部占画面大小');
  if(values.headToPersonHeight>.145)fail(label+'头身比（头部相对本人身高过大）');
  if(values.headWidthToShoulderWidth>.47||values.headHeightToShoulderWidth>.65)fail(label+'头部与肩宽');
  if(values.torsoToHeadHeight<1.3)fail(label+'躯干过短');
  heights.push(headHeight);measurements[side]={...values,confidence:p.confidence,head:[...p.head],shoulderLeft:[...p.shoulderLeft],shoulderRight:[...p.shoulderRight],hipCenter:[...p.hipCenter],footLeft:[...p.footLeft],footRight:[...p.footRight]};
 }
 if(Math.max(...heights)/Math.min(...heights)>1.5)fail('两人相近站位的头部尺度与透视');
 return measurements;
}
function assertNaturalCompositionQuality(quality,AppError,dimensions){
 const composition={},anatomy={};for(const key of ['sameCameraPerspective','plausibleRelativeScale','naturalStanceAndSpacing','unforcedPoses']){if(quality?.composition?.[key]!==true)throw new AppError('合照的同机位透视、两人相对比例、站位或自然姿势未通过核对；原合照已保留，请重试');composition[key]=true}
 for(const [side,label]of [['left','左侧'],['right','右侧']]){anatomy[side]={};for(const key of ['headBodyProportionNatural','neckShouldersNatural','limbsAndJointsNatural','handsNatural','balancedPosture']){if(quality?.anatomy?.[side]?.[key]!==true)throw new AppError('合照'+label+'玩家的头身比例、肩颈、身体关节或动作重心未通过核对；原合照已保留，请重试');anatomy[side][key]=true}}
 const measurements=assertBodyMeasurements(quality.geometry,dimensions,AppError);
 return{composition,anatomy,measurements};
}
module.exports={createAppearanceReferences,referenceBoard,assertAppearanceQuality,assertNaturalCompositionQuality,bodyGeometryPrompt};
