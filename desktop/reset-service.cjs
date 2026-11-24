'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {labels,activityStateKinds}=require('./activity-labels.cjs');
const HISTORY_KEYS=['archivedWinEvents','gameWinEvents','drawSuccessHistory','missionHistory','scoreHistory','scoreOpeningBalances','autoScoreLedger','selectionHistory'];
const ACTIVITY_SCOPES=new Set(activityStateKinds.flatMap((kind,index)=>kind?['activity:'+(index+1)]:[]));
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const normalized=scope=>{if(scope&&typeof scope==='object')scope=scope.scope;if(Number.isInteger(scope))scope='activity:'+scope;if(scope==='activity:9')return'scores';return ['all','players','scores'].includes(scope)||ACTIVITY_SCOPES.has(scope)?scope:null};
const version=value=>{const n=value??0;if(!Number.isSafeInteger(n)||n<0||n>=Number.MAX_SAFE_INTEGER)throw Error('存档版本无效，请保留备份后检查');return n+1};
const kindFor=scope=>scope.startsWith('activity:')?(Number(scope.slice(9))===7?'missions':activityStateKinds[Number(scope.slice(9))-1]):null;
const eventKind=x=>x?.kind??x?.source?.kind??x?.event?.kind;
const retiredIds=(data,events)=>[...new Set([...(Array.isArray(data.retiredGameWinEventIds)?data.retiredGameWinEventIds:[]),...(events??[]).map(x=>x.eventId)].filter(id=>typeof id==='string'&&id.length>0))];
const fansBank=value=>value?.challengeBank??(typeof value?.challenges==='string'?value.challenges.split(/\r?\n/).filter(Boolean):[]);
const filled=value=>(Array.isArray(value)?value:[]).filter(x=>typeof x==='string'&&x.trim()).length;
const questionCount=(data,number)=>{const s=data.states??{};return number===1?filled(s.pairs?.value?.challengeBank)+filled(s.pairs?.value?.round2Bank):number===6?filled(fansBank(s.fans?.value)):number===7?filled(s.taskBank?.value):0};
function emptyStates(data,keepBanks){const states={};for(const kind of new Set([...activityStateKinds.filter(Boolean),'screen',...Object.keys(data.states??{})])){const previous=data.states?.[kind],value=previous?.value;let next=null;if(keepBanks&&kind==='taskBank')next=structuredClone(value??[]);if(keepBanks&&kind==='pairs')next={formatVersion:2,round:1,groups:[],standby:[],challengeBank:structuredClone(value?.challengeBank??[]),round2Bank:structuredClone(value?.round2Bank??[])};if(keepBanks&&kind==='fans')next={formatVersion:2,a:'',b:'',teamA:[],teamB:[],rounds:[],seriesHistory:[],scoreA:0,scoreB:0,challengeBank:structuredClone(fansBank(value))};Object.defineProperty(states,kind,{value:{value:next,version:version(previous?.version)},writable:true,enumerable:true,configurable:true})}return states}
function clearEverything(data,scope){
 const old=structuredClone(data),keepPlayers=scope==='scores',keepBanks=scope!=='all',states=emptyStates(old,keepBanks),players=keepPlayers?old.players.map(p=>({...p,score:0,version:version(p.version)})):[];
 for(const key of Object.keys(data))delete data[key];
 Object.assign(data,{format:old.format,event:{...old.event,id:crypto.randomUUID()},ai:old.ai,players,states,missions:[],missionRound:null,selectionCounts:{},coverSceneAssignments:{},drawSelectionStarts:null,autoScoreVersion:1,resetEpoch:version(old.resetEpoch),retiredGameWinEventIds:retiredIds(old,old.gameWinEvents),manualAwards:{version:version(old.manualAwards?.version),records:{}}});
 for(const key of HISTORY_KEYS)data[key]=[];
 data.podiumAwards={version:version(old.podiumAwards?.version),choices:{}};
}
function clearActivity(data,scope){
 const number=Number(scope.slice(9)),stateKind=activityStateKinds[number-1],kind=kindFor(scope),previous=data.states?.[stateKind];
 // Remove only the active automatic contribution of this activity. Manual scores
 // and every other game's source ledger remain unchanged.
 for(const record of data.autoScoreLedger??[])if(record.active&&eventKind(record)===kind){const player=data.players.find(p=>p.id===record.event?.playerId);if(player){player.score=(Number(player.score)||0)-(record.event?.points??1);player.version=version(player.version)}}
 data.autoScoreLedger=(data.autoScoreLedger??[]).filter(x=>eventKind(x)!==kind);
 data.scoreHistory=(data.scoreHistory??[]).filter(x=>!(x.type==='automatic'&&eventKind(x)===kind));
 data.archivedWinEvents=(data.archivedWinEvents??[]).filter(x=>eventKind(x)!==kind);
 data.retiredGameWinEventIds=retiredIds(data,(data.gameWinEvents??[]).filter(x=>eventKind(x)===kind||Number(x.activity)===number));
 data.gameWinEvents=(data.gameWinEvents??[]).filter(x=>eventKind(x)!==kind&&Number(x.activity)!==number);
 const selected=(data.selectionHistory??[]).filter(x=>x.kind===kind),counts={...(data.selectionCounts??{})};for(const row of selected)if(Object.prototype.hasOwnProperty.call(counts,row.playerId)){counts[row.playerId]=Math.max(0,(Number(counts[row.playerId])||0)-1);if(counts[row.playerId]===0)delete counts[row.playerId]}
 data.selectionHistory=(data.selectionHistory??[]).filter(x=>x.kind!==kind);data.selectionCounts=counts;
 data.states??={};data.states[stateKind]={value:null,version:version(previous?.version)};
 if(kind==='draw'){data.drawSuccessHistory=[];data.drawSelectionStarts=null}
 if(kind==='missions'){data.missions=[];data.missionRound=null;data.missionHistory=[]}
 if(kind==='pairs'){data.coverSceneAssignments={};if(data.pairSummaryAward)data.pairSummaryAward={...data.pairSummaryAward,status:'revoked',version:version(data.pairSummaryAward.version)}}
 const screen=data.states.screen?.value,savedActivity=screen?.activity,mode={pair:1,'pair-profile':1,'pair-pk':1,'pair-heart':1,'pair-board':1,story:2,drawing:4,crop:5,'crop-roster':5,battle:6,missions:7,lottery:8}[screen?.mode];
 if(Number(savedActivity??mode)===number)data.states.screen={value:null,version:version(data.states.screen?.version)};
 data.resetEpoch=version(data.resetEpoch);data.autoScoreVersion=1;
 data.podiumAwards={version:version(data.podiumAwards?.version),choices:{}};
}
function writeResetBackup(store,{scope,now=Date.now()}){
 const directory=path.resolve(store.directory),parent=path.resolve(path.dirname(directory),'reset-backups');if(parent===directory||parent.startsWith(directory+path.sep))throw Error('清空备份不能放在当前data目录内');
 if(fs.existsSync(parent)){const stat=fs.lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('清空备份位置无效')}
 fs.mkdirSync(parent,{recursive:true});const target=path.join(parent,new Date(now).toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID()),copy=path.join(target,'data');fs.mkdirSync(copy,{recursive:true});const files=[];
 const transfer=(source,dest,relative='')=>{for(const name of fs.readdirSync(source)){const from=path.join(source,name),to=path.join(dest,name),part=relative?relative+'/'+name:name,stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw Error('备份不接受链接文件，请先检查存档目录');if(stat.isDirectory()){fs.mkdirSync(to);transfer(from,to,part)}else if(stat.isFile()){const bytes=fs.readFileSync(from);fs.writeFileSync(to,bytes,{flag:'wx'});const sha256=hash(bytes);if(hash(fs.readFileSync(to))!==sha256)throw Error('清空前备份校验失败');files.push({path:part,bytes:bytes.length,sha256})}else throw Error('存档目录包含不支持的文件')}};
 transfer(directory,copy);const normal=store.exportBackup(),compressed=zlib.gzipSync(Buffer.from(JSON.stringify(normal)));fs.writeFileSync(path.join(target,'完整备份.jungle'),compressed,{flag:'wx'});if(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(target,'完整备份.jungle')))).format!=='jungle-party-backup-v1')throw Error('清空前完整备份校验失败');
 fs.writeFileSync(path.join(target,'reset-backup.json'),JSON.stringify({format:'jungle-party-reset-backup-v1',scope,createdAt:new Date(now).toISOString(),files,complete:true},null,2),{flag:'wx'});return target;
}
function createResetService(store,{AppError=Error,now=Date.now,ttlMs=10*60*1000,backup=writeResetBackup}={}){
 const pending=new Map(),fail=(message,status=400)=>{throw new AppError(message,status)};
 const preview=input=>{const scope=normalized(input);if(!scope)fail('请选择有效的清空界面');const data=store.data,kind=kindFor(scope),records=(data.selectionHistory??[]).filter(x=>!kind||x.kind===kind),ledger=(data.autoScoreLedger??[]).filter(x=>x.active&&(!kind||eventKind(x)===kind)),number=kind?Number(scope.slice(9)):null;
  const counts={players:scope==='all'||scope==='players'?data.players.length:0,questions:scope==='all'?[1,6,7].reduce((n,i)=>n+questionCount(data,i),0):questionCount(data,number),groups:!kind||number===1?data.states?.pairs?.value?.groups?.length??0:0,missions:(!kind||kind==='missions')?(data.missions??[]).length:0,wins:ledger.length,selections:kind?records.length:Object.values(data.selectionCounts??{}).reduce((n,v)=>n+(Number(v)||0),0),manualAwards:kind?0:Object.keys(data.manualAwards?.records??{}).length};
  const title=scope==='all'?'清空目前所有内容':scope==='players'?'清空全部玩家及关联数据':scope==='scores'?'清空全场统计与所有比赛结果':'清空'+labels[kind]+'全部内容',keeps=['AI密钥与AI设置','固定服务器连接配置','原始照片文件（不再作为已清空活动展示）'];
  if(scope==='scores')keeps.push('玩家档案、签到状态与已保存题库');if(scope==='players')keeps.push('已保存的两轮PK题库、五局挑战题库和验收题库');if(kind)keeps.push('其他活动、玩家档案、其他游戏积分与主持人手动分');
  const details=scope==='all'?['玩家、所有题库、各游戏进度、当前舞台、验收任务全部从0开始。','清空全部积分、胜场、抽中次数、手工奖项及所有历史记录。']:scope==='players'?['删除全部玩家及关联比赛、验收、积分、抽取和手工奖项记录。','保留题库，已成组与未完成任务一并清空。']:scope==='scores'?['所有玩家总分、胜场、抽中统计、手工奖项和明细归0。','各游戏已完成/进行中的结果及当前分组一并清空，保留名单、签到与题库，避免旧结果再次加分。']:['清空本活动题库、当前进度及可归属本活动的胜利、抽取历史。','退回本活动已记录的自动积分，其他游戏与手动调整分保留。','旧版未分类的抽中次数无法归属到单一活动，会保留；清空09或全部内容才将其归0。'];
  pending.clear();const token=crypto.randomUUID(),expiresAt=now()+ttlMs;pending.set(token,{scope,fingerprint:hash(data),expiresAt});return{token,scope,title,details,keeps,counts,expiresAt};
 };
 const confirm=input=>{const token=typeof input==='string'?input:input?.token,preview=pending.get(token);pending.delete(token);if(!preview||now()>preview.expiresAt)fail('清空确认已失效，请重新预览',409);if(hash(store.data)!==preview.fingerprint)fail('资料已发生变化，请重新查看清空范围后确认',409);
  // Validate and calculate entirely in memory before any filesystem mutation.
  const next=structuredClone(store.data);if(preview.scope.startsWith('activity:'))clearActivity(next,preview.scope);else clearEverything(next,preview.scope);
  const backupPath=backup(store,{scope:preview.scope,now:now()});if(hash(store.data)!==preview.fingerprint)fail('备份期间资料已发生变化，本次未清空，请重新预览',409);
  return store.commit(data=>{for(const key of Object.keys(data))delete data[key];Object.assign(data,next);return{ok:true,scope:preview.scope,backupPath,eventId:data.event.id,resetEpoch:data.resetEpoch,stateVersions:Object.fromEntries(Object.entries(data.states).map(([key,s])=>[key,s.version])),manualAwardsVersion:data.manualAwards?.version??0}});
 };
 return{preview,confirm,cancel(input){pending.delete(typeof input==='string'?input:input?.token);return{canceled:true}}};
}
module.exports={createResetService,writeResetBackup};
