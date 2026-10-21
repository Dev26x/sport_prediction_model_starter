import { compatibleProps,correlationMatrix,simulationMasks,maskHits,jointSummary,SGP_GAME_MAX_LEGS } from './sgp-model';
import { fanDuelSelectionKey } from './fanduel-quotes';
import type { FanDuelGroup,FanDuelScope,FanDuelSuggestion } from './fanduel-types';

export function fanDuelSuggestions(input:FanDuelGroup[],scope:FanDuelScope='single'):FanDuelSuggestion[]{
 // Choose the most probable supplied outcome per player/stat BEFORE considering
 // either target. An alternate cannot be toughened solely to reach an odds band.
 const groups=input.map(group=>{const best=new Map<string,typeof group.candidates[number]>();for(const c of group.candidates){const key=`${c.playerId}:${c.metric}`,old=best.get(key);if(!old||c.probability>old.probability||c.probability===old.probability&&(c.quote?.decimalOdds||0)>(old.quote?.decimalOdds||0))best.set(key,c);}const candidates=[...best.values()].sort((a,b)=>b.probability-a.probability||a.id.localeCompare(b.id)),correlation=correlationMatrix(group.data,candidates,group.before,group.fixture.sport);return {...group,candidates,correlation,masks:simulationMasks(candidates,correlation.L),counts:new Map<string,number>()};});
 const flat=groups.flatMap((g,group)=>g.candidates.map((candidate,index)=>({group,index,candidate})));
 return (['compact','50'] as const).map(id=>{
  const target=id==='compact'?8:50,minimum=id==='compact'?.68:.55,ceiling=id==='compact'?Infinity:60;
  type State={indices:number[];groupHits:number[];probability:number};let states:State[]=[{indices:[],groupHits:groups.map(()=>65536),probability:1}],best:State|null=null,fallback:State|null=null;
  const maxDepth=scope==='combined'?Math.min(flat.length,groups.length*SGP_GAME_MAX_LEGS):Math.min(flat.length,SGP_GAME_MAX_LEGS);
  for(let depth=1;depth<=maxDepth;depth++){
   const next=new Map<string,State>();
   for(const state of states)for(let i=0;i<flat.length;i++){
    const item=flat[i],group=groups[item.group];if(item.candidate.probability<minimum||state.indices.includes(i)||state.indices.some(j=>flat[j].group===item.group&&!compatibleProps(item.candidate,flat[j].candidate,group.fixture.sport)))continue;
    const indices=[...state.indices,i].sort((a,b)=>a-b),key=indices.join(',');if(next.has(key))continue;
    const local=indices.filter(j=>flat[j].group===item.group).map(j=>flat[j].index).sort((a,b)=>a-b);if(local.length>SGP_GAME_MAX_LEGS)continue;const localKey=local.join(',');let hits=group.counts.get(localKey);if(hits===undefined){hits=maskHits(local,group.masks);group.counts.set(localKey,hits);}if(hits<25)continue;
    const probability=state.probability*hits/state.groupHits[item.group];if(probability<1/ceiling)continue;const groupHits=[...state.groupHits];groupHits[item.group]=hits;const value={indices,groupHits,probability};
    if(probability<=1/target){if(!best||probability>best.probability||probability===best.probability&&depth<best.indices.length)best=value;}else next.set(key,value);
    if(depth<=8&&(!fallback||depth>fallback.indices.length||depth===fallback.indices.length&&probability>fallback.probability))fallback=value;
   }
   if(best&&depth===8)break;
   const sorted=[...next.values()].sort((a,b)=>b.probability-a.probability||a.indices.join(',').localeCompare(b.indices.join(','))),near=[...sorted].reverse();states=[...new Map([...sorted.slice(0,16),...near.slice(0,16)].map(s=>[s.indices.join(','),s])).values()];if(!states.length)break;
  }
  const result=best||fallback,legs=result?.indices.map(i=>{const {group,candidate}=flat[i],f=groups[group].fixture;return {...candidate,sport:f.sport,fixtureId:f.id,matchup:`${f.away.name} at ${f.home.name}`};})||[];
  let measuredPairs=0,totalPairs=0;const gameGroups:FanDuelSuggestion['groups']=[];
  if(result)for(let g=0;g<groups.length;g++){const local=result.indices.filter(i=>flat[i].group===g).map(i=>flat[i].index);if(!local.length)continue;const summary=jointSummary(local,groups[g].candidates,groups[g].masks,groups[g].correlation),fixture=groups[g].fixture;measuredPairs+=summary.measuredPairs;totalPairs+=summary.totalPairs;gameGroups.push({fixtureId:fixture.id,sport:fixture.sport,matchup:`${fixture.away.name} at ${fixture.home.name}`,probability:summary.probability,fairOdds:summary.fairOdds,legs:local.length});}
  const policy=scope==='combined'?` Every selected game uses no more than ${SGP_GAME_MAX_LEGS} props; fewer props are valid.`:` The single-game suggestion uses no more than ${SGP_GAME_MAX_LEGS} props.`;
  return {id,legs,groups:gameGroups,probability:result?.probability??null,fairOdds:result?1/result.probability:null,modelTargetReached:!!best,selectionKey:fanDuelSelectionKey(legs),measuredPairs,totalPairs,reason:best?`${legs.length} unchanged, supplied lines reach the ${id==='compact'?'8+':'50–60'} model-fair target.${policy} The bounded search ranks joint model chance; it is not a proven global optimum. FanDuel’s combined price must be entered separately.`:`The ${id==='compact'?'8+':'50–60'} model-fair target is unavailable within the supported supplied lines.${policy} A research fallback is shown. No alternate line was made harder to force the target; FanDuel’s actual price remains separate.`};
 });
}
