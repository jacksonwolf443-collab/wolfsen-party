'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const QRCode=require('qrcode');
const {isEligible}=require('./attendance.cjs');
const {AppError}=require('./store.cjs');
const secret=()=>crypto.randomBytes(32).toString('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function createMobileService({store,backend}){
 let server=null,port=0,entry='',publicBase='',qrCache=null;const sessions=new Map(),limits=new Map();
 const prune=()=>{const now=Date.now();for(const[k,s]of sessions)if(s.expires<now||s.eventId!==store.data.event.id||!store.data.players.some(p=>p.id===s.player))sessions.delete(k);for(const[k,s]of limits)if(s.until<now)limits.delete(k)};
 const limit=(key,max,period=60000)=>{const now=Date.now(),v=limits.get(key);if(!v||v.until<now){limits.set(key,{count:1,until:now+period});return}if(++v.count>max)throw new AppError('操作太频繁，请稍后再试',429)};
 const bearer=req=>/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'')?.[1];
 const getSession=req=>{const token=bearer(req),s=token&&sessions.get(token);if(!s||s.expires<Date.now())throw new AppError('连接已失效，请重新选择本人',403);if(!store.data.players.some(p=>p.id===s.player))throw new AppError('玩家已移除',403);return s};
 const person=id=>{const p=store.data.players.find(p=>p.id===id);return p?{id:p.id,name:p.name,number:p.number}:null};
 const ownCard=s=>{
  const round=store.round(),self=person(s.player),out=store.data.missions.find(m=>m.round===round?.id&&m.actor===s.player),incoming=store.data.missions.filter(m=>m.round===round?.id&&m.target===s.player);
  const available=m=>!!m&&[m.actor,m.target].every(id=>isEligible(store.data.players.find(p=>p.id===id)));
  const incomingTasks=incoming.map(inc=>({id:inc.id,actor:person(inc.actor)??{name:inc.actorName,number:inc.actorNumber},task:inc.task,completed_at:inc.completed_at,paused:!available(inc),...(!round.ended&&available(inc)?{code:inc.code}:{})}));
  return{self,round,outgoing:out?{id:out.id,task:out.task,target:person(out.target)??{name:out.targetName,number:out.targetNumber},completed_at:out.completed_at,paused:!available(out)}:null,incoming:incomingTasks[0]??null,incomingTasks};
 };
 const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))};
 const body=async req=>{if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new AppError('请求格式不正确',415);let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>8192)throw new AppError('请求内容过大',413);chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new AppError('请求内容无效')}};
 const handler=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   prune();const u=new URL(req.url,'http://local');if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin)}catch{}if(!origin||origin.host!==req.headers.host)throw new AppError('禁止跨站操作',403)}
   if(req.method==='GET'&&['/','/app.js','/style.css'].includes(u.pathname)){
    const name=u.pathname==='/'?'index.html':u.pathname.slice(1),type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'mobile',name)));return;
   }
   if(req.method==='GET'&&u.pathname==='/api/roster'){
    if(!same(req.headers['x-party-entry'],entry))throw new AppError('请扫描当前活动二维码',403);limit('roster:'+req.socket.remoteAddress,600);
    json(res,200,{players:store.data.players.filter(isEligible).map(p=>({id:p.id,name:p.name,number:p.number}))});return;
   }
   if(req.method==='POST'&&u.pathname==='/api/claim'){
    if(!same(req.headers['x-party-entry'],entry))throw new AppError('请扫描当前活动二维码',403);limit('claim:'+req.socket.remoteAddress,250);
    const b=await body(req),p=store.data.players.find(p=>p.id===b.player);if(!isEligible(p))throw new AppError('这位玩家当前不在场或未参与');if(sessions.size>=1500)throw new AppError('连接申请过多，请主持人关闭后重新开启手机服务',429);
    // Choosing again replaces this browser's previous identity and any old phone
    // for the selected player. No host approval is involved.
    const previous=bearer(req);for(const[token,s]of sessions)if(token===previous||s.player===p.id)sessions.delete(token);
    const token=secret(),s={player:p.id,eventId:store.data.event.id,expires:Date.now()+8*60*60000};sessions.set(token,s);json(res,200,{token,name:p.name,number:p.number});return;
   }
   if(req.method==='GET'&&u.pathname==='/api/session'){const s=getSession(req);json(res,200,{status:'approved',self:person(s.player)});return}
   if(req.method==='GET'&&u.pathname==='/api/me'){json(res,200,ownCard(getSession(req)));return}
   if(req.method==='POST'&&u.pathname==='/api/verify'){
    const s=getSession(req);limit('verify:'+s.player,10);const b=await body(req);if(!/^\d{6}$/.test(String(b.code??'')))throw new AppError('请输入六位验收码');
    json(res,200,await backend('mission/verify',{actor:s.player,code:b.code}));return;
   }
   json(res,404,{error:'没有这个页面'});
  }catch(e){if(!res.headersSent)json(res,e instanceof AppError?e.status:500,{error:e instanceof AppError?e.message:'服务暂时不可用，请联系主持人'});else res.end();}
 };
 return{
  async start({port:requested=18741,host='0.0.0.0'}={}){
   if(server?.address()?.address===host)return this.status();
   if(server)await this.stop();
   sessions.clear();limits.clear();entry=secret();publicBase='';qrCache=null;
   const s=http.createServer(handler);
   s.requestTimeout=15000;s.headersTimeout=10000;s.maxHeadersCount=40;server=s;
   try{await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(requested,host,resolve)});port=s.address().port;return this.status()}catch(e){server=null;entry='';throw new AppError(e.code==='EADDRINUSE'?'手机服务端口被占用，请关闭重复程序或稍后重试':'手机服务启动失败：'+e.message)}
  },
  async stop(){const s=server;server=null;port=0;entry='';publicBase='';sessions.clear();limits.clear();qrCache=null;if(s){s.closeAllConnections();await new Promise(resolve=>s.close(resolve))}return{running:false}},
  setPublicURL(url){if(!server)throw new AppError('请先开启手机服务');const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new AppError('请填写HTTPS公网根地址，例如 https://party.example.com');publicBase=u.origin;qrCache=null},
  clearPublicURL(){publicBase='';qrCache=null},
  async status(){const address=server?.address();if(!address)return{running:false,connected:[]};const addresses=address.address==='0.0.0.0'?Object.values(os.networkInterfaces()).flat().filter(n=>n&&n.family==='IPv4'&&!n.internal).map(n=>'http://'+n.address+':'+port):[];const base=publicBase||addresses[0]||'http://127.0.0.1:'+port,url=base+'/#'+entry;
   if(qrCache?.url!==url)qrCache={url,qr:await QRCode.toDataURL(url,{width:320,margin:2,errorCorrectionLevel:'M'})};
   prune();return{running:true,port,url,qr:qrCache.qr,public:!!publicBase,localURLs:addresses.map(x=>x+'/#'+entry),connected:[...sessions.values()].map(s=>({player:s.player,name:person(s.player)?.name,number:person(s.player)?.number}))};},
  revoke(player){for(const[token,s]of sessions)if(s.player===player)sessions.delete(token);return{ok:true}}
 };
}
module.exports={createMobileService};
