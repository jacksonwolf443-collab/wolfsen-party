'use strict';

// Multi-reference editing models only. Speed notes describe vendor claims;
// they are not latency guarantees for a particular region or API account.
const defaultCoverModel='qwen-image-3.0-pro',coverEngineVersion=4;
const coverModels=Object.freeze([
 {id:'qwen-image-2.1-turbo',label:'千问 2.1 Turbo · 加速编辑',referenceLimit:10,speedNote:'官方8步加速模型；实际耗时以本机测试为准'},
 {id:'qwen-image-3.0',label:'千问 3.0 · 标准编辑',referenceLimit:3,speedNote:'官方说明比3.0 Pro生成更快'},
 {id:'qwen-image-3.0-pro',label:'千问 3.0 Pro · 精细编辑',referenceLimit:3,speedNote:'保留原有精细编辑选择'},
 {id:'wan2.7-image',label:'万相 2.7 · 标准编辑',referenceLimit:9,speedNote:'官方说明比万相2.7 Pro生成更快'}
]);
function coverParameters(model,negativePrompt){
 const parameters={n:1,size:'1792*1008',watermark:false};
 // Wan 2.7 documents neither prompt_extend nor negative_prompt. Qwen 2.1
 // documents prompt_extend but explicitly excludes negative_prompt support.
 if(/^wan2\.7-image(?:-pro)?$/.test(model))return parameters;
 parameters.prompt_extend=false;
 if(!/^qwen-image-2\.1(?:-|$)/.test(model))parameters.negative_prompt=negativePrompt;
 return parameters;
}
module.exports={defaultCoverModel,coverEngineVersion,coverModels,coverParameters};
