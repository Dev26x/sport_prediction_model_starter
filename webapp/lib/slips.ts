import { ODDS_CACHE_MINUTES } from './refresh-policy';
import type { Option } from './types';

export const SLIP_PROFILES = [
  {id:'10',label:'10+ odds',min:10,max:Infinity,description:'At least 10.00 decimal odds'},
  {id:'20',label:'20–40 odds',min:20,max:40,description:'20.00 to 40.00 decimal odds'},
  {id:'50',label:'50–200 odds',min:50,max:200,description:'50.00 to 200.00 decimal odds'},
  {id:'jackpot',label:'Jackpot',min:500,max:Infinity,description:'Jackpot · 500.00+ decimal odds'},
] as const;
export type SlipProfileId = typeof SLIP_PROFILES[number]['id'];
export type SuggestedSlip = {id:SlipProfileId;legs:Option[];decimalOdds:number|null;probability:number|null;reason:string;candidateGames:number;targetReached:boolean};

export function hasCurrentQuote(option:Option,now=Date.now()) {
  const q=option.quote;
  return !!q&&Number.isFinite(q.decimal)&&q.decimal>1&&Date.parse(q.observedAt)<=now&&now-Date.parse(q.observedAt)<ODDS_CACHE_MINUTES*60000&&Date.parse(option.start)>now+300000;
}
export function legPrice(option:Option):number|null {
  const value=option.quote?.decimal??option.fairOdds;
  return typeof value==='number'&&Number.isFinite(value)&&value>1?value:null;
}
export function legBook(option:Option):string|null {return option.quote?.book||null;}
export function usesModelPrice(option:Option){return !option.quote;}
export function slipEstimate(legs:Option[],stake:number) {
  const prices=legs.map(legPrice),books=new Set(legs.map(legBook).filter(Boolean));
  const allPriced=legs.length>0&&prices.every(p=>p!==null),sameBook=books.size<=1;
  const total=allPriced&&sameBook?prices.reduce<number>((s,p)=>s*p!,1):null;
  const odds=total!==null&&Number.isFinite(total)?total:null;
  const potential=odds!==null&&Number.isFinite(stake)&&stake>0?odds*stake:null;
  return {allPriced,sameBook,odds,return:potential!==null&&Number.isFinite(potential)?potential:null,profit:potential!==null&&Number.isFinite(potential)?potential-stake:null};
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
    // Optimize win chance for the requested payout range. A modeled value edge
    // is displayed separately; it is not required for a probability-led slip.
    // Dated provider snapshots and clearly labeled model fair prices are research estimates.
    const q=o.quote;
    if(o.market==='doublechance'&&o.side==='home_away')continue;
    if(!o.suggestionEligible||o.experimental||!['moneyline','doublechance'].includes(o.market)||o.probability<=0||o.probability>=1||!Number.isFinite(o.probability)||!Number.isFinite(Date.parse(o.start))||Date.parse(o.start)<=now+300000)continue;
    const group=groups.get(o.fixtureId)||[];if(!group.some(p=>p.id===o.id))group.push(o);groups.set(o.fixtureId,group);
  }
  // Fix the most probable supported outcome for each game BEFORE considering
  // payout targets. A long-priced opposing outcome can never enter the search.
  const fixtures=[...groups.values()].map(rows=>[rows.sort((a,b)=>b.probability-a.probability||Number(usesModelPrice(a))-Number(usesModelPrice(b)))[0]]).filter(([o])=>legPrice(o)!==null&&(!o.quote||o.quote.book===book&&Number.isFinite(Date.parse(o.quote.observedAt))&&Date.parse(o.quote.observedAt)<=now)).sort((a,b)=>b[0].probability-a[0].probability);
  const n=fixtures.length,maxLegs=n;
  // Search to 0.01% relative win-probability tolerance, beyond input precision.
  // This bounds numerical work without limiting the number of selected games.
  const logTolerance=1e-4;
  // Largest achievable log odds with at most k remaining games, for pruning.
  const attainable=Array.from({length:n+1},()=>Array(maxLegs+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let k=1;k<=maxLegs;k++)attainable[i][k]=Math.max(attainable[i+1][k],Math.max(...fixtures[i].map(o=>Math.log(legPrice(o)!)))+attainable[i+1][k-1]);
  const relaxed=fixtures.map((_,index)=>fixtures.slice(index).flat().map(o=>({odds:Math.log(legPrice(o)!),ratio:-Math.log(o.probability)/Math.log(legPrice(o)!)})).sort((a,b)=>a.ratio-b.ratio));
  const probabilityPrefix=[0];for(const group of fixtures)probabilityPrefix.push(probabilityPrefix.at(-1)!+Math.log(group[0].probability));
  return SLIP_PROFILES.map(profile=>{
    let best:Option[]|null=null,bestLogProbability=-Infinity,bestLogOdds=Infinity;
    const minimum=Math.log(profile.min),maximum=Math.log(profile.max),chosen:Option[]=[];
    function visit(index:number,logOdds:number,logProbability:number) {
      if(logOdds>maximum+1e-12||logProbability<bestLogProbability-1e-12)return;
      if(logOdds>=minimum-1e-12){
        // Verify products directly so a displayed rounded 10.00 never hides 9.999.
        const total=chosen.reduce((p,o)=>p*legPrice(o)!,1);
        if(total>=profile.min&&total<=profile.max&&(logProbability>bestLogProbability+1e-12||Math.abs(logProbability-bestLogProbability)<1e-12&&logOdds<bestLogOdds)){best=[...chosen];bestLogProbability=logProbability;bestLogOdds=logOdds;}
        return;
      }
      if(index>=n||chosen.length>=maxLegs||logOdds+attainable[index][maxLegs-chosen.length]<minimum-1e-12)return;
      let requiredGames=1;while(requiredGames<=n-index&&logOdds+attainable[index][requiredGames]<minimum-1e-12)requiredGames++;
      if(requiredGames>n-index||logProbability+probabilityPrefix[index+requiredGames]-probabilityPrefix[index]<=bestLogProbability+logTolerance)return;
      // Fractional relaxation: the cheapest remaining probability cost per unit
      // of log odds gives an optimistic bound, without imposing a game limit.
      let needed=minimum-logOdds,lowerCost=0;
      for(const item of relaxed[index]){const take=Math.min(needed,item.odds);lowerCost+=take*item.ratio;needed-=take;if(needed<=1e-12)break;}
      if(needed>1e-12||logProbability-lowerCost<=bestLogProbability+logTolerance)return;
      for(const option of fixtures[index]){chosen.push(option);visit(index+1,logOdds+Math.log(legPrice(option)!),logProbability+Math.log(option.probability));chosen.pop();}
      visit(index+1,logOdds,logProbability);
    }
    visit(0,0,0);
    const reached=!!best;
    const legs:Option[]=best||fixtures.map(g=>g[0]);
    return {id:profile.id,legs,decimalOdds:legs.length?legs.reduce((p,o)=>p*legPrice(o)!,1):null,probability:legs.length?legs.reduce((p,o)=>p*o.probability,1):null,candidateGames:n,targetReached:reached,
      reason:legs.length?`${reached?'Target reached.':'Available strongest outcomes: target not reached.'} Each game contributes its most probable supported win or win-or-draw outcome, including win-or-draw coverage. The combination is then optimized for joint model probability. Opposing underdogs are never substituted to raise odds. ${legs.some(usesModelPrice)?'Includes model fair-odds estimates where bookmaker quotes are missing; this target and payout are indicative.':'Uses observed bookmaker prices.'}`:'No supported upcoming games are published on this date. Try another date or update the slate.'};
  });
}
