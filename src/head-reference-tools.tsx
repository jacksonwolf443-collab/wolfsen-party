import React,{useEffect,useRef,useState} from 'react';
import {ScanFace,Square} from 'lucide-react';
import {isEligible} from './domain';
import type {Player} from './domain';
import {api,Button,Panel} from './ui';
import type {Context} from './ui';

type Failure={id:string;name:string;message:string};
type Progress={done:number;total:number;name:string;running:boolean};
export default function HeadReferenceTools({ctx,label,eligibleOnly=false,embedded=false}:{ctx:Context;label:string;eligibleOnly?:boolean;embedded?:boolean}){
 const [progress,setProgress]=useState<Progress|null>(null),[failures,setFailures]=useState<Failure[]>([]),[warnings,setWarnings]=useState<string[]>([]),[stopping,setStopping]=useState(false);
 const live=useRef(true),running=useRef(false),stop=useRef(false),currentPlayers=useRef(ctx.players);currentPlayers.current=ctx.players;
 useEffect(()=>{live.current=true;return()=>{live.current=false;stop.current=true}},[]);
 const candidates=ctx.players.filter(p=>p.photo&&(!eligibleOnly||isEligible(p)));
 const start=async(ids?:string[])=>{
  if(running.current||ctx.busy||!ctx.ai.hasKey)return;
  const people=candidates.filter(p=>!ids||ids.includes(p.id));if(!people.length)return;
  running.current=true;stop.current=false;setStopping(false);setFailures([]);setWarnings([]);
  const failed:Failure[]=[],notes:string[]=[];let done=0;
  try{await ctx.run('正在自动准备人脸参考…',async()=>{
   try{
    for(const snapshot of people){
     if(stop.current)break;
     const person:Player|undefined=currentPlayers.current.find(p=>p.id===snapshot.id);
     if(!person?.photo||(eligibleOnly&&!isEligible(person))){done++;continue}
     if(live.current)setProgress({done,total:people.length,name:person.name,running:true});
     try{const result=await api('ai/head-reference',{id:person.id});if(result.warning)notes.push(person.name+'：'+result.warning)}catch(e:any){failed.push({id:person.id,name:person.name,message:e.message??'准备失败'})}
     done++;
     if(live.current){setFailures([...failed]);setWarnings([...notes]);setProgress({done,total:people.length,name:person.name,running:true})}
    }
   }finally{await ctx.refresh(true)}
   if(live.current){setProgress({done,total:people.length,name:'',running:false});ctx.tell(`人脸参考已处理 ${done}/${people.length} 位${failed.length?'，'+failed.length+' 位可重试':''}${stop.current?'；后续已停止':''}`)}
  })}finally{running.current=false;if(live.current)setProgress(current=>current?{...current,running:false}:current)}
 };
 const content=<>
  <div className="button-row"><Button variant="secondary" disabled={!candidates.length||!!ctx.busy||!ctx.ai.hasKey} onClick={()=>start()}><ScanFace size={17}/>{label}</Button>{progress?.running&&<Button variant="secondary" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true)}}><Square size={14}/>{stopping?'当前玩家完成后停止':'停止后续玩家'}</Button>}</div>
  <p className="muted">这是可选的照片参考整理功能，会分析照片中的主要头部。当前合照直接使用两张完整原照，不依赖这一步，也不会把整理出的头像贴到身体上。{ctx.ai.hasKey?'联网识别费用计入你的百炼账号。':'云端AI未启用。'}</p>
  {progress&&<div className="pair-batch-progress" role="status"><b>{progress.running?'正在处理':'已处理'} {progress.done} / {progress.total} 位</b><span>{progress.name}</span><progress value={progress.done} max={Math.max(1,progress.total)}/></div>}
  {!!failures.length&&<div className="pair-batch-errors"><b>{failures.length} 位尚未准备成功</b><ul>{failures.map(f=><li key={f.id}>{f.name}：{f.message}</li>)}</ul><Button variant="secondary" disabled={!!ctx.busy||!ctx.ai.hasKey} onClick={()=>start(failures.map(f=>f.id))}>重试失败玩家</Button></div>}
  {!!warnings.length&&<details className="inline-note"><summary>已准备参考，{warnings.length} 位有提示</summary><ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
 </>;
 return embedded?<div className="head-reference-tools" style={{margin:'20px 0'}}>{content}</div>:<Panel title="照片的人脸参考" tag={candidates.length+' 张照片可自动准备'}>{content}</Panel>;
}
