import React,{useEffect,useState} from 'react';
import {api,Button,Panel,Field} from './ui';
import type {Context} from './ui';

export default function MobileAccess({ctx}:{ctx:Context}){
 const [status,setStatus]=useState<any>({running:false});
 const [error,setError]=useState('');
 const [url,setURL]=useState('');
 const [token,setToken]=useState('');
 const load=async()=>setStatus(await api('mobile/status'));
 useEffect(()=>{
  let alive=true;
  const poll=async()=>{try{const value=await api('mobile/status');if(alive){setStatus(value);setError('')}}catch(e:any){if(alive)setError(e.message)}};
  void poll();
  const timer=setInterval(poll,3000);
  return()=>{alive=false;clearInterval(timer)};
 },[]);

 const run=(label:string,task:()=>Promise<void>)=>ctx.run(label,async()=>{
  try{await task()}finally{await load()}
 });
 const connecting=['starting','reconnecting'].includes(status.fixed?.state);
 const busy=!!ctx.busy;
 const showQR=status.running&&(status.public||status.localURLs?.length>0);
 const networkStatus=status.public?'自建服务器已连接':showQR?'局域网已开启':connecting?'正在连接自建服务器…':'手机入口未开启';
 const notice=error||status.fixed?.error||status.startup?.error;

 return <Panel title="手机扫码领任务" tag={networkStatus}>
  <p>玩家扫码后选择自己的名字领取任务。完成任务时，请任务对象提供验收码，再在手机上提交。请把二维码发给本场玩家。</p>
  {showQR?<div className="phone-entry"><img src={status.qr} alt="手机任务入口二维码"/><div>
   <b>{status.public?'手机可用流量扫码':'手机请连同一 Wi-Fi'}</b>
   <p className="phone-url">{status.url}</p>
   <p className="muted">活动期间请保持主持电脑和程序开启。</p>
   <Button variant="secondary" onClick={()=>ctx.project({mode:'missions',title:'客官,YOU HAPPY？',subtitle:'扫码选择本人，立即领取任务'})}>投屏二维码和任务进度</Button>
  </div></div>:<p className="notice">{status.running&&!connecting&&!status.startup?.enabled?'暂未获取可扫码的局域网地址，请检查电脑的网络连接。':'启用局域网或连接自建服务器后，这里会显示二维码。'}</p>}
  {notice&&<p className="form-error">{notice}</p>}
  {!!status.connected?.length&&<details><summary>已连接 {status.connected.length} 人</summary><div className="phone-claims">{status.connected.map((player:any)=><div key={player.player}><b>#{player.number} {player.name}</b><Button variant="ghost" onClick={()=>{if(confirm('断开这位玩家的手机？'))run('断开手机…',()=>api('mobile/revoke',{player:player.player}))}}>断开</Button></div>)}</div></details>}
  <div className="button-row">
   <Button variant="secondary" disabled={busy||!!showQR&&!status.public} onClick={()=>run('开启局域网…',()=>api('mobile/start'))}>开启局域网（同一 Wi-Fi）</Button>
   {(status.running||status.startup?.enabled)&&<Button variant="ghost" disabled={busy} onClick={()=>run('关闭手机入口…',()=>api('mobile/stop'))}>关闭手机入口</Button>}
  </div>
  <h3>自建公网服务器</h3>
  <p className="muted">按源码包 <code>server/README.md</code> 部署。部署完成后，导入生成的 <code>.partyserver</code> 文件，或手动填写 HTTPS 地址和连接凭证。</p>
  {status.fixed?.configured&&<p>已保存服务器 <b>{status.fixed.url}</b></p>}
  <div className="two-col">
   <Field label="服务器 HTTPS 地址"><input type="url" value={url} placeholder="https://party.example.com" onChange={e=>setURL(e.target.value)}/></Field>
   <Field label="服务器连接凭证"><input type="password" value={token} autoComplete="off" onChange={e=>setToken(e.target.value)}/></Field>
  </div>
  <div className="button-row">
   <Button disabled={busy||!url.trim()||!token.trim()} onClick={()=>run('保存并连接服务器…',async()=>{
    await api('mobile/fixed-save',{url,token});
    setToken('');
    await api('mobile/fixed-start');
   })}>保存并连接</Button>
   <Button variant="secondary" disabled={busy} onClick={()=>run('导入自己的服务器配置…',async()=>{
    if((await api('mobile/fixed-import')).canceled)return;
    setURL('');setToken('');
    await api('mobile/fixed-start');
   })}>导入连接文件</Button>
   {status.fixed?.configured&&<Button variant="secondary" disabled={busy||connecting||status.public} onClick={()=>run('连接已保存的服务器…',()=>api('mobile/fixed-start'))}>连接已保存的服务器</Button>}
  </div>
 </Panel>;
}
