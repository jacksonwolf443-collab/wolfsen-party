import React,{useEffect,useRef,useState} from 'react';
import {Monitor,Shuffle,UsersRound} from 'lucide-react';
import {ActivityHeader,Button,Panel,Field,Empty,api} from './ui';
import type {Context} from './ui';
import ManualPlayerPicker from './manual-player-picker';
import {isEligible} from './domain';
import {DrawnPlayers} from './party-presentations';
import LotteryAnimation from './lottery-animation';
import type {LotteryPreview,LotterySession} from './lottery-animation';
export default function LotteryActivity({ctx}:{ctx:Context}){
  const result=ctx.bag.lottery,[count,setCount]=useState(String(result?.count??2));
  const [animation,setAnimation]=useState<(LotterySession&{roster:string})|null>(null);
  const mounted=useRef(true),running=useRef(false),cancelDraw=useRef<(()=>void)|null>(null);
  const eligible=ctx.players.filter(isEligible),roster=JSON.stringify(eligible.map(p=>[p.id,p.name,p.number,p.photo]).sort((a,b)=>a[0].localeCompare(b[0])));
  const currentRoster=useRef(roster);currentRoster.current=roster;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelDraw.current?.()}},[]);
  useEffect(()=>{if(animation&&!animation.saving&&animation.roster!==roster){cancelDraw.current?.();ctx.tell('玩家在场状态已变化，本次抽取已取消，请重新抽取')}},[animation,roster]);
  const visiblePeople=(result?.people??[]).filter((person:any)=>isEligible(ctx.players.find(p=>p.id===person.id)));
  const available=eligible.length,n=Number(count),valid=Number.isSafeInteger(n)&&n>=1&&n<=available;
  const draw=async(ids?:string[])=>{
    const n=ids?.length??Number(count);
    if((ids?(!n||n>available):!valid)||running.current||ctx.busy)return;
    running.current=true;
    try{await ctx.run('正在随机抽取…',async()=>{
      let finish!:(complete:boolean)=>void,token='',cancelled=false,committing=false;
      const finished=new Promise<boolean>(resolve=>{finish=resolve}),discarded=new Set<string>();
      const discard=(value:string)=>{if(!value||discarded.has(value))return;discarded.add(value);void api('lottery/cancel',{token:value}).catch(()=>{})};
      const cancel=()=>{if(committing)return;cancelled=true;finish(false);discard(token);if(mounted.current)setAnimation(null)};
      cancelDraw.current=cancel;
      const session:LotterySession&{roster:string}={players:eligible,count:n,result:null,saving:false,roster,onComplete:()=>finish(true),onCancel:cancel};
      setAnimation(session);
      try{
        const request=api('lottery/draw',{count:n,ids,version:ctx.bag.lotteryVersion??0,preview:true}).then((value:LotteryPreview)=>{
          if(cancelled||!mounted.current){discard(value.token);return null}token=value.token;return value;
        });
        const preview=await Promise.race([request,finished.then(()=>null)]);
        if(!preview||cancelled||!mounted.current)return;
        if(!preview.token||preview.people?.length!==n||new Set(preview.people.map(p=>p.id)).size!==n||preview.people.some(p=>!eligible.some(person=>person.id===p.id)))throw new Error('抽取结果无效，请重新抽取');
        if(currentRoster.current!==roster)throw new Error('玩家在场状态已变化，请重新抽取');
        setAnimation({...session,result:preview});
        if(!await finished||cancelled||!mounted.current)return;
        if(currentRoster.current!==roster)throw new Error('玩家在场状态已变化，请重新抽取');
        committing=true;setAnimation({...session,result:preview,saving:true});
        await api('lottery/commit',{token:preview.token,version:ctx.bag.lotteryVersion??0});
        await ctx.refresh(true);
        if(mounted.current)ctx.tell('已抽取 '+n+' 位玩家，结果已保存');
      }finally{finish(false);discard(token);cancelDraw.current=null;if(mounted.current)setAnimation(null)}
    })}finally{running.current=false}
  };
  if(animation)return <LotteryAnimation {...animation}/>;
  return <><ActivityHeader num={8} title="随机抽取玩家" description="从全场头像池中抽取主角，优先今晚被抽中较少的人，同次数随机。每轮不重复。"/>
    <Panel title="这次抽几位？" tag={available+' 位可参与玩家'}><div className="lottery-controls">
      <Field label="抽取人数"><input aria-label="抽取人数" type="number" min="1" max={available} step="1" value={count} onChange={e=>setCount(e.target.value)}/></Field>
      <ManualPlayerPicker players={eligible} max={Math.max(1,eligible.length)} disabled={!!ctx.busy} onConfirm={ids=>draw(ids)} label="手动选取任意玩家"/><Button disabled={!valid||!!ctx.busy} onClick={()=>draw()}><Shuffle size={18}/>随机抽取</Button>
      
    </div><p className="muted">优先从未被抽中、再选次数较少的玩家，同次数随机。只抽取已到场且参与活动的人；本轮不会重复。结果会显示头像、今晚被抽中次数和原因。</p>{!valid&&<p role="status">请输入 1 至 {available} 之间的整数。</p>}</Panel>
    {visiblePeople.length?<><p className="muted">上次抽取结果 · 当前仍在场 {visiblePeople.length} 位</p><DrawnPlayers people={visiblePeople}/></>:<Empty icon={UsersRound} title="等待主角登场">输入人数，点击“随机抽取”。</Empty>}
  </>;
}
