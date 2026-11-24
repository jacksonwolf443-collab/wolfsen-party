import React,{useEffect,useRef,useState} from 'react';
import {Camera,ChevronRight,Shuffle,Sparkles,Square,UsersRound} from 'lucide-react';
import {isEligible,pairPlayers,pairName} from './domain';
import {ActivityHeader,Avatar,Button,Empty,Panel,api,photoData,img} from './ui';
import type {Context} from './ui';
import {PairIntroduction} from './party-presentations';
import MatchingAnimation from './matching-animation';
import type {MatchingSession} from './matching-animation';
import PairTournament,{PairLegacySoloUpgrade} from './pair-tournament';
import {runPairCoverQueue} from './pair-cover-queue';
import {pairCoverRecoverySignature,restorePairCoverRecovery,rememberPairCoverRecovery,clearPairCoverRecovery} from './pair-cover-recovery';
import ManualPlayerPicker from './manual-player-picker';
import PairHeart,{PAIR_ROUND_NAMES} from './pair-heart';
import PairSummary from './pair-summary';

type Pair={id:string;members:string[];solo?:boolean;seats?:number;challenge:string;cover:string;scene?:string;coverMethod?:string;coverFailure?:{message:string;source?:string}|null;alive:boolean;votes:number;matchReason?:string;matchReasonSource?:string;matchReasonEvidence?:any[]};
type Failure={id:string;label:string;error:string;pending?:any};
type Kind='cover'|'challenge';
export default function Pairs({ctx}:{ctx:Context}){
  const s=ctx.bag.pairs??{groups:[],standby:[],round:1};
  const [selected,setSelected]=useState('');
  const [viewRound,setViewRound]=useState<number|null>(null);
  const round=viewRound??s.round??1;
  useEffect(()=>setViewRound(null),[s.round]);
  const [bank,setBank]=useState<string[]>(()=>Array.from({length:20},(_,i)=>s.challengeBank?.[i]??''));
  const [secondBank,setSecondBank]=useState<string[]>(()=>Array.from({length:10},(_,i)=>s.round2Bank?.[i]??''));
  const [manualWins,setManualWins]=useState<any[]>([]);
  const loadWins=async()=>{const r=await api('game/win/list',{activity:1});if(mounted.current)setManualWins(r.events??[])};
  useEffect(()=>{if((s.round??1)===3)loadWins().catch(()=>{})},[s.round,s.tournament?.blindfoldResults]);
  const saveBank=()=>save((current:any)=>({...current,groups:current?.groups??[],standby:current?.standby??[],round:current?.round??1,challengeBank:bank,round2Bank:secondBank}));
  const assignBank=()=>work('正在随机分配自定义挑战…',async()=>{await saveBank();const latest=await api('boot');const r=await api('pairs/assign-challenges',{version:latest.states.pairs.version});await ctx.refresh(true);ctx.tell('已为 '+r.count+' 组随机分配题库挑战');});
  const [progress,setProgress]=useState<{kind:Kind;done:number;total:number;label:string;running:boolean}|null>(null);
  const [failures,setFailures]=useState<Failure[]>([]),[stopping,setStopping]=useState(false);
  const [matching,setMatching]=useState<MatchingSession|null>(null);
  const finishMatching=useRef<((complete:boolean)=>void)|null>(null);
  const matchingRoster=useRef('');
  const stop=useRef(false),running=useRef(false),mounted=useRef(true);
  const coverGeneration=useRef(0),latestPairs=useRef(s);latestPairs.current=s;
  const pendingCovers=useRef(new Map<string,{stamp:string;patch:any}>());
  const failedCovers=useRef(new Set<string>());
  const recoveryContext=useRef('');
  const [retrySelection,setRetrySelection]=useState<{id:string;label:string}[]>([]);
  const refusedCovers=useRef(new Map<string,{source:string;error:any}>());
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;coverGeneration.current++;finishMatching.current?.(false)}},[]);
  const who=(id:string)=>ctx.players.find(p=>p.id===id);
  const recoveryScope={eventId:ctx.event?.id,resetEpoch:ctx.event?.resetEpoch??0};
  const liveCoverSource=useRef({scope:recoveryScope,players:ctx.players});liveCoverSource.current={scope:recoveryScope,players:ctx.players};
  const coverStamp=(g:Pair)=>JSON.stringify([recoveryScope.eventId,recoveryScope.resetEpoch,pairCoverRecoverySignature(g,ctx.players)]);
  const recoveryFingerprint=JSON.stringify([recoveryScope.eventId,recoveryScope.resetEpoch,s.groups.map((g:Pair)=>pairCoverRecoverySignature(g,ctx.players))]);
  if(recoveryContext.current!==recoveryFingerprint){
    const restored=restorePairCoverRecovery(recoveryScope,s.groups,ctx.players);
    pendingCovers.current=new Map([...restored].filter(([,record])=>record.pending).map(([id,record])=>{const g=s.groups.find((group:Pair)=>group.id===id);return[id,{stamp:coverStamp(g),patch:record.pending}]}));
    failedCovers.current=new Set(restored.keys());
    recoveryContext.current=recoveryFingerprint;
  }
  const active=ctx.players.filter(isEligible),eligibleIds=useRef(active.map(p=>p.id));
  const alreadyPaired=new Set<string>(s.groups.flatMap((g:Pair)=>g.members)),unmatched=active.filter(p=>!alreadyPaired.has(p.id));
  const roster=JSON.stringify(active.map(p=>[p.id,p.name,p.number,p.photo,p.interests??'',p.wish??'']).sort((a,b)=>a[0].localeCompare(b[0]))),currentRoster=useRef(roster);currentRoster.current=roster;
  useEffect(()=>{if(matching&&matchingRoster.current!==roster){finishMatching.current?.(false);setMatching(null);ctx.tell('玩家名单或档案已变化，本次配对已取消，请重新配对')}},[matching,roster]);
  eligibleIds.current=active.map(p=>p.id);
  const groupEligible=(g:Pair)=>g.members.every(id=>eligibleIds.current.includes(id));
  const coverGroups:Pair[]=s.groups.filter((g:Pair)=>g.members.length===2&&groupEligible(g));
  const failedCoverGroups=coverGroups.filter(g=>!g.cover||g.coverFailure||failedCovers.current.has(g.id)||pendingCovers.current.has(g.id));
  const groupInCurrentStage=(g:Pair)=>!s.tournament||s.round<3||g.alive!==false&&s.tournament.finalists.includes(g.id);
  const requireEligibleGroup=(g:Pair)=>{if(!groupEligible(g))throw new Error('本组有未到、已离场或未参与玩家，请先调整玩家状态或重新配对')};
  const projectGroup=async(g:Pair,payload:()=>Promise<any>)=>{
    requireEligibleGroup(g);
    if(!groupInCurrentStage(g))throw new Error('本组未晋级当前环节，仅保留历史档案，不能作为本轮队伍投屏');
    const screen=await payload();
    requireEligibleGroup(g);
    await ctx.project(screen);
  };
  const save=(value:any,matchedRosterSnapshot?:string)=>ctx.save('pairs',value,true,matchedRosterSnapshot===undefined?undefined:{matchedRosterSnapshot});
  const update=(id:string,patch:any)=>save((current:any)=>{
    const currentGroup=current?.groups.find((g:Pair)=>g.id===id);
    if(!currentGroup)throw new Error('原组合已被重新分配，本次结果未覆盖新分组');
    requireEligibleGroup(currentGroup);
    return{...current,groups:current.groups.map((g:Pair)=>g.id===id?{...g,...patch}:g)};
  });
  const work=async(label:string,fn:()=>Promise<any>)=>{
    if(running.current||ctx.busy)return;
    running.current=true;
    try{await ctx.run(label,fn)}finally{running.current=false}
  };
  const generate=(AI:boolean)=>work(AI?'AI正在按兴趣配对并逐组分析理由…':'正在随机配对…',async()=>{
    if(s.groups.length&&!confirm('重新配对将替换当前的晋级与现场结果记录，继续吗？'))return;
    if(!active.length)throw new Error('请先签到至少一位玩家');
    let generationSource=s;
    if(bank.some((t,i)=>t!==(s.challengeBank?.[i]??''))||secondBank.some((t,i)=>t!==(s.round2Bank?.[i]??'')))await save((current:any)=>{if(JSON.stringify(current??{groups:[],standby:[],round:1})!==JSON.stringify(s))throw new Error('原组合或题库已更新，请刷新后重新配对');generationSource={...current,groups:current?.groups??[],standby:current?.standby??[],round:current?.round??1,challengeBank:bank,round2Bank:secondBank};return generationSource;});
    let finish!:(complete:boolean)=>void;
    const complete=new Promise<boolean>(resolve=>{finish=resolve});
    finishMatching.current=finish;
    matchingRoster.current=roster;
    const session:MatchingSession={players:active,result:null,onComplete:()=>finish(true),onCancel:()=>{finish(false);if(mounted.current)setMatching(null)}};
    setMatching(session);
    try{
      const request=AI?api('ai/pairs',{}):Promise.resolve(pairPlayers(active.map(p=>p.id)));
      const outcome=await Promise.race([request.then(data=>({data})),complete.then(()=>({data:null}))]);
      if(!outcome.data||!mounted.current)return;
      const used=new Set(outcome.data.pairs.flat());
      const d={...outcome.data,pairs:[...outcome.data.pairs,...(outcome.data.standby??[]).filter((id:string)=>!used.has(id)).map((id:string)=>[id])],standby:[]};
      if(currentRoster.current!==roster)throw new Error('玩家名单或档案已变化，请重新配对');
      setMatching({...session,result:d});
      if(!await complete||!mounted.current)return;
      if(currentRoster.current!==roster)throw new Error('玩家名单或档案已变化，请重新配对');
      const original=JSON.stringify(generationSource);let adopted:any;
      await save((current:any)=>{if(JSON.stringify(current??{groups:[],standby:[],round:1})!==original)throw new Error('原组合或现场结果已更新，本次配对未覆盖新结果，请重新配对');adopted={...current,formatVersion:2,pairingMode:AI?'ai':'random',tournament:undefined,challengeBank:bank,round2Bank:secondBank,groups:d.pairs.map((ids:string[])=>{const solo=ids.length===1,reason=d.reasons?.find((r:any)=>r.members.length===ids.length&&r.members.every((id:string)=>ids.includes(id)));return{id:crypto.randomUUID(),members:ids,...(solo?{solo:true,seats:2}:{seats:2}),challenge:'',cover:'',alive:true,votes:0,matchReason:solo?'单人成队，按2个名额参加全部轮次；获胜只给本人记1分。':reason?.reason??(AI?'根据AI数据库分析两个人的长相可能互相存在吸引力':'本次为随机配对，未按兴趣或心愿推断共同点。'),matchReasonSource:solo?'solo':reason?.reasonSource??(AI?'entertainment':'random'),matchReasonEvidence:reason?.reasonEvidence??[]}}),standby:d.standby,round:1};return adopted},roster);
      clearPairCoverRecovery(recoveryScope);pendingCovers.current.clear();failedCovers.current.clear();refusedCovers.current.clear();
      if(mounted.current){latestPairs.current=adopted;setProgress(null);setFailures([]);setRetrySelection([]);setMatching(null);ctx.tell('搭档已分配，正在自动生成新组合合照');await autoCovers(adopted.groups)}
    }finally{finish(false);finishMatching.current=null;if(mounted.current)setMatching(null)}
  });
  const supplement=(manualIds?:string[])=>work('正在为已签到但尚未组队的玩家补配…',async()=>{
    if(bank.some((text,i)=>text!==(s.challengeBank?.[i]??''))||secondBank.some((text,i)=>text!==(s.round2Bank?.[i]??'')))throw new Error('题库还有未保存的修改，请先保存两轮题库，再补配');
    const boot=await api('boot'),current=boot.states.pairs??{value:null,version:0};
    if(JSON.stringify(current?.value??{groups:[],standby:[],round:1})!==JSON.stringify(s))throw new Error('搭档或现场结果已更新，请刷新后再补配');
    const grouped=new Set<string>((current.value?.groups??[]).flatMap((g:Pair)=>g.members)),candidates=boot.players.filter((p:any)=>isEligible(p)&&!grouped.has(p.id));
    if(!candidates.length)throw new Error('没有已签到且尚未组成搭档的玩家');
    if(JSON.stringify(candidates.map((p:any)=>p.id))!==JSON.stringify(unmatched.map(p=>p.id))){await ctx.refresh(true);ctx.tell('已更新最新签到名单，请再点击补配');return}
    let finish!:(accepted:boolean)=>void,token='',cancelled=false;
    const accepted=new Promise<boolean>(resolve=>{finish=resolve});finishMatching.current=finish;matchingRoster.current=roster;
    const session:MatchingSession={players:candidates,result:null,supplement:true,notice:'原有搭档、合照和比赛结果保持。新搭档将加入当前轮次，确认前不会写入。',onComplete:()=>finish(true),onCancel:()=>{finish(false);if(mounted.current)setMatching(null)}};
    setMatching(session);
    const mode=manualIds?'manual':s.pairingMode==='random'||!ctx.ai.hasKey?'random':'ai';
    try{
      const request=api('pairs/supplement/prepare',{version:current.version,eventId:boot.event.id,mode,ids:manualIds}).then(preview=>{if(cancelled||!mounted.current){void api('pairs/supplement/cancel',{token:preview.token}).catch(()=>{});return null}return preview});
      const preview=await Promise.race([request,accepted.then(()=>null)]);
      if(!preview||!mounted.current)return;token=preview.token;
      setMatching({...session,players:boot.players.filter((p:any)=>(preview.candidateIds??candidates.map((c:any)=>c.id)).includes(p.id)),result:preview,notice:preview.notice});
      if(!await accepted||!mounted.current)return;
      const saved=await api('pairs/supplement/commit',{token,version:preview.version,eventId:preview.eventId});token='';
      await ctx.refresh(true);latestPairs.current=saved.value;setProgress(null);setFailures([]);setRetrySelection([]);setMatching(null);
      ctx.tell(saved.notice??('已追加 '+saved.newGroups.length+' 组搭档，单人成队按2个名额参赛；原组合与比赛结果保留'));
      if(saved.newGroups.length)await autoCovers(saved.newGroups);
    }finally{cancelled=true;finish(false);finishMatching.current=null;if(token)await api('pairs/supplement/cancel',{token}).catch(()=>{});if(mounted.current)setMatching(null)}
  });
  const runCovers=async(requested:Pair[],replaceExisting=false,pending:Record<string,any>={})=>{
    const groups=requested.filter(g=>g.members.length===2);
    if(!groups.length){ctx.tell('单人成队直接参赛，无需生成双人合照');return}
    const generation=++coverGeneration.current,sourceRoster=currentRoster.current,sourceScope={...recoveryScope},sourcePlayers=ctx.players.map(p=>({id:p.id,photo:p.photo}));stop.current=false;setStopping(false);setFailures([]);const failed:Failure[]=[],retryLabels=new Map<string,string>();let processed=0;
    const stamp=(g:Pair)=>JSON.stringify([sourceScope.eventId,sourceScope.resetEpoch,pairCoverRecoverySignature(g,sourcePlayers)]),prepared={...pending};
    for(const g of groups){const cached=pendingCovers.current.get(g.id);if(cached?.stamp===stamp(g))prepared[g.id]=cached.patch;else pendingCovers.current.delete(g.id)}
    if(!ctx.ai.hasKey&&groups.some(g=>!prepared[g.id])){ctx.tell('搭档已保存；配置AI后可生成合照');return}
    const total=groups.filter(g=>replaceExisting||!g.cover||prepared[g.id]).length,labelFor=(g:Pair)=>g.members.map(id=>who(id)?.name??'玩家').join(' + '),photoSource=(g:Pair)=>JSON.stringify(g.members.map(id=>[id,who(id)?.photo??'']));
    setProgress({kind:'cover',done:0,total,label:'正在生成组合合照',running:true});
    const cancelled=()=>!mounted.current||stop.current||generation!==coverGeneration.current||sourceRoster!==currentRoster.current||sourceScope.eventId!==liveCoverSource.current.scope.eventId||sourceScope.resetEpoch!==liveCoverSource.current.scope.resetEpoch;
    const result=await runPairCoverQueue({groups,replaceExisting,pending:prepared,current:id=>latestPairs.current.groups?.find((g:Pair)=>g.id===id),cancelled,
      generate:async g=>{requireEligibleGroup(g);for(const id of g.members)if(!who(id)?.photo)throw Error((who(id)?.name??'该玩家')+'还没有上传照片');const refused=refusedCovers.current.get(g.id);if(refused?.source===photoSource(g))throw refused.error;refusedCovers.current.delete(g.id);const d=await api('ai/cover',{ids:g.members,groupId:g.id});return{cover:d.photo,scene:d.scene,sceneId:d.sceneId,coverMethod:d.coverMethod,faceSources:d.faceSources}},
      save:async(g,patch)=>{if(cancelled())return;const expected=stamp(g);pendingCovers.current.set(g.id,{stamp:expected,patch});failedCovers.current.add(g.id);rememberPairCoverRecovery(sourceScope,g,sourcePlayers,{pending:patch,error:'合照已生成，等待保存'});await save((current:any)=>{const live=current?.groups?.find((group:Pair)=>group.id===g.id),source=liveCoverSource.current;if(cancelled()||!live||JSON.stringify([source.scope.eventId,source.scope.resetEpoch,pairCoverRecoverySignature(live,source.players)])!==expected)throw Object.assign(new Error('本组原照片、成员、合照或活动已更新，旧图片已忽略'),{status:409});requireEligibleGroup(live);return{...current,groups:current.groups.map((group:Pair)=>group.id===g.id?{...group,...patch,coverFailure:null}:group)}});pendingCovers.current.delete(g.id);failedCovers.current.delete(g.id);clearPairCoverRecovery(sourceScope,g.id)},
      onFailure:async(g,e)=>{if(e.pending)pendingCovers.current.set(g.id,{stamp:stamp(g),patch:e.pending});if(e.moderationRejected)refusedCovers.current.set(g.id,{source:photoSource(g),error:e});failedCovers.current.add(g.id);rememberPairCoverRecovery(sourceScope,g,sourcePlayers,{pending:e.pending,error:e.message??'生成失败'});failed.push({id:g.id,label:labelFor(g),error:e.message??'生成失败',pending:e.pending});if(!cancelled()){setFailures([...failed]);if(!e.pending&&g.members.every(id=>!!who(id)?.photo))try{await update(g.id,{coverFailure:{message:e.message??'生成失败',source:photoSource(g)}})}catch{ /* Recovery paths remain available even if the main state cannot be saved. */ }}},
      onRetry:(g,retry,max,delay,phase)=>{if(cancelled())return;retryLabels.set(g.id,labelFor(g)+'：'+(phase==='save'?'保存结果':'生成合照')+'自动重试 '+retry+'/'+max+'，'+delay/1000+'秒后继续');setProgress({kind:'cover',done:processed,total,label:[...retryLabels.values()].join('；'),running:true})},
      onProgress:(done,total,g)=>{processed=done;retryLabels.delete(g.id);if(!cancelled())setProgress({kind:'cover',done,total,label:[...retryLabels.values()].join('；')||labelFor(g),running:true})}
    });
    if(mounted.current&&generation===coverGeneration.current){setProgress({kind:'cover',done:result.done,total:result.total,label:'',running:false});ctx.tell(`合照已处理 ${result.done}/${result.total} 组${failed.length?'，'+failed.length+' 组未成功，请查看各组提示':''}${result.cancelled?'，后续任务已停止':''}`)}
  };
  const autoCovers=(groups:Pair[])=>runCovers(groups);
  const makeChallenge=async(g:Pair,pending?:any)=>{
    requireEligibleGroup(g);
    let patch=pending;
    if(!patch){const d=await api('ai/challenge',{ids:g.members});patch={challenge:d.text}}
    try{await update(g.id,patch)}catch(e:any){e.pending=patch;throw e}
  };
  const batch=(kind:Kind,selected?:string[],pending:Record<string,any>={})=>work(kind==='cover'?'正在逐组生成随机场景合照…':'正在逐组匹配挑战…',async()=>{
    const groups:Pair[]=s.groups.filter((g:Pair)=>groupEligible(g)&&(!selected||selected.includes(g.id)));
    if(kind==='cover'){await runCovers(groups.filter(g=>!!selected||!g.cover||g.coverMethod!=='whole-photo-v2'||pendingCovers.current.has(g.id)),true,pending);return}
    stop.current=false;setStopping(false);setFailures([]);
    let done=0;const failed:Failure[]=[];
    for(const g of groups){
      if(stop.current)break;
      const label=g.members.map(id=>who(id)?.name??'已移除玩家').join(' + ');
      if(mounted.current)setProgress({kind,done,total:groups.length,label,running:true});
      try{await makeChallenge(g,pending[g.id])}catch(e:any){failed.push({id:g.id,label,error:e.message??'生成失败',pending:e.pending})}
      done++;
      if(mounted.current){setFailures([...failed]);setProgress({kind,done,total:groups.length,label,running:true})}
    }
    if(mounted.current)setProgress({kind,done,total:groups.length,label:'',running:false});
    ctx.tell(`已处理 ${done}/${groups.length} 组，成功 ${done-failed.length} 组${failed.length?'，失败 '+failed.length+' 组，可重试':''}${stop.current?'；后续已停止':''}`);
  });
  const openIntroduction=(g:Pair)=>{setSelected(g.id);if(groupEligible(g)&&groupInCurrentStage(g))void ctx.run('正在介绍这组搭档…',()=>projectGroup(g,async()=>({activity:1,groupId:g.id,mode:'pair-profile',round,title:pairName(g.members,ctx.players),reason:g.matchReason??'',solo:g.solo,seats:g.seats,people:g.members.map(id=>who(id)).filter(Boolean).map(p=>({id:p!.id,name:p!.name,number:p!.number,photo:p!.photo,interests:p!.interests,trait:p!.trait,wish:p!.wish,active:p!.active,consent:p!.consent})),image:g.cover?await photoData(g.cover):'',tag:'今晚谁最搭 · '+PAIR_ROUND_NAMES[round-1]})))};
  const roundTabs=<div className="round-tabs">{PAIR_ROUND_NAMES.map((n,i)=><button key={n} className={round===i+1?'selected':''} disabled={!!ctx.busy||(i===4?(s.round??1)<4:i+1>(s.tournament?s.round:Math.max(1,s.round??1)))} onClick={()=>{setSelected('');setViewRound(i+1)}}><span>0{i+1}</span>{n}<ChevronRight size={15}/></button>)}</div>;
  const supplementControls=s.groups.length>0&&<Panel title="迟到签到补配" tag={unmatched.length+'位已签到且未组队'}><p>只为已签到、从未进入现有组合的玩家补配（含原来的单人待安排）。已淘汰、已离场的原组合仍保留，不会拆队重配。{s.pairingMode==='random'||!ctx.ai.hasKey?'本次使用随机补配。':'本次按兴趣和心愿AI补配。'}</p><Button disabled={!unmatched.length||!!ctx.busy} onClick={()=>supplement()}>再次匹配刚才没有被匹配过的人</Button>{!!unmatched.length&&<p className="pair-supplement-candidates">待补配：{unmatched.map(p=>'#'+p.number+' '+p.name).join('、')}</p>}</Panel>;
  const visibleGroups:Pair[]=s.tournament&&round>=3?s.groups.filter((g:Pair)=>s.tournament.finalists.includes(g.id)):s.groups;
  const index=visibleGroups.findIndex((g:Pair)=>g.id===selected),selectedGroup:Pair|undefined=visibleGroups[index];
  if(matching)return <MatchingAnimation {...matching}/>;
  if(selectedGroup){
    const people=selectedGroup.members.map(who),title=pairName(selectedGroup.members,ctx.players);
    return <>
      <div className="intro-navigation"><Button variant="secondary" onClick={()=>{setSelected('');void ctx.project({activity:1,mode:'pair-board',round})}}>返回全部组合</Button><span>{index+1} / {visibleGroups.length}</span><Button variant="secondary" disabled={index===0} onClick={()=>openIntroduction(visibleGroups[index-1])}>上一组</Button><Button disabled={index===visibleGroups.length-1} onClick={()=>openIntroduction(visibleGroups[index+1])}>下一组</Button></div>
      {!groupEligible(selectedGroup)&&<p className="inline-note">本组含未到、已离场或未参与玩家；当前仅查看历史介绍，暂不参与现场活动。</p>}
      {selectedGroup.cover&&['original-head-composite-v1','original-face-region-v1'].includes(selectedGroup.coverMethod??'')&&<p className="inline-note pair-legacy-cover-note">这是旧版拼接合照。点击“重新生成本组合照”，可重新生成自然协调的完整照片；旧图会保留到新图成功。</p>}
      <PairIntroduction title={title} cover={img(selectedGroup.cover)} people={people} reason={selectedGroup.matchReason} solo={selectedGroup.solo} seats={selectedGroup.seats}/>
      {selectedGroup.cover&&<div className="button-row"><Button className="pair-regenerate-cover" variant="secondary" disabled={!!ctx.busy||!groupEligible(selectedGroup)} onClick={()=>work('正在重新生成本组合照…',()=>runCovers([selectedGroup],true))}><Camera size={15}/>重新生成本组合照</Button></div>}
    </>;
  }
  if(round===5)return <><ActivityHeader num={1} title="今晚谁最搭总结" description="汇总四轮活动累计得分，揭晓最佳搭档；冠军组每位实际成员各加5分。"/>{roundTabs}<PairSummary ctx={ctx}/></>;
  if(round===4)return <><ManualPlayerPicker players={unmatched} min={2} max={2} label="手动指定两位搭档" disabled={!!ctx.busy} onConfirm={ids=>supplement(ids)}/><ActivityHeader num={1} title="心有灵犀" description="一人用动作比划，另一人猜词；现场判定，每猜对一词本组加1分，实际成员全场积分各加1分。"/>{roundTabs}{supplementControls}<PairLegacySoloUpgrade ctx={ctx} state={s}/><PairHeart ctx={ctx} state={s} onIntroduce={id=>{const group=s.groups.find((g:Pair)=>g.id===id);if(group)openIntroduction(group)}}/><Button onClick={()=>setViewRound(5)}>进入第5步：今晚谁最搭总结</Button></>;
  return <>
    <ManualPlayerPicker players={unmatched} min={2} max={2} label="手动指定两位搭档" disabled={!!ctx.busy} onConfirm={ids=>supplement(ids)}/><ActivityHeader num={1} title="今晚谁最搭" description="让共同兴趣成为开场白，从一张双人封面开始认识彼此。">
      <Button variant="secondary" disabled={!active.length||!!ctx.busy} onClick={()=>generate(false)}><Shuffle size={16}/>随机配对</Button>
      <Button disabled={!active.length||!ctx.ai.hasKey||!!ctx.busy} onClick={()=>generate(true)}><Sparkles size={16}/>AI兴趣匹配</Button>
    </ActivityHeader>
    {roundTabs}
    {supplementControls}
    <div className="inline-note">当前 {active.length} 位在场玩家，可组成 {Math.floor(active.length/2)} 对搭档{active.length%2?'，另有1位单人成队，按2个名额参赛。':'。'} 每位玩家只进入一组；对战按实际队伍数安排，奇数队轮空。</div>
    {!!s.standby.length&&<Panel title="旧版待安排玩家" tag={s.standby.length+'位 · 可转为单人队'}><p>点击下方“将旧待安排转为单人队”，即可参加当前轮2V2挑战，不补前轮积分。</p><div className="pair-standby-list">{s.standby.map((id:string)=>{const p=who(id);return <article className="pair-standby-profile" key={id}><Avatar player={p} size={88}/><div><span>#{p?.number??'—'} · 旧版待安排</span><h2>{p?.name??'已移除玩家'}</h2><p>兴趣：{p?.interests||'尚未填写'}</p><p>一直想做却没敢做的事：{p?.wish||'尚未填写'}</p></div></article>})}</div></Panel>}
    <PairTournament ctx={ctx} state={s} bank={bank} onBankChange={setBank} saveBank={saveBank} round2Bank={secondBank} onRound2BankChange={setSecondBank} viewRound={s.tournament?round:undefined}/>
    <Panel title="玩家双人合照" tag="16:9 · 自然完整优先">
      <p className="pair-scene-description">参考两张原照，直接生成一张光线统一、比例协调的完整双人照片。优先保证人物自然完整，再尽量保留两位玩家的外貌特点。</p>
      <p className="muted">手机或物品遮挡部分面部的原照也可使用，AI会结合可见特征补全人物；生成外貌可能与本人有差异。新图成功后才替换原合照。</p>
      <div className="button-row">
        <Button disabled={!coverGroups.length||!!ctx.busy||!ctx.ai.hasKey} onClick={()=>{setRetrySelection([]);void batch('cover')}}><Camera size={16}/>给所有组合生成合照</Button>
        <Button variant="secondary" disabled={!failedCoverGroups.length||!!ctx.busy||!ctx.ai.hasKey} onClick={()=>{setRetrySelection(failedCoverGroups.map(g=>({id:g.id,label:pairName(g.members,ctx.players)})));void batch('cover',failedCoverGroups.map(g=>g.id))}}><Camera size={16}/>给生成失败的组再次生成合照</Button>
        <Button variant="secondary" disabled={!s.groups.some(groupEligible)||!!ctx.busy||!bank.some(t=>t.trim())} onClick={assignBank}><Shuffle size={16}/>给所有组合匹配挑战</Button>
        <Button variant="ghost" disabled={!!ctx.busy||!ctx.ai.hasKey||!s.groups.some(groupEligible)} onClick={()=>batch('challenge')}>可选：AI逐组出题</Button>
        {progress?.running&&<Button variant="secondary" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true)}}><Square size={14}/>{stopping?'当前组合完成后停止':'停止后续组合'}</Button>}
      </div>
      <p className="muted">生成后逐组保存，批量跳过已完成的自然合照，单人队直接参赛。网络超时、限流或服务暂时异常会自动重试最多10次，并逐步延长等待时间；原照片审核拒绝会提示更换照片并继续其它组。失败保留原结果，保存失败只重试保存。停止或切换活动后不再重试。{!ctx.ai.hasKey?' 云端AI未启用，可继续随机或手动组队。':'调用费用计入你的百炼账号。'}</p>
      {!!failedCoverGroups.length&&<div className="pair-cover-failed-list"><b>待重试或尚未完成合照 · {failedCoverGroups.length}组</b><ul>{failedCoverGroups.map(g=><li key={g.id}>{pairName(g.members,ctx.players)}{g.coverFailure?.message?'：'+g.coverFailure.message:''}</li>)}</ul></div>}
      {!!retrySelection.length&&<div className="pair-cover-retry-list" role="status"><b>本次单独重新生成的组 · {retrySelection.length}组</b><ul>{retrySelection.map(g=><li key={g.id}>{g.label}</li>)}</ul></div>}
      {progress&&<div className="pair-batch-progress" role="status"><b>{progress.running?'正在处理':'已处理'} {progress.done} / {progress.total} 组</b><span>{progress.label}</span><progress value={progress.done} max={progress.total}/></div>}
      {!!failures.length&&<div className="pair-batch-errors"><b>{failures.length}组未成功</b><ul>{failures.map(f=><li key={f.id}>{f.label}：{f.error}{f.pending?'（结果已生成，重试只保存，不重新调用AI）':''}</li>)}</ul>{progress?.kind==='challenge'&&<Button variant="secondary" disabled={!!ctx.busy} onClick={()=>batch('challenge',failures.map(f=>f.id),Object.fromEntries(failures.filter(f=>f.pending).map(f=>[f.id,f.pending])))}>重试失败组合</Button>}</div>}
    </Panel>
    {round===3&&s.tournament&&<p className="pair-pk-final-count">前轮晋级与主持人确认补配的 {visibleGroups.length} 队进入我们最默契；补配不追补前轮积分。</p>}
    {!s.groups.length?<Empty icon={UsersRound} title="搭档，还没有相遇">先添加至少两位玩家，再随机配对或使用AI兴趣匹配。</Empty>:<div className="pair-grid">{visibleGroups.map((g:Pair,i:number)=><Panel key={g.id} title={pairName(g.members,ctx.players)} tag={!groupEligible(g)?'成员不在场 · 历史组合':g.alive?'正在晋级':'本轮淘汰'} className={g.alive===false?'pair-eliminated-card':!groupEligible(g)?'dimmed':''}>
      {g.alive===false&&<div className="pair-elimination-stamp" data-elimination-stamp>本轮淘汰</div>}
      <div className="pair-members">{g.members.map(id=><div key={id}><Avatar player={who(id)} size={65}/><b>{who(id)?.name??'已移除'}</b><span>#{who(id)?.number}</span></div>)}{g.members.length===2&&<span className="pair-x">×</span>}</div>
      {g.solo&&<p className="inline-note">单人成队 · 按2个名额参加2V2 · 胜利只给本人计分</p>}
      {g.matchReason&&<div className="pair-match-reason"><b>{g.matchReasonSource==='profile'?'档案配对理由':g.matchReasonSource==='entertainment'?'趣味配对':g.matchReasonSource==='ai'?'AI配对理由':g.matchReasonSource==='random'?'配对方式':'资料说明'}</b><p>{g.matchReason}</p></div>}
      <Button variant="secondary" className="intro-open" onClick={()=>openIntroduction(g)}>介绍这一组</Button>
      {g.cover&&<button className="pair-cover-link" aria-label={'介绍'+pairName(g.members,ctx.players)} onClick={()=>openIntroduction(g)}><img className="pair-cover" src={img(g.cover)} alt="AI双人合照"/></button>}
      {g.cover&&['original-head-composite-v1','original-face-region-v1'].includes(g.coverMethod??'')&&<p className="inline-note pair-legacy-cover-note">旧版拼接合照 · 请重新生成。新图成功后才替换，原图暂时保留。</p>}
      {!groupEligible(g)&&<p className="muted">本组含未到、已离场或未参与玩家；历史结果保留，请调整状态后再游玩。</p>}
      <div className="button-row">{g.members.length===2&&<Button className={g.cover?'pair-regenerate-cover':''} variant="secondary" disabled={!!ctx.busy||!ctx.ai.hasKey||!groupEligible(g)} onClick={()=>work(g.cover?'正在重新生成本组合照…':'AI正在设计随机场景并生成合照…',()=>runCovers([g],true))}><Camera size={15}/>{g.cover?'重新生成本组合照':'生成合照'}</Button>}<Button variant="ghost" disabled={!!ctx.busy||!ctx.ai.hasKey||!groupEligible(g)} onClick={()=>work('正在生成兴趣挑战…',()=>makeChallenge(g))}><Sparkles size={15}/>生成挑战</Button></div>
      <textarea key={g.challenge} defaultValue={g.challenge} rows={4} disabled={!!ctx.busy||!groupEligible(g)} placeholder="挑战题目会显示在这里，也可以由你填写。" onBlur={e=>{if(e.target.value!==g.challenge)ctx.run('保存挑战…',()=>update(g.id,{challenge:e.target.value}))}}/>
      {!s.tournament&&s.formatVersion!==2&&<div className="pair-bottom"><Button variant={g.alive?'secondary':'ghost'} disabled={!!ctx.busy||!groupEligible(g)} onClick={()=>ctx.run('保存晋级…',()=>update(g.id,{alive:!g.alive}))}>{g.alive?'标记淘汰':'恢复晋级'}</Button></div>}
      {round===3&&s.tournament&&<div className="pair-round-win"><b>{s.tournament.blindfoldResults?.[g.id]==='advanced'?(g.solo?'已晋级第四轮 · 本轮本人+1分':'已晋级第四轮 · 本轮两人各+1分'):s.tournament.blindfoldResults?.[g.id]==='eliminated'?'本轮已淘汰':manualWins.some(w=>w.eventId==='pairs:3:'+g.id&&w.status==='active')?'已有本轮获胜积分，请在上方确认晋级或淘汰；已有积分不会重复增加。':'请在上方「我们最默契」面板判定本组晋级或淘汰。'}</b></div>}
    </Panel>)}</div>}
  </>;
}
