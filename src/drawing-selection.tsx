import React,{useEffect,useRef,useState} from 'react';
import {Avatar} from './ui';
import type {Player} from './domain';
export type DrawingPreview={token:string;count:number;people:any[];value:any};
export type DrawingSelectionSession={players:Player[];result:DrawingPreview|null;saving:boolean;onComplete:()=>void;onCancel:()=>void;roster:string};
export function DrawingSelection({players,result,saving,onComplete,onCancel}:DrawingSelectionSession){
 const started=useRef(Date.now()),[phase,setPhase]=useState<'rolling'|'revealed'>('rolling'),cancel=useRef<HTMLButtonElement>(null),confirm=useRef<HTMLButtonElement>(null),committed=useRef(false);
 useEffect(()=>{cancel.current?.focus()},[]);
 useEffect(()=>{if(!result||phase!=='rolling')return;const timer=setTimeout(()=>setPhase('revealed'),Math.max(0,3000-(Date.now()-started.current)));return()=>clearTimeout(timer)},[result,phase]);
 useEffect(()=>{if(phase==='revealed')confirm.current?.focus()},[phase]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelSelection()}if(e.key==='Tab'){e.preventDefault();const buttons=[confirm.current,cancel.current].filter((b):b is HTMLButtonElement=>!!b&&!b.disabled);if(!buttons.length)return;const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus()}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[onCancel,saving]);
 const accept=()=>{if(phase!=='revealed'||saving||committed.current)return;committed.current=true;onComplete()};
 const cancelSelection=()=>{if(saving||committed.current)return;committed.current=true;onCancel()};
 const winner=result?.people[0],selected=phase==='revealed';
 return <section className="drawing-selection" role="dialog" aria-modal="true" aria-label="画手抽取头像池" data-phase={phase}><header><span className="eyebrow">TONIGHT’S DRAWING STAR</span><h1>{selected?'本轮画手，就是你！':'抽取本轮画手'}</h1><p role="status">{selected?`#${winner.number} ${winner.name}`:`${players.length} 位在场玩家 · 每轮抽取 1 位`}</p></header><div className="drawing-selection-pool">{players.map((p,i)=><div key={p.id} data-player-id={p.id} className={'drawing-pool-person'+(selected?(winner.id===p.id?' selected':' dimmed'):'')} style={{left:8+(i*61.8034)%84+'%',top:10+(i*37.1097)%76+'%','--delay':-(i%13)*.4+'s'} as React.CSSProperties}><Avatar player={p} size={selected&&winner.id===p.id?148:48}/><b>{p.name}</b>{selected&&winner.id===p.id&&<small>NO. {p.number}</small>}</div>)}</div>{selected&&<div className="drawing-selection-reason"><b>抽前 {winner.beforeCount} 次 → 本次后 {winner.afterCount} 次</b><p>{winner.reason}</p></div>}<div className="drawing-selection-actions">{selected&&<button ref={confirm} type="button" className="btn primary" disabled={saving} onClick={accept}>确认画手，返回画布</button>}<button ref={cancel} type="button" className="btn secondary" disabled={saving||committed.current} onClick={cancelSelection}>取消本次抽取</button></div><p>{saving?'正在保存正式结果…':selected?'结果会保持展示，点击确认后保存并返回':'先抽今晚还没上过场的人，同次数随机'}</p></section>;
}

