import raw from './football-markets-seed.json';
import { cached,fresh } from './storage';
import { researchFixtures } from './service';
import { localDay } from './models';
import { plName } from './markets';
import { mergeFootballMarketGames } from './football-market-data';
import { footballMarketForecast,footballMarketHistory,FOOTBALL_MARKET_VERSION } from './football-market-model';
import type { FootballSport,FootballMarketGame,FootballMarketBoard } from './football-market-types';
const seed=raw as {snapshot:string;leagues:Record<FootballSport,{games:FootballMarketGame[]}>};
export const FOOTBALL_LEAGUES:FootballSport[]=['epl','laliga','seriea'];
const codes={epl:'E0',laliga:'SP1',seriea:'I1'};
export async function footballMarketBoard(date:string,league:string,line:number):Promise<FootballMarketBoard>{
 const today=localDay(Date.now()),asOf=date<today?date:today,sports=league==='football'?FOOTBALL_LEAGUES:[league as FootballSport],fixtures:FootballMarketBoard['fixtures']=[],sources:FootballMarketBoard['sources']=[],messages:string[]=[],needsRefresh:FootballSport[]=[];
 for(const sport of sports){
  const base=seed.leagues[sport].games.map(g=>({...g,home:plName(g.home),away:plName(g.away)})),current=await cached<FootballMarketGame[]>(`${sport}:market-current`),games=mergeFootballMarketGames(base,current?.value||[]),slate=await researchFixtures(date,sport),stamp=await cached(`fixtures:${sport}:${date}`),history=footballMarketHistory(games,asOf);
  for(const fixture of slate)fixtures.push(footballMarketForecast(games,fixture,asOf,line));
  if(!fresh(stamp?.at,15)||!fresh(current?.at,60))needsRefresh.push(sport);
  const health=await cached<string[]>(`health:sources:${sport}:${date}`);messages.push(...health?.value||[]);
  sources.push({sport,at:current?.at||seed.snapshot,lastResult:history.at(-1)?.day||null,games:history.length,corners:history.filter(g=>g.hc!==null&&g.ac!==null).length,url:`https://www.football-data.co.uk/mmz4281/2627/${codes[sport]}.csv`});
 }
 return {date,today,line,league,fixtures:fixtures.sort((a,b)=>a.fixture.start.localeCompare(b.fixture.start)),needsRefresh,sources,messages:[...new Set(messages)],generatedAt:new Date().toISOString(),modelVersion:FOOTBALL_MARKET_VERSION};
}
