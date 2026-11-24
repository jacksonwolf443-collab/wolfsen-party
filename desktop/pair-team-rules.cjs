'use strict';
const soloReason='单人成队，按2个名额参加全部轮次；获胜只给本人记1分。';
function validPairTeam(group){const ids=group?.members;return Array.isArray(ids)&&new Set(ids).size===ids.length&&(ids.length===2||ids.length===1&&group.solo===true&&group.seats===2);}
function isPairTeamEligible(group,players,isEligible){return validPairTeam(group)&&group.members.every(id=>isEligible(players.find(p=>p.id===id)));}
function teamMetadata(members){return members.length===1?{solo:true,seats:2}:{seats:2};}
function randomPairing(players,{shuffle=a=>a}={}){const ids=shuffle(players.map(p=>p.id)),pairs=[];for(let i=0;i<ids.length;i+=2)pairs.push(ids.slice(i,i+2));return{pairs,standby:[]};}
module.exports={validPairTeam,isPairTeamEligible,teamMetadata,randomPairing,soloReason};
