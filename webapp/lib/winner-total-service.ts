import {specialistBoard,refreshSpecialist} from './specialist-service';
import {footballMarketBoard} from './football-market-service';
import {refreshSources} from './service';
import {cached,putCache,fresh} from './storage';
import {winnerTotalFixture,WINNER_TOTAL_SPORTS,type WinnerTotalSport} from './winner-total-model';
import type {SpecialistBoard,ResearchFixture} from './specialist-types';
export async function winnerTotalBoard(date:string,sport:WinnerTotalSport,line?:number):Promise<SpecialistBoard>{
 if(sport==='nba'||sport==='ucl'){const board=await specialistBoard(sport==='nba'?'nba-team-totals':'ucl',date);return {...board,kind:'win-totals',fixtures:board.fixtures.map(f=>winnerTotalFixture(f,sport,line))};}
 const source=await footballMarketBoard(date,sport,8.5);
 const fixtures=source.fixtures.map(f=>{const base:ResearchFixture={id:f.fixture.id,start:f.fixture.start,home:f.fixture.home.name,away:f.fixture.away.name,status:f.fixture.status,completed:f.fixture.completed,summary:f.expectedGoals?`Projected goals: ${f.fixture.home.name} ${f.expectedGoals[0].toFixed(2)} · ${f.fixture.away.name} ${f.expectedGoals[1].toFixed(2)}`:'Insufficient earlier goal-scoring history.',picks:f.options.filter(p=>p.market==='btts').map(p=>({id:p.id,fixtureId:f.fixture.id,matchup:p.matchup,label:p.label,probability:p.probability,reason:p.reason||''})),combinations:[],analysis:[...f.notes,...f.options.filter(p=>p.market==='btts').slice(0,1).map(p=>p.reason||'')],form:[f.home,f.away].map(t=>({team:t.name,rows:t.lastFive.map(g=>({day:g.day,opponent:g.opponent,score:`${g.goalsFor}–${g.goalsAgainst}`,competition:WINNER_TOTAL_SPORTS[sport]}))})),...(f.expectedGoals?{scoreDistribution:{kind:'poisson' as const,homeMean:f.expectedGoals[0],awayMean:f.expectedGoals[1]}}:{})};return winnerTotalFixture(base,sport,line);});
 return {kind:'win-totals',date,at:source.generatedAt,fixtures,messages:[...source.messages,'Domestic football uses the existing recency-weighted, venue-specific goals model with prior-season and current-season results. Lineups and live sportsbook quotes are not incorporated.'],sources:source.sources.map(s=>({label:`${WINNER_TOTAL_SPORTS[sport]} match results`,url:s.url,at:s.at}))};
}
export async function refreshWinnerTotals(date:string,sport:WinnerTotalSport){
 if(sport==='nba'||sport==='ucl')return refreshSpecialist(sport==='nba'?'nba-team-totals':'ucl',date);
 const key=`specialist:refresh:win-totals:${sport}:${date}`,old=await cached(key);if(fresh(old?.at,30))return {messages:['Public sources checked within 30 minutes. Using the cached snapshot; no additional provider calls.']};
 const result=await refreshSources(date,[sport]);await putCache(key,true);return result;
}
