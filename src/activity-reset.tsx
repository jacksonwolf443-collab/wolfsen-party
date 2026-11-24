import React,{useState} from 'react';
import {Trash2} from 'lucide-react';
import {Button,Modal} from './ui';
import type {Context} from './ui';
import {activityNames,displayNumber} from './domain';
const contents=['组合、合照、挑战、晋级与票数','故事库、当事人、冒充者与揭秘状态','尾巴计分、排名与倒计时','画布、题目、猜测记录、计分与倒计时','照片局部、已抽照片与抢答积分','队长、应援口号、PK挑战与比分','全部任务题目、已分配任务、验收码、验收记录与倒计时','抽取人数与当前抽中名单'];
export default function ActivityReset({number,ctx}:{number:number;ctx:Context}){
  const[confirming,setConfirming]=useState(false);
  if(number===2||number===9)return null;
  return <div className="activity-reset"><Button variant="ghost" disabled={!!ctx.busy} onClick={()=>setConfirming(true)}><Trash2 size={15}/>清空当前全部内容</Button>
    {confirming&&<Modal title={'清空活动'+displayNumber(number)+' · '+activityNames[number-1]+'？'} onClose={()=>{if(!ctx.busy)setConfirming(false)}}>
      <p>将清空本活动的{contents[number-1]}，并清除本活动的舞台展示。</p><p>玩家档案、原照片、其他活动与AI设置都会保留。清空后可重新开始；需要留存时请先导出完整备份。</p>
      <div className="modal-actions"><Button variant="ghost" disabled={!!ctx.busy} onClick={()=>setConfirming(false)}>取消</Button><Button variant="danger" disabled={!!ctx.busy} onClick={()=>ctx.resetActivity(number)}>确认清空</Button></div>
    </Modal>}
  </div>;
}
