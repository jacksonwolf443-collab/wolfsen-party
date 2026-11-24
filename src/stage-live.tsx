import React,{useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {ActivityRules} from './activity-rules';
import {activityRules,pairRoundRules} from './rules-data';
import {Avatar} from './ui';

export function StageRules({activity,round}:{activity:number;round?:number}){
 const rule=activity===1&&round?pairRoundRules[round]??activityRules[1]:activityRules[activity],pages=Math.max(1,Math.ceil((rule?.steps.length??0)/2)),[page,setPage]=useState(0),[paused,setPaused]=useState(false);
 useEffect(()=>setPage(0),[activity,round]);
 useEffect(()=>{if(paused||pages<=1)return;const timer=setInterval(()=>setPage(p=>(p+1)%pages),20000);return()=>clearInterval(timer)},[pages,paused]);
 const safePage=Math.min(page,pages-1);
 return <div className="stage-rules-view"><ActivityRules activity={activity} round={round} stage page={safePage} pageSize={2}/><nav className="stage-page-controls" aria-label="活动规则分页"><button aria-label="规则上一页" onClick={()=>setPage((safePage+pages-1)%pages)}><ChevronLeft size={22}/>上一页</button><span>规则 {safePage+1} / {pages} 页 · {paused?'已暂停轮播':'每20秒自动翻页'}</span><button onClick={()=>setPaused(p=>!p)}>{paused?'继续轮播':'暂停轮播'}</button><button aria-label="规则下一页" onClick={()=>setPage((safePage+1)%pages)}>下一页<ChevronRight size={22}/></button></nav></div>;
}
export function PairPKBoard({matches=[],title}:{matches:any[];title?:string}){
 const [page,setPage]=useState(0),pages=Math.max(1,Math.ceil(matches.length/4)),safePage=Math.min(page,pages-1);
 useEffect(()=>{if(pages<=1)return;const timer=setInterval(()=>setPage(p=>(p+1)%pages),12000);return()=>clearInterval(timer)},[pages]);
 return <section className="pk-board"><div className="pk-board-heading"><h1>{title||'搭子2V2对战'}</h1><span>共 {matches.length} 场 · 第 {safePage+1} / {pages} 页</span></div>{!matches.length?<p className="stage-empty">请先分配本轮对战，再更新舞台。</p>:<div className="pk-board-grid">{matches.slice(safePage*4,(safePage+1)*4).map((match,i)=><article key={match.id} data-stage-match={match.id}><header><b>第 {safePage*4+i+1} 场</b><span>{match.bye?'轮空晋级':match.status==='pending'?'等待结果':match.status==='skipped'?'双方已跳过':'已确认胜负'}</span></header><div className="pk-board-teams">{(match.teams??[]).map((team:any,index:number)=><React.Fragment key={team.id}>{index>0&&<strong className="pk-board-vs">VS</strong>}<div className={'pk-board-team'+(match.loserId===team.id?' eliminated':'')+(match.winnerId===team.id?' winner':'')}>{match.loserId===team.id&&<div className="pair-elimination-stamp" data-elimination-stamp>本轮淘汰</div>}<div className="pk-board-people">{(team.members??[]).map((person:any)=><div className="pk-board-member" key={person.id}><Avatar player={person} size={52}/><b>{person.name}</b><small>#{person.number}</small></div>)}</div><span>{team.solo&&<>单人成队 · 按{team.seats??2}个名额参赛<br/></>}{match.loserId===team.id?'已淘汰':match.winnerId===team.id?'晋级':team.name}</span></div></React.Fragment>)}</div><p className="pk-board-task">{match.task}</p></article>)}</div>}<nav className="stage-page-controls"><button aria-label="对战上一页" onClick={()=>setPage((safePage+pages-1)%pages)}><ChevronLeft size={22}/>上一页</button><span>每12秒轮播全部对战</span><button aria-label="对战下一页" onClick={()=>setPage((safePage+1)%pages)}>下一页<ChevronRight size={22}/></button></nav></section>;
}
