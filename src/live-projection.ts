import {activityNames,isEligible,pairName} from './domain';
import {buildHeartRows} from './pair-heart';

export const stageModeActivities:Record<string,number>={pair:1,'pair-board':1,'pair-profile':1,'pair-pk':1,'pair-heart':1,'pair-summary':1,story:2,drawing:4,crop:5,battle:6,missions:7,lottery:8,'global-scores':9,'party-summary':9,'crop-roster':5};
const safe=(p:any)=>p?{id:p.id,name:p.name,number:p.number,photo:p.photo??'',interests:p.interests??'',wish:p.wish??'',active:p.active,attendance:p.attendance}:null;
const state=(states:any,key:string)=>states?.[key]?.value??{};
const image=(value:any)=>typeof value==='string'?value:'';
const ranking=(players:any[],scores:any)=>players.filter(isEligible).map(p=>({...safe(p),score:Number(scores?.[p.id])||0})).sort((a,b)=>b.score-a.score||a.number.localeCompare(b.number,'zh-CN',{numeric:true}));

/** Read-only, public projection. Never spread private states or saved screen payloads. */
export function liveProjection({activity,states={},players=[],screen={},missions,gameWins=[],now=Date.now(),view='current'}:{activity:number;states?:any;players?:any[];screen?:any;missions?:any;gameWins?:any[];now?:number;view?:string}):any{
 const who=(id:string)=>players.find(p=>p.id===id),savedActivity=screen.activity??stageModeActivities[screen.mode],same=savedActivity===activity;
 if(activity===0)return{activity,mode:'players',title:'今晚的玩家',people:players.map(safe)};
 if(activity===9)return{activity,mode:same&&screen.mode==='party-summary'?'party-summary':'global-scores',title:'全场最强英雄'};
 if(activity===2){const talent=state(states,'truth'),entries=talent.formatVersion===2?(talent.entries??[]).filter((x:any)=>x.status==='active'&&x.round===talent.currentRound):[],ids=[...new Set(entries.flatMap((x:any)=>x.playerIds??[]))];if(ids.length)return{activity,mode:'lottery',title:'谁是最有趣开心的人',subtitle:'第'+talent.currentRound+'轮 · 参与表演+3分 · 半数观众认同再+3分',people:ids.map(id=>who(String(id))).filter(isEligible).map(safe)}};
 if(activity===10||activity===11)return{activity,mode:'voice',title:activityNames[activity-1]};
 if(activity===2||activity===-1)return{activity,mode:'rules',title:activityNames[activity-1]??'AI 与本地存档'};
 if(activity===1){
  const s=state(states,'pairs'),round=s.round??1,groups=s.groups??[],finalists=s.tournament?.finalists??[],publicGroup=(g:any)=>({id:g.id,solo:g.solo===true&&g.members?.length===1,seats:2,name:pairName(g.members??[],players),cover:image(g.cover),members:(g.members??[]).map(who).map(safe).filter(Boolean)});
  if(same&&screen.mode==='pair-summary'&&round===4&&groups.length)return{activity,mode:'pair-summary',round:5,title:'今晚谁最搭总结'};
  const eligibleGroups=groups.filter((g:any)=>g.alive!==false&&(round<3||!s.tournament||finalists.includes(g.id)));
  const ids=screen.people?.map((p:any)=>p.id)??[],intro=groups.find((g:any)=>screen.groupId?g.id===screen.groupId:g.members?.length===ids.length&&g.members.every((id:string)=>ids.includes(id)));
  if(same&&screen.mode==='pair-profile'&&screen.round===round&&intro&&eligibleGroups.includes(intro))return{activity,mode:'pair-profile',round,groupId:intro.id,solo:intro.solo===true&&intro.members.length===1,seats:2,title:pairName(intro.members,players),image:image(intro.cover),people:intro.members.map(who).map(safe).filter(Boolean),reason:intro.matchReason??''};
  if(round<=2){const matches=s.tournament?.rounds?.find((r:any)=>r.number===round)?.matches??[];if(matches.length)return{activity,mode:'pair-pk',round,title:(round===1?'哪组最猛':'我们最猛')+' · 第'+round+'轮',matches:matches.map((m:any)=>({id:m.id,task:m.task??'',bye:!!m.bye,status:m.status,winnerId:m.winnerId,loserId:m.loserId,teams:(m.teamIds??[]).map((id:string)=>groups.find((g:any)=>g.id===id)).filter(Boolean).map(publicGroup)}))};}
  const heart=round===4?buildHeartRows(s,players,gameWins):[];
  const rows=eligibleGroups.map((g:any)=>({...publicGroup(g),score:round===4?heart.find((r:any)=>r.groupId===g.id)?.score??0:undefined}));
  return{activity,mode:round===4?'pair-heart':'pair-board',round,title:round===4?'心有灵犀':round===3?'我们最默契':'今晚谁最搭',groups:rows,subtitle:round===4?'每队共8题 · 单人成队按2个名额参赛 · 主持人线下判定':'每位玩家只进入一队 · 单人成队按2个名额参赛'};
 }
 if(activity===3){const s=state(states,'tails');if(s.formatVersion===3)return{activity,mode:'tails-podium',title:'线下决斗',endsAt:s.endsAt,awards:(s.awards??[]).map((a:any)=>({...safe(who(a.playerId)),...a}))};return{activity,mode:'score',title:'线下决斗 · 当前排名',rows:ranking(players,s.scores),endsAt:s.endsAt??0};}
 if(activity===4){const s=state(states,'draw'),p=who(s.player),last=s.history?.at(-1),celebration=s.celebrationOpen!==false&&s.celebration?.roundId===s.roundId?s.celebration:null;return{activity,mode:'drawing',title:'毕加索在世',subtitle:p?p.name+' 正在作画':'等待本轮画手',body:typeof last==='string'?last:last?.guess??last?.text??'',image:image(s.canvas),endsAt:s.endsAt??0,celebration:celebration?{roundId:celebration.roundId,answer:celebration.answer??'',guess:celebration.guess??celebration.answer??'',canvas:image(celebration.canvas||s.canvas),player:safe(who(celebration.player?.id)??celebration.player)}:null};}
 if(activity===5){
  const s=state(states,'crop'),ready=(p:any)=>p&&isEligible(p)&&p.consent&&p.photo&&s.rosterPhotos?.[p.id]===p.photo;
  if(view==='ranking')return{activity,mode:'score',title:'这又是哪位佳丽 · 抢答排名',rows:ranking(players,s.scores)};
  const p=who(s.current),roster=(s.roster??[]).map(who).filter(ready).map(safe),rosterMode=same&&screen.mode==='crop-roster'&&!s.current;
  if(!ready(p)||rosterMode)return{activity,mode:'crop-roster',title:'先认识本轮玩家',people:roster};
  return{activity,mode:'crop',title:s.revealed?'这位玩家是…':'这又是哪位佳丽',subtitle:s.revealed?p.name:'从本轮10人名单中猜昵称或编号',image:image(s.frame),tag:`第 ${(s.used??[]).length} / ${(s.roster??[]).length} 张 · ${s.rangePercent??10}%范围`,body:s.outcome==='guessed'?'有人猜中了！照片本人喝一杯酒。':s.outcome==='nobody'?'所有人都没猜到，全场一起喝一杯酒。':'猜中：照片本人喝酒；无人猜中：所有人喝酒。'};
 }
 if(activity===6){
  const s=state(states,'fans'),rounds=s.formatVersion===2?s.rounds??[]:[],a=rounds.filter((r:any)=>r.winnerSide==='A').length,b=rounds.filter((r:any)=>r.winnerSide==='B').length,winner=a>=3?'A':b>=3?'B':null;
  return{activity,mode:'battle',title:winner?'王不见王 · 决赛胜利':'王不见王 · 五局三胜',subtitle:winner?(who(s[winner==='A'?'a':'b'])?.name??winner+'队')+'的应援队获胜':'第 '+(rounds.length+1)+' 局 / 最多5局',body:winner?'全队一起喊出队长的名字！':s.challengeBank?.[rounds.length]??'等待主持人保存本局PK项目',winner,seriesId:s.seriesId,people:['A','B'].map(side=>({...safe(who(s[side==='A'?'a':'b'])),name:who(s[side==='A'?'a':'b'])?.name??side+'队',score:side==='A'?a:b,slogan:s[side==='A'?'sloganA':'sloganB']??'',members:(s[side==='A'?'teamA':'teamB']??[]).map(who).map(safe).filter(Boolean)})),rounds:rounds.map((r:any)=>({id:r.id,number:r.number,task:r.task,winnerSide:r.winnerSide}))};
 }
 if(activity===7){
  const input=missions??{round:null,missions:[]},r=input.round,round=r?{id:r.id,endsAt:r.endsAt,ended:!!r.ended||!!r.endsAt&&r.endsAt<=now}:null;
  const rows=(input.missions??[]).map((m:any)=>{const p=who(m.actor),target=who(m.target);return{actor:m.actor,target:m.target,task:m.task??'',completed_at:m.completed_at??null,paused:!isEligible(p)||!isEligible(target),...safe(p),id:m.id,name:p?.name??m.actorName??'已移除玩家',number:p?.number??m.actorNumber??'',photo:p?.photo??'',targetName:target?.name??m.targetName??'已移除玩家',targetNumber:target?.number??m.targetNumber??''}});
  return{activity,mode:'missions',title:round?.ended?'任务结算':'客官,YOU HAPPY？',progress:{round,rows},join:same&&screen.mode==='missions'&&screen.join?{qr:screen.join.qr,public:!!screen.join.public}:undefined};
 }
 if(activity===8){const s=state(states,'lottery');return{activity,mode:'lottery',title:'本轮选中的玩家',subtitle:'名单实时同步 · 先零次，再选次数较少的玩家',people:(s.people??[]).map((p:any)=>{const current=who(p.id);return current&&isEligible(current)?{...safe(current),beforeCount:p.beforeCount,count:p.count,reason:p.reason??''}:null}).filter(Boolean)};}
 return{activity,mode:'rules',title:activityNames[activity-1]??'派对软件'};
}
