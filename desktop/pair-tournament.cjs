const crypto=require('node:crypto');
const {isPairTeamEligible,soloReason}=require('./pair-team-rules.cjs');
const copy=value=>structuredClone(value);
function randomize(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a;}
function migratePairState(value){const next=copy(value??{});next.groups=Array.isArray(next.groups)?next.groups:[];next.standby=Array.isArray(next.standby)?next.standby:[];next.challengeBank=Array.from({length:20},(_,i)=>String(next.challengeBank?.[i]??''));next.round2Bank=Array.from({length:10},(_,i)=>String(next.round2Bank?.[i]??''));if(!next.tournament){const preservedRound=[3,4].includes(Number(next.round))?Number(next.round):1;next.tournament={version:1,rounds:[],finalists:preservedRound>=3?next.groups.filter(g=>g.alive!==false).map(g=>g.id):[],legacyEliminated:next.groups.filter(g=>g.alive===false).map(g=>g.id)};next.round=preservedRound;}next.formatVersion=2;return next;}
const settled=match=>match.status!=='pending';
function appendSupplementalEntrants(input,groupIds,{shuffle=randomize,AppError=Error}={}){
 const value=copy(input),round=Number(value.round??1);if(![1,2,3,4].includes(round))throw new AppError('当前轮次无效，请先核对活动');
 if(!groupIds.length)return{value,matches:[],notice:'当前未组成新的双人队。'};
 if(!value.tournament)value.tournament={version:1,rounds:[],finalists:round>=3?value.groups.filter(g=>g.alive!==false&&!groupIds.includes(g.id)).map(g=>g.id):[],legacyEliminated:value.groups.filter(g=>g.alive===false).map(g=>g.id),...(round>1?{entryRound:round}:{})};
 value.formatVersion=2;
 if(round>=3){value.tournament.finalists=[...new Set([...value.tournament.finalists,...groupIds])];return{value,matches:[],notice:`新增${groupIds.length}队直接加入第${round}轮当前队伍，不追补前面已结束轮次的胜场或积分。`};}
 const current=value.tournament.rounds.find(r=>r.number===round);
 if(!current){if(round===2){value.tournament.supplementalEntrants??={};value.tournament.supplementalEntrants[2]=[...new Set([...(value.tournament.supplementalEntrants[2]??[]),...groupIds])];}return{value,matches:[],notice:`新增${groupIds.length}队加入第${round}轮尚未抽签的队伍池；不追补前轮积分。`};}
 const bank=((round===1?value.challengeBank:value.round2Bank)??[]).map(t=>String(t).trim()).filter(Boolean),ids=shuffle([...groupIds]),tasks=shuffle(bank);
 if(ids.length>1&&!tasks.length)throw new AppError('请先填写至少一道当前轮挑战，再补配新增对战');
 const matches=[];for(let i=0;i<ids.length;i+=2){const teamIds=ids.slice(i,i+2),bye=teamIds.length===1;matches.push({id:crypto.randomUUID(),teamIds,task:bye?'补配轮空，直接晋级':tasks[(i/2)%tasks.length],bye,status:bye?'bye':'pending',winnerId:bye?teamIds[0]:null,loserId:null,supplemental:true});}
 current.matches.push(...matches);
 return{value,matches,notice:`第${round}轮已抽签，另追加${matches.filter(m=>!m.bye).length}场新队2V2${matches.some(m=>m.bye)?'及1队补配轮空':''}；原对战与结果保持。轮空不计胜场，不追补前轮积分。`};
}
function createPairTournamentService({store,isEligible,AppError=Error,shuffle=randomize}){
 const previews=new Map();
 const fail=(message,status=400)=>{throw new AppError(message,status)};
 const attendance=()=>store.data.players.filter(isEligible).map(p=>p.id).sort().join('\0');
 const groupEligible=g=>isPairTeamEligible(g,store.data.players,isEligible);
 const checkVersion=b=>{const state=store.state('pairs');if(b.eventId!==undefined&&b.eventId!==store.data.event.id||b.resetEpoch!==undefined&&b.resetEpoch!==(store.data.resetEpoch??0))fail('活动已更换或清空，请刷新后重新判定',409);if(Number(b.version)!==state.version)fail('该活动已被更新，请刷新后再操作',409);return state};
 const write=(state,value)=>({...store.putState('pairs',value,state.version),value});
 function winners(round){return round.matches.map(m=>m.winnerId).filter(Boolean);}
 function recompute(value){const rounds=value.tournament.rounds,eliminated=new Set(value.tournament.legacyEliminated??[]);for(const round of rounds){for(const id of round.skipped??[])eliminated.add(id);for(const m of round.matches){if(m.loserId)eliminated.add(m.loserId);if(m.status==='skipped')m.teamIds.forEach(id=>eliminated.add(id));}}for(const[id,result]of Object.entries(value.tournament.blindfoldResults??{}))if(result==='eliminated')eliminated.add(id);value.groups=value.groups.map(g=>({...g,alive:!eliminated.has(g.id)}));return value;}
 return function tournament(action,b={}){
  if(action==='cancel'){previews.delete(b.token);return{cancelled:true};}
  // A confirmation attempt consumes its token even when the version check fails.
  // Restoring an earlier backup must not make a rejected draw usable again.
  let pending;if(action==='commit'){pending=previews.get(b.token);previews.delete(b.token);if(!pending)fail('本次抽签已取消或已使用，请重新抽签');}
  const state=checkVersion(b),value=migratePairState(state.value),roundNumber=value.round??1;
  if(action==='upgrade-solos'){
   if(!state.value?.tournament&&Number(state.value?.round)===2){value.round=2;value.tournament.entryRound=2;}
   const used=new Set(value.groups.flatMap(g=>g.members??[])),ids=[...new Set(value.standby)].filter(id=>!used.has(id)&&isEligible(store.data.players.find(p=>p.id===id)));
   if(!ids.length)fail('当前没有已签到且尚未成队的旧待安排玩家');
   const groups=ids.map(id=>({id:crypto.randomUUID(),members:[id],solo:true,seats:2,challenge:'',cover:'',alive:true,votes:0,matchReason:soloReason,matchReasonSource:'solo',matchReasonEvidence:[]}));
   value.groups.push(...groups);value.standby=value.standby.filter(id=>!ids.includes(id));value.soloTeamVersion=1;
   const plan=appendSupplementalEntrants(value,groups.map(g=>g.id),{shuffle,AppError});
   return{...write(state,plan.value),newGroups:groups,notice:'旧待安排玩家已转为单人成队，按2个名额参赛。'+plan.notice};
  }
  if(action==='blindfold-result'){
   if(roundNumber!==3)fail('只能修改当前第三轮结果，历史结果已锁定',409);
   const group=value.groups.find(g=>g.id===b.groupId),entrants=value.tournament.finalists??[];
   if(!group||!entrants.includes(group.id))fail('请选择当前第三轮晋级名单中的搭档',409);
   if(!['advanced','eliminated','pending'].includes(b.outcome))fail('请明确选择晋级第四轮、本轮淘汰或撤销判定');
   if(b.outcome==='advanced'&&!groupEligible(group))fail('本组成员未签到或已离场，请先调整在场状态');
   const eventId='pairs:3:'+group.id,previous=(store.data.gameWinEvents??[]).find(e=>e.eventId===eventId),ids=[...group.members].sort();
   if(previous&&(previous.activity!==1||Number(previous.round)!==3||previous.groupId!==group.id||JSON.stringify([...(previous.playerIds??[])].sort())!==JSON.stringify(ids)))fail('本组胜利编号属于其他搭档，请先核对历史记录',409);
   value.tournament.blindfoldResults??={};if(b.outcome==='pending')delete value.tournament.blindfoldResults[group.id];else value.tournament.blindfoldResults[group.id]=b.outcome;
   recompute(value);
   return store.commit(data=>{
    data.gameWinEvents??=[];const now=new Date().toISOString(),event=data.gameWinEvents.find(e=>e.eventId===eventId);
    if(b.outcome==='advanced'&&event?.status!=='active'){
     const win={eventId,activity:1,kind:'pairs',activityName:'今晚谁最搭',round:3,groupId:group.id,playerIds:ids,players:ids.map(id=>{const p=data.players.find(p=>p.id===id);return{id:p.id,name:p.name,number:p.number,photo:p.photo??''}}),task:previous?.task??'蒙眼认搭子',status:'active',version:Number(previous?.version??0)+1,createdAt:previous?.createdAt??now,updatedAt:now};
     if(event)Object.assign(event,win);else data.gameWinEvents.push(win);
    }else if(b.outcome!=='advanced'&&event?.status==='active'){event.status='revoked';event.version++;event.updatedAt=now;}
    data.states.pairs={value:copy(value),version:state.version+1};return{value,version:state.version+1};
   });
  }
  if(action==='prepare'){
   if(value.standby.some(id=>isEligible(store.data.players.find(p=>p.id===id))))fail('请先把旧待安排玩家转为单人成队，再进行本轮抽签');
   if(roundNumber>2)fail('两轮对战已完成，无需重新抽签');
   if(value.tournament.rounds.some(r=>r.number===roundNumber))fail('本轮对战已保存；请保留现场结果，重开请明确清空活动后重新配对');
   let ids;if(roundNumber===1)ids=value.groups.filter(g=>g.alive!==false).map(g=>g.id);else{const first=value.tournament.rounds.find(r=>r.number===1);if(!first&&value.tournament.entryRound===2)ids=value.groups.filter(g=>g.alive!==false).map(g=>g.id);else{if(!first||!first.matches.every(settled))fail('第一轮结果尚未全部结束');ids=[...new Set([...winners(first),...(value.tournament.supplementalEntrants?.[2]??[])])];}}
   if(new Set(ids).size!==ids.length||new Set(value.groups.map(g=>g.id)).size!==value.groups.length)fail('组合编号重复，请重新配对');
   const entrants=[],skipped=[];for(const id of ids){const group=value.groups.find(g=>g.id===id);(groupEligible(group)?entrants:skipped).push(id);}
   if(!entrants.length)fail('没有成员全部在场的晋级队伍，请先调整在场状态');
   const bank=(roundNumber===1?value.challengeBank:value.round2Bank).map(t=>t.trim().slice(0,2000)).filter(Boolean);if(!bank.length&&entrants.length>1)fail('请先填写至少一道本轮挑战');
   const randomized=shuffle(entrants),tasks=shuffle(bank),taskCount=Math.floor(entrants.length/2),assigned=shuffle(Array.from({length:taskCount},(_,i)=>tasks[i%Math.max(1,tasks.length)]));
   const matches=[];for(let i=0;i<randomized.length;i+=2){const teamIds=randomized.slice(i,i+2),bye=teamIds.length===1;matches.push({id:crypto.randomUUID(),teamIds,task:bye?'轮空，直接晋级':assigned[i/2],bye,status:bye?'bye':'pending',winnerId:bye?teamIds[0]:null,loserId:null});}
   const token=crypto.randomUUID(),preview={token,version:state.version,round:roundNumber,matches,skipped,entrantCount:entrants.length};previews.clear();previews.set(token,{preview:copy(preview),attendance:attendance()});return copy(preview);
  }
  if(action==='commit'){
   if(pending.preview.version!==state.version)fail('该活动已被更新，请刷新后重新抽签',409);
   if(pending.attendance!==attendance())fail('在场名单已变化，本次抽签未保存，请重新抽签',409);
   if(value.tournament.rounds.some(r=>r.number===pending.preview.round))fail('本轮对战已被保存，请刷新',409);
   const{round,matches,skipped}=pending.preview;value.tournament.rounds.push({number:round,matches:copy(matches),skipped:[...skipped],startedAt:new Date().toISOString()});value.round=round;
   const result=write(state,recompute(value));previews.delete(b.token);return result;
  }
  if(action==='advance'){
   if(roundNumber<=2){const round=value.tournament.rounds.find(r=>r.number===roundNumber);if(!round||!round.matches.every(settled))fail('本轮结果尚未全部结束，请先为每场标记一个淘汰队伍');if(roundNumber===2)value.tournament.finalists=winners(round);value.round=roundNumber+1;}
   else if(roundNumber===3){const entrants=value.tournament.finalists??[],results=value.tournament.blindfoldResults??{};if(!entrants.length||entrants.some(id=>!['advanced','eliminated'].includes(results[id])))fail('请先为每一队明确判定晋级第四轮或本轮淘汰');const qualified=entrants.filter(id=>results[id]==='advanced');if(!qualified.length)fail('至少需要一队晋级第四轮');if(qualified.some(id=>!groupEligible(value.groups.find(g=>g.id===id))))fail('晋级队伍有成员未签到或已离场，请先更正判定');value.tournament.blindfoldEntrants=[...entrants];value.tournament.finalists=qualified;value.round=4;}else fail('已经到达最终轮次');
   return write(state,recompute(value));
  }
  const round=value.tournament.rounds.find(r=>r.number===roundNumber),match=round?.matches.find(m=>m.id===b.matchId);if(!match)fail('只能修改当前轮次的对战，历史结果已锁定');
  if(action==='task'){match.task=String(b.task??'').trim().slice(0,2000);if(!match.task)fail('请填写本场挑战');return write(state,value);}
  if(match.bye)fail('轮空队伍直接晋级，无需标记淘汰');
  if(action==='undo'){if(match.status==='pending')fail('本场尚未填写结果');match.status='pending';match.winnerId=null;match.loserId=null;return write(state,recompute(value));}
  if(match.status!=='pending')fail('本场已有结果，每场只能淘汰一队；需要修改请先撤销本场结果');
  if(action==='result'){
   if(!match.teamIds.includes(b.loserId))fail('请选择本场的一个队伍作为淘汰队伍');
   if(!match.teamIds.every(id=>groupEligible(value.groups.find(g=>g.id===id))))fail('本场有队伍成员未在场或已离场，请明确跳过离场队伍');
   match.loserId=b.loserId;match.winnerId=match.teamIds.find(id=>id!==b.loserId);match.status='settled';
  }else if(action==='forfeit'){
   if(!match.teamIds.includes(b.teamId))fail('请选择本场需要跳过的队伍');
   if(groupEligible(value.groups.find(g=>g.id===b.teamId)))fail('该队成员仍全部在场，请正常标记比赛结果');
   const opponent=match.teamIds.find(id=>id!==b.teamId);match.loserId=b.teamId;match.winnerId=groupEligible(value.groups.find(g=>g.id===opponent))?opponent:null;match.status=match.winnerId?'forfeit':'skipped';
  }else fail('没有这个对战操作');
  return write(state,recompute(value));
 };
}
module.exports={migratePairState,createPairTournamentService,appendSupplementalEntrants};
