import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Avatar} from './ui';
import type {Player} from './domain';

export type LotteryPreview={token:string;count:number;people:Player[]};
export type LotterySession={players:Player[];count:number;result:LotteryPreview|null;saving:boolean;onComplete:()=>void;onCancel:()=>void};

export default function LotteryAnimation({players,count,result,saving,onComplete,onCancel}:LotterySession){
 const started=useRef(Date.now()),cancelButton=useRef<HTMLButtonElement>(null),confirmButton=useRef<HTMLButtonElement>(null),previousPageButton=useRef<HTMLButtonElement>(null),nextPageButton=useRef<HTMLButtonElement>(null),finished=useRef(false);
 const [phase,setPhase]=useState<'rolling'|'revealed'>('rolling'),[confirming,setConfirming]=useState(false),[page,setPage]=useState(0);
 const cancel=()=>{if(saving||finished.current)return;finished.current=true;onCancel()};
 const accept=()=>{if(phase!=='revealed'||saving||finished.current)return;finished.current=true;setConfirming(true);onComplete()};
 useEffect(()=>{
  if(!result||phase!=='rolling')return;
  const timer=setTimeout(()=>setPhase('revealed'),Math.max(0,3000-(Date.now()-started.current)));
  return()=>clearTimeout(timer);
 },[result,phase]);
 useEffect(()=>{if(phase==='revealed')confirmButton.current?.focus()},[phase]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  cancelButton.current?.focus();
  return()=>{if(previous?.isConnected)previous.focus()};
 },[]);
 useEffect(()=>{
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel()}
   if(event.key==='Tab'){event.preventDefault();const controls=[confirmButton.current,cancelButton.current,previousPageButton.current,nextPageButton.current].filter((b):b is HTMLButtonElement=>!!b&&!b.disabled);if(!controls.length)return;const index=controls.indexOf(document.activeElement as HTMLButtonElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus()}
  };
  window.addEventListener('keydown',keyboard,true);
  return()=>window.removeEventListener('keydown',keyboard,true);
 },[onCancel,saving]);
 const selected=phase==='revealed',people=result?.people??[],pages=Math.max(1,Math.ceil(people.length/10)),currentPage=Math.min(page,pages-1),visible=people.slice(currentPage*10,(currentPage+1)*10),columns=Math.max(1,Math.min(5,visible.length)),rows=visible.length>5?2:1;
 const size=Math.max(22,Math.min(88,Math.floor(540/Math.sqrt(Math.max(1,players.length)))));
 const changePage=(direction:number)=>{if(!saving&&!finished.current)setPage((currentPage+direction+pages)%pages)};
 return <section className={'lottery-animation'+(players.length>100?' compact':'')+(count>80?' dense-selection':'')} data-phase={phase} role="dialog" aria-modal="true" aria-label="随机抽取头像池" style={{'--lottery-size':size+'px'} as React.CSSProperties}>
  <header className="lottery-animation-heading"><span className="eyebrow">TONIGHT’S SPOTLIGHT</span><h1>{selected?'今晚的主角，就是你们':'主角正在诞生'}</h1><p role="status" aria-live="polite">{selected?`本轮抽中 ${count} 位，掌声欢迎！`:`${players.length} 位在场玩家正在池中滚动，即将抽出 ${count} 位…`}</p><button ref={cancelButton} type="button" className="btn secondary" disabled={saving||confirming} onClick={cancel}><X size={16}/>取消本次抽取</button></header>
  {selected?<div className="lottery-result-region"><div className={'lottery-result-grid rows-'+rows} data-columns={columns} data-rows={rows} style={{'--lottery-columns':columns} as React.CSSProperties}>{visible.map((player:any)=><article key={player.id} data-player-id={player.id} className="lottery-result-card lottery-pool-avatar selected"><Avatar player={player} size={rows===1?160:112}/><h2>{player.name}</h2><span className="lottery-result-number">NO. {player.number}</span><strong className="lottery-result-count">{player.count!==undefined?'今晚第 '+player.count+' 次被抽中':'本轮入选'}</strong><p className="lottery-result-reason">{player.reason||'本轮随机抽中'}</p></article>)}</div>{pages>1&&<nav className="lottery-result-pagination" aria-label="抽取结果翻页"><button ref={previousPageButton} type="button" aria-label="抽取名单上一页" disabled={saving||confirming} onClick={()=>changePage(-1)}>上一页</button><b>第 {currentPage+1} / {pages} 页 · 共 {people.length} 位</b><button ref={nextPageButton} type="button" aria-label="抽取名单下一页" disabled={saving||confirming} onClick={()=>changePage(1)}>下一页</button></nav>}</div>:<div className="lottery-avatar-pool">{players.map((player,index)=><div key={player.id} data-player-id={player.id} className="lottery-pool-avatar" style={{left:8+(index*61.8034)%84+'%',top:10+(index*37.1097)%76+'%','--lottery-delay':-(index%11)*.47+'s','--lottery-speed':(2.8+(index%7)*.29)+'s','--lottery-turn':index%2?1:-1} as React.CSSProperties}><div className="lottery-avatar-orbit"><Avatar player={player} size={size}/><b title={player.name}>{player.name}</b></div></div>)}</div>}
  <footer><span>{saving||confirming?'正在保存本轮结果…':selected?`已抽中 ${count} 位 · 结果将保持展示，确认后保存并继续`:'每一位在场参与者都有机会 · 本轮不会重复'}</span>{selected&&<button ref={confirmButton} type="button" className="btn primary lottery-confirm-button" disabled={saving||confirming} onClick={accept}>确认名单，继续活动</button>}</footer>
 </section>;
}
