'use strict';
const canonical={outline:[[40,20],[60,20],[70,35],[70,60],[60,80],[50,85],[40,80],[30,60],[30,35]],eyeLeft:[40,40],eyeRight:[60,40],mouth:[50,65]};
function faceAt(width,height,centerX,eyeY,unit){const point=([x,y])=>[(centerX+(x-50)*unit)*1000/width,(eyeY+(y-40)*unit)*1000/height];return{outline:canonical.outline.map(point),eyeLeft:point(canonical.eyeLeft),eyeRight:point(canonical.eyeRight),mouth:point(canonical.mouth)}}
const sourceFace=(width=128,height=128)=>({...faceAt(width,height,width*.5,height*.4,width/100),unobstructed:true,eyesVisible:true,noseVisible:true,mouthVisible:true});
const targetFaces=(width=1280,height=720)=>[faceAt(width,height,width*.3125,height*2/9,height/360),faceAt(width,height,width*.6875,height*2/9,height/360)];
// Use this response only for geometry prompts. Structural reviews retain each
// test's own quality response, including deliberately failing quality fixtures.
function faceRegionReply(body){const content=body.messages?.[0]?.content??[],prompt=content.find(x=>x.type==='text')?.text??'';if(prompt.includes('FACE_SOURCE_HEAD_BOXES'))return{heads:content.filter(x=>x.type==='image_url').map(()=>({bbox_xyxy:[100,100,900,900]}))};if(prompt.includes('FACE_SOURCE_REGIONS'))return{faces:content.filter(x=>x.type==='image_url').map(()=>({unobstructed:true,eyesVisible:true,noseVisible:true,mouthVisible:true}))};if(prompt.includes('FACE_TARGET_HEAD_BOXES'))return{heads:[{bbox_xyxy:[260,100,370,390]},{bbox_xyxy:[635,100,745,390]}]};return null}
// These synthetic rasters contain no faces. Keep their deterministic geometry
// at the dependency boundary; production always runs the bundled local model.
async function faceLocalizer(raster,options={}){if(options.headBox){const center=options.headBox[0]+options.headBox[2]/2;return targetFaces(raster.width,raster.height)[center<500?0:1]}return sourceFace(raster.width,raster.height)}
module.exports={sourceFace,targetFaces,faceRegionReply,faceLocalizer};
