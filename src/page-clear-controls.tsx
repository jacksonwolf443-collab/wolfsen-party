import React,{useState} from 'react';
import {Trash2,FolderOpen} from 'lucide-react';
import {Button,Modal} from './ui';
type Props={page:string;prepare:(scope:string)=>Promise<any>;apply:(preview:any)=>Promise<any>;cancel:(preview:any)=>Promise<any>;openBackup?:()=>Promise<any>};
const countNames:Record<string,string>={players:'玩家',questions:'题库条目',groups:'组合',missions:'验收任务',wins:'自动积分记录',selections:'抽取记录',manualAwards:'手工奖项'};
export default function PageClearControls({page,prepare,apply,cancel,openBackup}:Props){
 const[preview,setPreview]=useState<any>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[backupPath,setBackupPath]=useState('');
 const scope=page==='players'?'players':page==='settings'?'settings-draft':page==='9'?'scores':'activity:'+page;
 const open=async(next:string)=>{setWorking(true);setError('');try{setPreview(await prepare(next))}catch(e:any){setError(e.message??'无法读取清空范围')}finally{setWorking(false)}};
 const close=async()=>{if(working)return;const p=preview;setPreview(null);setError('');if(p)try{await cancel(p)}catch{}};
 const confirm=async()=>{setWorking(true);setError('');try{const result=await apply(preview);if(result?.backupPath)setBackupPath(result.backupPath);setPreview(null)}catch(e:any){setError(e.message??'清空未完成')}finally{setWorking(false)}};
 return <><div className="page-clear-controls"><Button variant="ghost" disabled={working} onClick={()=>open(scope)}><Trash2 size={15}/>清空当前界面全部内容</Button>{page==='settings'&&<Button variant="danger" disabled={working} onClick={()=>open('all')}><Trash2 size={15}/>清空目前所有内容</Button>}</div>
 {!preview&&error&&<p className="notice error" role="alert">{error}</p>}
 {backupPath&&<div className="reset-backup-result" role="status"><b>清空已完成，已保留清空前备份</b><span>{backupPath}</span>{openBackup&&<Button variant="secondary" onClick={openBackup}><FolderOpen size={15}/>打开清空前备份</Button>}</div>}
 {preview&&<Modal title={preview.title} onClose={close}><div className="clear-preview"><p>请先核对以下范围，点击确认后才执行。</p><ul>{(preview.details??[]).map((s:string)=><li key={s}>{s}</li>)}</ul><div className="clear-preview-counts">{Object.entries<any>(preview.counts??{}).filter(([,n])=>n>0).map(([k,n])=><span key={k}>{countNames[k]??k} <b>{n}</b></span>)}</div><h3>保留的内容</h3><p>{(preview.keeps??[]).join('；')}</p>{preview.scope!=='settings-draft'&&<p>执行前自动备份原资料；备份失败则不清空。备份位置会在完成后显示。</p>}{error&&<p className="notice error" role="alert">{error}</p>}</div><div className="modal-actions"><Button variant="ghost" disabled={working} onClick={close}>取消</Button>{error&&<Button variant="secondary" disabled={working} onClick={()=>open(preview.scope)}>重新查看范围</Button>}<Button variant="danger" disabled={working||!!error} onClick={confirm}>{working?'正在备份并清空…':preview.scope==='all'?'确认清空全部活动资料':'确认清空本界面'}</Button></div></Modal>}</>;
}
