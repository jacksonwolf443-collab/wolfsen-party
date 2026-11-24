export type CoverRecoveryScope={eventId?:string;resetEpoch?:number};
type Group={id:string;members:string[];cover?:string};
type Person={id:string;photo?:string};
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type CoverRecovery={signature:string;pending?:any;error?:string};
type RecordEntry=CoverRecovery&{eventId:string;resetEpoch:number;groupId:string;updatedAt:number};

const storageKey='jungle-party:pair-cover-recovery:v1';
const maxRecords=500,maxBytes=1024*1024,maxAge=30*24*60*60*1000;
const memory=new Map<string,RecordEntry>(),loadedStorage=new WeakSet<object>();
const clearedGroups=new Map<string,number>(),clearedScopes=new Map<string,number>();
const localKey=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,239}$/.test(value);
const identity=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/.test(value);
const recordKey=(entry:{eventId:string;resetEpoch:number;groupId:string})=>JSON.stringify([entry.eventId,entry.resetEpoch,entry.groupId]);
const scopeKey=(entry:{eventId:string;resetEpoch:number})=>JSON.stringify([entry.eventId,entry.resetEpoch]);
const scopeValue=(scope:CoverRecoveryScope)=>identity(scope?.eventId)&&Number.isSafeInteger(scope.resetEpoch??0)&&(scope.resetEpoch??0)>=0?{eventId:scope.eventId!,resetEpoch:scope.resetEpoch??0}:null;
function storageFor(supplied?:StorageLike){try{return supplied??(typeof window!=='undefined'?window.localStorage:undefined)}catch{return undefined}}
function validSignature(signature:string,groupId:string){
 try{const value=JSON.parse(signature);return Array.isArray(value)&&value.length===3&&value[0]===groupId&&Array.isArray(value[1])&&value[1].length>0&&value[1].length<=2&&value[1].every((row:any)=>Array.isArray(row)&&row.length===2&&identity(row[0])&&(row[1]===null||row[1]===''||localKey(row[1])))&&(value[2]===''||localKey(value[2]))}catch{return false}
}
function pendingPatch(value:any){
 if(!value||typeof value!=='object'||!localKey(value.cover))return undefined;
 const patch:any={cover:value.cover};
 for(const key of ['scene','sceneId','coverMethod'])if(typeof value[key]==='string'&&value[key].length<=4096&&!/^(?:data:|blob:|https?:|file:)/i.test(value[key]))patch[key]=value[key];
 if(Array.isArray(value.faceSources)&&value.faceSources.length<=2&&value.faceSources.every(localKey))patch.faceSources=[...value.faceSources];
 return patch;
}
function prune(){
 const now=Date.now();
 for(const cleared of [clearedGroups,clearedScopes]){for(const [key,at] of cleared)if(now-at>maxAge)cleared.delete(key);while(cleared.size>maxRecords)cleared.delete(cleared.keys().next().value!)}
 for(const [key,entry] of memory)if(now-entry.updatedAt>maxAge||entry.updatedAt>now+5*60*1000)memory.delete(key);
 const entries=[...memory.entries()].sort((a,b)=>a[1].updatedAt-b[1].updatedAt);
 while(entries.length>maxRecords){const [key]=entries.shift()!;memory.delete(key)}
 let size=JSON.stringify({version:1,records:[...memory.values()]}).length*2;
 while(size>maxBytes&&entries.length){const [key,entry]=entries.shift()!;memory.delete(key);size-=JSON.stringify(entry).length*2+2}
}
function read(storage?:StorageLike){
 if(!storage||loadedStorage.has(storage))return;
 try{
  const encoded=storage.getItem(storageKey);loadedStorage.add(storage);if(!encoded||encoded.length*2>maxBytes)return;
  const saved=JSON.parse(encoded);if(saved?.version!==1||!Array.isArray(saved.records))return;
  for(const raw of saved.records.slice(-maxRecords)){
   const scope=scopeValue(raw),signature=raw?.signature;
   if(!scope||!identity(raw.groupId)||typeof signature!=='string'||signature.length>8192||!validSignature(signature,raw.groupId)||!Number.isFinite(raw.updatedAt))continue;
   const pending=pendingPatch(raw.pending),error=typeof raw.error==='string'?raw.error.slice(0,2000):undefined;
   if(!pending&&!error)continue;
   const entry:RecordEntry={...scope,groupId:raw.groupId,signature,updatedAt:raw.updatedAt,...(pending?{pending}:{}),...(error?{error}:{})},key=recordKey(entry);
   if(entry.updatedAt<=(clearedGroups.get(key)??-Infinity)||entry.updatedAt<=(clearedScopes.get(scopeKey(entry))??-Infinity))continue;
   if(!memory.has(key)||memory.get(key)!.updatedAt<entry.updatedAt)memory.set(key,entry);
  }
 }catch{ /* Storage may be disabled, full or damaged; active work keeps its memory copy. */ }
 prune();
}
function persist(storage?:StorageLike){
 prune();if(!storage||!loadedStorage.has(storage))return;
 try{if(memory.size)storage.setItem(storageKey,JSON.stringify({version:1,records:[...memory.values()]}));else storage.removeItem(storageKey)}catch{ /* Recovery is best effort and must never interrupt the cover queue. */ }
}

