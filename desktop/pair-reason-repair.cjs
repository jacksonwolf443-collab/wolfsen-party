const {profilePairReason}=require('./ai-pairing.cjs');
function repairSavedPairReasons(store){
 const data=store.data,pairs=data.states?.pairs,groups=pairs?.value?.groups;if(!Array.isArray(groups))return false;
 const changes=[];
 for(const group of groups){if(!Array.isArray(group.members)||group.members.length!==2)continue;if(!['insufficient','profile','entertainment'].includes(group.matchReasonSource)&&!/^资料不足，暂无可确认/.test(group.matchReason??''))continue;if(['ai','random','host'].includes(group.matchReasonSource)&&!/^资料不足，暂无可确认/.test(group.matchReason??''))continue;
  const reason=profilePairReason(group.members,data.players),patch={matchReason:reason.reason,matchReasonSource:reason.reasonSource,matchReasonEvidence:reason.reasonEvidence};if(Object.entries(patch).some(([key,value])=>JSON.stringify(group[key])!==JSON.stringify(value)))changes.push({id:group.id,patch});
 }
 if(!changes.length)return false;
 store.commit(d=>{const state=d.states.pairs;for(const change of changes){const group=state.value.groups.find(g=>g.id===change.id);Object.assign(group,change.patch);const screen=d.states.screen;if(screen?.value?.mode==='pair-profile'&&screen.value.groupId===group.id&&screen.value.reason!==group.matchReason){screen.value.reason=group.matchReason;screen.value.reasonSource=group.matchReasonSource;screen.version=(screen.version??0)+1}}state.version=(state.version??0)+1;return{}});
 return true;
}
module.exports={repairSavedPairReasons};
