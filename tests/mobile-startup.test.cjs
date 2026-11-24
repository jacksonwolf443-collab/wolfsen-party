'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');
const{createMobileStartup}=require('../desktop/mobile-startup.cjs');
test('stopping while the local listener is still starting never reconnects the fixed server',async()=>{
 let release,started=0,connected=0,running=false;const gate=new Promise(r=>release=r),mobile={start:async()=>{started++;await gate;running=true;return{port:12345}},stop:async()=>{running=false}},fixed={start:async()=>{connected++},stop:async()=>{},status:()=>({state:'off'})},config={status:()=>({configured:true}),load:()=>({url:'https://party.test',token:'x'.repeat(43)})};
 const service=createMobileStartup({mobile,fixed,config}),a=service.start(),b=service.start();assert.equal(a,b);assert.equal(started,1);const stopped=service.stop();release();await Promise.all([a,b,stopped]);assert.equal(connected,0);assert.equal(running,false);assert.equal(service.status().enabled,false);
});
test('stopping an in-flight relay connection cancels it before closing the local listener',async()=>{
 let rejectConnect,connecting=false,running=false;const mobile={start:async()=>{running=true;return{port:12345}},stop:async()=>{assert.equal(connecting,false);running=false}},fixed={start:()=>new Promise((_resolve,reject)=>{connecting=true;rejectConnect=reject}),stop:async()=>{connecting=false;rejectConnect?.(Error('cancelled'))},status:()=>({state:'off'})},config={status:()=>({configured:true}),load:()=>({url:'https://party.test',token:'x'.repeat(43)})};
 const service=createMobileStartup({mobile,fixed,config}),started=service.start();await new Promise(r=>setImmediate(r));assert.equal(connecting,true);await service.stop();await assert.rejects(started,/cancelled/);assert.equal(running,false);assert.equal(service.status().error,'');
});
