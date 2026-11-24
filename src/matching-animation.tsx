import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Avatar} from './ui';
import type {Player} from './domain';

export type MatchResult={pairs:string[][];standby:string[];reasons?:{members:string[];reason:string;reasonSource:string}[];newGroups?:{id:string;members:string[];solo?:boolean;seats?:number}[];matches?:{id:string;teamIds:string[];bye:boolean;task:string}[]};
export type MatchingSession={players:Player[];result:MatchResult|null;onComplete:()=>void;onCancel:()=>void;supplement?:boolean;notice?:string};

// Keep one element per player so the rolling portraits visibly settle into the returned pairs.
export default function MatchingAnimation({players,result,onComplete,onCancel,supplement=false,notice}:MatchingSession){
  const started=useRef(Date.now()),finished=useRef(false),confirmButton=useRef<HTMLButtonElement>(null),cancelButton=useRef<HTMLButtonElement>(null),[phase,setPhase]=useState<'rolling'|'paired'>('rolling'),[page,setPage]=useState(0),[confirming,setConfirming]=useState(false);
  const cancel=()=>{if(finished.current)return;finished.current=true;onCancel()};
  const accept=()=>{if(phase!=='paired'||finished.current)return;finished.current=true;setConfirming(true);onComplete()};
  useEffect(()=>{
    if(!result||phase!=='rolling')return;
    const timer=setTimeout(()=>setPhase('paired'),Math.max(0,3000-(Date.now()-started.current)));
    return()=>clearTimeout(timer);
  },[result,phase]);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;cancelButton.current?.focus();return()=>{if(previous?.isConnected)previous.focus()}},[]);
  useEffect(()=>{if(phase==='paired')confirmButton.current?.focus()},[phase]);
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel()}if(event.key==='Tab'){event.preventDefault();const controls=Array.from(document.querySelectorAll<HTMLButtonElement>('.matching-animation button')).filter(b=>!b.disabled);if(!controls.length)return;const index=controls.indexOf(document.activeElement as HTMLButtonElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus()}};
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[onCancel]);
  const clusters=result?[...result.pairs,...result.standby.map(id=>[id])]:[],soloCount=clusters.filter(members=>members.length===1).length;
  const explained=phase==='paired'&&!!result?.reasons?.length,pages=Math.max(1,Math.ceil(clusters.length/4)),currentPage=Math.min(page,pages-1);
  const columns=Math.max(1,Math.ceil(Math.sqrt(clusters.length*1.65))),rows=Math.max(1,Math.ceil(clusters.length/columns));
  const size=Math.max(20,Math.min(84,Math.floor(540/Math.sqrt(Math.max(1,players.length)))));
  const positions=new Map<string,{x:number;y:number;offset:number}>();
  clusters.forEach((members,index)=>members.forEach((id,member)=>positions.set(id,{x:100*(index%columns+.5)/columns,y:100*(Math.floor(index/columns)+.5)/rows,offset:members.length===1?0:(member===0?-.56:.56)})));
  const supplementalBattle=(members:string[])=>{const group=result?.newGroups?.find(g=>g.members.length===members.length&&g.members.every(id=>members.includes(id))),match=result?.matches?.find(m=>group&&m.teamIds.includes(group.id));if(!match)return null;const opponent=result?.newGroups?.find(g=>match.teamIds.includes(g.id)&&g.id!==group?.id);return <p className="matching-supplement-pk">{match.bye?'本轮补配轮空，直接晋级；不计胜场。':<>补充对手：{opponent?.members.map(id=>players.find(p=>p.id===id)?.name??'已移除').join(' + ')}<br/>项目：{match.task}</>}</p>};
  return <section className={'matching-animation'+(players.length>100?' compact':'')+(explained?' explained':'')} data-phase={phase} role="dialog" aria-modal="true" aria-label="搭档相遇池" style={{'--matching-size':size+'px'} as React.CSSProperties}>
    <header className="matching-heading"><span className="eyebrow">MEET YOUR PARTNER</span><h1>{supplement?(phase==='rolling'?'新到的搭档正在相遇':'新增搭档，请核对'):(phase==='rolling'?'缘分正在靠近':'就是这一位搭档')}</h1><p role="status">{phase==='rolling'?(supplement?'只抽取已签到且尚未组队的人，已有搭档保留。':'所有在场玩家都在池中滚动，搭档即将相遇…'):explained?'看看你们为什么成为搭档；可以翻页看完，再确认采用本次配对。':'头像靠在一起的就是本轮组合；单人成队按2个名额参赛。结果会保持展示，确认后保存。'}</p>{notice&&<p className="matching-supplement-notice">{notice}</p>}<button ref={cancelButton} type="button" className="btn secondary" disabled={confirming} onClick={cancel}><X size={16}/>{supplement?'取消本次补配':'取消本次配对'}</button></header>
    {explained?<div className={'matching-explained-list count-'+clusters.slice(currentPage*4,(currentPage+1)*4).length}>{clusters.slice(currentPage*4,(currentPage+1)*4).map((members,i)=>{const reason=result?.reasons?.find(r=>r.members.length===members.length&&r.members.every(id=>members.includes(id)));return <article className={'matching-explained-group '+(members.length===1?'solo':'')} key={members.join(',')} data-members={members.join(',')}><span>{members.length===1?'单人成队':'搭档 '+(currentPage*4+i+1)}</span><div className="matching-explained-people">{members.map(id=>{const p=players.find(p=>p.id===id);return <div key={id}><Avatar player={p} size={64}/><h2>{p?.name??'玩家已移除'}</h2><span>#{p?.number??'—'}</span></div>})}</div>{members.length===2&&reason?.reasonSource==='entertainment'&&<small className="matching-reason-source">趣味配对</small>}{members.length===2&&reason?.reasonSource==='profile'&&<small className="matching-reason-source">档案配对理由</small>}<p>{members.length===1?'单人成队，按2个名额参赛；参加全部轮次，获胜只给本人加1分。':reason?.reason??'根据AI数据库分析两个人的长相可能互相存在吸引力'}</p>{supplement&&supplementalBattle(members)}{members.length===1&&<small>兴趣：{players.find(p=>p.id===members[0])?.interests||'尚未填写'}</small>}</article>})}</div>:<div className="matching-pool">
      {phase==='paired'&&clusters.map((members,index)=><div key={index} className={'matching-cluster '+(members.length===1?'solo':'')} data-members={members.join(',')} style={{left:100*(index%columns+.5)/columns+'%',top:100*(Math.floor(index/columns)+.5)/rows+'%',width:92/columns+'%',height:88/rows+'%'}}><span>{members.length===1?'单人成队 · 按2个名额参赛':members.map(id=>players.find(p=>p.id===id)?.name??'已移除玩家').join(' + ')}</span></div>)}
      {players.map((player,index)=>{
        const destination=positions.get(player.id),paired=phase==='paired'&&destination;
        const x=8+((index*61.8034)%84),y=10+((index*37.1097)%76);
        return <div key={player.id} className="matching-avatar" data-player-id={player.id} style={{left:(paired?destination.x:x)+'%',top:(paired?destination.y:y)+'%','--matching-offset':paired?destination.offset:0,'--matching-delay':-(index%11)*.47+'s','--matching-speed':(2.8+(index%7)*.29)+'s','--matching-turn':index%2?1:-1} as React.CSSProperties}><div className="matching-orbit"><Avatar player={player} size={size}/><b title={player.name}>{player.name}</b></div></div>;
      })}
    </div>}
    <footer><span>{players.length} 位{supplement?'补配候选':'在场玩家'} · {phase==='paired'?`${clusters.length} 队${soloCount?' · '+soloCount+' 队单人成队（各按2个名额参赛）':''}`:'正在寻找彼此'}</span>{explained&&<nav className="matching-explained-pages"><button aria-label="搭档理由上一页" onClick={()=>setPage((currentPage-1+pages)%pages)} disabled={pages<2||confirming}>上一页</button><b>第 {currentPage+1} / {pages} 页</b><button aria-label="搭档理由下一页" onClick={()=>setPage((currentPage+1)%pages)} disabled={pages<2||confirming}>下一页</button></nav>}{phase==='paired'&&<button ref={confirmButton} type="button" className="btn primary matching-confirm-button" disabled={confirming} onClick={accept}>{supplement?'确认追加本次搭档':'确认采用本次配对'}</button>}</footer>
  </section>;
}
