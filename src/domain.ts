export function normalizeNumber(value: unknown): string {
  const s=String(value??'').normalize('NFKC').trim();
  if(!/^[\p{L}\p{N}_-]{1,16}$/u.test(s)) throw new Error('编号请输入1–16位文字、数字、下划线或短横线');
  return s;
}
export function shuffle<T>(items:T[]):T[]{const a=[...items];for(let i=a.length-1;i>0;i--){const n=crypto.getRandomValues(new Uint32Array(1))[0];const j=n%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function pairPlayers(ids:string[]){
 const unique=shuffle([...new Set(ids)]),pairs:string[][]=[];
 for(let i=0;i<unique.length;i+=2)pairs.push(unique.slice(i,i+2));
 return {pairs,standby:[] as string[]};
}
export function assignMissions(ids:string[],bank:string[]){const a=shuffle([...new Set(ids)]), tasks=shuffle(bank.map(x=>x.trim()).filter(Boolean));if(a.length<2)throw new Error('至少需要2名参与玩家');if(!tasks.length)throw new Error('请先填写至少一道任务');const balanced=shuffle(a.map((_,i)=>tasks[i%tasks.length]));return a.map((actor,i)=>({actor,target:a[(i+1)%a.length],task:balanced[i]}));}
export function token(bytes=24){return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
export function numericCode(digits=6){let s='';for(const n of crypto.getRandomValues(new Uint8Array(digits)))s+=String(n%10);return s;}
export type Player={score?:number;id:string;number:string;name:string;photo:string;facePhoto?:string;headCutout?:string;headSourcePhoto?:string;headReferenceMethod?:string;headReferenceWarning?:string;interests:string;trait:string;wish?:string;consent:number;active:number;attendance?:'present'|'away';checkedInAt?:string|null;attendanceUpdatedAt?:string;lastCheckOutAt?:string;pin?:string;version?:number;created_at?:string};
export function isEligible(player?:Player|null):player is Player{return !!player&&!!player.active&&(player.attendance===undefined||player.attendance==='present');}
export function isPairTeamEligible(group:{members:string[];solo?:boolean;seats?:number}|null|undefined,players:Player[]){const ids=group?.members;return !!ids&&new Set(ids).size===ids.length&&(ids.length===2||ids.length===1&&group?.solo===true&&group.seats===2)&&ids.every(id=>isEligible(players.find(p=>p.id===id)));}
export const activityNames=['今晚谁最搭','谁是最有趣开心的人','线下决斗','毕加索在世','这又是哪位佳丽','王不见王','客官,YOU HAPPY？','随机抽取玩家','全场最强英雄','谁叫的最高','谁叫得最像'];
export const activityKinds=['pairs','truth','tails','draw','crop','fans','taskBank','lottery','scores','voicePitch','voiceImitation'];
/** Presentation order only. Internal ids and persisted state keys stay stable. */
export const activityDisplayOrder=[1,7,3,4,6,5,2,8,9,10,11];
export function displayNumber(activity:number){const index=activityDisplayOrder.indexOf(activity);return index<0?activity:index+1;}

const legacyActivityNames:Record<string,string>={
 '天作之合':activityNames[0],
 '今晚，请验收我':activityNames[6],'今晚,请验收我':activityNames[6],'今晚，验收我':activityNames[6],'今晚,验收我':activityNames[6],'今晚请验收我':activityNames[6],'今晚验收我':activityNames[6],
 '抢你的尾巴':activityNames[2],'抢尾巴大赛':activityNames[2],
 '你画，AI猜':activityNames[3],'你画,AI猜':activityNames[3],'你画AI猜':activityNames[3],
 '全场积分榜':activityNames[8]
};
const legacyScreenLabels:Record<string,string>={...legacyActivityNames,
 '选出全场天作之合':activityNames[0],
 '天作之合总结':activityNames[0]+'总结'
};
// Only known system metadata is adapted. Saved data, task text and custom captions stay intact.
for(const[old,name]of Object.entries(legacyActivityNames)){
 const suffixes=old==='天作之合'?['哪组最猛','我们最猛','我们最默契','心有灵犀','天作之合总结','认识这一组','最佳搭档','活动总结','四轮活动积分总结','活动累计积分冠军','活动累计积分并列冠军']:old==='抢你的尾巴'||old==='抢尾巴大赛'?['当前排名','三强揭晓']:old.includes('验收我')?['本轮结束']:[];
 for(const suffix of suffixes)legacyScreenLabels[old+' · '+suffix]=name+' · '+(suffix==='天作之合总结'?activityNames[0]+'总结':suffix);
}
export function adaptScreenActivityNames<T extends Record<string,any>>(screen:T):T{
 const shown={...screen};
 for(const field of ['title','subtitle','tag'] as const){const value=screen[field];if(typeof value==='string'&&Object.hasOwn(legacyScreenLabels,value))(shown as Record<string,any>)[field]=legacyScreenLabels[value];}
 return shown;
}

export function pairName(ids:string[],players:Player[]){return ids.map(id=>players.find(p=>p.id===id)?.name??'已移除玩家').join(' + ')}
