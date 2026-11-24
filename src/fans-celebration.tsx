import React,{useEffect,useRef} from 'react';
import {Sparkles,Trophy} from 'lucide-react';
import {Avatar} from './ui';

export function FansCelebration({celebration,onClose}:{celebration:any;onClose:()=>void}){
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus({preventScroll:true});const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose()}if(event.key==='Tab'){event.preventDefault();close.current?.focus()}};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus()}},[onClose]);
 return <section className="fans-celebration" role="dialog" aria-modal="true" aria-label={celebration.side+'队本局获胜'} data-round-id={celebration.roundId}>
  <div className="fans-victory-confetti" aria-hidden="true">{Array.from({length:54},(_,i)=><i key={i} style={{left:(i*47.13%100)+'%','--fans-delay':-(i%9)*.4+'s','--fans-confetti-color':['#ffdc61','#ec8f76','#8ee0c7','#a8b7ff'][i%4],'--fans-tilt':(i%2?1:-1)*85+'deg'} as React.CSSProperties}/>)}</div>
  <header><span><Sparkles size={22}/> 掌声送给每一位队员</span><Trophy className="fans-victory-trophy" size={65}/><h1>恭喜{celebration.side}队获胜！</h1><p>第 {celebration.number} 局胜利 · {celebration.people.length} 位队员共同赢下这一局</p><strong>A队 {celebration.scoreA} : {celebration.scoreB} B队{celebration.champion?' · 五局三胜总冠军！':''}</strong></header>
  <div className="fans-victory-team" aria-label="本局全体获胜队员">{celebration.people.map((p:any,i:number)=><article key={p.id} data-winner-id={p.id} style={{'--fans-player-delay':Math.min(i,12)*.04+'s'} as React.CSSProperties}><Avatar player={p} size={116}/><span>NO. {p.number}</span><h2>{p.name}</h2></article>)}</div>
  <footer><p>本局成绩与积分已保存，胜利属于全队！</p><button ref={close} type="button" className="btn primary" onClick={onClose}>继续活动</button></footer>
 </section>;
}
