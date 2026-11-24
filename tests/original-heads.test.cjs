const {test}=require('node:test'),assert=require('node:assert/strict');
const raster=(w,h,base)=>({width:w,height:h,data:Buffer.from(Array.from({length:w*h},(_,i)=>[base+i%30,40,60,255]).flat())});
test('original head extraction copies every source pixel in its bounding region and ignores model masks',()=>{
 const {extractHead}=require('../desktop/original-heads.cjs');
 const original=raster(20,20,100),before=Buffer.from(original.data);
 const head=extractHead(original,{box:[200,100,600,800],outline:[[500,100],[800,400],[500,900],[200,400]]});
 assert.equal(head.width,12);assert.equal(head.height,16);
 assert.deepEqual([...head.data.subarray((8*12+6)*4,(8*12+6)*4+4)],[original.data[((10*20+10)*4)],40,60,255]);
 assert.equal(head.data[3],255,'source hair and background are retained instead of trusting a generated silhouette');
 assert.deepEqual(original.data,before,'source is never retouched');
 for(let i=0;i<head.data.length;i+=4)if(head.data[i+3])assert.ok(head.data[i]>=100&&head.data[i]<=129);
});
test('compositing places unmodified head pixels using uniform nearest sampling; no blending or face synthesis',()=>{
 const {compositeHeads}=require('../desktop/original-heads.cjs');
 const background=raster(100,50,1),heads=[raster(10,10,100),raster(10,10,200)],before=Buffer.from(background.data);
 const boxes=[[100,200,200,400],[650,200,200,400]];
 const result=compositeHeads(background,heads,boxes);
 assert.deepEqual([...result.data.subarray((20*100+20)*4,(20*100+20)*4+4)],[125,40,60,255]);
 assert.deepEqual([...result.data.subarray((20*100+75)*4,(20*100+75)*4+4)],[225,40,60,255]);
 assert.deepEqual(result.data.subarray(0,4),background.data.subarray(0,4));assert.deepEqual(background.data,before);
 assert.throws(()=>compositeHeads(background,heads,[[100,200,-1,400],boxes[1]]),/定位/);
});
test('missing outlines and slightly inconsistent boxes keep original pixels, while output overlaps are rejected',()=>{
 const {extractHead,compositeHeads}=require('../desktop/original-heads.cjs');
 const original=raster(20,20,100),fallback=extractHead(original,{box:[0,0,1000,1000],outline:[]});
 assert.equal(fallback.width,20);assert.equal(fallback.height,20);assert.deepEqual(fallback.data.subarray((10*20+10)*4,(10*20+10)*4+4),original.data.subarray((10*20+10)*4,(10*20+10)*4+4));
 assert.throws(()=>compositeHeads(raster(100,50,0),[raster(10,10,100),raster(10,10,200)],[[100,100,500,500],[200,100,500,500]]),/重叠/);
 const expanded=extractHead(original,{box:[300,100,400,800],outline:[[100,100],[900,100],[900,900],[100,900]]});assert.equal(expanded.width,8);assert.equal(expanded.height,16);
});
test('AI head pixels are removed before pasting, including every transparent corner and aspect-ratio padding',()=>{
 const {compositeHeads}=require('../desktop/original-heads.cjs');
 const base={width:100,height:50,data:Buffer.alloc(100*50*4)};for(let i=0;i<base.data.length;i+=4){base.data[i]=7;base.data[i+3]=255}
 for(const start of [10,65])for(let y=10;y<30;y++)for(let x=start;x<start+20;x++)base.data[(y*100+x)*4]=250;
 const head=raster(5,10,100);for(let y=0;y<10;y++){head.data[(y*5)*4+3]=0;head.data[(y*5+4)*4+3]=0}
 const result=compositeHeads(base,[head,head],[[100,200,200,400],[650,200,200,400]]);
 for(let i=0;i<result.data.length;i+=4)assert.notEqual(result.data[i],250,'no generated head pixel may survive beneath the cutout');
 assert.equal(base.data[(10*100+10)*4],250,'base source is immutable');
});
test('a wider original head is anchored at the neck edge and does not erase the body collar below it',()=>{
 const {compositeHeads}=require('../desktop/original-heads.cjs'),base=raster(100,50,7);
 const result=compositeHeads(base,[raster(10,5,100),raster(10,5,200)],[[100,200,200,400],[650,200,200,400]]);
 assert.equal(result.placements[0].top+result.placements[0].height,30,'head bottom meets the target neck edge');
 assert.deepEqual(result.data.subarray((31*100+20)*4,(31*100+20)*4+4),base.data.subarray((31*100+20)*4,(31*100+20)*4+4),'collar below the head remains');
});
test('a generated head mask erases the AI face core while leaving corner background pixels unchanged',()=>{
 const {compositeHeads}=require('../desktop/original-heads.cjs'),base=raster(120,80,7),boxes=[[100,100,250,650],[650,100,250,650]];
 const masks=boxes.map(()=>({width:30,height:52,data:Buffer.alloc(30*52*4)}));
 for(const mask of masks)for(let y=3;y<49;y++)for(let x=5;x<25;x++)if(((x-15)/10)**2+((y-25)/23)**2<=1)mask.data[(y*30+x)*4+3]=255;
 // An intentionally empty central mask still must not leave the AI face core.
 for(const mask of masks)for(let y=18;y<34;y++)for(let x=10;x<20;x++)mask.data[(y*30+x)*4+3]=0;
 for(const start of [12,78])for(let y=14;y<56;y++)for(let x=start+8;x<start+23;x++)base.data[(y*120+x)*4]=250;
 const head=raster(16,40,100);for(let i=0;i<head.data.length;i+=4)head.data[i+3]=0;
 for(let y=2;y<38;y++)for(let x=4;x<12;x++)head.data[(y*16+x)*4+3]=255;
 const result=compositeHeads(base,[head,head],boxes,masks);
 for(const [x,y]of [[12,8],[41,8],[12,59],[78,8],[107,8],[78,59]])assert.deepEqual(result.data.subarray((y*120+x)*4,(y*120+x)*4+4),base.data.subarray((y*120+x)*4,(y*120+x)*4+4),'corners surrounding each head remain the original background instead of horizontal fill bands');
 for(const [x,y]of [[27,34],[93,34]])assert.notEqual(result.data[(y*120+x)*4],250,'generated face core is removed even when the predicted mask has a hole');
 assert.equal(base.data[(34*120+27)*4],250,'the base file is unchanged');
});
