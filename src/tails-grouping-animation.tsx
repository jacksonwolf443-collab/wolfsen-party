import React,{useEffect,useRef,useState} from 'react';
import {Shuffle,X} from 'lucide-react';
import {Avatar,Button} from './ui';
import type {Player} from './domain';

export type TailsGroupingSession={players:Player[];groups:string[][]|null;saving:boolean;onConfirm:()=>void;onCancel:()=>void};

export default function TailsGroupingAnimation({players,groups,saving,onConfirm,onCancel}:TailsGroupingSession){
 const started=useRef(Date.now()),dialog=useRef<HTMLElement>(null),cancelButton=useRef<HTMLButtonElement>(null),confirmButton=useRef<HTMLButtonElement>(null),finished=useRef(false);
 const[phase,setPhase]=useState<'rolling'|'distributing'|'grouped'>('rolling'),[confirming,setConfirming]=useState(false);
 const cancel=()=>{if(saving||finished.current)return;finished.current=true;onCancel()};
 const accept=()=>{if(phase!=='grouped'||saving||finished.current)return;finished.current=true;setConfirming(true);onConfirm()};
 useEffect(()=>{if(!groups)return;const distribute=setTimeout(()=>setPhase('distributing'),Math.max(0,1700-(Date.now()-started.current))),reveal=setTimeout(()=>setPhase('grouped'),Math.max(0,3200-(Date.now()-started.current)));return()=>{clearTimeout(distribute);clearTimeout(reveal)}},[groups]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;cancelButton.current?.focus();return()=>{if(previous?.isConnected)previous.focus()}},[]);
 useEffect(()=>{if(phase==='grouped')confirmButton.current?.focus()},[phase]);
 useEffect(()=>{const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel()}if(event.key==='Tab'){event.preventDefault();const controls=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button')??[]).filter(b=>!b.disabled);if(!controls.length)return;const index=controls.indexOf(document.activeElement as HTMLButtonElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus()}};window.addEventListener('keydown',keyboard,true);return()=>window.removeEventListener('keydown',keyboard,true)},[saving,onCancel]);
 const size=Math.max(24,Math.min(84,Math.floor(540/Math.sqrt(Math.max(1,players.length))))),who=(id:string)=>players.find(p=>p.id===id);
 return <section ref={dialog} className="tails-grouping-animation" data-phase={phase} role="dialog" aria-modal="true" aria-label="抢尾巴三组随机分组">
  <header className="tails-grouping-heading"><span><Shuffle size={20}/> 抢尾巴 · 全员集结</span><h1>{phase==='grouped'?'三组挑战者，就位！':phase==='distributing'?'正在进入各自的战队':'全场玩家，随机分组'}</h1><p role="status">{phase==='grouped'?'请核对三组名单；确认后才保存分组并开始3分钟倒计时。':`${players.length} 位已签到玩家正在头像池中随机流动，即将均衡分为3组…`}</p><button ref={cancelButton} className="btn secondary" disabled={saving||confirming} onClick={cancel}><X size={16}/>取消本次分组</button></header>
  {phase==='grouped'?<div className="tails-preview-groups">{groups!.map((group,i)=><article key={i} className="tails-preview-group"><h2>第{i+1}组挑战者：<span>{group.length}人</span></h2><div className="tails-preview-members">{group.map((id,index)=>{const player=who(id);return <div key={id} data-player-id={id} style={{'--tails-entry-delay':Math.min(index*.025,.6)+'s'} as React.CSSProperties}><Avatar player={player} size={72}/><strong>{player?.name??'玩家已移除'}</strong><small>#{player?.number??'—'}</small></div>})}</div></article>)}</div>:<div className="tails-grouping-pool">{phase==='distributing'&&<div className="tails-pool-lanes" aria-hidden="true">{[1,2,3].map(i=><b key={i}>第{i}组</b>)}</div>}{players.map((player,index)=>{const groupIndex=groups?.findIndex(g=>g.includes(player.id))??-1,memberIndex=groups&&groupIndex>=0?groups[groupIndex].indexOf(player.id):index,distributed=phase==='distributing'&&groupIndex>=0;return <div key={player.id} className="tails-pool-avatar" data-player-id={player.id} style={{left:(distributed?(groupIndex+.5)*100/3:8+(index*61.8034)%84)+'%',top:(distributed?20+(memberIndex*17.71)%60:10+(index*37.1097)%76)+'%','--tails-pool-delay':-(index%11)*.47+'s','--tails-pool-speed':(2.8+(index%7)*.29)+'s','--tails-pool-turn':index%2?1:-1,'--tails-pool-size':size+'px'} as React.CSSProperties}><div className="tails-pool-orbit"><Avatar player={player} size={size}/><b>{player.name}</b></div></div>})}</div>}
  <footer><span>{saving||confirming?'正在保存分组并开始本轮…':phase==='grouped'?`${players.length}位玩家 · 三组人数相差不超过1人 · 名单保持展示，等待确认`:'每位在场玩家只加入一组 · 已有成绩和历史保留'}</span>{phase==='grouped'&&<button ref={confirmButton} className="btn primary" disabled={saving||confirming} onClick={accept}>确认分组并开始本轮</button>}</footer>
 </section>;
}
