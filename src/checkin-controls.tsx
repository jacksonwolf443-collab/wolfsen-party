import React,{useRef,useState} from 'react';
import {Check,LogIn,LogOut} from 'lucide-react';
import {Button,api} from './ui';
import type {Context} from './ui';
import type {Player} from './domain';
export function checkInLabel(player:any){return player.attendance===undefined||player.attendance==='present'?'已签到':player.checkedInAt?'已签退':'未签到'}
export function CheckInControls({player,ctx}:{player:Player;ctx:Context}){
 const checked=player.attendance===undefined||player.attendance==='present',[working,setWorking]=useState(false),lock=useRef(false);
 const change=async(attendance:'present'|'away')=>{if(lock.current)return;lock.current=true;setWorking(true);try{await ctx.run(attendance==='present'?'正在签到…':'正在签退…',async()=>{
  // A phone acceptance or score edit can advance the player version while this
  // card is visible. Read the latest record before the attendance-only CAS.
  const latest=(await api('scores/list')).players?.find((p:Player)=>p.id===player.id);if(!latest)throw Error('玩家档案已变化，请重新读取名单');
  await api('players/attendance',{id:player.id,version:latest.version??0,attendance});await ctx.refresh(true);ctx.tell(player.name+(attendance==='present'?'已签到，进入后续新回合候选':'已签退，后续抽取将跳过'));
 })}finally{lock.current=false;setWorking(false)}};
 return <div className="button-row checkin-controls"><Button variant={checked?'secondary':'primary'} disabled={checked||working} onClick={()=>change('present')}>{checked?<Check size={16}/>:<LogIn size={16}/>}<span>{checked?'已签到':'签到'}</span></Button>{checked&&<Button variant="ghost" disabled={working} onClick={()=>change('away')}><LogOut size={16}/><span>签退</span></Button>}</div>;
}
