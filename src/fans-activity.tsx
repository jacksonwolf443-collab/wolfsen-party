import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Monitor,RotateCcw,Trophy,Undo2,Check} from 'lucide-react';
import {ActivityHeader,Panel,Button,Avatar,Field,PlayerSelect,api} from './ui';
import type {Context} from './ui';
import ManualPlayerPicker from './manual-player-picker';
import {FansCelebration} from './fans-celebration';
import {isEligible} from './domain';
const examples=[
 '全队俯卧撑：双方各派相同人数，1分钟内全队完成的规范俯卧撑总数更多的一队获胜。',
 '接力跑：双方派出相同人数，按相同路线接力，全部队员先完成的一队获胜。',
 '同步深蹲：双方各派相同人数，1分钟内同步完成的规范深蹲轮数更多的一队获胜。',
 '传递气球：双方派出相同人数，按主持人规定的方式接力传递，先完成全部接力的一队获胜。',
 '应援合拍：双方用30秒准备一段全队应援动作，完成后由现场观众投票决定胜方。'
];
const viewState=(input:any)=>{const s=input??{},modern=s.formatVersion===2,rounds=modern?(s.rounds??[]):[],scoreA=rounds.filter((r:any)=>r.winnerSide==='A').length,scoreB=rounds.filter((r:any)=>r.winnerSide==='B').length;return{...s,a:s.a??'',b:s.b??'',sloganA:s.sloganA??'',sloganB:s.sloganB??'',teamA:s.teamA??(s.a?[s.a]:[]),teamB:s.teamB??(s.b?[s.b]:[]),challengeBank:Array.from({length:5},(_,i)=>String((s.challengeBank??(s.challenges?s.challenges.split(/\r?\n/).filter(Boolean):examples))[i]??'')),rounds,scoreA,scoreB,winner:scoreA>=3?'A':scoreB>=3?'B':null,legacyPrevious:s.legacyPrevious??(!modern&&(s.scoreA||s.scoreB)?{scoreA:s.scoreA,scoreB:s.scoreB}:null)}};
const setupOf=(s:any)=>({a:s.a,b:s.b,teamA:s.teamA,teamB:s.teamB,sloganA:s.sloganA,sloganB:s.sloganB,challengeBank:s.challengeBank});
function projection(value:any,players:any[]){const s=viewState(value),who=(id:string)=>players.find(p=>p.id===id),safe=(p:any)=>p?{id:p.id,name:p.name,number:p.number,photo:p.photo??''}:null;return{activity:6,mode:'battle',title:s.winner?'王不见王 · 决赛胜利':'王不见王 · 五局三胜',tag:'五局三胜 · 先得3分获胜',subtitle:s.winner?(who(s[s.winner==='A'?'a':'b'])?.name??s.winner+'队')+'的应援队获胜':'第 '+(s.rounds.length+1)+' 局 / 最多5局',body:s.winner?'全队一起喊出队长的名字！':s.challengeBank[s.rounds.length]??'',winner:s.winner,seriesId:s.seriesId,people:['A','B'].map(side=>({...safe(who(s[side==='A'?'a':'b'])),name:who(s[side==='A'?'a':'b'])?.name??side+'队',score:s[side==='A'?'scoreA':'scoreB'],slogan:s[side==='A'?'sloganA':'sloganB'],team:side,members:s[side==='A'?'teamA':'teamB'].map((id:string)=>safe(who(id))).filter(Boolean)})),rounds:s.rounds}};

