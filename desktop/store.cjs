'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {isEligible,setAttendance,assertMissionAvailable}=require('./attendance.cjs');
const {createCoverService}=require('./cover-service.cjs');
const {defaultCoverModel,coverEngineVersion}=require('./cover-models.cjs');
const {createTailsService}=require('./tails-session.cjs');
const {createTruthService}=require('./truth-session.cjs');
const {createManualAwardsService}=require('./manual-awards.cjs');
const {createPodiumAwardsService,invalidatePodiumChoices}=require('./podium-awards.cjs');
const {createResetService}=require('./reset-service.cjs');
const {createPairSupplementService}=require('./pair-supplement.cjs');
const {createMissionSupplementService}=require('./mission-supplement.cjs');
const {createLotteryPreview}=require('./lottery-preview.cjs');
const {selectedIds,recordSelections,selectDrawing,drawingRepeat,createDrawingPreview}=require('./party-selection.cjs');
const {createPlayerScores,normalizeScoreData,scoreValue}=require('./player-scores.cjs');
const {createAIPairing}=require('./ai-pairing.cjs');
const {repairSavedPairReasons}=require('./pair-reason-repair.cjs');
const {createPairTournamentService}=require('./pair-tournament.cjs');
const {isPairTeamEligible,validPairTeam}=require('./pair-team-rules.cjs');
const {createPairSummaryService}=require('./pair-summary.cjs');
const {buildPartySummary,recordSelectionDetails,captureDrawSuccess,archiveActivitySummary,archiveMissions}=require('./party-summary.cjs');
const {createCropSession}=require('./crop-session.cjs');
const {createFansService}=require('./fans-session.cjs');
const {reconcileAutomaticScores,createGameWins}=require('./automatic-scores.cjs');
const {activityStateKinds}=require('./activity-labels.cjs');
const clone=x=>structuredClone(x);
const defaults={region:'beijing',workspace:'',textModel:'qwen-plus',visionModel:'qwen3-vl-plus',imageModel:defaultCoverModel,coverEngineVersion};
const kinds=new Set([...activityStateKinds.filter(Boolean),'screen']);
function screenActivity(s){
 if(s?.activity)return s.activity;
 const modes={pair:1,'pair-profile':1,'pair-pk':1,story:2,drawing:4,crop:5,battle:6,missions:7,lottery:8,'global-scores':9,'party-summary':9,'crop-roster':5};
 if(modes[s?.mode])return modes[s.mode];
 const text=[s?.title,s?.subtitle,s?.tag].join(' ');
 if(/天作之合|今晚谁最搭/.test(text))return 1;if(/局部通缉令|这又是哪位佳丽/.test(text))return 5;if(/尾巴|抢后面大赛|线下决斗/.test(text))return 3;if(/抢男人|抢粉丝|王不见王/.test(text))return 6;
 return null;
}
function photoReferences(data){const awardPhotos=Object.values(data.manualAwards?.records??{}).flatMap(a=>(a.winners??[]).map(p=>p.photo)).filter(Boolean);const refs=new Set(data.players.flatMap(p=>[p.photo,p.facePhoto,p.headCutout]).filter(Boolean));for(const g of data.states.pairs?.value?.groups??[]){if(g.cover)refs.add(g.cover);for(const key of g.faceSources??[])refs.add(key)}for(const p of data.states.lottery?.value?.people??[])if(p?.photo)refs.add(p.photo);for(const p of data.states.screen?.value?.people??[])if(p?.photo)refs.add(p.photo);for(const key of awardPhotos)refs.add(key);return refs;}
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function normalizeNumber(value){const s=String(value??'').normalize('NFKC').trim();if(!/^[\p{L}\p{N}_-]{1,16}$/u.test(s))throw new AppError('编号请输入1–16位文字、数字、下划线或短横线');return s;}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function assignMissions(ids,bank){const a=shuffle([...new Set(ids)]),tasks=shuffle(bank.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean));if(a.length<2)throw new AppError('至少需要2名参与玩家');if(!tasks.length)throw new AppError('请先填写至少一道任务');const balanced=shuffle(a.map((_,i)=>tasks[i%tasks.length]));return a.map((actor,i)=>({actor,target:a[(i+1)%a.length],task:balanced[i]}));}
const newData=()=>({format:'jungle-party-local-v1',event:{id:crypto.randomUUID(),title:'派对软件'},players:[],states:{},selectionCounts:{},scoreHistory:[],missions:[],ai:{...defaults},updatedAt:new Date().toISOString()});
function validateData(d){if(!d||d.format!=='jungle-party-local-v1'||!Array.isArray(d.players)||!d.states||!Array.isArray(d.missions)||!d.event?.id)throw new AppError('存档格式不正确');const ids=new Set(),numbers=new Set();for(const p of d.players){if(typeof p.id!=='string'||ids.has(p.id)||numbers.has(p.number)||normalizeNumber(p.number)!==p.number||!p.name)throw new AppError('存档玩家资料不完整或编号重复');ids.add(p.id);numbers.add(p.number);}d.ai=aiOptions(d.ai);normalizeScoreData(d,AppError);return d;}
class Store{
 constructor(directory){this.directory=path.resolve(directory);this.file=path.join(this.directory,'party.json');this.photos=path.join(this.directory,'photos');this.recoveryMessage='';fs.mkdirSync(this.photos,{recursive:true});if(fs.existsSync(this.file)){try{this.data=validateData(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch{try{this.data=validateData(JSON.parse(fs.readFileSync(this.file+'.bak','utf8')));const broken=this.file+'.damaged-'+Date.now();fs.copyFileSync(this.file,broken);fs.copyFileSync(this.file+'.bak',this.file);this.recoveryMessage='主存档读取失败，已恢复上一次自动备份。请核对最近一次修改，原文件已保留。';}catch{throw new AppError('本地存档无法读取，程序没有覆盖你的资料。请保留存档文件夹并使用备份恢复。');}}}else{this.data=newData();this.persist();}if(reconcileAutomaticScores(this.data,AppError))this.persist();}
 persist(){this.data.updatedAt=new Date().toISOString();const next=JSON.stringify(this.data);const temp=this.file+'.tmp';let fd;try{fd=fs.openSync(temp,'w');fs.writeFileSync(fd,next,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(fs.existsSync(this.file)){fs.copyFileSync(this.file,this.file+'.bak.tmp');fs.renameSync(this.file+'.bak.tmp',this.file+'.bak');}fs.renameSync(temp,this.file);}catch(e){if(fd!==undefined)try{fs.closeSync(fd);}catch{}throw new AppError('保存失败，请检查磁盘空间或存档文件夹权限。'+e.message);}}
 commit(fn){const old=clone(this.data);try{const value=fn(this.data);reconcileAutomaticScores(this.data,AppError);invalidatePodiumChoices(this.data,AppError);this.persist();return clone(value);}catch(e){this.data=old;throw e;}}
 player(id){const p=this.data.players.find(x=>x.id===id);if(!p)throw new AppError('找不到这位玩家',404);return p;}
 state(kind){return clone(this.data.states[kind]??{value:null,version:0});}
 putState(kind,value,version){if(!kinds.has(kind))throw new AppError('无效的活动');const previous=this.state(kind);if(version!==undefined&&Number(version)!==previous.version)throw new AppError('该活动已被更新，请刷新后再操作',409);if(JSON.stringify(value).length>12*1024*1024)throw new AppError('活动内容过大');return this.commit(d=>{const selected=[...selectedIds(kind,value,previous.value),...(kind==='draw'?drawingRepeat(d,value,previous.value):[])];recordSelections(d,selected);recordSelectionDetails(d,selected,kind,value);if(kind==='draw')captureDrawSuccess(d,value);if(kind==='pairs'&&JSON.stringify((value?.groups??[]).map(g=>g.id))!==JSON.stringify((previous.value?.groups??[]).map(g=>g.id)))archiveActivitySummary(d,kind,previous.value);d.states[kind]={value:clone(value),version:previous.version+1};return{version:previous.version+1};});}
 photoPath(key){if(typeof key!=='string'||!/^(?:cover-)?[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/.test(key))throw new AppError('图片标识不正确');return path.join(this.photos,key);}
 upload(bytes,type){const b=Buffer.from(bytes??[]);if(!b.length||b.length>5*1024*1024)throw new AppError('请选择5MB以内的照片');if(!validImage(b,type))throw new AppError('请选择有效的JPG、PNG或WebP照片');const key=crypto.randomUUID()+'.'+({['image/png']:'png',['image/jpeg']:'jpg',['image/webp']:'webp'}[type]);fs.writeFileSync(this.photoPath(key),b);return{key};}
 photoData(key){const type=key.endsWith('.png')?'image/png':key.endsWith('.webp')?'image/webp':'image/jpeg';return'data:'+type+';base64,'+fs.readFileSync(this.photoPath(key)).toString('base64');}
 round(){const r=clone(this.data.missionRound??null);if(r&&Date.now()>=r.endsAt)r.ended=true;return r;}
 inRound(id){const r=this.round();return r&&!r.ended&&this.data.missions.some(x=>x.round===r.id&&(x.actor===id||x.target===id));}
 exportBackup(){const data=clone(this.data);delete data.ai;const photos={};const references=photoReferences(data);for(const key of references)photos[key]=fs.readFileSync(this.photoPath(key)).toString('base64');return{format:'jungle-party-backup-v1',exportedAt:new Date().toISOString(),data,photos};}
 restoreBackup(input){if(input?.format!=='jungle-party-backup-v1'||!input.photos||typeof input.photos!=='object')throw new AppError('请选择此程序导出的备份文件');const data=validateData(clone(input.data));const refs=photoReferences(data);const prepared=[];for(const key of refs){const target=this.photoPath(key),encoded=input.photos[key];if(typeof encoded!=='string'||encoded.length>32*1024*1024)throw new AppError('备份照片不完整：'+key);const bytes=Buffer.from(encoded,'base64');if(!validImage(bytes,key.endsWith('.png')?'image/png':key.endsWith('.webp')?'image/webp':'image/jpeg'))throw new AppError('备份照片损坏');prepared.push({target,bytes});}for(const {target,bytes}of prepared)fs.writeFileSync(target,bytes);data.ai=clone(this.data.ai??defaults);this.commit(d=>{for(const key of Object.keys(d))delete d[key];Object.assign(d,data);return{players:data.players.length};});return{players:data.players.length};}
}
function validImage(b,type){return(type==='image/jpeg'&&b[0]===255&&b[1]===216)||(type==='image/png'&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)||(type==='image/webp'&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP');}
function aiOptions(config={}){
 const {region,workspace,textModel,visionModel,imageModel,coverEngineVersion:engineVersion}=config??{};
 const model=(value,fallback)=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)?value:fallback;
 return{
  region:region==='singapore'?'singapore':'beijing',
  workspace:typeof workspace==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(workspace)?workspace:'',
  textModel:model(textModel,defaults.textModel),visionModel:model(visionModel,defaults.visionModel),
  imageModel:model(imageModel,defaults.imageModel),coverEngineVersion:Number.isInteger(engineVersion)?engineVersion:0,
 };
}
function parseAIJSON(s){try{return JSON.parse(s.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim());}catch{try{return JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));}catch{throw new AppError('AI返回格式不完整，请重试；原结果没有修改');}}}
function createBackend(store,{getAIKey=()=>'',imageCodec,headMatte,faceLocalizer,fetcher=globalThis.fetch}={}){
 const aiKey=()=>String(getAIKey()??'').trim();
 const publicAI=config=>({...aiOptions(config),hasKey:!!aiKey()});
 const provider=async(route,body)=>{
  const c=store.data.ai,key=aiKey();
  if(!key)throw new AppError('云端 AI 未启用。可继续使用线下玩法，或按公开版文档自行配置。',428);
  const region=c.region==='singapore'?'ap-southeast-1':'cn-beijing';
  const host=c.workspace?'https://'+c.workspace+'.'+region+'.maas.aliyuncs.com':c.region==='singapore'?'https://dashscope-intl.aliyuncs.com':'https://dashscope.aliyuncs.com';
  let response;
  try{response=await fetcher(host+route,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)})}
  catch(e){throw new AppError(e.name==='TimeoutError'?'AI请求超时，请稍后再试':'AI连接失败，请检查联网情况和地域设置',e.name==='TimeoutError'?408:503)}
  let data;
  try{data=await response.json()}catch{throw new AppError('AI服务返回无法识别的内容',502)}
  if(!response.ok||data.code){
   const redacted=value=>String(value).replaceAll(key,'[已隐藏]');
   const code=redacted(data.error?.code??data.code??'');
   const status=response.status>=400?response.status:/throttl|rate.?limit/i.test(code)?429:400;
   const error=new AppError('千问调用失败：'+redacted(data.error?.message??data.message??response.status).slice(0,300),status);
   error.code=code;throw error;
  }
  return data;
 };
 const aiText=async(prompt,image)=>{const c=store.data.ai;const d=await provider('/compatible-mode/v1/chat/completions',{model:image?c.visionModel:c.textModel,messages:[{role:'user',content:image?[{type:'image_url',image_url:{url:image}},{type:'text',text:prompt}]:prompt}],enable_thinking:false,max_tokens:4000,temperature:image?0.3:0.85});const answer=d.choices?.[0]?.message?.content;if(typeof answer!=='string')throw new AppError('模型没有返回文字，请检查模型设置');return answer;};
 const cover=createCoverService({store,provider,imageCodec,headMatte,faceLocalizer,parseAIJSON,AppError,fetcher,isEligible,validImage});
 const lottery=createLotteryPreview({store,isEligible,shuffle,AppError});
 const drawing=createDrawingPreview({store,isEligible,shuffle,AppError});
 const scores=createPlayerScores(store,AppError);
 const podiumAwards=createPodiumAwardsService({store,AppError});
 const gameWins=createGameWins(store,{isEligible,AppError});
 const tailsService=createTailsService({store,isEligible,shuffle,AppError});
 const truthService=createTruthService({store,isEligible,AppError});
 const aiPairing=createAIPairing({store,aiText,parseAIJSON,isEligible,AppError,shuffle});
 const pairTournament=createPairTournamentService({store,isEligible,AppError,shuffle});
 const pairSummary=createPairSummaryService({store,isEligible,AppError});
 const crop=createCropSession({store,isEligible,shuffle,AppError}),fansService=createFansService({store,isEligible,AppError});
 const manualAwards=createManualAwardsService({store,AppError}),resets=createResetService(store,{AppError}),pairSupplement=createPairSupplementService({store,isEligible,AppError,aiPairing,hasAI:()=>!!aiKey(),shuffle}),missionSupplement=createMissionSupplementService({store,isEligible,AppError,shuffle});
 return async function api(route,b,method){b=b??{};method=method??'POST';const d=store.data;
 if(route==='boot'){
  repairSavedPairReasons(store);
  if(!d.selectionCounts)store.commit(state=>{state.selectionCounts={};for(const kind of ['lottery','truth','fans','draw','crop']){const v=state.states[kind]?.value;if(kind==='draw'&&v?.player)recordSelections(state,[v.player]);else recordSelections(state,selectedIds(kind,v,null))}return{}});
  if(!Number.isInteger(d.ai.coverEngineVersion)||d.ai.coverEngineVersion<coverEngineVersion)store.commit(state=>{const prior=state.ai.coverEngineVersion??0;if(state.ai.imageModel==='qwen-image-2.1-turbo'||(prior<2&&state.ai.imageModel==='qwen-image-2.0-pro'))state.ai.imageModel=defaultCoverModel;state.ai.coverEngineVersion=coverEngineVersion;return{}});
  return{event:clone(d.event),players:clone(d.players),states:clone(d.states),ai:publicAI(d.ai),dataDirectory:store.directory,resetEpoch:d.resetEpoch??0,recoveryMessage:store.recoveryMessage};
 }
 if(route==='reset/preview')return resets.preview(b.scope);
 if(route==='reset/confirm')return resets.confirm(b);
 if(route==='reset/cancel')return resets.cancel(b);
 if(route==='awards/manual/list')return manualAwards.list();
 if(route==='awards/manual/save')return manualAwards.save(b);
 if(route==='awards/manual/clear')return manualAwards.clear(b);
 if(route.startsWith('pairs/supplement/'))return pairSupplement(route.slice('pairs/supplement/'.length),b);
 if(route.startsWith('pairs/summary/'))return pairSummary(route.slice('pairs/summary/'.length),b);
 if(route==='mission/supplement')return missionSupplement.append(b);
 if(route.startsWith('tails/'))return tailsService(route.slice(6),b);
 if(route.startsWith('talent/'))return truthService(route.slice(7),b);
 if(route==='players/attendance')return setAttendance(store,b,AppError);
 if(route==='scores/list')return scores.list();
 if(route==='scores/adjust')return scores.adjust(b);
 if(route==='scores/detail')return scores.detail(b);
 if(route==='game/win')return gameWins.win(b);
 if(route==='game/win/list')return gameWins.list(b);
 if(route==='game/win/revoke')return gameWins.revoke(b);
 if(route==='summary/list')return buildPartySummary(d);
 if(route==='awards/podium/resolve')return podiumAwards.resolve(b);
 if(route==='awards/podium/restart')return podiumAwards.restart(b);
 if(route==='players'&&method==='GET')return clone(d.players);
 if(route==='players'&&(method==='POST'||method==='PUT')){const number=normalizeNumber(b.number),name=String(b.name??'').trim();if(!name||name.length>40)throw new AppError('玩家名字请输入1–40个字');const previous=method==='PUT'?store.player(String(b.id)):null;const active=b.active===false||b.active===0?0:1;if(previous&&store.inRound(previous.id)&&!active)throw new AppError('玩家正在任务轮中，请先结束该轮再设为不参与');if(previous&&Number(b.version??0)!==Number(previous.version??0))throw new AppError('这位玩家已被更新，请重新打开档案再编辑',409);if(d.players.some(x=>x.number===number&&x.id!==previous?.id))throw new AppError('这个编号已经存在，请换一个；原玩家没有被覆盖',409);const photo=String(b.photo??'');if(photo&&!fs.existsSync(store.photoPath(photo)))throw new AppError('找不到照片，请重新上传');const player={id:previous?.id??crypto.randomUUID(),name,number,photo,score:previous?scoreValue(previous,AppError):0,facePhoto:previous?.photo===photo?(previous.facePhoto??''):'',headCutout:previous?.photo===photo?(previous.headCutout??''):'',headSourceKey:previous?.photo===photo?(previous.headSourceKey??''):'',...(previous?.photo===photo?Object.fromEntries(['headGeometryVersion','headGeometry','headReferenceMethod','headReferenceWarning'].filter(k=>previous[k]!==undefined).map(k=>[k,previous[k]])):{}),attendance:previous?(previous.attendance??'present'):'away',checkedInAt:previous?.checkedInAt??null,...(previous?.attendanceUpdatedAt?{attendanceUpdatedAt:previous.attendanceUpdatedAt}:{}),...(previous?.lastCheckOutAt?{lastCheckOutAt:previous.lastCheckOutAt}:{}),interests:String(b.interests??'').slice(0,300),trait:String(b.trait??previous?.trait??'').slice(0,300),wish:String(b.wish??previous?.wish??'').slice(0,300),consent:b.consent?1:0,active,version:previous?Number(previous.version??0)+1:0,created_at:previous?.created_at??new Date().toISOString()};return store.commit(state=>{if(previous)state.players=state.players.map(x=>x.id===player.id?player:x);else state.players.push(player);return{player};});}
 if(route==='players'&&method==='DELETE'){store.player(b.id);if(store.inRound(b.id))throw new AppError('玩家正在任务轮中，请先结束该轮再删除');return store.commit(state=>{state.players=state.players.filter(x=>x.id!==b.id);return{ok:true};});}
 if(route==='players/face'){
  const p=store.player(b.id);if(Number(b.version)!==Number(p.version??0))throw new AppError('这位玩家已被更新，请重新打开档案',409);
  if(!p.photo||b.sourcePhoto!==p.photo)throw new AppError('原照片已更换，请重新选取人脸参考',409);
  const key=String(b.photo??'');if(key&&!fs.existsSync(store.photoPath(key)))throw new AppError('找不到人脸参考照片');
  return store.commit(state=>{const player=state.players.find(x=>x.id===p.id);player.facePhoto=key;player.headCutout='';player.headSourceKey='';for(const key of ['headGeometryVersion','headGeometry','headReferenceMethod','headReferenceWarning'])delete player[key];player.version=Number(player.version??0)+1;return{player}});
 }
 if(route==='activity/reset'){
  const number=Number(b.number),kind=activityStateKinds[number-1];if(!Number.isInteger(number)||!kind)throw new AppError('无效的活动');
  const previous=store.state(kind);if(Number(b.version)!==previous.version)throw new AppError('该活动已被更新，请重新打开后再清空',409);
  return store.commit(state=>{
   archiveActivitySummary(state,kind,previous.value);state.states[kind]={value:null,version:previous.version+1};
   if(number===7){archiveMissions(state);state.missions=[];state.missionRound=null}if(number===1)state.coverSceneAssignments={};
   const screen=state.states.screen;if(screen&&screenActivity(screen.value)===number)state.states.screen={value:null,version:screen.version+1};
   return{version:previous.version+1};
  });
 }
 if(route==='draw/select')return drawing.select(b);
 if(route==='draw/commit')return drawing.commit(b);
 if(route==='draw/cancel')return drawing.cancel(b);
 if(route.startsWith('crop/')){const action=route.slice(5);if(!['select','commit','cancel','photo','start','frame','result'].includes(action))throw new AppError('没有这个照片操作',404);return crop[action](b);}
 if(route.startsWith('fans/'))return fansService(route.slice(5),b);
 if(route.startsWith('pairs/tournament/'))return pairTournament(route.slice('pairs/tournament/'.length),b);
 if(route==='selection/counts')return clone(d.selectionCounts??{});
 if(route==='pairs/assign-challenges'){
  const previous=store.state('pairs');if(Number(b.version)!==previous.version)throw new AppError('该活动已被更新，请刷新后再分配',409);
  const value=previous.value,bank=(value?.challengeBank??[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim().slice(0,2000));
  if(!bank.length)throw new AppError('请先填写至少一道自定义挑战');
  const groups=value.groups??[],eligible=groups.filter(g=>isPairTeamEligible(g,d.players,isEligible));
  if(!eligible.length)throw new AppError('请先为在场玩家配对');
  const randomized=shuffle(bank),tasks=shuffle(Array.from({length:eligible.length},(_,i)=>randomized[i%randomized.length])),assign=new Map(shuffle(eligible).map((g,i)=>[g.id,tasks[i]]));
  const next={...value,groups:groups.map(g=>assign.has(g.id)?{...g,challenge:assign.get(g.id)}:g)};
  return{...store.putState('pairs',next,previous.version),value:next,count:eligible.length};
 }
 if(route==='lottery/draw')return lottery.draw(b);
 if(route==='lottery/commit')return lottery.commit(b);
 if(route==='lottery/cancel')return lottery.cancel(b);
 if(route==='ai/head-reference')return cover.prepareHead(b);
 if(route==='upload')return store.upload(b.bytes,b.type);
 if(route==='photo/data')return{data:store.photoData(b.key)};
 if(route==='state'){
  if(b.resetEpoch!==undefined&&b.resetEpoch!==(d.resetEpoch??0)||b.eventId!==undefined&&b.eventId!==d.event.id)throw new AppError('活动已经清空，旧保存结果已忽略',409);
  if((d.resetEpoch??0)>0&&b.version===undefined)throw new AppError('清空后保存必须使用当前活动版本',409);
  if(b.kind==='pairs'&&Object.prototype.hasOwnProperty.call(b,'matchedRosterSnapshot')){
   const roster=JSON.stringify(d.players.filter(isEligible).map(p=>[p.id,p.name,p.number,p.photo,p.interests??'',p.wish??'']).sort((a,b)=>a[0].localeCompare(b[0])));
   if(typeof b.matchedRosterSnapshot!=='string'||b.matchedRosterSnapshot!==roster)throw new AppError('玩家名单或档案已变化，本次配对未保存，请重新配对',409);
   const groups=b.value?.groups??[];
   if(groups.length){if(groups.some(g=>!validPairTeam(g)))throw new AppError('队伍成员不能重复；单人队必须明确标记为单人成队并占2个名额');const members=groups.flatMap(g=>g.members),eligible=d.players.filter(isEligible).map(p=>p.id);if(new Set(members).size!==members.length||members.length!==eligible.length||members.some(id=>!eligible.includes(id))||(b.value.standby??[]).length)throw new AppError('配对名单必须让每位在场玩家恰好进入一队，奇数最后一位单人成队');}
  }
  return store.putState(b.kind,b.value,b.version);
 }
 if(route==='screen'){const s=clone(d.states.screen?.value??{mode:'welcome',title:'派对软件 - 狼森',subtitle:'一场属于所有人的派对'});let progress=null;if(s.mode==='missions'&&d.missionRound){progress={round:store.round(),rows:d.missions.filter(x=>x.round===d.missionRound.id&&(store.round()?.ended||x.completed_at||isEligible(d.players.find(p=>p.id===x.actor))&&isEligible(d.players.find(p=>p.id===x.target)))).map(x=>({id:x.id,actor:x.actor,target:x.target,task:x.task,paused:![x.actor,x.target].every(id=>isEligible(d.players.find(p=>p.id===id))),targetName:d.players.find(p=>p.id===x.target)?.name??x.targetName??'已移除玩家',targetNumber:d.players.find(p=>p.id===x.target)?.number??x.targetNumber??'—',completed_at:x.completed_at,photo:d.players.find(p=>p.id===x.actor)?.photo??'',name:d.players.find(p=>p.id===x.actor)?.name??x.actorName??'已移除玩家',number:d.players.find(p=>p.id===x.actor)?.number??x.actorNumber??'—'}))};}return{...s,progress};}
 if(route==='mission/start'){if(store.round()&&!store.round().ended)throw new AppError('请先结束当前任务轮，再重新分配');const assignments=assignMissions(d.players.filter(isEligible).map(x=>x.id),d.states.taskBank?.value??[]),round={id:crypto.randomUUID(),startedAt:Date.now(),endsAt:Date.now()+Math.max(1,Math.min(180,Number(b.minutes)||20))*60000,ended:false};const codes=new Set();const missions=assignments.map(x=>{let code;do{code=String(crypto.randomInt(0,1000000)).padStart(6,'0');}while(codes.has(code));codes.add(code);return{...x,actorName:store.player(x.actor).name,actorNumber:store.player(x.actor).number,targetName:store.player(x.target).name,targetNumber:store.player(x.target).number,id:crypto.randomUUID(),round:round.id,code,completed_at:null};});return store.commit(state=>{archiveMissions(state);state.missionRound=round;state.missions=missions;return{round};});}
 if(route==='mission/list')return{round:store.round(),missions:d.missions.filter(x=>x.round===d.missionRound?.id).map(({code,...rest})=>clone(rest))};
 if(route==='mission/cards'){return d.players.filter(x=>d.missions.some(m=>m.actor===x.id&&m.round===d.missionRound?.id)).map(p=>({id:p.id,number:p.number,name:p.name,outgoing:clone(d.missions.find(m=>m.actor===p.id&&m.round===d.missionRound.id)),incoming:clone(d.missions.find(m=>m.target===p.id&&m.round===d.missionRound.id)),incomingTasks:clone(d.missions.filter(m=>m.target===p.id&&m.round===d.missionRound.id))}));}
 if(route==='mission/end')return store.commit(state=>{if(state.missionRound)state.missionRound.ended=true;return{ok:true};});
 if(route==='mission/verify'){const round=store.round();if(!round||round.ended)throw new AppError('本轮活动已结束');const m=d.missions.find(x=>x.actor===b.actor&&x.round===round.id);if(!m)throw new AppError('这位玩家还没有任务');if(m.completed_at)return{ok:true,already:true};assertMissionAvailable(d,m,AppError);if(String(b.code??'').trim()!==m.code)throw new AppError('验收码不正确，请向任务对象核对');return store.commit(state=>{state.missions.find(x=>x.id===m.id).completed_at=new Date().toISOString();return{ok:true};});}
 if(route==='mission/approve'){const round=store.round();if(!round||round.ended)throw new AppError('本轮活动已结束');const m=d.missions.find(x=>x.id===b.id&&x.round===d.missionRound?.id);if(!m)throw new AppError('找不到当前任务');assertMissionAvailable(d,m,AppError);return store.commit(state=>{state.missions.find(x=>x.id===m.id).completed_at=new Date().toISOString();return{ok:true};});}
 if(route==='ai/settings'){
  const next=aiOptions(d.ai);
  for(const field of ['textModel','visionModel','imageModel']){
   if(b[field]===undefined)continue;
   if(typeof b[field]!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(b[field]))throw new AppError('模型名称格式不正确');
   next[field]=b[field];
  }
  if(b.region)next.region=b.region==='singapore'?'singapore':'beijing';
  if(b.workspace!==undefined){
   if(typeof b.workspace!=='string'||b.workspace&&!/^[a-zA-Z0-9_-]{1,80}$/.test(b.workspace))throw new AppError('业务空间ID格式不正确');
   next.workspace=b.workspace;
  }
  return store.commit(state=>{state.ai=next;return publicAI(next)});
 }
 if(route==='ai/test')return{text:await aiText('请用中文回复：连接成功。')};
 if(route==='ai/pairs')return aiPairing(b);
 if(route==='ai/challenge'){const ps=Array.isArray(b.ids)?b.ids.map(id=>store.player(id)):[],solo=ps.length===1&&(d.states.pairs?.value?.groups??[]).some(g=>g.solo===true&&g.seats===2&&g.members?.length===1&&g.members[0]===ps[0].id);if(ps.length!==2&&!solo||new Set(ps.map(p=>p.id)).size!==ps.length)throw new AppError('请选择两位搭档或已保存的单人成队玩家');if(ps.some(p=>!isEligible(p)))throw new AppError('搭档未到或已离场，请重新选择');return{text:await aiText((solo?'给一位单人成队的成年玩家生成一个可独自完成、按2个名额参加对战的1分钟挑战，依据实际玩家兴趣和心愿，':'给两位成年朋友生成一个在舞台1分钟内完成的默契挑战，依据两个兴趣与一直想做却没敢做的事，')+'只输出题目和清楚的成功标准，120字以内，不强制接触或饮酒，不涉及危险动作。'+JSON.stringify(ps.map(({name,interests,wish})=>({name,interests,wish:wish??''}))))};}
 if(route==='ai/truth')return{text:await aiText('即兴故事游戏：三人中两人冒充当事人。请根据下面故事提供5个观众追问及演员应对方向，不要宣称虚构信息是真实事实。'+String(b.story??'').slice(0,2000))};
 if(route==='ai/fans')return{text:await aiText('为成年朋友派对决赛生成3道简单有趣的1V1挑战。每项30秒，不需要道具或身体对抗，不强迫接触、饮酒，不涉及危险。写清如何判胜，每题70字以内，编号1、2、3。')};
 if(route==='ai/guess'){if(typeof b.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(b.image)||b.image.length>2*1024*1024)throw new AppError('画布截图无效');return{text:await aiText('你在玩你画我猜。只根据白色画布线条猜测动作或物体，给出最可能的一个中文词语，不超过12字，不作解释。',b.image)};}
 if(route==='ai/cover')return cover(b);
 throw new AppError('没有这个操作：'+route,404);
 };
}
module.exports={Store,AppError,createBackend,assignMissions,shuffle,normalizeNumber,validImage};