/** The original photo keys and old accepted cover must still match before a paid result can be reused. */
export function pairCoverRecoverySignature(group:Group,players:Person[]){
 return JSON.stringify([group.id,group.members.map(id=>[id,players.find(p=>p.id===id)?.photo??null]),group.cover??'']);
}

export function restorePairCoverRecovery(scope:CoverRecoveryScope,groups:Group[],players:Person[],suppliedStorage?:StorageLike):Map<string,CoverRecovery>{
 const selected=scopeValue(scope),restored=new Map<string,CoverRecovery>();if(!selected)return restored;
 const storage=storageFor(suppliedStorage);read(storage);prune();
 const current=new Map(groups.map(group=>[group.id,pairCoverRecoverySignature(group,players)]));
 for(const [key,entry] of memory){
  if(entry.eventId!==selected.eventId||entry.resetEpoch!==selected.resetEpoch)continue;
  if(current.get(entry.groupId)!==entry.signature){memory.delete(key);clearedGroups.set(key,Date.now());continue}
  restored.set(entry.groupId,{signature:entry.signature,...(entry.pending?{pending:structuredClone(entry.pending)}:{}),...(entry.error?{error:entry.error}:{})});
 }
 persist(storage);return restored;
}

export function rememberPairCoverRecovery(scope:CoverRecoveryScope,group:Group,players:Person[],failure:{pending?:any;error?:string},suppliedStorage?:StorageLike){
 const selected=scopeValue(scope);if(!selected||!identity(group?.id)||!Array.isArray(group.members)||!group.members.every(identity)||!group.members.length)return;
 const storage=storageFor(suppliedStorage);read(storage);
 const signature=pairCoverRecoverySignature(group,players);if(!validSignature(signature,group.id))return;
 const pending=pendingPatch(failure.pending),error=typeof failure.error==='string'?failure.error.slice(0,2000):undefined;
 if(!pending&&!error)return;
 const entry:RecordEntry={...selected,groupId:group.id,signature,updatedAt:Date.now(),...(pending?{pending}:{}),...(error?{error}:{})};
 const key=recordKey(entry);clearedGroups.delete(key);memory.set(key,entry);persist(storage);
}

export function clearPairCoverRecovery(scope:CoverRecoveryScope,groupId?:string,suppliedStorage?:StorageLike){
 const selected=scopeValue(scope);if(!selected)return;
 const storage=storageFor(suppliedStorage);read(storage);
 if(groupId===undefined)clearedScopes.set(scopeKey(selected),Date.now());else clearedGroups.set(recordKey({...selected,groupId}),Date.now());
 for(const [key,entry] of memory)if(entry.eventId===selected.eventId&&entry.resetEpoch===selected.resetEpoch&&(groupId===undefined||entry.groupId===groupId))memory.delete(key);
 persist(storage);
}