export default function FansActivity({ctx}:{ctx:Context}){
 const input=ctx.bag.fans,value=useMemo(()=>viewState(input),[input]),[form,setForm]=useState(()=>setupOf(value)),[localBusy,setLocalBusy]=useState(false),[celebration,setCelebration]=useState<any>(null),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{setForm(setupOf(value))},[value]);
 const dirty=JSON.stringify(form)!==JSON.stringify(setupOf(value)),ps=ctx.players.filter(isEligible),who=(id:string)=>ctx.players.find(p=>p.id===id),ready=!!form.a&&!!form.b&&form.a!==form.b&&isEligible(who(form.a))&&isEligible(who(form.b)),busy=!!ctx.busy||localBusy;
 const work=async(label:string,fn:()=>Promise<any>)=>{if(lock.current||ctx.busy)return;lock.current=true;setLocalBusy(true);try{await ctx.run(label,fn)}finally{lock.current=false;setLocalBusy(false)}};
 const call=async(action:string,body:any={})=>{const boot=await api('boot'),saved=boot.states.fans??{value:null,version:0};if(JSON.stringify(saved.value)!==JSON.stringify(input??null))throw Error('决赛已被其他操作更新，请刷新后再记录');return api('fans/'+action,{...body,version:saved.version})};
 const save=()=>work('保存队伍和五道挑战…',async()=>{await call('configure',form);await ctx.refresh(true);ctx.tell('已保存五局三胜队伍和题库')});
 const result=(winnerSide:string)=>work('记录本局胜方…',async()=>{const result=await call('result',{winnerSide,round:value.rounds.length+1});await ctx.refresh(true);await ctx.project(projection(result.value,ctx.players));const saved=viewState(result.value),round=saved.rounds.at(-1),side=round?.winnerSide??winnerSide,ids=round?.winnerIds??saved[side==='A'?'teamA':'teamB'],people=ids.map((id:string)=>({...((round?.players??[]).find((p:any)=>p.id===id)??who(id)??{id,name:'已登记玩家',number:'',photo:''})}));if(mounted.current)setCelebration({roundId:round?.id,number:round?.number??saved.rounds.length,side,people,scoreA:saved.scoreA,scoreB:saved.scoreB,champion:saved.winner===side})});
 const changeCaptain=(side:'A'|'B',id:string)=>setForm(f=>{const key=side==='A'?'a':'b',team=side==='A'?'teamA':'teamB';return{...f,[key]:id,[team]:[...new Set([id,...f[team].filter((member:string)=>member!==f[key])])].filter(Boolean)}});
 if(celebration)return <FansCelebration celebration={celebration} onClose={()=>setCelebration(null)}/>;
 return <>
  <ActivityHeader num={6} title="王不见王" description="全队出征，五局三胜；每局完成一个多人PK项目，先得3分的应援队获胜。"></ActivityHeader>
  <ManualPlayerPicker players={ps} max={Math.max(1,ps.length-1)} label="选取A组玩家" confirmLabel="确定A组" disabled={busy} onConfirm={async ids=>{await work('确定A组并自动组成B组…',async()=>{await call('partition',{teamA:ids,roster:ps.map(p=>p.id)});await ctx.refresh(true);ctx.tell('A组已确定，其余已签到玩家自动成为B组')})}}/><div className="fans-format-banner"><Trophy size={30}/><div><strong>五局三胜 · 先得3分获胜</strong><p>选取A组玩家并确认，其余已签到玩家自动成为B组。两组队长可在下方指定，依次完成5道PK项目。后到或签退后，重新确认A组才更新队伍，已经结束的局保留原参赛名单。</p></div></div>
  {value.legacyPrevious&&<p className="inline-note">旧版三局两胜比分 {value.legacyPrevious.scoreA??0} : {value.legacyPrevious.scoreB??0} 已保留供查看；新版五局三胜从0比0开始，不把旧比分当作新比赛结果。</p>}
  <div className="battle-grid fans-host-grid">{(['A','B'] as const).map(side=>{const key=side==='A'?'a':'b',team=side==='A'?'teamA':'teamB',other=side==='A'?'b':'a',otherTeam=side==='A'?'teamB':'teamA',slogan=side==='A'?'sloganA':'sloganB',captain=who(form[key]);return <Panel key={side} title={side+'队'} tag={form[team].length+'名已登记队员'}>
   <PlayerSelect players={ps.filter(p=>p.id!==form[other])} value={form[key]} disabled={busy||value.rounds.length>0} onChange={(id:string)=>changeCaptain(side,id)} placeholder="选择本队队长"/>
   <div className="fans-captain-profile"><Avatar player={captain} size={88}/><div><small>{captain?'#'+captain.number:'等待队长就位'}</small><h2>{captain?.name??side+'队队长'}</h2></div><strong>{side==='A'?value.scoreA:value.scoreB}</strong></div>
   <Field label="全队应援口号"><input value={form[slogan]} disabled={busy} maxLength={2000} onChange={e=>setForm(f=>({...f,[slogan]:e.target.value}))} placeholder="给队长一句应援！"/></Field>
   <details className="fans-team-editor"><summary>登记本队队员 · {form[team].length} 人（包括队长）</summary><p>在此登记实际参赛队员，便于全晚总结统计获胜项目；每人只能加入一队。未登记时仅记录队长。</p><div>{[...ctx.players.filter(p=>Boolean(isEligible(p))||form[team].includes(p.id)),...form[team].filter((id:string)=>!who(id)).map((id:string)=>({id,name:'已移除的玩家',number:'',photo:'',active:0}))].filter(p=>!form[otherTeam].includes(p.id)).map(p=><label key={p.id}><input type="checkbox" checked={form[team].includes(p.id)} disabled={busy||p.id===form[key]} onChange={e=>setForm(f=>({...f,[team]:e.target.checked?[...new Set([...f[team],p.id])]:f[team].filter((id:string)=>id!==p.id)}))}/><Avatar player={p} size={26}/><span>{p.name}{!isEligible(p)?'（未到/已离场）':''}</span></label>)}</div></details>
   <button className="btn primary fans-result-button" aria-label={'记录'+side+'队本局获胜'} disabled={!ready||busy||dirty||input?.formatVersion!==2||!!value.winner||!value.challengeBank[value.rounds.length]} onClick={()=>result(side)}><Check size={18}/>记录{side}队本局获胜</button>
  </Panel>})}</div>
  <Panel title={value.winner?value.winner+'队获胜！':'当前第 '+(value.rounds.length+1)+' 局'} tag={'五局三胜 · '+value.scoreA+' : '+value.scoreB} className="fans-current-panel">
   <p className="fans-current-project">{value.winner?'先得3分，决赛结束！':value.challengeBank[value.rounds.length]||'先填写本局PK项目'}</p>
   {!!value.rounds.length&&<ol className="fans-round-log">{value.rounds.map((r:any)=><li key={r.id??r.number}><span>第{r.number}局</span><b>{r.winnerSide}队获胜</b><p>{r.task}</p></li>)}</ol>}
   <div className="button-row"><Button variant="secondary" disabled={busy||!value.rounds.length} onClick={()=>work('撤销上一局结果…',async()=>{const result=await call('undo');await ctx.refresh(true);await ctx.project(projection(result.value,ctx.players))})}><Undo2 size={16}/>撤销上一局结果</Button><Button variant="ghost" disabled={busy} onClick={()=>{if(confirm('重开本场五局三胜决赛？逐局成绩会保留在全晚总结历史中，新决赛从0比0开始。'))work('重开决赛…',async()=>{await call('reset',{confirmed:true});await ctx.refresh(true)})}}><RotateCcw size={16}/>重开决赛（保留历史）</Button></div>
  </Panel>
  <Panel title="自定义决赛题库" tag="1—5 · 每局一个项目"><p className="muted">下列为可直接修改的多人项目示例。可填写俯卧撑总数、接力跑等项目，并写清人数、时长与判胜标准；已结束的局保留当时题目。若有队员离场，取消其勾选并保存后继续。</p><div className="fans-project-bank">{form.challengeBank.map((task:string,i:number)=><Field key={i} label={'第 '+(i+1)+' 局PK项目'}><textarea data-fans-project={i+1} aria-label={'第'+(i+1)+'局PK项目'} rows={3} maxLength={2000} disabled={busy} value={task} onChange={e=>setForm(f=>({...f,challengeBank:f.challengeBank.map((v:string,n:number)=>n===i?e.target.value:v)}))}/></Field>)}</div><Button disabled={busy||!ready||(!dirty&&input?.formatVersion===2)} onClick={save}>保存队伍和五道挑战</Button>{dirty&&<p className="fans-unsaved">修改后请先保存，再记录本局胜方。</p>}</Panel>
 </>;
}

export function FansStage({state}:{state:any}){
 const people=state.people??[],rounds=state.rounds??[];
 return <section className={'fans-stage '+(state.winner?'fans-stage-winner':'')}><div className="fans-stage-heading"><span>五局三胜 · 先得3分获胜</span><h1>{state.title??'王不见王'}</h1><p>{state.subtitle}</p></div><div className="fans-stage-teams">{people.map((p:any,i:number)=><article key={p.id??i} className={'fans-stage-team '+(state.winner===(i===0?'A':'B')?'winner':'')}><div><Avatar player={p} size={100}/><span>{i===0?'A':'B'}队 · 队长 #{p.number}</span><h2>{p.name}</h2>{p.slogan&&<p>{p.slogan}</p>}<small>{(p.members??[]).length} 名已登记队员</small></div><strong className="fans-stage-score">{p.score??0}</strong></article>)}</div><div className="fans-stage-project"><b>{state.winner?'胜利属于你们！':'本局PK项目'}</b><p>{state.body}</p></div><div className="fans-stage-results">{rounds.map((r:any)=><span key={r.id??r.number}>第{r.number}局 · {r.winnerSide}队胜</span>)}</div></section>;
}
