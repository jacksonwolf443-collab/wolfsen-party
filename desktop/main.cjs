'use strict';
const {app,BrowserWindow,ipcMain,protocol,dialog,safeStorage,shell,Menu,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const {pathToFileURL}=require('node:url');
const {Store,createBackend,AppError}=require('./store.cjs');
const {createImageCodec}=require('./image-codec.cjs');
const {segmentHead}=require('./head-matting.cjs');
const appName='派对软件 - 狼森';
app.setName(appName);
const profile=app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData',path.isAbsolute(profile)?profile:path.join(app.getPath('appData'),'WolfsenParty'));
app.setAppUserModelId('com.wolfsenparty.desktop');
protocol.registerSchemesAsPrivileged([{scheme:'party-photo',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const locked=app.requestSingleInstanceLock();
const {createMobileService}=require('./mobile-service.cjs');
const {createFixedRelay,createFixedConfig,validateConfig}=require('./fixed-server.cjs');
const {createMobileStartup}=require('./mobile-startup.cjs');
let window,store,backend,mobile,fixed,fixedConfig,startup;
if(!locked)app.quit();
else{
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
 try{store=new Store(path.join(app.getPath('userData'),'data'));}catch(e){dialog.showErrorBox('存档读取失败',e.message+'\n\n存档目录：'+path.join(app.getPath('userData'),'data'));app.quit();return;}
 const codec={encrypt:token=>{if(!safeStorage.isEncryptionAvailable())throw new AppError('当前电脑无法安全保存服务器连接凭证，请检查 Windows 用户环境');return safeStorage.encryptString(token).toString('base64');},decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))};
 backend=createBackend(store,{getAIKey:()=>process.env.WOLFSEN_DASHSCOPE_API_KEY,imageCodec:createImageCodec(nativeImage),headMatte:segmentHead});
 mobile=createMobileService({store,backend});
 fixedConfig=createFixedConfig({file:path.join(store.directory,'fixed-server.json'),codec});
 fixed=createFixedRelay({onReady:url=>mobile.setPublicURL(url),onStop:()=>mobile.clearPublicURL()});
 startup=createMobileStartup({mobile,fixed,config:fixedConfig});
 app.on('before-quit',()=>{void startup.stop()});
 protocol.handle('party-photo',request=>{try{const u=new URL(request.url);if(u.hostname!=='local'||request.method!=='GET')return new Response('',{status:403});const key=decodeURIComponent(u.pathname.slice(1));const bytes=fs.readFileSync(store.photoPath(key));const type=key.endsWith('.png')?'image/png':key.endsWith('.webp')?'image/webp':'image/jpeg';return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}catch{return new Response('',{status:404});}});
 ipcMain.handle('party:call',async(event,route,body,method)=>{try{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new AppError('无权执行此操作');if(typeof route!=='string'||route.length>100)throw new AppError('操作无效');return{ok:true,data:await command(route,body??{},method)};}catch(e){return{ok:false,error:e instanceof AppError?e.message:e.message||'操作未完成',status:e.status??500};}});
 window=new BrowserWindow({width:1450,height:940,minWidth:1000,minHeight:680,title:appName,backgroundColor:'#f5f4ee',icon:path.join(__dirname,'../assets/icon.png'),show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 Menu.setApplicationMenu(null);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(path.join(__dirname,'../dist/index.html')).href)event.preventDefault();});
 require('./voice-permissions.cjs').installVoicePermissions(window.webContents,path.join(__dirname,'../dist/index.html'));
 window.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F11'){window.setFullScreen(!window.isFullScreen());event.preventDefault();}});
 window.once('ready-to-show',()=>window.show());
 window.loadFile(path.join(__dirname,'../dist/index.html'));
 window.webContents.on('did-fail-load',(_event,code,description)=>{if(code!==-3)dialog.showErrorBox('界面加载失败',description);});
});
app.on('window-all-closed',()=>app.quit());
}
async function saveFile(defaultName,data,filters){const result=await dialog.showSaveDialog(window,{title:'保存文件',defaultPath:path.join(app.getPath('documents'),defaultName),filters});if(result.canceled||!result.filePath)return{canceled:true};fs.writeFileSync(result.filePath,data);return{saved:true,path:result.filePath};}
async function command(route,body,method){
 if(route==='mobile/status')return{...await mobile.status(),startup:startup.status(),fixed:{...fixedConfig.status(),...fixed.status()}};
 if(route==='mobile/start'){await startup.stop();return mobile.start()}
 if(route==='mobile/stop'){await startup.stop();return mobile.status()}
 if(route==='mobile/fixed-save'){
  const config=validateConfig(body);
  await startup.stop();
  return fixedConfig.save(config);
 }
 if(route==='mobile/fixed-import'){
  const chosen=await dialog.showOpenDialog(window,{title:'导入你的服务器连接文件',properties:['openFile'],filters:[{name:'服务器连接文件',extensions:['partyserver','json']}]});if(chosen.canceled)return{canceled:true};
  let value;try{const file=chosen.filePaths[0];if(fs.statSync(file).size>16384)throw Error();value=JSON.parse(fs.readFileSync(file,'utf8'));if(value?.format!=='wolfsen-party-server-v1')throw Error()}catch{throw new AppError('请选择自己部署服务器时生成的 .partyserver 文件')}
  const config=validateConfig(value);await startup.stop();return fixedConfig.save(config);
 }
 if(route==='mobile/fixed-start')return startup.start()
 if(route==='mobile/revoke')return mobile.revoke(body.player);
 if(route==='screen'){const s=await backend(route,body,method);if(s.mode==='missions'){const m=await mobile.status();if(m.running&&(m.public||m.localURLs.length))s.join={qr:m.qr,public:m.public}}return s}
 
 if(route==='desktop/fullscreen'){window.setFullScreen(typeof body.enabled==='boolean'?body.enabled:!window.isFullScreen());return{fullscreen:window.isFullScreen()};}
 if(route==='desktop/data-folder'){const error=await shell.openPath(store.directory);if(error)throw new AppError(error);return{ok:true};}
 if(route==='files/save'){const name=path.basename(String(body.name??'导出.txt'));if(typeof body.data!=='string'||body.data.length>20*1024*1024)throw new AppError('导出内容无效或过大');return saveFile(name,body.data);}
 if(route==='backup/export'){const content=Buffer.from(JSON.stringify(store.exportBackup()));return saveFile('派对软件 - 狼森-'+new Date().toISOString().slice(0,10)+'.jungle',zlib.gzipSync(content),[{name:'派对软件 - 狼森完整备份',extensions:['jungle']}]);}
 if(route==='backup/import'){const chosen=await dialog.showOpenDialog(window,{title:'选择派对软件 - 狼森备份',properties:['openFile'],filters:[{name:'派对软件 - 狼森备份',extensions:['jungle']}]});if(chosen.canceled)return{canceled:true};let backup;try{backup=JSON.parse(zlib.gunzipSync(fs.readFileSync(chosen.filePaths[0]),{maxOutputLength:512*1024*1024}).toString('utf8'));}catch{throw new AppError('备份文件无法读取，请选择此程序导出的.jungle文件');}const answer=await dialog.showMessageBox(window,{type:'question',title:'恢复完整备份',message:'用这份备份恢复玩家、照片与活动进度？',detail:'当前资料会先另存一份恢复前备份。',buttons:['取消','恢复'],defaultId:0,cancelId:0});if(answer.response!==1)return{canceled:true};fs.writeFileSync(path.join(store.directory,'before-restore-'+Date.now()+'.jungle'),zlib.gzipSync(Buffer.from(JSON.stringify(store.exportBackup()))));return{restored:true,...store.restoreBackup(backup)};}
 if(route==='mission/export-cards'){const cards=await backend('mission/cards');if(!cards.length)throw new AppError('请先随机分配任务');const byID=id=>{const p=store.data.players.find(p=>p.id===id);if(p)return p;const m=store.data.missions.find(m=>m.actor===id);return{name:m?.actorName??'已移除玩家',number:m?.actorNumber??'—'};};const escape=value=>{const s=String(value??'');return'"'+(/^[=+\-@\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';};const rows=[['本人编号','本人昵称','我要做的任务','任务对象编号','任务对象昵称','来找我的人','我负责验收的任务','仅本人可见的验收码'],...cards.flatMap(c=>(c.incomingTasks?.length?c.incomingTasks:[null]).map(inc=>[c.number,c.name,c.outgoing.task,byID(c.outgoing.target).number,byID(c.outgoing.target).name,inc?byID(inc.actor).name:'',inc?.task??'',inc?.code??'']))];return saveFile('派对软件 - 狼森-私密任务卡.csv','\ufeff'+rows.map(row=>row.map(escape).join(',')).join('\r\n'),[{name:'任务卡表格',extensions:['csv']}]);}
 if(route==='desktop/reset-backups'){const directory=path.resolve(store.directory,'..','reset-backups');if(!fs.existsSync(directory))throw new AppError('还没有清空前备份');const error=await shell.openPath(directory);if(error)throw new AppError('无法打开备份位置');return{ok:true};}
 return backend(route,body,method);
}
