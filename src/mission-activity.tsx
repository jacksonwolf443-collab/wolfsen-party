import React,{useEffect,useState} from 'react';
import {Plus,Check,Play,Square,Monitor,Download,Ticket,CheckCircle2} from 'lucide-react';
import {ActivityHeader,Panel,Button,Countdown,api,Avatar,Empty,Field,PlayerSelect} from './ui';
import type {Context} from './ui';
import {isEligible} from './domain';
import MobileAccess from './mobile-access';
import ManualPlayerPicker from './manual-player-picker';
import MissionFinale from './mission-finale';

export default function MissionActivity({ctx}:{ctx:Context}){
 const[bank,setBank]=useState<string[]>(ctx.bag.taskBank??Array(35).fill('')),[minutes,setMinutes]=useState(20),[data,setData]=useState<any>({round:null,missions:[]}),[section,setSection]=useState('bank'),[actor,setActor]=useState(''),[code,setCode]=useState(''),[finaleReplay,setFinaleReplay]=useState(0);
 const active=ctx.players.filter(isEligible),filled=bank.filter(x=>x.trim()).length,completed=data.missions.filter((m:any)=>m.completed_at).length,who=(id:string)=>ctx.players.find(p=>p.id===id);
 const available=(m:any)=>isEligible(who(m.actor))&&isEligible(who(m.target)),actorAvailable=data.missions.some((m:any)=>m.actor===actor&&available(m));
 const pending=data.missions.filter((m:any)=>!m.completed_at&&available(m)),paused=data.missions.filter((m:any)=>!m.completed_at&&!available(m));
 const newcomers=active.filter(p=>!data.missions.some((m:any)=>m.actor===p.id)),canSupplement=!!data.round&&!data.round.ended&&data.round.endsAt>Date.now()&&newcomers.length>0;
 const progress={round:data.round,rows:data.missions.map((m:any)=>({id:m.id,actor:m.actor,target:m.target,name:who(m.actor)?.name??m.actorName??'已移除玩家',number:who(m.actor)?.number??m.actorNumber??'—',photo:who(m.actor)?.photo??'',targetName:who(m.target)?.name??m.targetName??'已移除玩家',targetNumber:who(m.target)?.number??m.targetNumber??'—',task:m.task,completed_at:m.completed_at,paused:!available(m)}))};
 const load=async()=>{const next=await api('mission/list');setData(next);return next};
 useEffect(()=>{let mounted=true;const poll=async()=>{try{const next=await api('mission/list');if(mounted)setData(next)}catch(e:any){if(mounted)ctx.tell(e.message)}};void poll();const timer=setInterval(poll,3000);return()=>{mounted=false;clearInterval(timer)}},[]);
 useEffect(()=>{if(data.round?.ended)setSection('progress')},[data.round?.id,data.round?.ended]);
 const project=async(enter=false)=>{await ctx.project({activity:7,mode:'missions',title:data.round?.ended?'任务结算':'客官,YOU HAPPY？',subtitle:data.round?.ended?'未通过玩家与验收事件':'A去找B，由B对A完成任务；认可后交付验收码。'});if(enter)ctx.enterStage?.()};
 const start=()=>ctx.run('分配任务与验收对象…',async()=>{await ctx.save('taskBank',bank);await api('mission/start',{minutes});await load();setSection('progress');ctx.tell('任务已分配，每个人都有自己的目标')});
 const supplement=(actorIds?:string[])=>ctx.run('给新签到玩家补发任务…',async()=>{const result=await api('mission/supplement',{eventId:ctx.event?.id,roundId:data.round.id,actorIds});await load();setSection('progress');ctx.tell(result.added?'已给'+result.added+'位新签到玩家补发任务，原任务和截止时间保留':'新签到玩家已全部领到任务')});
 const verify=()=>ctx.run('校验验收码…',async()=>{if(!actorAvailable)throw new Error('任务参与者未到/已离场，恢复到场后可继续验收');const r=await api('mission/verify',{actor,code});setCode('');await load();ctx.tell(r.already?'这位玩家已经通过验收':'验收通过，已存档')});
 const end=()=>{if(confirm('结束本轮，播放结算过程并公布未通过玩家与验收事件？'))ctx.run('结算任务…',async()=>{await api('mission/end',{});const next=await load();if(!next.round?.ended)throw new Error('本轮尚未确认结束，请刷新后重试');setSection('progress');setFinaleReplay(n=>n+1);await ctx.project({activity:7,mode:'missions',title:'任务结算',subtitle:'未通过玩家与验收事件'});ctx.tell('本轮已结束，可打开大字结算向全场公布')})};
 return <>
  <ActivityHeader num={7} title="客官,YOU HAPPY？" description="A去找B，由B对A完成任务；A不配合，B不给验收码，A受罚。认可后由A提交B给的验收码。">
   <Button variant="secondary" disabled={!data.missions.length||!!ctx.busy} onClick={()=>ctx.run('导出任务卡…',async()=>{const r=await api('mission/export-cards');if(!r.canceled)ctx.tell('任务卡已导出：请把每一行的信息分别交给本人')})}><Download size={16}/>导出私密任务卡</Button>
   
   <Button disabled={!data.missions.length} onClick={()=>ctx.run('打开全屏任务大字板…',()=>project(true))}>{data.round?.ended?'全屏大字公布结算':'全屏查看所有任务'}</Button>
  </ActivityHeader>
  <div className="mission-stats"><div><span>参与玩家</span><b>{active.length}<small>人</small></b></div><div><span>有效任务</span><b>{filled}<small>道</small></b></div><div><span>验收通过</span><b>{completed}<small>/ {data.missions.length}</small></b></div><div><span>{data.round?.ended?'本轮已结束':'本轮剩余'}</span><Countdown endsAt={data.round?.endsAt}/></div></div>
  <MobileAccess ctx={ctx}/>
  {canSupplement&&<div className="mission-late-entry inline-note"><b>新签到 · {newcomers.length}人待领任务</b><p>{newcomers.map(p=>p.name).join('、')}</p><p>补入本轮后即可扫码领任务。原来玩家的任务、验收码和截止时间保留。</p><Button disabled={!!ctx.busy} onClick={()=>supplement()}><Plus size={16}/>给新签到玩家补发任务</Button><ManualPlayerPicker players={newcomers} max={newcomers.length} label="手动选择要补发任务的玩家" onConfirm={ids=>supplement(ids)}/></div>}
  <div className="section-tabs"><button className={section==='bank'?'active':''} onClick={()=>setSection('bank')}>自定义题库 <span>{filled}</span></button><button className={section==='progress'?'active':''} onClick={()=>setSection('progress')}>分配与验收 <span>{data.missions.length}</span></button></div>
  {section==='bank'?<Panel title="你的任务题库" tag="35个输入框，可继续增加"><div className="inline-note">题目描述验收对象B要对来找他的A做什么，例如「给来找你的人讲一个有趣的故事」。空白题跳过，题数少于玩家数时均衡复用；每人的目标和验收码都独立。</div><div className="task-bank">{bank.map((text,i)=><label className={'task-input '+(text.trim()?'filled':'')} key={i}><span>任务 {String(i+1).padStart(2,'0')}{text.trim()&&<Check size={13}/>}</span><textarea aria-label={'任务'+(i+1)} rows={3} value={text} placeholder="写下B要对来找他的A做的事…" onChange={e=>setBank(b=>b.map((t,n)=>n===i?e.target.value:t))} onBlur={()=>ctx.save('taskBank',bank).catch(e=>ctx.tell(e.message))}/></label>)}</div><div className="button-row"><Button variant="secondary" onClick={()=>setBank(b=>[...b,''])}><Plus size={16}/>增加一道任务</Button><Button onClick={()=>ctx.run('保存任务题库…',async()=>{await ctx.save('taskBank',bank);ctx.tell('题库已保存到本机')})}><Check size={16}/>保存题库</Button></div></Panel>:<>
   {data.round?.ended&&<div className="mission-finale-operator"><MissionFinale key={data.round.id+':'+finaleReplay} progress={progress}/><div className="mission-end-actions"><Button onClick={()=>ctx.run('打开大字结算…',()=>project(true))}><Monitor size={16}/>向全场公布结算</Button><Button variant="secondary" onClick={()=>setFinaleReplay(n=>n+1)}>重播结束动画</Button></div></div>}
   {!data.round?.ended&&<Panel title="现场录入验收码" tag="6位数字"><div className="offline-verification"><Field label="完成任务的玩家"><PlayerSelect players={ctx.players.filter(p=>isEligible(p)&&data.missions.some((m:any)=>m.actor===p.id&&available(m)))} value={actor} onChange={setActor}/></Field><Field label="从任务对象处拿到的验收码"><input inputMode="numeric" maxLength={6} value={code} placeholder="输入6位验收码" onChange={e=>setCode(e.target.value.replace(/\D/g,''))} onKeyDown={e=>{if(e.key==='Enter'&&actorAvailable&&code.length===6)verify()}}/></Field><Button disabled={!actorAvailable||code.length!==6||!!ctx.busy} onClick={verify}><CheckCircle2 size={17}/>确认验收</Button></div><p className="muted">验收码只在本人手机页面或导出的私密任务卡中出现，不会在舞台上公布。未到/已离场者的待完成任务暂停验收；恢复到场后可继续。现场情况特殊时，可手动补记通过。</p></Panel>}
   <Panel title={data.round?.ended?'本轮结算明细':'全员任务与完成进度'} tag="本地实时保存">
    {!data.missions.length?<Empty icon={Ticket} title="还没有分配任务">填好题库后，点击下方「随机分配并开始」。</Empty>:<>
     {data.round?.ended&&<div className="result-note mission-result-summary"><b>未验收通过名单 · {pending.length}人</b><p>{pending.map((m:any)=>who(m.actor)?.name??m.actorName??'已移除').join('、')||'在场玩家均已通过，或其任务因参与者离场而暂停。'}</p>{paused.length>0&&<span>另有{paused.length}人任务暂停，不计入未通过受罚名单。</span>}</div>}
     <div className="progress-track"><span style={{width:completed/data.missions.length*100+'%'}}/></div><div className="mission-list">{data.missions.map((m:any)=><div key={m.id} className={m.completed_at?'complete':''}><div className="mission-person"><Avatar player={who(m.actor)} size={38}/><div><b>{who(m.actor)?.name??m.actorName??'已移除'}</b><strong className="mission-target">去找 → #{who(m.target)?.number??m.targetNumber} {who(m.target)?.name??m.targetName??'已移除'}</strong></div></div><p>{m.task}</p><span className={'pill '+(m.completed_at?'green':'')}>{m.completed_at?'验收通过':available(m)?data.round?.ended?'本轮未验收通过':'等待验收':'暂停 · 参与者未到/已离场'}</span>{!m.completed_at&&!data.round?.ended&&available(m)&&<button className="text-button" onClick={()=>{if(confirm('确认这位玩家已完成任务，手动补记通过？'))ctx.run('补记通过…',async()=>{await api('mission/approve',{id:m.id});await load()})}}>补记通过</button>}</div>)}</div>
    </>}
   </Panel>
  </>}
  <div className="mission-control"><div><b>{data.round?.ended?'本轮验收已经结算':'准备好让大家互相认识了吗？'}</b><span>大家扫码选择本人即可领任务；本轮结束后，大字公布未通过玩家和验收事件。</span></div><label>时长 <input aria-label="任务时长" type="number" min="1" max="180" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/> 分钟</label>{data.round&&!data.round.ended?<Button variant="danger" disabled={!!ctx.busy} onClick={end}><Square size={14}/>结束本轮</Button>:<Button disabled={active.length<2||!filled||!!ctx.busy} onClick={start}><Play size={16}/>随机分配并开始</Button>}</div>
 </>;
}
