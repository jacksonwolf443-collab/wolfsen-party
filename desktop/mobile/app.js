'use strict';
const $=id=>document.getElementById(id),show=(id,on)=>$(id).hidden=!on,text=(id,value)=>$(id).textContent=value??'';
let entry=location.hash.slice(1),token=localStorage.getItem('party-phone-session')||'',players=[],refreshing=null,choosing=!token,view=0;
if(entry){sessionStorage.setItem('party-entry',entry);history.replaceState(null,'',location.pathname)}else entry=sessionStorage.getItem('party-entry')||'';
async function call(route,body,entryAuth=false){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(entryAuth?{'X-Party-Entry':entry}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok){const e=Error(d.error||'暂时无法连接');e.status=r.status;throw e}return d}
const label=p=>p?'#'+p.number+' '+p.name:'玩家已移除';
function renderIncoming(data){
 const list=$('incomingList'),cards=data.incomingTasks?.length?data.incomingTasks:data.incoming?[data.incoming]:[null],signature=cards.map(c=>c?.id??c?.actor?.id??'waiting').join('|');
 if(list.dataset.cards!==signature){list.replaceChildren();cards.forEach((card,i)=>{const section=document.createElement('section');section.className='private';section.dataset.incomingCard=card?.id??card?.actor?.id??'waiting';const fields=[['h2','accept-heading','我负责验收',null],['h3','','','visitor'],['p','task','','incomingTask'],['p','','你要对来找你的人完成上面的事件；认可后，把该任务的码只告诉这个人。',null],['strong','bigcode','','acceptCode'],['p','','','inStatus']];for(const [tag,className,value,field]of fields){const el=document.createElement(tag);el.className=className;el.textContent=value;if(field){el.dataset.field=field;el.id=field+(i?'-'+i:'')}section.append(el)}list.append(section)});list.dataset.cards=signature}
 cards.forEach((inc,i)=>{const section=list.children[i],put=(field,value)=>{const el=section.querySelector('[data-field="'+field+'"]');if(el.textContent!==value)el.textContent=value};put('visitor',inc?label(inc.actor)+' 会来找你':'等待主持人分配');put('incomingTask',inc?.task||'');put('acceptCode',inc?.code||'暂不可用');put('inStatus',inc?.completed_at?'对方已通过验收':inc?.paused?'参与者不在场，暂停验收':data.round?.ended?'本轮已结束':'请对来找你的人完成事件；他配合且你认可后给码。不配合则不给码，由他受罚。勿公开给其他人')});
}

function options(){const select=$('player'),old=select.value;select.replaceChildren(new Option('请选择本人',''));for(const p of players)select.add(new Option(label(p),p.id));select.value=old}
async function claimPage(){const current=view;show('cards',false);show('claim',true);show('retry',false);text('connection','选择自己的姓名与编号，即可领取任务');const d=await call('roster',null,true);if(current!==view||!choosing)return;players=d.players;options()}
function refresh(){if(refreshing)return refreshing;const current=view;const task=(async()=>{try{
 if(choosing||!token){if(!players.length)await claimPage();return}
 const d=await call('me');if(current!==view||choosing)return;show('retry',true);show('claim',false);show('cards',true);text('connection','已连接 · 自动更新');text('self',label(d.self));
 const out=d.outgoing;show('verify',!!out&&!out.completed_at&&!out.paused&&!d.round?.ended);text('target',out?label(out.target):'等待主持人分配');text('task',out?.task||'分配后会自动显示，无需重新扫码');text('outStatus',out?.completed_at?'✓ 已通过验收':d.round?.ended?'本轮已结束':out?.paused?'任务暂停：有参与者未到 / 已离场':'请配合对方对你完成上面的事件；认可后向对方索要验收码');
 renderIncoming(d);
 }catch(e){if(current!==view)return;if(e.status===403&&!choosing){token='';localStorage.removeItem('party-phone-session');choosing=true;players=[];view++;show('cards',false);try{await claimPage()}catch(next){text('connection',next.message+'。请重新扫描当前二维码。')}return}text('connection','连接提示：'+e.message);show('retry',true)}})();refreshing=task;task.finally(()=>{if(refreshing===task)refreshing=null});return task}
$('join').addEventListener('click',async()=>{if(!$('player').value)return text('message','请先选择本人');$('join').disabled=true;try{const d=await call('claim',{player:$('player').value},true);token=d.token;localStorage.setItem('party-phone-session',token);choosing=false;view++;text('message','');await refreshing;await refresh()}catch(e){text('message',e.message)}finally{$('join').disabled=false}});
$('retry').addEventListener('click',async()=>{choosing=true;view++;players=[];text('message','');try{await claimPage()}catch(e){text('message',e.message+'。请重新扫描当前二维码。')}});
$('verify').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;try{await call('verify',{code:$('code').value.trim()});$('code').value='';text('message','验收通过，已保存！');await refreshing;await refresh()}catch(e){text('message',e.message)}finally{$('submit').disabled=false}});
refresh();setInterval(refresh,6000+Math.random()*2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
