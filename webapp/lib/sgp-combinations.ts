import { compatibleProps,correlationMatrix,jointSummary,simulationMasks,SGP_GAME_MAX_LEGS } from './sgp-model';
import type { SgpCandidate,SgpDataset,SgpModelSport,SgpPrefixSet } from './sgp-types';

type Choice={indices:number[];hits:number};
type BeamChoice=Choice&{mask:Uint32Array};
const SAMPLES=65536,BEAM_WIDTH=128,OPTION_WIDTH=.025;
function popcount(v:number){v-=v>>>1&0x55555555;v=(v&0x33333333)+(v>>>2&0x33333333);return ((v+(v>>>4)&0x0F0F0F0F)*0x01010101)>>>24;}
function intersectionHits(a:Uint32Array,b:Uint32Array){let count=0;for(let w=0;w<a.length;w++)count+=popcount(a[w]&b[w]);return count;}
function intersect(indices:number[],masks:Uint32Array[]){const result=new Uint32Array(SAMPLES/32);result.fill(0xFFFFFFFF);for(const i of indices)for(let w=0;w<result.length;w++)result[w]&=masks[i][w];return result;}
const stable=(a:Choice,b:Choice)=>b.hits-a.hits||a.indices.length-b.indices.length||a.indices.join(',').localeCompare(b.indices.join(','));
function spread(states:Choice[],maximum:number){
 if(states.length<=maximum)return states.sort(stable);
 // Keep combinations throughout the probability range, rather than only the
 // safest chain. Diverse sets at a given depth may have different compatibilities.
 const ordered=states.sort(stable),bins=new Map<number,Choice>();
 for(const state of ordered){const bin=Math.floor(-Math.log(state.hits/SAMPLES)/OPTION_WIDTH);if(!bins.has(bin))bins.set(bin,state);}
 const range=[...bins.values()];const selected=range.length>maximum?Array.from({length:maximum},(_,i)=>range[Math.round(i*(range.length-1)/(maximum-1))]):range;
 const keys=new Set(selected.map(s=>s.indices.join(',')));for(const state of ordered){if(selected.length>=maximum)break;const key=state.indices.join(',');if(!keys.has(key)){keys.add(key);selected.push(state);}}
 return selected;
}

/** Fixed lines enter this target-independent search. Ten is a ceiling, not a goal.
 * Small pools enumerate every compatible subset. Larger pools use a diverse beam.
 * Only the bounded frontier is published; global optimality is not asserted.
 */
export function sgpCombinations(data:SgpDataset,candidates:SgpCandidate[],before:string,sport:SgpModelSport):SgpPrefixSet['prefixes']{
 if(!candidates.length)return [];
 const correlation=correlationMatrix(data,candidates,before,sport),masks=simulationMasks(candidates,correlation.L),all=new Map<number,Choice>();
 const initial=new Uint32Array(SAMPLES/32);initial.fill(0xFFFFFFFF);let beam:BeamChoice[]=[{indices:[],hits:SAMPLES,mask:initial}];
 for(let depth=1;depth<=Math.min(SGP_GAME_MAX_LEGS,candidates.length);depth++){
  const next:Choice[]=[],seen=new Set<string>();
  for(const state of beam)for(let i=0;i<candidates.length;i++){
   if(state.indices.includes(i)||!Number.isFinite(candidates[i].probability)||candidates[i].probability<=0||candidates[i].probability>=1||state.indices.some(j=>!compatibleProps(candidates[i],candidates[j],sport)))continue;
   const indices=[...state.indices,i].sort((a,b)=>a-b),key=indices.join(',');if(seen.has(key))continue;seen.add(key);
   const hits=intersectionHits(state.mask,masks[i]);if(hits<25||hits>=state.hits)continue;
   const value={indices,hits};next.push(value);
   if(depth>=2){const bin=Math.floor(-Math.log(hits/SAMPLES)/OPTION_WIDTH),old=all.get(bin);if(!old||value.indices.length<old.indices.length||value.indices.length===old.indices.length&&stable(value,old)<0)all.set(bin,value);}
  }
  if(!next.length)break;
  const kept=spread(next,candidates.length<=10?1024:BEAM_WIDTH);beam=kept.map(s=>({...s,mask:intersect(s.indices,masks)}));
 }
 return [...all.values()].sort(stable).map(state=>({indices:state.indices,joint:jointSummary(state.indices,candidates,masks,correlation)}));
}
