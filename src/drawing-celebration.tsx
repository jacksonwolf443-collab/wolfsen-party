import React from 'react';
import {Trophy,Sparkles} from 'lucide-react';
import {Avatar,Button} from './ui';
export function DrawingCelebration({celebration,onClose}:{celebration:any;onClose?:()=>void}){
 const p=celebration?.player;if(!p)return null;
 return <section className="drawing-celebration" role="dialog" aria-modal="true" aria-label="毕加索在世挑战成功" data-round-id={celebration.roundId}>
  <div className="drawing-confetti" aria-hidden="true">{Array.from({length:54},(_,i)=><i key={i} style={{left:(i*47.13%100)+'%','--delay':-(i%9)*.4+'s','--confetti-color':['#ffdc61','#ec8f76','#8ee0c7','#a8b7ff'][i%4],'--tilt':(i%2?1:-1)*85+'deg'} as React.CSSProperties}/>)}</div>
  <div className="drawing-victory-card drawing-victory-art"><span className="drawing-victory-eyebrow"><Sparkles size={20}/> 猜对了！祝贺灵魂画手！</span><h1>挑战成功！</h1><div className="drawing-victory-columns"><div className="drawing-victory-person"><Trophy className="drawing-trophy" size={65}/><Avatar player={p} size={120}/><span className="drawing-winner-number">NO. {p.number}</span><h2>{p.name}</h2>{p.interests&&<p>{p.interests}</p>}{p.wish&&<p>{p.wish}</p>}</div><div className="drawing-victory-work">{celebration.canvas?<img className="drawing-winning-canvas" src={celebration.canvas} alt="本轮获胜画布"/>:<p>本轮画作未保存在旧记录中</p>}<p className="drawing-winning-answer">AI猜：<strong>{celebration.guess??celebration.answer}</strong></p></div></div><p className="drawing-genius-praise">你就是毕加索在世，达芬奇都要暂避你的锋芒</p><p className="drawing-score-note">掌声送给本轮画手 · 本轮胜利自动加1分</p>{onClose&&<Button onClick={onClose}>继续本轮</Button>}</div>
 </section>;
}
