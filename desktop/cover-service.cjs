'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {reserveScene}=require('./cover-scenes.cjs');
const {extractHead}=require('./original-heads.cjs');
const {normalizeHead,selectProminentHead}=require('./head-geometry.cjs');
const faceRequirements='相似度是次要参考：尽量沿用两张原照片中各自主体的年龄感、脸型、五官特点、发型与肤色，但以整张照片自然完整为先。可以重新绘制面部，让表情、头部角度、皮肤纹理和光照与身体及场景一致；手机或手遮住的五官可以合理推断，不要求保留原脸像素，不承诺精确还原本人。';
function createCoverService({store,provider,imageCodec,headMatte,parseAIJSON,AppError,fetcher,isEligible,validImage,retryDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const jobs=new Map(),preparing=new Map(),geometryVersion=headMatte?'auto-head-v6-refined':'auto-head-v4';
 const retryableDownload=error=>{
  const message=String(error?.message??'')+' '+String(error?.code??''),status=Number(error?.status);
  if(/green[\s_-]*net.*reject|reject(?:ed)?.*image|data.?inspection|content[_ -]?(?:filter|moderation)|safety[_ -]?(?:check|reject)|(?:内容|输入|图片).*审核|审核.*(?:拒绝|未通过|不通过)/i.test(message))return false;
  if(status>0)return[408,425,429].includes(status)||status>=500&&status<600;
  return['TypeError','TimeoutError','AbortError'].includes(error?.name)||/network|fetch failed|terminated|time[ -]?out|timed out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_/i.test(message+' '+String(error?.cause?.code??''));
 };
 const vision=async(prompt,images)=>{
  const d=await provider('/compatible-mode/v1/chat/completions',{model:store.data.ai.visionModel,messages:[{role:'user',content:[...images.map(image=>({type:'image_url',image_url:{url:image}})),{type:'text',text:prompt}]}],enable_thinking:false,max_tokens:2500,temperature:0.1});
  return parseAIJSON(d.choices?.[0]?.message?.content??'');
 };
 const assertSources=sources=>{for(const p of sources){const now=store.player(p.id);if(now.photo!==p.photo||(now.facePhoto??'')!==(p.facePhoto??''))throw new AppError('玩家照片已更换，本次结果没有覆盖新照片',409)}};
 const assertCurrent=sources=>{assertSources(sources);for(const p of sources){const now=store.player(p.id);if(!isEligible(now))throw new AppError(now.name+'未到或已离场，已停止本组合生成')}};
 const cutout=async(p)=>{
  const sourceKey=p.facePhoto||p.photo,source=store.photoData(sourceKey),current=store.player(p.id);
  if(current.headGeometryVersion===geometryVersion&&current.headSourceKey===sourceKey&&current.headCutout&&fs.existsSync(store.photoPath(current.headCutout)))return current.headCutout;
  const pendingKey=p.id+'|'+sourceKey;if(preparing.has(pendingKey))return preparing.get(pendingKey);
  const task=(async()=>{
   const raster=imageCodec.decode(fs.readFileSync(store.photoPath(sourceKey)));let geometry=null,lastError,referenceMethod='automatic-head',warning='';
   for(let attempt=0;attempt<2&&!geometry;attempt++){
    const prompt=attempt===0
     ?'这是定位与抠图任务，不生成或修改人物。照片可能是半身自拍、全身照、歪头、侧脸、头发或耳朵被图边裁切、手机挡住部分面部，也可能有边缘路人；这些都可以定位。选择画面中面积最大、最突出的本人头部，忽略背景路人，只返回该主体。保留实际看得到的全部头发、脸、下巴和原有遮挡，不要求双耳、全部头发都可见，不补画不存在的部分。仅输出JSON {"coordinate_system":"normalized_1000","coordinate_format":"xyxy","heads":[{"bbox_xyxy":[x_min,y_min,x_max,y_max]}]}。bbox_xyxy要保守包围全部可见头发、脸、下巴和少量颈部，在头发与耳朵外留少量余量，宁可包括少量背景，绝对不能切到发型或脸。不要返回多边形或轮廓。全部坐标为原图0至1000，四个数字依次为左边、上边、右边、下边，第三第四个数字是右下角坐标，绝对不是宽度和高度。只有完全找不到真人头部才返回空heads。'
     :'重新做头部定位与抠图任务：只找面积最大的主体人物可见头部，半身自拍、图边裁切、单耳、歪头和手机遮挡均有效，不要求完整正脸。不要返回轮廓。只返回严格JSON {"coordinate_system":"normalized_1000","coordinate_format":"xyxy","heads":[{"bbox_xyxy":[左边,上边,右边,下边]}]}，数字范围0至1000，必须使用左上、右下两点坐标，不是宽度高度。没有头部才返回空heads。';
    try{geometry=selectProminentHead(await vision(prompt,[source]),raster.width,raster.height)}catch(error){lastError=error;if(error.status===401||error.status===403)throw error}
   }
   if(!geometry&&p.facePhoto){geometry=normalizeHead({box:[0,0,1000,1000]},raster.width,raster.height);referenceMethod='manual-frame';warning='已沿用你保存的人脸参考原图；自动轮廓未定位，头部周边可能保留少量原背景。'}
   if(!geometry)throw new AppError(p.name+'的照片暂未找到可用头部，请换一张本人更清楚的照片后重试'+(lastError?'（识别返回格式暂不可读）':''));
   if(!warning)warning='已自动保留本人完整头部原图区域；为避免裁掉发型或五官，会同时保留少量原背景。';
   let head=extractHead(raster,geometry);if(head.width<8||head.height<8)throw new AppError(p.name+'的头部在原图中太小，请换一张更清楚的照片');
   if(headMatte){try{head=await headMatte(head,{refineHead:true});if(head.mattingApplied){referenceMethod='automatic-head-matte';warning='已自动识别并去除原照片背景，脸部像素保留；边缘与身体衔接仍需核对。'+(head.warning||'')}else warning=head.warning||'自动去背景暂未完成，已保留原头部照片区域。'}catch{warning='自动去背景暂未完成，已保留原头部照片区域，可继续生成或稍后重试。'}}
   if(head.width<32||head.height<32)warning+=(warning?' ':'')+'原照片头部较小，合成后清晰度可能有限。';
   const key=crypto.randomUUID()+'.png',bytes=imageCodec.encode(head);assertSources([p]);fs.writeFileSync(store.photoPath(key),bytes);
   store.commit(d=>{const player=d.players.find(x=>x.id===p.id);player.headCutout=key;player.headSourceKey=sourceKey;player.headGeometryVersion=headMatte&&!head.mattingApplied?'auto-head-v4':geometryVersion;player.headGeometry=geometry;player.headReferenceMethod=referenceMethod;player.headReferenceWarning=warning;return{}});
   return key;
  })();preparing.set(pendingKey,task);try{return await task}finally{if(preparing.get(pendingKey)===task)preparing.delete(pendingKey)}
 };
 async function cover(b){
  if(!Array.isArray(b.ids)||b.ids.length!==2||b.ids[0]===b.ids[1])throw new AppError('请选择两位不同的搭档');
  const sources=b.ids.map(id=>structuredClone(store.player(id)));for(const p of sources)if(!p.photo)throw new AppError(p.name+'还没有上传照片');assertCurrent(sources);
  if(!imageCodec?.decode)throw new AppError('本机图片读取组件未加载，请重新打开完整桌面程序',422);
  const existing=store.data.states.pairs?.value?.groups?.find(g=>g.id===b.groupId);
  if(b.groupId&&(!existing||existing.members.length!==2||!b.ids.every(id=>existing.members.includes(id))))throw new AppError('组合已重新分配，请重新打开本组',409);
  const scene=reserveScene(store,{ids:b.ids,groupId:b.groupId});
  const group=existing||store.data.states.pairs?.value?.groups?.find(g=>g.members.length===2&&b.ids.every(id=>g.members.includes(id)));
  const jobKey=b.groupId||group?.id||[...b.ids].sort().join('|'),token=crypto.randomUUID();jobs.set(jobKey,token);
  const assertJob=()=>{
   assertCurrent(sources);if(jobs.get(jobKey)!==token||store.data.coverSceneAssignments?.[jobKey]!==scene.id)throw new AppError('本组合已有新生成请求或活动已失效，旧结果已忽略',409);
   if(b.groupId){const current=store.data.states.pairs?.value?.groups?.find(g=>g.id===b.groupId);if(!current||current.members.length!==2||!b.ids.every(id=>current.members.includes(id)))throw new AppError('组合已重新分配，旧图片已忽略',409)}
  };
  const content=sources.map(p=>({image:store.photoData(p.photo)}));
  const prompt='请以两张原整图中各自面积最大、最突出的主体为参考，生成一张完整自然的双人真实摄影照片，16:9横版。图一主体在左，图二主体在右；画面只有这两位伙伴，忽略原照片背景路人。最高优先级是整张照片成功、自然、完整，像同一台相机在同一时刻真实拍摄。'+faceRequirements+'\n两个人必须从头发、头部、下巴、脖子、肩膀到躯干和手臂连续自然，头身比例、肩宽、颈部长度与透视合理，肤色、光照、阴影、清晰度和皮肤纹理统一。普通真实成年人的体型和自然站姿，不要统一健美身材、夸张肌肉、过宽肩膀或模板脸。使用自然舒适的半身至大腿构图，两人适度互动，面部清楚、彼此不遮挡。原图中的手机、手或物品遮脸不影响生成，请自然补全遮挡部分并移除遮脸物；不需要用户另外换照片。\n本组唯一主题【'+scene.label+'】：'+scene.setting+'。服装：'+scene.clothing+'。背景、服装与动作符合本主题，非海边主题不要改成海边。请一次生成最终完整照片，面部与头发、身体、场景一起统一绘制；禁止复制粘贴原脸、贴头、面部补丁、拼贴、剪纸、贴纸、悬浮头、断颈、横切接缝、矩形原图背景、分屏、多余人物或肢体，不添加文字、标志和水印。';
  const model=store.data.ai.imageModel,parameters={n:1,size:'1280*720',prompt_extend:false,watermark:false};
  if(!/^qwen-image-2\.1/.test(model))parameters.negative_prompt='剪贴画，拼接头像，贴头，贴纸，悬浮头，断颈，颈部接缝，矩形边框，原照片背景残块，重影，同一张脸，模板脸，混合五官，改变发型，塑料皮肤，多余人物，多余肢体，错误场景，文字，水印';
  const response=await provider('/api/v1/services/aigc/multimodal-generation/generation',{model,input:{messages:[{role:'user',content:[...content,{text:prompt}]}]},parameters});assertJob();
  const url=response.output?.choices?.[0]?.message?.content?.find(x=>x.image)?.image;let u;try{u=new URL(url)}catch{throw new AppError('模型没有返回图片')}
  if(u.protocol!=='https:'||!/(?:^|\.)(?:aliyuncs\.com|alicdn\.com|aliyun\.com)$/.test(u.hostname))throw new AppError('图片下载地址无效');
  // Retry only the existing generated URL so a CDN interruption cannot repeat paid generation.
  let bytes;
  for(let attempt=0;attempt<=3;attempt++){
   assertJob();
   try{
    const downloaded=await fetcher(url,{signal:AbortSignal.timeout(45000)});if(!downloaded.ok)throw new AppError('生成成功，但图片下载失败',downloaded.status);
    bytes=Buffer.from(await downloaded.arrayBuffer());break;
   }catch(error){
    assertJob();if(!retryableDownload(error))throw error;
    // A permanent error here prevents the outer generation queue from paying to generate again.
    if(attempt===3)throw new AppError('生成成功，但图片下载已自动重试3次仍未完成；原合照已保留',400);
    await retryDelay(1000*2**attempt);assertJob();
   }
  }
  assertJob();const imageType=['image/png','image/jpeg','image/webp'].find(type=>validImage(bytes,type));
  if(bytes.length>20*1024*1024||!imageType)throw new AppError('模型返回的图片无法读取');
  // Decode only to verify the returned bytes. Save the complete model image
  // unchanged: no source-face pixels, masks, placement or raster re-encoding.
  try{const image=imageCodec.decode(bytes);if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>40000000||image.data?.length!==image.width*image.height*4||Math.abs(image.width/image.height-16/9)>.05)throw Error('invalid image')}catch{throw new AppError('模型返回的图片无法读取或不是完整16:9照片')}
  let review;
  try{review=await vision('仅检查这张完整照片的结构与场景，不识别人物身份，不比较人物相似度。输出严格JSON {"sceneMatches":true或false,"completePeople":true或false,"naturalBlend":true或false,"issue":"简短中文原因"}。应有恰好两位完整自然的人，头部、下巴、脖子、肩膀连续，人物头身比例合理，没有贴头、悬浮头像、裁切矩形边框、脖子横切接缝、原照片背景残块或明显重复肢体；只在有这些明显结构问题时naturalBlend=false。合理的半身构图不算身体不完整。背景和服装须符合主题【'+scene.label+'】：'+scene.setting+'。主题明显错误时sceneMatches=false。照片因构图截取腿部不算缺失人物。',['data:'+imageType+';base64,'+bytes.toString('base64')])}catch{assertJob()}
  assertJob();
  // An unavailable checker must not discard a valid paid image. Only an
  // explicit defect requests a bounded outer retry; absent fields are unknown.
  if(review?.sceneMatches===false)throw new AppError('完整合照未通过“'+scene.label+'”场景核对，原合照已保留',503);
  if(review?.completePeople===false||review?.naturalBlend===false)throw new AppError('合照人物完整性或自然融合未通过检查'+(typeof review.issue==='string'?'：'+review.issue.slice(0,120):'')+'；原合照已保留，请自动重试',503);
  const reviewed=['sceneMatches','completePeople','naturalBlend'].every(flag=>review?.[flag]===true),quality=reviewed?{sceneMatches:true,completePeople:true,naturalBlend:true,reviewStatus:'passed'}:{reviewStatus:'unavailable'};
  const key='cover-'+crypto.randomUUID()+(imageType==='image/png'?'.png':imageType==='image/webp'?'.webp':'.jpg');fs.writeFileSync(store.photoPath(key),bytes);
  return{photo:key,scene:scene.label+'：'+scene.setting,sceneId:scene.id,coverMethod:'whole-photo-v2',faceSources:sources.map(p=>p.photo),quality,imageModel:model};

 }
 cover.prepareHead=async({id})=>{
  if(!imageCodec)throw new AppError('本机原脸合成组件未加载');
  const p=structuredClone(store.player(id));if(!p.photo)throw new AppError(p.name+'还没有上传照片');
  const headCutout=await cutout(p);assertSources([p]);const player=store.player(id);
  return{id,headCutout,headSourceKey:player.headSourceKey,headGeometryVersion:player.headGeometryVersion,referenceMethod:player.headReferenceMethod,warning:player.headReferenceWarning||''};
 };
 return cover;
}
module.exports={createCoverService,faceRequirements};
