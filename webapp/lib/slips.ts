import { ODDS_CACHE_MINUTES } from './refresh-policy';
import type { Option } from './types';

export const SLIP_PROFILES = [
  {id:'10',label:'10+ odds',min:10,max:Infinity,description:'At least 10.00 decimal odds'},
  {id:'20',label:'20–40 odds',min:20,max:40,description:'20.00 to 40.00 decimal odds'},
  {id:'50',label:'50–100 odds',min:50,max:100,description:'50.00 to 100.00 decimal odds'},
] as const;
export type SlipProfileId = typeof SLIP_PROFILES[number]['id'];
export type SuggestedSlip = {id:SlipProfileId;legs:Option[];decimalOdds:number|null;probability:number|null;reason:string;candidateGames:number};

export function hasCurrentQuote(option:Option,now=Date.now()) {
  const q=option.quote;
  return !!q&&Number.isFinite(q.decimal)&&q.decimal>1&&Date.parse(q.observedAt)<=now&&now-Date.parse(q.observedAt)<ODDS_CACHE_MINUTES*60000&&Date.parse(option.start)>now+300000;
}
export function selectionReason(option:Option) {
  return option.reason||`${option.label} has an estimated ${(option.probability*100).toFixed(1)}% model chance and fair decimal odds of ${option.fairOdds.toFixed(2)}. ${option.quote?'The displayed bookmaker price is '+option.quote.decimal.toFixed(2)+'.':'A complete bookmaker price is unavailable.'}`;
}

/** Prioritize the largest combined model probability inside each odds target.
 * One outcome per fixture, one selected bookmaker, no exploratory markets.
 * Branch bounds prune combinations that cannot improve the best probability.
 * The slate itself determines the number of games; there is no leg-count cap.
 */
export function buildSuggestedSlips(options:Option[],book:string,now=Date.now()):SuggestedSlip[] {
  const groups=new Map<string,Option[]>();
  for(const o of options) {
    if(!o.suggestionEligible||o.experimental||o.market!=='moneyline'||o.probability<.5||o.probability>=1||!Number.isFinite(o.probability)||o.ev===null||o.ev<=0||o.edge===null||o.edge<=0||o.quote?.book!==book||!hasCurrentQuote(o,now))continue;
    const group=groups.get(o.fixtureId)||[];if(!group.some(p=>p.id===o.id))group.push(o);groups.set(o.fixtureId,group);
  }
  const fixtures=[...groups.values()].map(rows=>rows.sort((a,b)=>b.probability-a.probability)).sort((a,b)=>b[0].probability-a[0].probability);
  const n=fixtures.length,maxLegs=n;
  // Largest achievable log odds with at most k remaining games, for pruning.
  const attainable=Array.from({length:n+1},()=>Array(maxLegs+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let k=1;k<=maxLegs;k++)attainable[i][k]=Math.max(attainable[i+1][k],Math.max(...fixtures[i].map(o=>Math.log(o.quote!.decimal)))+attainable[i+1][k-1]);
  const relaxed=fixtures.map((_,index)=>fixtures.slice(index).flat().map(o=>({odds:Math.log(o.quote!.decimal),ratio:-Math.log(o.probability)/Math.log(o.quote!.decimal)})).sort((a,b)=>a.ratio-b.ratio));
  return SLIP_PROFILES.map(profile=>{
    let best:Option[]|null=null,bestLogProbability=-Infinity,bestLogOdds=Infinity;
    const minimum=Math.log(profile.min),maximum=Math.log(profile.max),chosen:Option[]=[];
    function visit(index:number,logOdds:number,logProbability:number) {
      if(logOdds>maximum+1e-12||logProbability<bestLogProbability-1e-12)return;
      if(logOdds>=minimum-1e-12){
        // Verify products directly so a displayed rounded 10.00 never hides 9.999.
        const total=chosen.reduce((p,o)=>p*o.quote!.decimal,1);
        if(total>=profile.min&&total<=profile.max&&(logProbability>bestLogProbability+1e-12||Math.abs(logProbability-bestLogProbability)<1e-12&&logOdds<bestLogOdds)){best=[...chosen];bestLogProbability=logProbability;bestLogOdds=logOdds;}
        return;
      }
      if(index>=n||chosen.length>=maxLegs||logOdds+attainable[index][maxLegs-chosen.length]<minimum-1e-12)return;
      // Fractional relaxation: the cheapest remaining probability cost per unit
      // of log odds gives an optimistic bound, without imposing a game limit.
      let needed=minimum-logOdds,lowerCost=0;
      for(const item of relaxed[index]){const take=Math.min(needed,item.odds);lowerCost+=take*item.ratio;needed-=take;if(needed<=1e-12)break;}
      if(needed>1e-12||logProbability-lowerCost<=bestLogProbability+1e-12)return;
      for(const option of fixtures[index]){chosen.push(option);visit(index+1,logOdds+Math.log(option.quote!.decimal),logProbability+Math.log(option.probability));chosen.pop();}
      visit(index+1,logOdds,logProbability);
    }
    visit(0,0,0);
    const legs:Option[]=best||[];
    return {id:profile.id,legs,decimalOdds:legs.length?legs.reduce((p,o)=>p*o.quote!.decimal,1):null,probability:legs.length?legs.reduce((p,o)=>p*o.probability,1):null,candidateGames:n,
      reason:legs.length?'Prioritizes combined model chance within this odds target. Each game has at least a 50% model chance and positive modeled value.':!n?'No qualifying match-winner prices are available. Load a dated snapshot with Refresh odds, or choose another date.':`${n} game${n===1?'':'s'} qualify, but no supported combination reaches ${profile.label}. No weaker or stale picks were added to force the target.`};
  });
}
