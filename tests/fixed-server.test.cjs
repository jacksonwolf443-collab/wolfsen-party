'use strict';
const {createCheckedInPlayer}=require('./helpers/checked-in-player.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn,spawnSync}=require('node:child_process');
const {Store,createBackend}=require('../desktop/store.cjs');
const {createMobileService}=require('../desktop/mobile-service.cjs');
const python=process.env.PARTY_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const waitFor=async(fn,ms=6000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,20))}assert.fail('Condition did not become true')};
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-fixed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const setup=path.join(dir,'deployment'),config=path.join(setup,'relay.json');
 const generated=spawnSync(python,[path.join(__dirname,'../server/configure.py'),'https://party.test','--output',setup],{encoding:'utf8',windowsHide:true});
 assert.equal(generated.status,0,generated.stderr||generated.error?.message);
 const {token,origin}=JSON.parse(fs.readFileSync(config,'utf8'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(setup,'connection.partyserver'),'utf8')),{format:'wolfsen-party-server-v1',url:origin,token});
 const child=spawn(python,[path.join(__dirname,'../server/relay.py'),'--config',config,'--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';child.on('error',e=>{errors=e.message});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);t.after(()=>{child.kill()});
 await waitFor(()=>{if(child.exitCode!==null||errors)assert.fail(errors||output);return output.includes('"port":')});const port=JSON.parse(output.split('\n')[0]).port;
 const requestImpl=(options,callback)=>http.request({...options,protocol:'http:',hostname:'127.0.0.1',port,agent:false},callback);
 const raw=async(route,body,extra={})=>{const r=await fetch('http://127.0.0.1:'+port+route,{method:body?'POST':'GET',headers:{Host:'party.test',...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 return{dir,token,port,requestImpl,raw,child};
}
test('fixed configuration rejects unsafe origins and saves the server token only through the encryption codec',()=>{
 const {validateConfig,createFixedConfig}=require('../desktop/fixed-server.cjs');
 for(const url of ['http://203.0.113.42','https://a.test/path','https://user:a@a.test','https://a.test/?key=a'])assert.throws(()=>validateConfig({url,token:'x'.repeat(43)}));
 assert.throws(()=>validateConfig({url:'https://party.test',token:'short'}));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-fixed-config-'));try{const secret='s'.repeat(43),file=path.join(dir,'server.json'),codec={encrypt:s=>Buffer.from(s).reverse().toString('hex'),decrypt:s=>Buffer.from(s,'hex').reverse().toString()};const conf=createFixedConfig({file,codec});conf.save({url:'https://party.test/',token:secret});assert.ok(!fs.readFileSync(file,'utf8').includes(secret));assert.deepEqual(conf.load(),{url:'https://party.test',token:secret});assert.deepEqual(conf.status(),{configured:true,url:'https://party.test'});}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('fixed relay serves real phone tasks immediately for 70 clients and isolates codes and persisted acceptance',async t=>{
 const {createFixedRelay}=require('../desktop/fixed-server.cjs'),f=await fixture(t),store=new Store(f.dir),api=createBackend(store),players=[];
 for(let i=0;i<70;i++)players.push((await createCheckedInPlayer(api, {number:String(i+1),name:'玩家'+i})).player);
 await api('state',{kind:'taskBank',version:0,value:['一起分享一个兴趣']});await api('mission/start',{minutes:20});
 const mobile=createMobileService({store,backend:api});t.after(()=>mobile.stop());await mobile.start({port:0});const local=await mobile.status(),entry=new URL(local.url).hash.slice(1);
 let ready='',stopped=0;const link=createFixedRelay({requestImpl:f.requestImpl,onReady:u=>{ready=u;mobile.setPublicURL(u)},onStop:()=>{stopped++;mobile.clearPublicURL()},retryMs:20});t.after(()=>link.stop());
 assert.equal((await f.raw('/api/roster')).status,503);await link.start({url:'https://party.test',token:f.token},local.port);assert.equal(ready,'https://party.test');
 const roster=await f.raw('/api/roster',null,{'X-Party-Entry':entry});assert.equal(roster.data.players.length,70);
 const claims=await Promise.all(players.map(p=>f.raw('/api/claim',{player:p.id},{'X-Party-Entry':entry})));assert.ok(claims.every(c=>c.status===200));assert.equal((await mobile.status()).connected.length,70);
 const who=claims[0].data.token;assert.equal((await f.raw('/api/me',null,{Authorization:'Bearer '+who})).status,200);
 const cards=await Promise.all(claims.map(c=>f.raw('/api/me',null,{Authorization:'Bearer '+c.data.token})));assert.ok(cards.every(c=>c.status===200));
 const own=store.data.missions.find(m=>m.actor===players[0].id),card=cards[0].data;assert.equal(card.self.name,'玩家0');assert.ok(card.incoming.code);assert.ok(!JSON.stringify(card).includes(own.code));
 assert.equal((await f.raw('/api/verify',{code:own.code},{Authorization:'Bearer '+who,Origin:'https://evil.test'})).status,403);
 assert.equal((await f.raw('/api/verify',{code:own.code},{Authorization:'Bearer '+who,Origin:'https://party.test'})).status,200);assert.ok(new Store(f.dir).data.missions.find(m=>m.id===own.id).completed_at);
 for(const route of ['/api/boot','/api/mission/cards','/desktop/main.cjs','/api/photo?key=party.json'])assert.equal((await f.raw(route)).status,404);
 assert.equal((await f.raw('/_party/poll',{}, {Authorization:'Bearer '+'x'.repeat(43)})).status,403);
 await link.stop();assert.equal((await f.raw('/api/me',null,{Authorization:'Bearer '+who})).status,503);assert.equal(ready,'https://party.test');assert.ok(stopped);assert.equal((await mobile.status()).public,false);
});
test('QR is available only after explicit configuration and connection, with the local listener bound to loopback',async t=>{
 const{createFixedRelay,createFixedConfig}=require('../desktop/fixed-server.cjs'),{createMobileStartup}=require('../desktop/mobile-startup.cjs'),f=await fixture(t),store=new Store(f.dir),api=createBackend(store),mobile=createMobileService({store,backend:api}),conf=createFixedConfig({file:path.join(f.dir,'fixed-server.json'),codec:{encrypt:s=>Buffer.from(s).toString('hex'),decrypt:s=>Buffer.from(s,'hex').toString()}});
 const link=createFixedRelay({requestImpl:f.requestImpl,onReady:u=>mobile.setPublicURL(u),onStop:()=>mobile.clearPublicURL()});const startup=createMobileStartup({mobile,fixed:link,config:conf,port:0});t.after(()=>startup.stop());
 assert.equal(conf.status().configured,false);
 await assert.rejects(startup.start(),/请先填写/);
 assert.equal((await mobile.status()).running,false);
 conf.save({url:'https://party.test',token:f.token});
 assert.equal((await mobile.status()).running,false);
 await startup.start();const state=await mobile.status();assert.equal(state.public,true);assert.ok(state.url.startsWith('https://party.test/#'));assert.ok(state.qr.startsWith('data:image/png'));assert.equal(link.status().state,'ready');assert.equal(conf.status().configured,true);assert.deepEqual(state.localURLs,[]);
 await startup.stop();assert.equal((await mobile.status()).running,false);assert.equal(link.status().state,'off');
});
test('relay takeover retires the previous host and a wrong token never publishes a public QR',async t=>{
 const{createFixedRelay}=require('../desktop/fixed-server.cjs'),f=await fixture(t);let exposed=0;
 const bad=createFixedRelay({requestImpl:f.requestImpl,onReady:()=>exposed++});t.after(()=>bad.stop());await assert.rejects(()=>bad.start({url:'https://party.test',token:'z'.repeat(43)},18741));assert.equal(exposed,0);
 const first=createFixedRelay({requestImpl:f.requestImpl,onReady:()=>exposed++}),second=createFixedRelay({requestImpl:f.requestImpl});t.after(()=>first.stop());t.after(()=>second.stop());
 await first.start({url:'https://party.test',token:f.token},18741);await second.start({url:'https://party.test',token:f.token},18741);await waitFor(()=>first.status().state==='failed');assert.equal(second.status().state,'ready');
});
test('a stop during the initial relay start boundary never publishes or reconnects the QR',async t=>{
 const{createFixedRelay}=require('../desktop/fixed-server.cjs'),f=await fixture(t);let ready=0;const link=createFixedRelay({requestImpl:f.requestImpl,onReady:()=>ready++});t.after(()=>link.stop());
 const starting=link.start({url:'https://party.test',token:f.token},18741),stopped=link.stop();await Promise.all([starting,stopped]);assert.equal(link.status().state,'off');assert.equal(ready,0);assert.equal((await f.raw('/health')).data.connected,false);
});
test('an automatic reconnect with an old lease cannot take over a newer explicitly connected host',async t=>{
 const f=await fixture(t),auth={Authorization:'Bearer '+f.token};const a=await f.raw('/_party/connect',{client:'a'.repeat(43),takeover:true},auth),b=await f.raw('/_party/connect',{client:'b'.repeat(43),takeover:true},auth);assert.notEqual(a.data.session,b.data.session);
 assert.equal((await f.raw('/_party/connect',{client:'a'.repeat(43),takeover:false}, {...auth,'X-Party-Connection':a.data.session})).status,409);
 assert.equal((await f.raw('/_party/connect',{client:'b'.repeat(43),takeover:false}, {...auth,'X-Party-Connection':b.data.session})).status,200);
});
test('a lost reconnect acknowledgement is safe to repeat without inventing another computer',async t=>{
 const f=await fixture(t),auth={Authorization:'Bearer '+f.token},client='a'.repeat(43);const first=await f.raw('/_party/connect',{client,takeover:true},auth);
 for(let i=0;i<2;i++){const retry=await f.raw('/_party/connect',{client,takeover:false}, {...auth,'X-Party-Connection':first.data.session});assert.equal(retry.status,200);assert.equal(retry.data.session,first.data.session)}
});
test('oversized public authentication headers are rejected before they can overflow desktop polling',async t=>{
 const f=await fixture(t);assert.equal((await f.raw('/api/claim',{player:'x'},{Authorization:'x'.repeat(7900),'X-Party-Entry':'x'.repeat(7900)})).status,431);
});
test('a transient HTTPS request failure reconnects without changing the active phone entry',async t=>{
 const{createFixedRelay}=require('../desktop/fixed-server.cjs'),f=await fixture(t),store=new Store(f.dir),api=createBackend(store),mobile=createMobileService({store,backend:api});t.after(()=>mobile.stop());await mobile.start({port:0});const initial=new URL((await mobile.status()).url).hash;
 let breakPoll=false,stops=0,ready=0;const transport=(options,callback)=>{const request=f.requestImpl(options,callback);if(breakPoll&&options.path==='/_party/poll'){breakPoll=false;process.nextTick(()=>request.destroy(new Error('simulated connection loss')))}return request};
 const link=createFixedRelay({requestImpl:transport,retryMs:20,onReady:u=>{ready++;mobile.setPublicURL(u)},onStop:()=>{stops++;mobile.clearPublicURL()}});t.after(()=>link.stop());await link.start({url:'https://party.test',token:f.token},(await mobile.status()).port);breakPoll=true;
 // Cause the outstanding long poll to return, then lose the next one.
 await f.raw('/api/roster');await waitFor(()=>ready===2);assert.equal(link.status().state,'ready');assert.ok(stops>=2);assert.equal(new URL((await mobile.status()).url).hash,initial);
});
test('the default HTTPS connector rejects an untrusted server certificate',async t=>{
 const https=require('node:https'),{createFixedRelay}=require('../desktop/fixed-server.cjs');
 const generated=spawnSync(python,['-c',`from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import datetime,ipaddress,json
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
now=datetime.datetime.now(datetime.timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).sign(k,hashes.SHA256())
print(json.dumps({'key':k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),'cert':c.public_bytes(serialization.Encoding.PEM).decode()}))`],{encoding:'utf8',windowsHide:true});assert.equal(generated.status,0,generated.stderr);const cert=JSON.parse(generated.stdout);
 const server=https.createServer(cert,(_q,r)=>r.end('{}'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));let ready=0;const link=createFixedRelay({onReady:()=>ready++});t.after(()=>link.stop());await assert.rejects(()=>link.start({url:'https://127.0.0.1:'+server.address().port,token:'x'.repeat(43)},18741));assert.equal(ready,0);
});
