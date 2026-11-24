import React,{useEffect,useRef,useState} from 'react';
import {ActivityHeader,Panel,Button,Avatar,Countdown,PlayerSelect,api} from './ui';
import type {Context} from './ui';
import {isEligible} from './domain';
import TailsGroupingAnimation from './tails-grouping-animation';
import type {TailsGroupingSession} from './tails-grouping-animation';
const names=['冠军','亚军','季军'];
export function TailsBoard({awards=[],endsAt}:{awards:any[];endsAt?:number}){return <section className="tails-board"><h1>线下决斗 · 三强揭晓</h1>{!awards.length&&<><Countdown endsAt={endsAt}/><p>三组各决出一位尾巴最多的玩家，再比较三位冠军的收获。</p></>}<div className="tails-awards">{[0,1,2].map(i=>{const a=awards[i];return <article key={i}><h2>线下决斗{names[i]} <strong>+{3-i}分</strong></h2><Avatar player={a} size={110}/><h3>{a?.name??'待定玩家'}</h3>{a&&<p>#{a.number} · 收集 {a.count} 条尾巴</p>}</article>})}</div></section>}
export default function TailsActivity({ctx}:{ctx:Context}){
 const s=ctx.bag.tails??{},[winners,setWinners]=useState<any[]>([]),[rankOrder,setRankOrder]=useState<string[]>([]),[tieConfirmed,setTieConfirmed]=useState(false),[animation,setAnimation]=useState<(TailsGroupingSession&{roster:string;state:string;eventId:string})|null>(null);
 const mounted=useRef(true),running=useRef(false),cancelGrouping=useRef<(()=>void)|null>(null),eligible=ctx.players.filter(isEligible),roster=JSON.stringify(eligible.map(p=>[p.id,p.name,p.number,p.photo]).sort((a,b)=>a[0].localeCompare(b[0]))),state=JSON.stringify(ctx.bag.tails??null),currentRoster=useRef(roster);currentRoster.current=roster;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelGrouping.current?.()}},[]);
 useEffect(()=>{if(animation&&!animation.saving&&(animation.roster!==roster||animation.state!==state||animation.eventId!==ctx.event.id)){cancelGrouping.current?.();ctx.tell('玩家名单或本轮分组已变化，本次分组已取消，请重新开始')}},[animation,roster,state,ctx.event.id]);
 useEffect(()=>{setWinners(Array.from({length:3},(_,i)=>s.winners?.[i]??{playerId:'',count:0}));setRankOrder([]);setTieConfirmed(false)},[s.roundId]);
 const who=(id:string)=>ctx.players.find(p=>p.id===id),call=async(action:string,extra:any={})=>{const boot=await api('boot');const r=await api('tails/'+action,{version:boot.states.tails?.version??0,eventId:ctx.event.id,...extra});await ctx.refresh(true);return r};
 const start=async()=>{
  if(running.current||ctx.busy||eligible.length<3)return;running.current=true;
  try{await ctx.run('随机分为三组…',async()=>{
   let finish!:(accept:boolean)=>void,token='',version=0,cancelled=false,committing=false;
   const finished=new Promise<boolean>(resolve=>{finish=resolve}),discarded=new Set<string>(),discard=(id:string)=>{if(!id||discarded.has(id))return;discarded.add(id);void api('tails/cancel',{token:id}).catch(()=>{})};
   const cancel=()=>{if(committing)return;cancelled=true;finish(false);discard(token);if(mounted.current)setAnimation(null)};cancelGrouping.current=cancel;
   const session:TailsGroupingSession&{roster:string;state:string;eventId:string}={players:eligible,groups:null,saving:false,roster,state,eventId:ctx.event.id,onConfirm:()=>finish(true),onCancel:cancel};setAnimation(session);
   try{
    const request=(async()=>{const boot=await api('boot');if(cancelled||!mounted.current)return null;if(boot.event?.id!==ctx.event.id||JSON.stringify(boot.states.tails?.value??null)!==state)throw new Error('本轮分组已被更新，请刷新后重新分组');version=boot.states.tails?.version??0;const value=await api('tails/prepare',{version,eventId:ctx.event.id});token=value.token;if(cancelled||!mounted.current){discard(token);return null}return value})();
    const preview=await Promise.race([request,finished.then(()=>null)]);if(!preview||cancelled||!mounted.current)return;
    const groups=preview.groups,ids=Array.isArray(groups)?groups.flat():[];
    if(!preview.token||!Array.isArray(groups)||groups.length!==3||groups.some((g:any)=>!Array.isArray(g)||!g.length)||ids.length!==eligible.length||new Set(ids).size!==eligible.length||ids.some((id:string)=>!eligible.some(p=>p.id===id))||Math.max(...groups.map((g:string[])=>g.length))-Math.min(...groups.map((g:string[])=>g.length))>1)throw new Error('分组结果不完整，请重新分组');
    if(currentRoster.current!==roster)throw new Error('玩家名单已变化，请重新分组');setAnimation({...session,groups});
    if(!await finished||cancelled||!mounted.current)return;if(currentRoster.current!==roster)throw new Error('玩家名单已变化，请重新分组');committing=true;setAnimation({...session,groups,saving:true});
    await api('tails/commit',{token,version,eventId:ctx.event.id});await ctx.refresh(true);if(mounted.current)ctx.tell('三组挑战者已就位，本轮3分钟倒计时开始');
   }finally{finish(false);discard(token);cancelGrouping.current=null;if(mounted.current)setAnimation(null)}
  })}finally{running.current=false}
 };
 const awards=(s.awards??[]).map((a:any)=>({...who(a.playerId),...a})),tie=new Set(winners.map(w=>w.count)).size<3;
 if(animation)return <TailsGroupingAnimation {...animation}/>;
 return <><ActivityHeader num={3} title="线下决斗" description="在场玩家分为3组，每组先选出尾巴最多的一人；三位组冠军再按尾巴数排名。"><Button disabled={!!ctx.busy||eligible.length<3} onClick={start}>{s.roundId?'重新分为3组并开始':'分为3组并开始'}</Button></ActivityHeader>
 {(s.formatVersion!==3)?<TailsBoard awards={awards} endsAt={s.endsAt}/>:<div className="score-overview"><Countdown endsAt={s.endsAt}/><b>每组决出一位尾巴最多的玩家</b></div>}
 {s.formatVersion===3&&<><div className="tails-awards">{(s.groups??[]).map((group:string[],i:number)=><section key={i} className="panel tails-group-card"><div className="tails-challenger-roster"><h3>第{i+1}组挑战者：</h3><div>{group.map(id=>{const player=who(id);return <div key={id} className="tails-challenger" data-player-id={id}><Avatar player={player} size={48}/><b>{player?.name??'已移除的玩家'}</b></div>})}</div></div><div className="tails-champion-picker"><h3>第{i+1}组冠军{(()=>{const a=awards.find((a:any)=>a.playerId===winners[i]?.playerId);return a?' · 线下决斗'+names[a.rank-1]+' +'+a.points+'分':''})()}</h3><Avatar player={who(winners[i]?.playerId)} size={90}/><PlayerSelect players={group.map(who).filter(isEligible)} value={winners[i]?.playerId} placeholder="选取本组任意一位获胜玩家" onChange={(id:string)=>setWinners(rows=>rows.map((w,n)=>n===i?{...w,playerId:id}:w))}/><label className="field"><span>收集尾巴数量</span><input aria-label={'第'+(i+1)+'组尾巴数'} type="number" min="0" value={winners[i]?.count??0} onChange={e=>setWinners(rows=>rows.map((w,n)=>n===i?{...w,count:Number(e.target.value)}:w))}/></label></div></section>)}</div>{tie&&winners.every(w=>w.playerId)&&<Panel title="同数时先加赛，再确认名次"><p>相同尾巴数不会自动决定胜负；以下名次仅用于同数玩家的先后。</p>{names.map((name,i)=><PlayerSelect key={i} players={winners.map(w=>who(w.playerId)).filter(Boolean)} value={rankOrder[i]} placeholder={'加赛'+name} onChange={(id:string)=>setRankOrder(old=>{const next=[...old];next[i]=id;return next})}/>)}<label><input type="checkbox" checked={tieConfirmed} onChange={e=>setTieConfirmed(e.target.checked)}/>已确认同数时的加赛名次</label></Panel>}<Button disabled={!!ctx.busy||winners.length!==3||winners.some(w=>!w.playerId)||tie&&!tieConfirmed} onClick={()=>ctx.run('结算前三名…',async()=>{await call('settle',{winners,...(tie?{rankOrder}:{})});ctx.tell('冠军+3分、亚军+2分、季军+1分，已计入全场积分')})}>确认前三名并计分（3 / 2 / 1）</Button></>}
 </>;
}
