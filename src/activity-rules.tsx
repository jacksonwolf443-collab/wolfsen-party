import React from 'react';
import {activityRules,pairRoundRules} from './rules-data';
export function ActivityRules({activity,round,stage=false,page=0,pageSize}:{activity:number;round?:number|string;stage?:boolean;page?:number;pageSize?:number}){
 const rule=activity===1&&round&&pairRoundRules[Number(round)]?pairRoundRules[Number(round)]:activityRules[activity];
 if(!rule)return null;
 const offset=pageSize?Math.max(0,page)*pageSize:0,steps=pageSize?rule.steps.slice(offset,offset+pageSize):rule.steps;
 return <section className={'activity-rules'+(stage?' activity-rules-stage':'')} aria-label={rule.title+'活动规则'}><div className="activity-rules-heading"><span>活动规则</span><h2>{rule.title}</h2></div><ol>{steps.map((step,index)=><li key={step}><span className="activity-rule-number">{String(offset+index+1).padStart(2,'0')}</span><p>{step}</p></li>)}</ol></section>;
}
