'use strict';
const {AppError}=require('./store.cjs');
function createMobileStartup({mobile,fixed,config,port=18741}){
 let generation=0,flight=null,stopping=null,enabled=false,error='';
 const status=()=>({enabled,error});
 return{
  status,
  start(){
   if(stopping)return stopping.then(()=>this.start());
   if(flight)return flight;
   if(enabled&&['ready','starting','reconnecting'].includes(fixed.status().state))return Promise.resolve(status());
   enabled=true;error='';const gen=++generation;
   const task=(async()=>{try{
    if(!config.status().configured)throw new AppError('请先填写并保存你自己的服务器连接配置');
    const conf=config.load();
    const local=await mobile.start({port,host:'127.0.0.1'});
    if(gen!==generation)return status();
    await fixed.start(conf,local.port);
    return status();
   }catch(e){if(gen===generation)error=e.message;throw e}})();
   flight=task;task.then(()=>{if(flight===task)flight=null},()=>{if(flight===task)flight=null});return task;
  },
  stop(){
   if(stopping)return stopping;
   enabled=false;error='';generation++;
   const active=flight,task=(async()=>{await fixed.stop();await active?.catch(()=>{});await mobile.stop();return status()})();
   stopping=task;task.then(()=>{if(stopping===task)stopping=null},()=>{if(stopping===task)stopping=null});return task;
  }
 };
}
module.exports={createMobileStartup};
