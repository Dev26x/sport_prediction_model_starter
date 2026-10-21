import { SGP_GAME_MAX_LEGS,compatibleProps } from './sgp-model';
import type { SgpPrefixSet,SgpCandidate,SgpJoint } from './sgp-types';
import type { Fixture } from './types';

// The book price is an independent input. Never derive it from model probability.
export type PricedGameOption={key:string;decimal:number;observedAt:string};
export type PricedGameGroup={key:string;fixture:Fixture;legs:SgpCandidate[];joint:SgpJoint;decimal:number;observedAt:string};
export type PricedSgpSlip={groups:PricedGameGroup[];probability:number|null;decimal:number|null;targetReached:boolean;minimum:number;maximum:number;reason:string};
export function sgpGameOptionKey(set:SgpPrefixSet,indices:number[]){return JSON.stringify([set.fixture.sport,set.fixture.id,set.modelVersion,set.generatedAt,indices.map(i=>{const c=set.candidates[i];return c?[c.id,c.side||'milestone',c.threshold]:null;})]);}
export function sgpReturnTarget(stake:number,returnGoal=80){return Number.isFinite(stake)&&stake>0&&Number.isFinite(returnGoal)&&returnGoal>stake?Math.max(1.01,returnGoal/stake):null;}
export function pricedSgpSlip(sets:SgpPrefixSet[],quotes:PricedGameOption[],minimum:number,maximum=Infinity,now=Date.now()):PricedSgpSlip{
 const empty=(reason:string):PricedSgpSlip=>({groups:[],probability:null,decimal:null,targetReached:false,minimum,maximum,reason});
 if(!Number.isFinite(minimum)||minimum<=1||Number.isNaN(maximum)||maximum<minimum)return empty('Enter a valid stake and return target.');
 const validQuotes=new Map<string,PricedGameOption>();
 for(const q of quotes){const age=now-Date.parse(q.observedAt);if(!Number.isFinite(q.decimal)||q.decimal<=1||q.decimal>100000||!Number.isFinite(age)||age<0||age>=1800000)continue;const old=validQuotes.get(q.key);if(!old||q.observedAt>old.observedAt)validQuotes.set(q.key,q);}
 const games=new Map<string,PricedGameGroup[]>();
 for(const set of sets){
  const f=set.fixture;if(!['nba','nfl'].includes(f.sport)||f.completed||f.preseason||f.unsupported||f.status!=='Scheduled'||Date.parse(f.start)<=now+300000||!Number.isFinite(Date.parse(f.start)))continue;
  const gameKey=`${f.sport}:${f.id}`,options=games.get(gameKey)||[];
  for(const row of set.prefixes){
   if(row.indices.length<2||row.indices.length>SGP_GAME_MAX_LEGS||new Set(row.indices).size!==row.indices.length||row.indices.some(i=>!Number.isInteger(i)||i<0||i>=set.candidates.length)||row.joint.unresolved||!Number.isFinite(row.joint.probability)||row.joint.probability<=0||row.joint.probability>=1)continue;
   const legs=row.indices.map(i=>set.candidates[i]);if(legs.some((c,i)=>legs.slice(0,i).some(other=>!compatibleProps(c,other,f.sport as 'nba'|'nfl'))))continue;
   const key=sgpGameOptionKey(set,row.indices),quote=validQuotes.get(key);if(!quote||options.some(o=>o.key===key))continue;
   options.push({key,fixture:f,legs,joint:row.joint,decimal:quote.decimal,observedAt:quote.observedAt});
  }
  if(options.length)games.set(gameKey,options);
 }
 if(!games.size)return empty('Research is available below. Enter current sportsbook SGP prices for the exact per-game selections to search the payout target. No probability-to-price conversion is used.');
 type State={groups:PricedGameGroup[];probability:number;decimal:number;legs:number};
 const initial:State={groups:[],probability:1,decimal:1,legs:0};let states:State[]=[initial],best:State|null=null;
 const better=(a:State,b:State)=>a.probability>b.probability||a.probability===b.probability&&a.legs<b.legs;
 // Bounded search ranks modeled probability under an independently quoted odds
 // constraint. One option per game; different-game probabilities multiply.
 for(const options of games.values()){
  const next=[...states];for(const state of states)for(const option of options){
   const decimal=state.decimal*option.decimal,probability=state.probability*option.joint.probability;if(!Number.isFinite(decimal)||decimal>maximum||!Number.isFinite(probability)||probability<=0)continue;
   const value={groups:[...state.groups,option],probability,decimal,legs:state.legs+option.legs.length};
   if(decimal>=minimum){if(!best||better(value,best))best=value;}else next.push(value);
  }
  // Keep distinct price states exactly on small slates. Bound larger searches
  // using independent price and probability rankings, not an inverse-price rule.
  const unique=new Map<string,State>();for(const state of next){const key=state.groups.map(g=>g.key).join('|'),old=unique.get(key);if(!old||better(state,old))unique.set(key,state);}
  const values=[...unique.values()];states=values.length<=4096?values:[...new Map([...values.sort((a,b)=>b.probability-a.probability).slice(0,2048),...values.sort((a,b)=>b.decimal-a.decimal).slice(0,2048)].map(s=>[s.groups.map(g=>g.key).join('|'),s])).values()];
 }
 const fallback=[...states].filter(s=>s.groups.length).sort((a,b)=>b.decimal-a.decimal||b.probability-a.probability)[0],result=best||fallback;
 if(!result)return empty('No supported priced combination fits this range. No extra or harder prop was added to force it.');
 return {groups:result.groups,probability:result.probability,decimal:result.decimal,targetReached:!!best,minimum,maximum,reason:best?'Highest modeled chance found among the priced combinations in range. Every game uses 2–10 unchanged supported props.':'Target not reached by the current priced options. The closest available combination below target is shown; additional games or actual prices may help.'};
}
