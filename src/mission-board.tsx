import React,{useEffect,useState} from 'react';
import {Countdown} from './ui';
import MissionFinale from './mission-finale';
export default function MissionBoard({progress,join,title,subtitle}:{progress:any;join?:any;title?:string;subtitle?:string}){
 const [page,setPage]=useState(0),[auto,setAuto]=useState(true),[size,setSize]=useState(4),[showAll,setShowAll]=useState(false);
 const rows=progress?.rows??[],pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages-1),round=progress?.round;
 useEffect(()=>{setPage(0);setShowAll(false)},[round?.id,round?.ended,size]);
 useEffect(()=>{if(!auto||pages<2||round?.ended&&!showAll)return;const timer=setInterval(()=>setPage(n=>(n+1)%pages),10000);return()=>clearInterval(timer)},[auto,pages,round?.ended,showAll]);
 if(round?.ended&&!showAll)return <MissionFinale progress={progress} onAllTasks={()=>setShowAll(true)}/>;
 return <section className="mission-board"><div className="mission-board-heading"><div><span>客官,YOU HAPPY？</span><h1>{round?.ended?'本轮结束 · 全员任务':'找到你的名字，出发！'}</h1><p>{rows.filter((r:any)=>r.completed_at).length} / {rows.length} 人已验收 · {round?.ended?'本轮已结束':<>剩余 <Countdown endsAt={round?.endsAt}/></>}</p>{round?.ended&&subtitle&&<p>{subtitle}</p>}</div>{join?.qr&&!round?.ended&&<div className="board-qr"><img src={join.qr} alt="扫码领取本人任务"/><span>扫码领任务<br/>{join.public?'可用手机流量':'请连同一Wi-Fi'}</span></div>}{round?.ended&&<button className="mission-board-back" onClick={()=>setShowAll(false)}>查看未通过大字结算</button>}</div>
 <p className="mission-board-rule">A去找B，由B对A完成任务；A不配合，B不给验收码，A受罚。完成后由B把验收码交给A提交。</p>
 <div className={'mission-board-grid count-'+size}>{rows.slice(current*size,(current+1)*size).map((r:any)=><article key={r.id}><div className="assignment-names"><strong><small>#{r.number}</small>{r.name}</strong><span>{round?.ended?'对象 →':'去找 →'}</span><strong><small>#{r.targetNumber}</small>{r.targetName}</strong></div><p>{r.task}</p><span className={'pill '+(r.completed_at?'green':'')}>{r.completed_at?'✓ 已验收':r.paused?'暂停 · 参与者未到/已离场':round?.ended?'本轮未验收通过':'完成后向对方索取验收码'}</span></article>)}</div>
 {!rows.length&&<h2>等待主持人分配任务</h2>}
 <nav className="board-navigation"><button onClick={()=>setPage((current-1+pages)%pages)}>上一页</button><b>第 {current+1} / {pages} 页 · 共 {rows.length} 人</b><button onClick={()=>setPage((current+1)%pages)}>下一页</button><button onClick={()=>setAuto(a=>!a)}>{auto?'暂停自动翻页':'每10秒自动翻页'}</button><label>每页 <select value={size} onChange={e=>setSize(Number(e.target.value))}><option value={4}>4人 · 大字</option><option value={6}>6人</option><option value={8}>8人</option></select></label></nav></section>;
}
