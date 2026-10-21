import { compatibleProps,correlationMatrix,jointSummary,maskHits,simulationMasks } from './sgp-model';
import type { SgpCandidate,SgpDataset,SgpModelSport } from './sgp-types';

export function cappedSgpTarget(data:SgpDataset,candidates:SgpCandidate[],before:string,sport:SgpModelSport,target=50){
 const corr=correlationMatrix(data,candidates,before,sport),masks=simulationMasks(candidates,corr.L),cutoff=Math.floor(65536/target),floor=Math.ceil(65536/(target*1.2)),counts=new Map<string,number>();
 type State={indices:number[];hits:number};let beam:State[]=[{indices:[],hits:65536}],best:State|null=null,fallback:State|null=null;
 // A bounded search keeps both likely states and states closer to the target.
 // Lines never change. This is a search approximation, not a global optimum.
 for(let depth=1;depth<=10;depth++){
  const next=new Map<string,State>();
  for(const state of beam)for(let i=0;i<candidates.length;i++){
   if(state.indices.includes(i)||state.indices.some(j=>!compatibleProps(candidates[i],candidates[j],sport)))continue;
   const indices=[...state.indices,i].sort((a,b)=>a-b),key=indices.join(',');if(next.has(key))continue;
   let hits=counts.get(key);if(hits===undefined){hits=maskHits(indices,masks);counts.set(key,hits);}
   const value={indices,hits};
   if(hits>=floor&&hits<=cutoff){if(!best||hits>best.hits||hits===best.hits&&indices.length<best.indices.length)best=value;}
   else if(hits>cutoff)next.set(key,value);
   if(depth<=8&&(!fallback||depth>fallback.indices.length||depth===fallback.indices.length&&hits>fallback.hits))fallback=value;
  }
  if(best&&depth===8)break;
  const sorted=[...next.values()].sort((a,b)=>b.hits-a.hits||a.indices.join(',').localeCompare(b.indices.join(','))),near=[...sorted].reverse();beam=[...new Map([...sorted.slice(0,16),...near.slice(0,16)].map(s=>[s.indices.join(','),s])).values()];
  if(!beam.length)break;
 }
 const state=best||fallback,joint=state?jointSummary(state.indices,candidates,masks,corr):null;
 return {legs:state?.indices.map(i=>candidates[i])||[],joint,targetReached:!!best,reason:best?`${state!.indices.length} fixed, supported props reach the ${target}–${target*1.2} model-fair range. The bounded search prefers eight or fewer and never exceeds ten. This is not a FanDuel quote.`:`The ${target}–${target*1.2} model-fair range was not reached within ten supported props. No harder line or longshot was invented. This research fallback is not a FanDuel quote.`};
}
