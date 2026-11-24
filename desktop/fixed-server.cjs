'use strict';
const https=require('node:https'),http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const {AppError}=require('./store.cjs');
const GET=new Set(['/','/app.js','/style.css','/api/roster','/api/session','/api/me']),POST=new Set(['/api/claim','/api/verify']);
const REQUEST_HEADERS=new Set(['authorization','x-party-entry','content-type','origin']);
const RESPONSE_HEADERS=new Set(['content-type','cache-control','x-content-type-options','referrer-policy','x-frame-options','content-security-policy']);
function validateConfig(value){
 let u;try{u=new URL(String(value?.url??'').trim())}catch{throw new AppError('请输入有效的服务器地址')}
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.hash||u.search||u.origin.length>300)throw new AppError('服务器地址需要是HTTPS根地址');
 const token=typeof value.token==='string'?value.token.trim():'';
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError('请输入部署时生成的服务器连接凭证');
 return{url:u.origin,token};
}
function createFixedConfig({file,codec}){return{
 save(input){const conf=validateConfig(input);const value={url:conf.url,encryptedToken:codec.encrypt(conf.token)};fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);return this.status()},
 load(){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return validateConfig({url:value.url,token:codec.decrypt(value.encryptedToken)})}catch{throw new AppError('服务器连接配置不可用，请在连接设置中恢复')}},
 status(){try{return{configured:true,url:this.load().url}}catch{return{configured:false,url:''}}}
};}
function createFixedRelay({onReady,onStop,requestImpl=https.request,retryMs=3000}={}){
 let state={state:'off',error:''},generation=0,config=null,session='',client='',takeover=false,port=0,retry=null,agent=null;const active=new Set(),local=new Set();
 const status=()=>({...state});
 const remote=(route,payload,timeout=25000,saved={config,session,agent})=>new Promise((resolve,reject)=>{
  const data=Buffer.from(JSON.stringify(payload));let completed=false;
  const req=requestImpl({protocol:'https:',hostname:new URL(saved.config.url).hostname,port:new URL(saved.config.url).port||443,method:'POST',path:route,agent:saved.agent,headers:{Host:new URL(saved.config.url).host,Authorization:'Bearer '+saved.config.token,'X-Party-Connection':saved.session,'Content-Type':'application/json','Content-Length':data.length}},res=>{
   let bytes=0,chunks=[];res.on('data',b=>{bytes+=b.length;if(bytes>800000)req.destroy(new Error('响应过大'));else chunks.push(b)});
   res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200){const e=new Error(res.statusCode===403?'服务器连接凭证不正确，请重新导入':res.statusCode===409?'固定服务器已由另一电脑连接，请确认后重新连接':'服务器未能完成连接，请稍后重试');e.permanent=[403,409].includes(res.statusCode);throw e}completed=true;resolve(body)}catch(e){reject(e)}});res.on('error',reject);
  });
  active.add(req);req.on('close',()=>active.delete(req));req.on('error',e=>{if(!completed)reject(e)});req.setTimeout(timeout,()=>req.destroy(new Error('连接超时')));req.end(data);
 });
 const forward=(r,gen)=>new Promise(resolve=>{
  const reply=value=>{if(gen===generation)void remote('/_party/reply',{id:r.id,...value},8000).catch(()=>{});resolve()};
  if(!r||typeof r.id!=='string'||!/^[a-f0-9]{32}$/.test(r.id))return resolve();
  if(!(r.method==='GET'?GET:r.method==='POST'?POST:new Set()).has(r.path))return reply({status:404,headers:{'content-type':'application/json'},body:Buffer.from('{"error":"没有这个页面"}').toString('base64')});
  let body;try{if(typeof r.body!=='string'||r.body.length>11000)throw Error();body=Buffer.from(r.body,'base64');if(body.length>8192)throw Error()}catch{return resolve()}
  const headers={host:new URL(config.url).host};for(const[k,v]of Object.entries(r.headers??{}))if(REQUEST_HEADERS.has(k)&&typeof v==='string'&&v.length<16384&&!/[\r\n]/.test(v))headers[k]=v;
  if(r.method==='POST')headers['content-length']=body.length;
  const req=http.request({hostname:'127.0.0.1',port,method:r.method,path:r.path,headers},res=>{let size=0,chunks=[];res.on('data',b=>{size+=b.length;if(size>524288)req.destroy();else chunks.push(b)});res.on('end',()=>{const safe={};for(const[k,v]of Object.entries(res.headers))if(RESPONSE_HEADERS.has(k)&&typeof v==='string')safe[k]=v;reply({status:res.statusCode,headers:safe,body:Buffer.concat(chunks).toString('base64')})});res.on('error',()=>resolve())});
  local.add(req);req.on('close',()=>local.delete(req));req.on('error',()=>reply({status:503,headers:{'content-type':'application/json'},body:Buffer.from('{"error":"电脑手机服务暂不可用"}').toString('base64')}));req.setTimeout(8000,()=>req.destroy());req.end(body);
 });
 const fail=(gen,e)=>{
  if(gen!==generation)return;onStop?.();state={state:e.permanent?'failed':'reconnecting',error:e.permanent?e.message:'与固定服务器连接中断，正在自动重连…'};
  for(const req of local)req.destroy();local.clear();
  if(!e.permanent){retry=setTimeout(()=>{if(gen===generation)void connect(gen).catch(error=>fail(gen,error))},retryMs);retry.unref?.()}
 };
 const poll=async gen=>{try{while(gen===generation){const data=await remote('/_party/poll',{});if(gen!==generation)return;if(!Array.isArray(data.requests)||data.requests.length>32)throw Error('服务器响应格式无效');for(const r of data.requests)void forward(r,gen)}}catch(e){fail(gen,e)}};
 const connect=async gen=>{const replacing=takeover;takeover=false;const data=await remote('/_party/connect',{client,takeover:replacing},8000);if(gen!==generation)return;if(data.service!=='wolfsen-party-relay-v1'||typeof data.session!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.session)){const error=new Error('服务器版本不兼容，请使用公开版自带的服务端');error.permanent=true;throw error}session=data.session;state={state:'ready',error:''};onReady?.(config.url);void poll(gen)};
 return{status,async start(value,localPort){const conf=validateConfig(value);if(!Number.isInteger(localPort)||localPort<1||localPort>65535)throw new AppError('请先开启手机扫码');const stopped=this.stop(),gen=generation;await stopped;if(gen!==generation)return status();config=conf;port=localPort;session='';client=crypto.randomBytes(32).toString('base64url');takeover=true;agent=new https.Agent({keepAlive:true,maxSockets:40});state={state:'starting',error:''};try{await connect(gen)}catch(e){fail(gen,e);throw new AppError(e.permanent?e.message:'暂时未能连接固定服务器，请确认服务器已部署并开放443网页端口')}return status()},
  async stop(){const old={config,session,agent};generation++;clearTimeout(retry);retry=null;for(const r of active)r.destroy();active.clear();for(const r of local)r.destroy();local.clear();session='';agent=null;state={state:'off',error:''};onStop?.();if(old.config&&old.session)await remote('/_party/disconnect',{},1500,old).catch(()=>{});old.agent?.destroy();}
 };
}
module.exports={createFixedRelay,createFixedConfig,validateConfig};
