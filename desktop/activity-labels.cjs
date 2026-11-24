'use strict';
const labels={pairs:'今晚谁最搭',truth:'谁是最有趣开心的人',tails:'线下决斗',draw:'毕加索在世',crop:'这又是哪位佳丽',fans:'王不见王',missions:'客官,YOU HAPPY？',lottery:'随机抽取玩家',voicePitch:'谁叫的最高',voiceImitation:'谁叫得最像'};
const voiceActivityKinds={10:'voicePitch',11:'voiceImitation'};
// Activity 09 is the score and awards page and has no standalone game state.
const activityStateKinds=['pairs','truth','tails','draw','crop','fans','taskBank','lottery',null,...Object.values(voiceActivityKinds)];
// Legacy names are accepted only in generated activity metadata. Player text,
// tasks and saved captions retain their original wording.
const legacy={pairs:/天作之合/g,truth:/谁才是真正的当事人[？?]?/g,tails:/抢你的尾巴|抢尾巴大赛|抢后面大赛/g,fans:/抢粉丝大赛|抢男人大赛/g,draw:/你画[，,、]?\s*AI猜/g,missions:/今晚[，,、]?\s*(?:请)?验收我/g};
function displayActivityText(value,kind){return typeof value==='string'&&legacy[kind]?value.replace(legacy[kind],labels[kind]):value;}
function displayWinEvent(event){
 const result=structuredClone(event);if(labels[result.kind])result.activity=labels[result.kind];
 if(result.sourceLabel)result.sourceLabel=displayActivityText(result.sourceLabel,result.kind);
 if(result.reason==='pair-champion'||String(result.id??'').startsWith('pairs:champion:'))result.task=displayActivityText(result.task,'pairs');
 return result;
}
function displayGameWinEvent(event){const result=structuredClone(event);if(labels[result.kind])result.activityName=labels[result.kind];return result;}
module.exports={labels,activityStateKinds,voiceActivityKinds,displayActivityText,displayWinEvent,displayGameWinEvent};
