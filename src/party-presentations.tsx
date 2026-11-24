import React from 'react';
import {img} from './ui';

export function PairIntroduction({title,cover,people,reason,solo=false,seats=2}:{title:string;cover?:string;people:any[];reason?:string;solo?:boolean;seats?:number}){
  return <section className="pair-introduction">
    <div className="intro-heading"><span>今晚谁最搭 · 认识这一组</span><h1>{title}</h1>{solo&&<p>单人成队 · 按{seats}个名额参赛 · 获胜只给本人加1分</p>}</div>
    {reason&&<div className="intro-match-reason"><strong>为什么是这一组</strong><p>{reason}</p></div>}
    {solo?null:cover?<img className="pair-cover intro-cover" src={cover} alt="本组合AI合照"/>:<div className="intro-no-cover">本组合尚未生成合照</div>}
    <div className="intro-profiles">{people.map((p,i)=><article key={p?.id??i} className="intro-profile">
      {p?.photo?<img className="intro-original" src={img(p.photo)} alt={(p.name??'玩家')+'的原照片'}/>:<div className="intro-photo-empty">暂无原照片</div>}
      <div><span className="intro-number">NO. {p?.number??'—'}</span><h2>{p?.name??'玩家已移除'}</h2><dl>
        <dt>兴趣</dt><dd>{p?.interests||'尚未填写'}</dd><dt>一直想做却没敢做的事</dt><dd>{p?.wish||'尚未填写'}</dd>
        {p&&<><dt>参与状态</dt><dd>{p.active?'参与活动':'暂不参与'}</dd></>}
      </dl></div>
    </article>)}</div>
  </section>;
}
export function DrawnPlayers({people}:{people:any[]}){return <div className="lottery-results">{people.map(p=><article className="lottery-person" key={p.id}>
  {p.photo?<img src={img(p.photo)} alt={p.name+'的照片'}/>:<div className="lottery-no-photo">{p.name.slice(0,1)}<small>尚未上传照片</small></div>}
  <span>NO. {p.number}</span><h2>{p.name}</h2>{p.count!==undefined&&<div className="drawn-selection-reason"><b>今晚第 {p.count} 次被抽中</b><p>{p.reason}</p></div>}
</article>)}</div>}
