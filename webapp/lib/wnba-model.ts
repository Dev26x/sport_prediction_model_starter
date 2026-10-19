import { correlationMatrix,simulationMasks,maskHits,jointSummary,compatibleProps } from './sgp-model';
import type { SgpCandidate } from './sgp-types';
import type { WnbaData,WnbaFixture,WnbaSuggestion } from './wnba-types';
export const WNBA_MODEL_VERSION='wnba-finals-v2-compact';
export const WNBA_SLIP_POLICY={targetOdds:8,preferredLegs:8,maxLegs:10};
export function wnbaAvailability(fixture:WnbaFixture|undefined,fixtures:WnbaFixture[],data:WnbaData,asOf:string,rosterAt:string,now=Date.now()){
 if(!fixture)return 'No Finals fixtures are available.';
 if(fixture.completed||Date.parse(fixture.start)<=now)return 'This game has started or finished. Pregame SGP suggestions are closed.';
 if(fixture.unsupported||!/^scheduled$/i.test(fixture.status))return 'This fixture is not confirmed as scheduled. Update the Finals schedule before building a slip.';
 if(!Number.isFinite(Date.parse(rosterAt))||now-Date.parse(rosterAt)>=24*60*60000)return 'Roster checks are over 24 hours old. Update public data to reopen suggestions.';
 if(fixtures.some(f=>f.gameNumber<fixture.gameNumber&&f.completed&&f.day<asOf&&!data.games.some(g=>g[0]===f.id)))return 'A completed earlier Finals game is missing from the player feed. Suggestions will resume when the public statistics catch up.';
 if([fixture.home.id,fixture.away.id].some(id=>{const latest=data.games.filter(g=>g[1]<asOf&&(g[3]===id||g[4]===id)).map(g=>g[1]).sort().at(-1);return !latest||Date.parse(asOf)-Date.parse(latest)>21*86400000;}))return 'Recent team history is incomplete or over 21 days old. Update public data before using a suggestion.';
 return null;
}
export function wnbaFifty(data:WnbaData,candidates:SgpCandidate[],before:string):WnbaSuggestion{
 const correlation=correlationMatrix(data,candidates,before,'wnba'),masks=simulationMasks(candidates,correlation.L),indices:number[]=[];let hits=65536;
 // Fixed milestones enter this search unchanged. Greedy prefixes preserve the
 // greatest simulated chance at each addition; no global optimum is claimed.
 while(indices.length<candidates.length&&hits/65536>1/50){let best=-1,bestHits=-1;
  for(let i=0;i<candidates.length;i++){if(indices.includes(i)||indices.some(j=>!compatibleProps(candidates[i],candidates[j],'wnba')))continue;const n=maskHits([...indices,i],masks);if(n>bestHits&&n<hits){best=i;bestHits=n;}}
  if(best<0||bestHits<25)break;indices.push(best);hits=bestHits;
 }
 const joint=indices.length?jointSummary(indices,candidates,masks,correlation):null,targetReached=!!joint?.fairOdds&&joint.fairOdds>=50;
 return {legs:indices.map(i=>candidates[i]),joint,targetReached,reason:!indices.length?'No milestones passed the history, recent role and public availability checks.':targetReached?'50+ model fair odds reached with fixed player milestones. The builder adds the compatible prop that preserves the greatest joint chance at each step; it does not harden a line to reach 50.':'The supported player milestones cannot reach 50 model fair odds. The strongest available combination is shown; no tougher line was invented.'};
}
export function compactWnbaSlip(data:WnbaData,candidates:SgpCandidate[],before:string):WnbaSuggestion{
 const {targetOdds,preferredLegs,maxLegs}=WNBA_SLIP_POLICY,samples=65536,threshold=Math.floor(samples/targetOdds),correlation=correlationMatrix(data,candidates,before,'wnba'),masks=simulationMasks(candidates,correlation.L),words=Math.ceil(samples/32),buffers=Array.from({length:maxLegs+1},()=>new Uint32Array(words));buffers[0].fill(0xFFFFFFFF);
 let best:number[]|null=null,bestHits=0,fallback:number[]=[],fallbackHits=0;const chosen:number[]=[];
 const pop=(v:number)=>{v-=v>>>1&0x55555555;v=(v&0x33333333)+(v>>>2&0x33333333);return ((v+(v>>>4)&0x0F0F0F0F)*0x01010101)>>>24;};
 // Exhaustive compatible-subset search over the fixed supported pool. A prefix
 // already at the target cannot be improved by adding more conjunctions.
 function search(from:number,depth:number,limit:number){
  for(let i=from;i<candidates.length;i++){
   if(chosen.some(j=>!compatibleProps(candidates[i],candidates[j],'wnba')))continue;
   let hits=0;for(let w=0;w<words;w++){const bits=buffers[depth][w]&masks[i][w];buffers[depth+1][w]=bits;hits+=pop(bits);}
   chosen.push(i);const n=chosen.length;
   if(n<=preferredLegs&&(n>fallback.length||n===fallback.length&&hits>fallbackHits)){fallback=[...chosen];fallbackHits=hits;}
   if(hits>=25&&hits<=threshold){if(hits>bestHits||hits===bestHits&&n<(best?.length||Infinity)){best=[...chosen];bestHits=hits;}}
   else if(hits>threshold&&n<limit)search(i+1,depth+1,limit);
   chosen.pop();if(bestHits===threshold)return;
  }
 }
 if(candidates.length)search(0,0,preferredLegs);
 // Prefer an eight-or-fewer-leg solution. Nine or ten are considered only if
 // the fixed pool cannot meet 8+ with the preferred compact count.
 if(!best&&candidates.length>preferredLegs)search(0,0,maxLegs);
 const indices=best||fallback,joint=indices.length?jointSummary(indices,candidates,masks,correlation):null,targetReached=!!best&&!!joint?.fairOdds&&joint.fairOdds>=targetOdds;
 return {legs:indices.map(i=>candidates[i]),joint,targetReached,reason:!indices.length?'No supported player milestones passed the history, availability and role checks.':targetReached?`${indices.length} fixed player props reach 8+ model fair odds. The search preserves the highest simulated joint chance found, preferring at most eight legs and enforcing a hard ten-leg cap. No line was increased to force the return target.`:'8+ model fair odds cannot be reached with the supported milestones inside the ten-leg cap. A compact supported fallback is shown; the payout target is explicitly missed.'};
}
