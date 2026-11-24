'use client';
import React from 'react';
import type {Context} from './ui';
import {DrawActivity,CropActivity} from './visual-activities';
import MissionActivity from './mission-activity';
import Pairs from './pair-activity';
import LotteryActivity from './lottery-activity';
import ScoresActivity from './scores-activity';
import FansActivity from './fans-activity';
import Tails from './tails-activity';
import TruthActivity from './truth-activity';
import {VoiceActivity} from './voice-activity';
export default function Activities({number,ctx}:{number:number;ctx:Context}){return <div key={number}>{number===1?<Pairs ctx={ctx}/>:number===2?<Truth ctx={ctx}/>:number===3?<Tails ctx={ctx}/>:number===4?<DrawActivity ctx={ctx}/>:number===5?<CropActivity ctx={ctx}/>:number===6?<FansActivity ctx={ctx}/>:number===7?<MissionActivity ctx={ctx}/>:number===8?<LotteryActivity ctx={ctx}/>:number===10||number===11?<VoiceActivity activity={number} ctx={ctx}/>:<ScoresActivity ctx={ctx}/>}</div>;}
export function Truth({ctx}:{ctx:Context}){return <TruthActivity ctx={ctx}/>;}
