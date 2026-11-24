export function normalizedAnswer(text:unknown){return String(text??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}
export function answersMatch(topic:unknown,guess:unknown){const answer=normalizedAnswer(topic);return !!answer&&answer===normalizedAnswer(guess);}
// Frames contain the canvas before each complete stroke. An imported image is the first base.
// Both bounds keep the generic persisted activity well below its 12 MiB size limit.
export function boundedUndo(frames:string[],frame:string){const next=[...frames,frame];while(next.length>50||next.reduce((total,value)=>total+value.length,0)>7*1024*1024)next.shift();return next;}
