'use strict';
const crypto=require('node:crypto');
function selectedIds(kind,value,previous){
 if(!value)return[];
 if(kind==='lottery'&&value.drawnAt!==previous?.drawnAt)return(value.people??[]).map(p=>p.id);
 if(kind==='truth'&&JSON.stringify(value.cast)!==JSON.stringify(previous?.cast))return value.cast??[];
 if(kind==='fans')return['a','b'].filter(k=>value[k]&&value[k]!==previous?.[k]).map(k=>value[k]);
 if(kind==='draw'){
  if(value.selectionId&&value.selectionId!==previous?.selectionId)return value.contestants??[];
  if(value.roundId&&value.roundId!==previous?.roundId&&!value.contestants?.includes(value.player))return[value.player];
 }
 if(kind==='crop'){if(value.formatVersion>=2)return[];if(value.current&&value.current!==previous?.current)return[value.current];}
 return[];
}
function recordSelections(data,ids){data.selectionCounts??={};for(const id of new Set(ids)){if(data.players.some(p=>p.id===id))Object.defineProperty(data.selectionCounts,id,{value:(Number(data.selectionCounts[id])||0)+1,writable:true,enumerable:true,configurable:true});}}
function drawingRepeat(data,value,previous){
 if(!value?.roundId||value.roundId===previous?.roundId||!value.contestants?.includes(value.player))return[];
 if(data.drawSelectionStarts?.id!==value.selectionId)data.drawSelectionStarts={id:value.selectionId,players:[]};
 const seen=data.drawSelectionStarts.players;
 if(seen.includes(value.player))return[value.player];
 seen.push(value.player);return[];
}
function fairPlayers(pool,counts,count,shuffle){return shuffle(pool).sort((a,b)=>(Number(counts[a.id])||0)-(Number(counts[b.id])||0)).slice(0,count);}
function drawingValue(store,{isEligible,shuffle,AppError},version){
 const previous=store.state('draw'),pool=store.data.players.filter(isEligible);
 if(Number(version)!==previous.version)throw new AppError('该活动已被更新，请重新选择',409);
 if(!pool.length)throw new AppError('没有可抽取的在场玩家');
 if(previous.value?.endsAt>Date.now())throw new AppError('请先结束正在进行的作画，再选择下一位选手');
 const chosen=fairPlayers(pool,store.data.selectionCounts??{},1,shuffle)[0],beforeCount=Number(store.data.selectionCounts?.[chosen.id])||0;
 const person={id:chosen.id,name:chosen.name,number:chosen.number,photo:chosen.photo,beforeCount,afterCount:beforeCount+1,count:beforeCount+1,reason:beforeCount===0?'今晚还没被抽中':'今晚被抽中次数较少，同次数随机'};
 const value={...(previous.value??{topic:'',history:[],endsAt:0,scores:{},canvas:'',awarded:false,roundId:''}),contestants:[chosen.id],selectionId:crypto.randomUUID(),selection:person,player:chosen.id,endsAt:0,roundId:'',awarded:false,celebration:null,celebratedRoundId:'',history:[],autoCalls:0};
 return{value,people:[person],count:1};
}
function selectDrawing(store,b,deps){const result=drawingValue(store,deps,b.version);return{...store.putState('draw',result.value,b.version),...result};}
function createDrawingPreview({store,isEligible,shuffle,AppError}){
 const pending=new Map(),deps={isEligible,shuffle,AppError};
 const roster=()=>JSON.stringify(store.data.players.filter(isEligible).map(p=>[p.id,p.name,p.number,p.photo]).sort((a,b)=>a[0].localeCompare(b[0])));
 const counts=()=>JSON.stringify(store.data.players.filter(isEligible).map(p=>[p.id,Number(store.data.selectionCounts?.[p.id])||0]).sort((a,b)=>a[0].localeCompare(b[0])));
 return{
  select(b){if(!b.preview)return selectDrawing(store,b,deps);const result=drawingValue(store,deps,b.version);pending.clear();const token=crypto.randomUUID();pending.set(token,{result,roster:roster(),counts:counts(),version:store.state('draw').version});return{token,...structuredClone(result)}},
  cancel(b){pending.delete(b.token);return{ok:true}},
  commit(b){const p=pending.get(b.token);pending.delete(b.token);if(!p)throw new AppError('本次抽取已失效，请重新抽取',409);if(Number(b.version)!==p.version||store.state('draw').version!==p.version)throw new AppError('该活动已被更新，请重新抽取',409);if(p.roster!==roster())throw new AppError('玩家名单已变化，请重新抽取',409);if(p.counts!==counts())throw new AppError('全局抽中次数已变化，请重新抽取',409);return{...store.putState('draw',p.result.value,p.version),...structuredClone(p.result)}}
 };
}
module.exports={selectedIds,recordSelections,fairPlayers,selectDrawing,drawingRepeat,createDrawingPreview};
