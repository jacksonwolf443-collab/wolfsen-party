import React,{useEffect,useState} from 'react';
import {Trophy,Flag} from 'lucide-react';
import {Avatar} from './ui';

/** Public fields only: acceptance codes are never read or rendered here. */
export default function MissionFinale({progress,skipCountdown=false,onAllTasks}:{progress:any;skipCountdown?:boolean;onAllTasks?:()=>void}){
 const round=progress?.round,rows=progress?.rows??[],pending=rows.filter((r:any)=>!r.completed_at&&!r.paused),paused=rows.filter((r:any)=>!r.completed_at&&r.paused),passed=rows.filter((r:any)=>r.completed_at);
 const ordered=[...pending,...paused,...passed];
 const[count,setCount]=useState(skipCountdown?0:3),[page,setPage]=useState(0),[auto,setAuto]=useState(true),[replay,setReplay]=useState(0),pages=Math.max(1,Math.ceil(ordered.length/2)),current=Math.min(page,pages-1);
 useEffect(()=>{setCount(skipCountdown?0:3);setPage(0)},[round?.id,skipCountdown,replay]);
 useEffect(()=>{if(count<=0)return;const timer=setInterval(()=>setCount(n=>Math.max(0,n-1)),1000);return()=>clearInterval(timer)},[count>0,round?.id,replay]);
 useEffect(()=>{if(count>0||!auto||pages<2)return;const timer=setInterval(()=>setPage(n=>(n+1)%pages),8000);return()=>clearInterval(timer)},[count>0,auto,pages]);
 if(!round?.ended)return null;
 return <section className="mission-finale" aria-label="本轮验收结算">
  {count>0?<div className="mission-ending-countdown" role="status" aria-live="polite"><Flag size={48}/><p>本轮任务结束</p><strong data-mission-countdown>{count}</strong><h2>即将公布全员验收结果与事件</h2><button onClick={()=>setCount(0)}>直接查看结算</button></div>:<>
   <header className="mission-finale-heading"><div><span>客官,YOU HAPPY？ · 本轮结束</span><h1>{pending.length||paused.length?'本轮全员验收结果':'全员通过验收！'}</h1><p>已通过 {passed.length} 人 · 未通过 {pending.length} 人{paused.length?` · 暂停 ${paused.length} 人`:''}</p></div>{!pending.length&&!paused.length&&<Trophy className="mission-finale-trophy" size={76}/>}</header>
   {ordered.length?<div className="mission-finale-grid">{ordered.slice(current*2,(current+1)*2).map((r:any)=>{const status=r.completed_at?'passed':r.paused?'paused':'pending';return <article key={r.id} className={'mission-result-'+status} data-mission-result={r.id} data-status={status} data-mission-unpassed={status==='pending'?r.id:undefined}><div className="mission-finale-player"><Avatar player={{name:r.name,photo:r.photo}} size={80}/><div><small>#{r.number}</small><h2>{r.name}</h2></div><b>{status==='passed'?'✓ 本轮已验收通过':status==='paused'?'暂停 · 参与者未到/已离场':'本轮未验收通过'}</b></div><div className="mission-finale-target">去找 <strong>#{r.targetNumber} {r.targetName}</strong> 验收</div><div className="mission-finale-task"><span>验收事件</span><p>{r.task}</p></div></article>})}</div>:<div className="mission-finale-complete"><h2>本轮还没有任务记录</h2></div>}
   {paused.length>0&&<p className="mission-finale-paused">另有{paused.length}人因参与者不在场而暂停：{paused.map((r:any)=>r.name).join('、')}。暂停任务不列入受罚名单。</p>}
   <nav className="mission-finale-controls">{ordered.length>0&&<><button aria-label="验收结果上一页" onClick={()=>setPage((current-1+pages)%pages)}>上一页</button><b>第 {current+1} / {pages} 页 · 共 {ordered.length} 人</b><button aria-label="验收结果下一页" onClick={()=>setPage((current+1)%pages)}>下一页</button><button onClick={()=>setAuto(v=>!v)}>{auto?'暂停自动翻页':'每8秒自动翻页'}</button></>}<button onClick={()=>setReplay(n=>n+1)}>重播结束动画</button>{onAllTasks&&<button onClick={onAllTasks}>查看全部任务</button>}</nav>
  </>}
 </section>;
}
