const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeHead,selectProminentHead,normalizeHeadLayout}=require('../desktop/head-geometry.cjs');
test('head coordinates accept normalized units, xyxy pixel metadata, and clipped edge hair',()=>{
 const unit=normalizeHead({box:[.2,.05,.5,.7]},800,1200);
 assert.deepEqual(unit.box,[200,50,500,700]);assert.equal(unit.outline.length,4);
 const pixels=normalizeHead({bbox_xyxy:[80,0,560,600]},800,1200,{coordinate_system:'pixels',coordinate_format:'xywh'});
 assert.deepEqual(pixels.box,[100,0,600,500]);
 const clipped=normalizeHead({box:[-8,-12,1020,1025]},800,1200);
 assert.deepEqual(clipped.box,[0,0,1000,1000]);
 assert.deepEqual(normalizeHead({box:[200,100,500,600]},800,1200,{coordinate_system:'normalized'}).box,[200,100,500,600]);
 assert.deepEqual(normalizeHead({box:[.2,.1,.5,.6]},800,1200,{coordinate_system:'normalized'}).box,[200,100,500,600]);
});
test('model contours are ignored because a plausible polygon can still cut through the face or hair',()=>{
 const head=normalizeHead({box:[300,200,300,500],outline:[[200,100],[700,100],[750,800],[150,800]]},800,1000);
 assert.deepEqual(head.box,[300,200,300,500]);assert.equal(head.outlineFallback,true);
 assert.deepEqual(head.outline,[[300,200],[600,200],[600,700],[300,700]]);
 const poor=normalizeHead({box:[300,200,300,500],outline:[[400,300],[405,300],[405,305]]},800,1000);
 assert.equal(poor.outlineFallback,true);
});
test('real selfie localization regressions preserve every pixel inside the source head box',()=>{
 const {extractHead}=require('../desktop/original-heads.cjs');
 const liveGeometries=[
  {box:[108,62,892,938],outline:[[108,62],[200,100],[300,150],[400,180],[500,190],[600,180],[700,170],[800,200],[830,280],[840,350],[850,420],[860,500],[850,600],[830,700],[800,800],[750,880],[680,920],[600,940],[520,950],[440,940],[380,920],[320,880],[270,820],[230,750],[200,650],[180,550],[160,450],[130,350]]},
  {box:[24,58,792,942],outline:[[24,68],[130,58],[240,72],[340,110],[420,180],[470,270],[490,370],[480,480],[450,580],[410,670],[360,750],[300,820],[230,870],[160,900],[90,920],[40,910],[24,850],[24,68]]}
 ];
 const data=Buffer.alloc(200*200*4);for(let i=0;i<data.length;i+=4){data[i]=(i/4)%251;data[i+3]=255}
 for(const geometry of liveGeometries){
  const head=extractHead({width:200,height:200,data},geometry),x=Math.floor(geometry.box[0]*.2),y=Math.floor(geometry.box[1]*.2);
  for(let py=0;py<head.height;py++)for(let px=0;px<head.width;px++)assert.deepEqual(head.data.subarray((py*head.width+px)*4,(py*head.width+px+1)*4),data.subarray(((y+py)*200+x+px)*4,((y+py)*200+x+px+1)*4),'source hair and face must not be removed by model polygon');
 }
});
test('automatic reference chooses the largest prominent head over a cropped background person',()=>{
 const head=selectProminentHead({heads:[{bbox_xyxy:[0,0,80,200]},{bbox_xyxy:[180,80,700,800]}],coordinate_system:'pixels'},800,1200);
 assert.deepEqual(head.box,[225,80/1200*1000,650,600]);
 assert.equal(selectProminentHead({heads:[]},800,1200),null);
 assert.throws(()=>normalizeHead({box:[0,0,-20,100]},800,1200),/定位/);
});
test('output head boxes accept xyxy and are sorted left to right without accepting overlap',()=>{
 const boxes=normalizeHeadLayout({coordinate_system:'pixels',heads:[{bbox_xyxy:[800,80,1120,420]},{bbox_xyxy:[120,70,400,430]}]},1280,720);
 assert.equal(boxes.length,2);assert.equal(boxes[0][0],93.75);assert.equal(boxes[1][0],625);
 assert.throws(()=>normalizeHeadLayout({heads:[{box:[100,100,500,500]},{box:[200,100,500,500]}]},1280,720),/重叠/);
});
test('Qwen real xyxy bounds remain correct even when a legacy response mistakenly labels them xywh',()=>{
 const source=normalizeHead({bbox_xyxy:[108,62,1000,1000]},800,1200,{coordinate_system:'normalized_1000',coordinate_format:'xyxy'});
 assert.deepEqual(source.box,[108,62,892,938]);
 const second=normalizeHead({bbox_xyxy:[24,76,800,999]},800,1200,{coordinate_system:'normalized_1000',coordinate_format:'xyxy'});
 assert.deepEqual(second.box,[24,76,776,923]);
 const heads=[{box:[309,178,376,325]},{box:[624,202,688,342]}];
 assert.deepEqual(normalizeHeadLayout({coordinate_system:'normalized_1000',coordinate_format:'xywh',heads},1280,720),[[309,178,67,147],[624,202,64,140]]);
 assert.deepEqual(normalizeHeadLayout({coordinate_system:'normalized_1000',coordinate_format:'xyxy',heads:heads.map(h=>({bbox_xyxy:h.box}))},1280,720),[[309,178,67,147],[624,202,64,140]]);
});
