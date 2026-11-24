import React,{useEffect,useState} from 'react';
import {ArrowLeft,Target,Trophy,BookOpen,Monitor} from 'lucide-react';
import {PairIntroduction,DrawnPlayers} from './party-presentations';
import {api,Avatar,Countdown} from './ui';
import MissionBoard from './mission-board';
import {ScoresLeaderboard} from './scores-activity';
import {StageRules,PairPKBoard} from './stage-live';
import {PartySummaryBoard} from './party-summary';
import {PairSummaryBoard} from './pair-summary';
import {CropRoster} from './crop-roster';
import {TailsBoard} from './tails-activity';
import {FansStage} from './fans-activity';
import {DrawingCelebration} from './drawing-celebration';
import {liveProjection,stageModeActivities} from './live-projection';
import {adaptScreenActivityNames} from './domain';
import {VoiceStage} from './voice-activity';
function LiveRanking({state}:{state:any}){
 const[page,setPage]=useState(0),[auto,setAuto]=useState(true),rows=state.rows??[],pages=Math.max(1,Math.ceil(rows.length/5)),current=Math.min(page,pages-1);
 useEffect(()=>{if(!auto||pages<2)return;const timer=setInterval(()=>setPage(n=>(n+1)%pages),10000);return()=>clearInterval(timer)},[pages,auto]);
 return <section className="live-game-ranking"><h1>{state.title}</h1>{state.endsAt>0&&<Countdown endsAt={state.endsAt}/>}<ol>{rows.slice(current*5,(current+1)*5).map((p:any,i:number)=><li key={p.id} data-live-rank={p.id}><strong>{current*5+i+1}</strong><Avatar player={p} size={60}/><div><b>{p.name}</b><span>#{p.number}</span></div><em>{p.score}<small>{state.activity===3?'条':'次胜利'}</small></em></li>)}</ol>{!rows.length&&<h2>等待本轮玩家与成绩</h2>}<nav><button aria-label="本游戏排名上一页" onClick={()=>setPage((current-1+pages)%pages)}>上一页</button><b>第 {current+1} / {pages} 页 · 共 {rows.length} 人</b><button aria-label="本游戏排名下一页" onClick={()=>setPage((current+1)%pages)}>下一页</button><button onClick={()=>setAuto(v=>!v)}>{auto?'暂停自动翻页':'继续自动翻页'}</button></nav></section>;
}
export function PairLiveBoard({state}:{state:any}){
 const[page,setPage]=useState(0),[auto,setAuto]=useState(true),groups=state.groups??[],pages=Math.max(1,Math.ceil(groups.length/4)),current=Math.min(page,pages-1),highest=Math.max(0,...groups.map((g:any)=>g.score??0));
 useEffect(()=>setPage(0),[state.round]);
 useEffect(()=>{if(!auto||pages<2)return;const timer=setInterval(()=>setPage(n=>(n+1)%pages),12000);return()=>clearInterval(timer)},[pages,auto]);
 return <section className="live-pair-board"><header><h1>{state.title}</h1><p>{state.subtitle}</p>{state.round===4&&highest>0&&<strong className="live-heart-leaders">最高分 {highest} 分 · {groups.filter((g:any)=>g.score===highest).map((g:any)=>g.name).join(' / ')}</strong>}</header><div className="live-pair-grid">{groups.slice(current*4,(current+1)*4).map((g:any)=><article key={g.id} data-live-group={g.id}><div>{g.members.map((p:any)=><div key={p.id}><Avatar player={p} size={72}/><b>{p.name}</b><span>#{p.number}</span></div>)}</div><h2>{g.name}</h2>{g.solo&&<small>单人成队 · 按{g.seats??2}个名额参赛</small>}{g.score!==undefined&&<strong>{g.score}<small> / 8 分</small></strong>}</article>)}</div>{!groups.length&&<p>等待主持人完成本轮配对或晋级</p>}<nav><button onClick={()=>setPage((current-1+pages)%pages)}>上一页</button><b>第 {current+1} / {pages} 页 · 共 {groups.length} 组</b><button onClick={()=>setPage((current+1)%pages)}>下一页</button><button onClick={()=>setAuto(v=>!v)}>{auto?'暂停自动翻页':'继续自动翻页'}</button></nav></section>;
}
export default function Stage({onClose,activity,round}:{onClose:()=>void;activity?:number;round?:number}){
 const voiceStage=activity===10||activity===11;
 const[data,setData]=useState<any>(null),[error,setError]=useState(''),[rulesOpen,setRulesOpen]=useState(activity!==undefined&&!voiceStage),[view,setView]=useState('current'),[height,setHeight]=useState(()=>window.innerHeight);
 useEffect(()=>{setRulesOpen(activity!==undefined&&!voiceStage);setView('current')},[activity,voiceStage]);
 useEffect(()=>{const resize=()=>setHeight(window.innerHeight);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
 useEffect(()=>{
  if(voiceStage)return;
  let active=true,loading=false;
  const load=async()=>{if(loading)return;loading=true;try{
   // Stage only reads. Polling never writes screen or game states.
   const reads=await Promise.allSettled([api('boot'),api('scores/list'),api('screen')]);
   const boot=reads[0].status==='fulfilled'?reads[0].value:null,scores=reads[1].status==='fulfilled'?reads[1].value:null,screen=adaptScreenActivityNames(reads[2].status==='fulfilled'?reads[2].value??{}:{});
   if(!boot&&!scores)throw (reads[0] as PromiseRejectedResult).reason;
   const number=activity??screen.activity??stageModeActivities[screen.mode]??0;
   const pairSummaryOpen=number===1&&screen.mode==='pair-summary';
   const extra=await Promise.allSettled([number===7?api('mission/list'):Promise.resolve(null),number===9?api('summary/list'):Promise.resolve(null),number===1?api('game/win/list',{activity:1}):Promise.resolve(null),pairSummaryOpen?api('pairs/summary/list'):Promise.resolve(null)]);
   if(extra[0].status==='rejected')throw extra[0].reason;
   if(number===1&&extra[2].status==='rejected')throw extra[2].reason;
   if(pairSummaryOpen&&extra[3].status==='rejected')throw extra[3].reason;
   if(active){setData({number,states:boot?.states??{},players:(scores?.players??boot?.players??[]).map((p:any)=>({...p})),screen,missions:extra[0].status==='fulfilled'?extra[0].value:null,summary:extra[1].status==='fulfilled'?extra[1].value:null,pairSummary:extra[3].status==='fulfilled'?extra[3].value:null,gameWins:extra[2].status==='fulfilled'?extra[2].value?.events??[]:[]});setError('')}
  }catch(e:any){if(active)setError(e.message??'舞台资料暂时无法读取')}finally{loading=false}};
  void load();const timer=setInterval(load,1000),key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',key);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('keydown',key)};
 },[onClose,activity,voiceStage]);
 const number=activity??data?.number??0,s=data?liveProjection({...data,activity:number,view}):null,players=data?.players??[],liveRound=s?.round??round;
 const content=voiceStage?<VoiceStage screen={{activity}}/>:error?<div className="stage-content"><h2>{error}</h2></div>:!s?<div className="stage-content"><h2>舞台准备中…</h2></div>:s.mode==='rules'?<StageRules activity={number} round={liveRound}/>:s.mode==='party-summary'?<PartySummaryBoard summary={data.summary} stage/>:s.mode==='pair-summary'?<PairSummaryBoard summary={data.pairSummary} stage/>:number===9?<section className="scores-stage-screen"><h1>全场最强英雄</h1><ScoresLeaderboard players={players} stage pageSize={Math.max(3,Math.min(8,Math.floor((height-320)/98)))}/></section>:number===0?<section className="lottery-stage"><h1>今晚的玩家</h1><DrawnPlayers people={s.people}/></section>:s.mode==='tails-podium'?<TailsBoard awards={s.awards} endsAt={s.endsAt}/>:s.mode==='score'?<LiveRanking key={number} state={s}/>:s.mode==='crop-roster'?<CropRoster people={s.people??[]} stage/>:s.mode==='battle'?<FansStage state={s}/>:s.mode==='missions'?<MissionBoard progress={s.progress} join={s.join} title={s.title}/>:s.mode==='pair-pk'?<PairPKBoard matches={s.matches} title={s.title}/>:s.mode==='pair-board'||s.mode==='pair-heart'?<PairLiveBoard state={s}/>:s.mode==='pair-profile'?<PairIntroduction title={s.title} cover={s.image} people={s.people??[]} reason={s.reason} solo={s.solo} seats={s.seats}/>:s.mode==='lottery'?<section className="lottery-stage"><h1>{s.title}</h1><h2>{s.subtitle}</h2><DrawnPlayers people={s.people??[]}/></section>:<section className={'stage-content '+(s.image?'with-image':'')}><div><div className="stage-label"><i/>{s.tag??'派对软件'}</div><h1>{s.title}</h1>{s.subtitle&&<h2>{s.subtitle}</h2>}{s.body&&<p className="stage-body">{s.body}</p>}{s.endsAt>0&&<Countdown endsAt={s.endsAt}/>}</div>{s.image&&<img className="stage-image" src={s.image} alt="本轮舞台图片"/>}</section>;
 return <div className="stage stage-live"><header><span><Target size={21}/>派对软件 - 狼森</span><div className="stage-heading-controls"><button onClick={()=>setRulesOpen(true)}><BookOpen size={18}/>游戏规则</button><button onClick={()=>{setRulesOpen(false);setView('current')}}><Monitor size={18}/>展示本轮内容</button>{number===5&&<button onClick={()=>{setRulesOpen(false);setView('ranking')}}><Trophy size={18}/>本游戏排名</button>}<button className="stage-return" onClick={onClose}><ArrowLeft size={16}/>返回操作 Esc</button></div></header><div className="stage-live-body">{rulesOpen?<StageRules activity={number} round={liveRound}/>:content}</div>{!rulesOpen&&number===4&&s?.mode==='drawing'&&s?.celebration&&<DrawingCelebration celebration={s.celebration}/>}<footer><span>派对软件 - 狼森</span><span>没有人是旁观者</span></footer></div>;
}
