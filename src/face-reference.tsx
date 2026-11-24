import React,{useEffect,useRef,useState} from 'react';
import {api,Button,Modal,photoData} from './ui';
import type {Context} from './ui';
import type {Player} from './domain';
type Box={x:number;y:number;width:number;height:number};
const full:Box={x:0,y:0,width:1,height:1};
export default function FaceReference({player,ctx,onClose}:{player:Player;ctx:Context;onClose:()=>void}){
 const[source,setSource]=useState(''),[box,setBox]=useState<Box>(full),[error,setError]=useState(''),[saving,setSaving]=useState(false),[ready,setReady]=useState(false);
 const image=useRef<HTMLImageElement>(null),preview=useRef<HTMLCanvasElement>(null),start=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{let live=true;photoData(player.photo).then(url=>{if(live)setSource(url)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[player.photo]);
 useEffect(()=>{
  const photo=image.current,canvas=preview.current;if(!ready||!photo||!canvas)return;
  const width=Math.max(1,Math.round(photo.naturalWidth*box.width)),height=Math.max(1,Math.round(photo.naturalHeight*box.height)),scale=Math.min(1,1024/Math.max(width,height));
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const c=canvas.getContext('2d');if(!c){setError('人脸参考预览无法加载');return}
  c.drawImage(photo,photo.naturalWidth*box.x,photo.naturalHeight*box.y,width,height,0,0,canvas.width,canvas.height);
 },[box,ready]);
 const point=(event:React.PointerEvent<HTMLDivElement>)=>{const r=event.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}};
 const move=(event:React.PointerEvent<HTMLDivElement>)=>{if(!start.current)return;const p=point(event),a=start.current;setBox({x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)})};
 const valid=ready&&!!image.current&&image.current.naturalWidth*box.width>=64&&image.current.naturalHeight*box.height>=64;
 const save=async()=>{if(!valid||saving)return;setSaving(true);setError('');try{
  const blob=await new Promise<Blob>((resolve,reject)=>preview.current!.toBlob(b=>b?resolve(b):reject(new Error('无法保存人脸参考')),'image/png'));
  const {key}=await api('upload',{bytes:new Uint8Array(await blob.arrayBuffer()),type:'image/png'});
  await api('players/face',{id:player.id,version:player.version??0,sourcePhoto:player.photo,photo:key});await ctx.refresh(true);ctx.tell('可选人脸参考已保存，原照片保留');onClose();
 }catch(e:any){setError(e.message)}finally{setSaving(false)}};
 return <Modal title={'选取人脸参考 · '+player.name} subtitle="在原照片上拖出矩形，框住全部头发、双耳、下巴和少量颈部；原照片保留。" wide onClose={()=>{if(!saving)onClose()}}>
  <div className="face-reference-editor"><div className="face-selection" onPointerDown={e=>{if(!ready||saving)return;start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={move} onPointerUp={e=>{move(e);start.current=null}} onPointerCancel={()=>{start.current=null}}>
   {source&&<img ref={image} src={source} alt="拖动框选本人的头部" draggable={false} onLoad={()=>setReady(true)} onError={()=>setError('原照片无法加载')}/>}
   {ready&&<div className="face-selection-box" style={{left:box.x*100+'%',top:box.y*100+'%',width:box.width*100+'%',height:box.height*100+'%'}}/>}
  </div><div><h3>原照片头部范围预览</h3><canvas ref={preview} className="face-preview"/><p>这是可选的参考整理，原照片会保留。请选择本人清楚可见的头部，不要框入旁人。被手机或墨镜遮住的细节无法靠裁切找回。</p><p>当前双人合照直接使用两张完整原照，不要求手动框脸，也不会把这个裁切图硬贴到身体上。</p><Button variant="secondary" disabled={saving} onClick={()=>setBox(full)}>重新框选（恢复整张）</Button>{!valid&&ready&&<p>框选区域太小，请至少保留64×64像素的原图。</p>}</div></div>
  {error&&<div className="form-error" role="alert">{error}</div>}
  <div className="modal-actions"><Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button><Button disabled={!valid||saving} onClick={save}>{saving?'保存中…':'保存人脸参考'}</Button></div>
 </Modal>;
}
