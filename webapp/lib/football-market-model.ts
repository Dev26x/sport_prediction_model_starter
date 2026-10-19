import { days,localDay,plPrediction } from './models';
import { plName } from './markets';
import { buildSuggestedSlips } from './slips';
import type { Fixture,Option } from './types';
import type { FootballMarketGame,FootballMarketFixture,FootballMarket,TeamMarketForm } from './football-market-types';
export const FOOTBALL_MARKET_VERSION='football-markets-v1';
export const CORNER_LINES=[6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5] as const;
export function footballSeason(day:string){return Number(day.slice(0,4))+(Number(day.slice(5,7))>=7?1:0);}
export function footballMarketHistory(games:FootballMarketGame[],before:string){const season=footballSeason(before);return games.filter(g=>g.day<before&&g.season>=season-4&&g.season<=season&&Number.isInteger(g.hp)&&Number.isInteger(g.ap)&&g.hp>=0&&g.ap>=0).sort((a,b)=>a.day.localeCompare(b.day));}
/** Negative-binomial count CDF; a Poisson limit handles non-overdispersed data. */
export function cornerUnderProbability(mean:number,dispersion:number|null,line:number){
 if(!Number.isFinite(mean)||mean<=0||!Number.isFinite(line)||line<0||dispersion!==null&&(!Number.isFinite(dispersion)||dispersion<=0))throw new Error('Invalid corner distribution parameters.');
 const k=dispersion,poisson=k===null||k>1e5;
 let mass=poisson?Math.exp(-mean):Math.exp(k*Math.log(k/(k+mean))),sum=mass;
 for(let i=1;i<=Math.floor(line);i++){mass*=poisson?mean/i:(i-1+k!)/i*mean/(k!+mean);sum+=mass;}
 return Math.max(0,Math.min(1,sum));
}
export function fitCornerForecast(history:FootballMarketGame[],home:string,away:string,before:string){
 const rows=history.filter(g=>g.day<before&&Number.isInteger(g.hc)&&Number.isInteger(g.ac)&&g.hc!>=0&&g.ac!>=0).map(g=>({...g,w:2**(-days(before,g.day)/180)}));
 const hn=rows.filter(g=>g.home===home||g.away===home).length,an=rows.filter(g=>g.home===away||g.away===away).length,hv=rows.filter(g=>g.home===home).length,av=rows.filter(g=>g.away===away).length;
 if(rows.length<200||Math.min(hn,an)<12||Math.min(hv,av)<5)return null;
 const weight=rows.reduce((s,g)=>s+g.w,0),lh=rows.reduce((s,g)=>s+g.w*g.hc!,0)/weight,la=rows.reduce((s,g)=>s+g.w*g.ac!,0)/weight;
 if(lh<=0||la<=0)return null;
 const strength=(team:string,side:'home'|'away',key:'hc'|'ac',base:number)=>{const r=rows.filter(g=>g[side]===team);return (r.reduce((s,g)=>s+g.w*g[key]!,0)+12*base)/(r.reduce((s,g)=>s+g.w,0)+12)/base;};
 const eh=lh*strength(home,'home','hc',lh)*strength(away,'away','hc',lh),ea=la*strength(away,'away','ac',la)*strength(home,'home','ac',la),mean=lh+la;
 const variance=rows.reduce((s,g)=>s+g.w*((g.hc!+g.ac!)-mean)**2,0)/weight,dispersion=variance>mean?Math.max(2,mean*mean/(variance-mean)):null;
 return {home:eh,away:ea,total:eh+ea,dispersion,history:rows.length,lastResult:rows.at(-1)!.day};
}
function teamForm(history:FootballMarketGame[],name:string,before:string):TeamMarketForm{
 const rows=history.filter(g=>g.home===name||g.away===name),season=footballSeason(before);
 return {name,games:rows.length,currentGames:rows.filter(g=>g.season===season).length,cornerGames:rows.filter(g=>g.hc!==null&&g.ac!==null).length,lastFive:rows.slice(-5).reverse().map(g=>{const h=g.home===name;return {day:g.day,opponent:h?g.away:g.home,home:h,goalsFor:h?g.hp:g.ap,goalsAgainst:h?g.ap:g.hp,cornersFor:h?g.hc:g.ac,cornersAgainst:h?g.ac:g.hc};})};
}
export function footballMarketForecast(games:FootballMarketGame[],fixture:Fixture,before:string,line:number,now=Date.now()):FootballMarketFixture{
 if(!['epl','laliga','seriea'].includes(fixture.sport)||!(CORNER_LINES as readonly number[]).includes(line))throw new Error('Unsupported football league or corner line.');
 const history=footballMarketHistory(games,before),home=plName(fixture.home.name),away=plName(fixture.away.name),h=teamForm(history,home,before),a=teamForm(history,away,before),notes:string[]=[];
 const playable=fixture.day>=localDay(now)&&!fixture.completed&&!fixture.preseason&&!fixture.unsupported&&fixture.status==='Scheduled'&&Date.parse(fixture.start)>now+300000;
 const corners=fitCornerForecast(history,home,away,before),goal=history.length>=200&&Math.min(h.games,a.games)>=8?plPrediction(history,home,away,before):null;
 if(!corners)notes.push(`Corners need 200 league matches, 12 earlier corner records per club and 5 in each relevant venue. Available: ${h.cornerGames} / ${a.cornerGames} team corner records.`);
 if(!goal)notes.push('BTTS needs 200 earlier league results and 8 per club; no unsupported probability is invented.');
 if(!playable)notes.push('This fixture is historical, started, postponed, completed or unsupported; it cannot enter a suggested slip.');
 const options:Option[]=[];
 function add(market:FootballMarket,side:string,label:string,p:number,reason:string){if(!Number.isFinite(p)||p<=0||p>=1)return;options.push({id:`${fixture.sport}:${fixture.id}:${market}:${market==='corners'?line+':':''}${side}`,fixtureId:fixture.id,sport:fixture.sport,matchup:`${fixture.away.name} at ${fixture.home.name}`,start:fixture.start,label,market,side,line:market==='corners'?line:undefined,probability:p,fairOdds:1/p,quote:null,edge:null,ev:null,eligible:false,suggestionEligible:playable,experimental:true,reason, cautions:['Experimental model probability; this market has no connected bookmaker quote.','Full-time league play only. Separate fixtures are multiplied under an independence assumption; same-game markets are not combined.']});}
 if(corners){const under=cornerUnderProbability(corners.total,corners.dispersion,line),reason=`Recency-weighted, venue-specific corners for and conceded project ${home} ${corners.home.toFixed(2)} + ${away} ${corners.away.toFixed(2)} = ${corners.total.toFixed(2)} total corners. A ${corners.dispersion===null?'Poisson':'negative-binomial'} count distribution uses league-level variance from ${corners.history} earlier matches. The ${line} line is fixed before choosing an odds range.`;add('corners','over',`Over ${line} total corners`,1-under,reason);add('corners','under',`Under ${line} total corners`,under,reason);}
 if(goal){const reason=`The existing venue-specific goal model projects ${home} ${goal.expectedGoals[0].toFixed(2)} and ${away} ${goal.expectedGoals[1].toFixed(2)} goals from ${goal.history} earlier results, with 180-day recency weighting and league-prior shrinkage. BTTS Yes = (1 − exp(−home goals)) × (1 − exp(−away goals)); No is its complement. Confirmed lineups are not modeled.`;const yes=(1-Math.exp(-goal.expectedGoals[0]))*(1-Math.exp(-goal.expectedGoals[1]));add('btts','yes','Both teams to score · Yes',yes,reason);add('btts','no','Both teams to score · No',1-yes,reason);}
 return {fixture,asOf:before,home:h,away:a,expectedGoals:goal?.expectedGoals||null,corners,options,notes};
}
export function footballMarketSlips(options:Option[],kind:FootballMarket,now=Date.now(),side='best'){
 if(!['corners','btts'].includes(kind))throw new Error('Unsupported football slip market.');
 const pool=options.filter(o=>o.market===kind&&(side==='best'||o.side===side));
 return buildSuggestedSlips(pool,'23',now,{markets:[kind],allowExperimental:true}).map(s=>({...s,reason:!s.legs.length?'No supported upcoming selections in this pool. Update football data or try another date.':`${s.targetReached?'Target reached.':'Target not reached; strongest available outcomes shown.'} Each fixture contributes its most probable supported ${kind==='corners'?'over/under at the selected fixed corner line':'BTTS outcome'}${side==='best'?'':` within the ${side} filter`}. The combination maximizes joint model chance to the existing search tolerance, with one leg per fixture and no game-count cap. Lines never change to force a target. Uses model fair prices; actual bookmaker odds and payouts can differ.`}));
}
