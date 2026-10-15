import { cached,fresh,putCache } from './storage';
import { localDay,addDays } from './models';
import { researchFixtures,refreshSources } from './service';
import { COMPETITIONS } from './competitions';
import { extraSeed } from './extra-data';
import { parseNews } from './nba-context';
import { playerCandidates,suggestedSgps,SGP_MODEL_VERSION,currentSgpSeason } from './sgp-model';
import { parseNflPlayers,parseSgpNbaBox,parseSgpRoster,mergePlayerUpdates,appendNbaGames } from './sgp-data';
import type { SgpDataset,SgpRosterPlayer,SgpSport,SgpAnalysis,SgpResponse,SgpPlayer } from './sgp-types';
import type { Fixture,NbaGame } from './types';
import type { NewsItem } from './nba-context';
async function baseData(sport:SgpSport):Promise<SgpDataset>{return (sport==='nba'?(await import('./sgp-nba-seed.json')).default:(await import('./sgp-nfl-seed.json')).default) as unknown as SgpDataset;}
type Updates={players:Record<string,SgpPlayer>;processed?:string[];games?:SgpDataset['games']};
async function dataset(sport:SgpSport){const base=await baseData(sport),update=await cached<Updates>(`sgp:players:${sport}`);const d=update?.value.games?{...base,games:update.value.games}:base;return {data:update?mergePlayerUpdates(d,update.value.players):d,at:update?.at||base.snapshot};}
function espnTeam(f:Fixture,team:Fixture['home']){return team.espnId||(f.sport==='nba'?team.id:extraSeed.margin.nfl.teams.find(t=>t.id===team.id)?.espn_id);}
async function json(url:string){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Public player source returned HTTP ${r.status}.`);return r.json() as Promise<any>;}
export async function refreshSgp(date:string,sport:SgpSport,fixtureId:string){
 const result=await refreshSources(date,[sport]),messages=[...result.messages],fixtures=await researchFixtures(date,sport),fixture=fixtures.find(f=>f.id===fixtureId);
 if(!fixture||fixture.completed||fixture.preseason||fixture.unsupported||Date.parse(fixture.start)<=Date.now())return {messages:[...messages,'Select an upcoming regular-season fixture for player research.']};
 let {data}=await dataset(sport);
 for(const team of [fixture.away,fixture.home]){
  const id=espnTeam(fixture,team);if(!id){messages.push(`${team.name}: public roster ID unavailable.`);continue;}
  const key=`sgp:roster:${sport}:${team.id}`,old=await cached<SgpRosterPlayer[]>(key);
  if(!fresh(old?.at,30))try{const roster=await json(`https://site.api.espn.com/apis/site/v2/sports/${COMPETITIONS[sport].path}/teams/${id}/roster`);await putCache(key,parseSgpRoster(roster,data,sport));messages.push(`${team.name}: current roster and public injury flags checked.`);}catch(e){messages.push(`${team.name}: ${(e as Error).message}`);}
  const nk=`sgp:news:${sport}:${team.id}`,news=await cached<NewsItem[]>(nk);if(!fresh(news?.at,30))try{const payload=await json(`https://site.api.espn.com/apis/site/v2/sports/${COMPETITIONS[sport].path}/news?team=${id}&limit=8`);if(!Array.isArray(payload.articles))throw new Error('News response missing articles.');await putCache(nk,parseNews(payload,id,team.name));}catch(e){messages.push(`${team.name} news: ${(e as Error).message}`);}
 }
 const key=`sgp:players:${sport}`,old=await cached<Updates>(key);
 if(sport==='nfl'&&!fresh(old?.at,60))try{
  const season=currentSgpSeason(localDay(Date.now()),sport),r=await fetch(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,{redirect:'follow',signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`NFL player file returned HTTP ${r.status}.`);const parsed=parseNflPlayers(await r.text(),data,season),previous=Object.values(old?.value.players||{}).reduce((s,p)=>s+p.logs.length,0),count=Object.values(parsed.players).reduce((s,p)=>s+p.logs.length,0);if(count<previous)throw new Error('NFL feed lost previously recorded boxes; dated snapshot retained.');await putCache(key,{players:parsed.players});messages.push(`NFL: ${count} current-season offensive player boxes checked.${parsed.rejected?` ${parsed.rejected} unmatched schedule rows omitted.`:''}`);
 }catch(e){messages.push((e as Error).message);}
 if(sport==='nba'){
  const current=await cached<NbaGame[]>('nba:current'),processed=old?.value.processed||[],known=new Set(Object.values(data.players).flatMap(p=>p.logs.map(l=>data.games[l[0]][0]))),missing=(current?.value||[]).filter(g=>g.completed&&localDay(g.start)<localDay(Date.now())&&[fixture.home.id,fixture.away.id].some(t=>t===g.home||t===g.away)&&!known.has(g.id)),batch=missing.sort((a,b)=>b.start.localeCompare(a.start)).slice(0,8);let done=0;
  let updates=old?.value.players||{};data=appendNbaGames(data,batch);
  for(const game of batch)try{const parsed=parseSgpNbaBox(await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${game.id}`),game,data.games.findIndex(g=>g[0]===game.id));updates=mergePlayerUpdates({...data,players:updates},parsed).players;processed.push(game.id);done++;}catch(e){messages.push(`NBA ${game.id}: ${(e as Error).message}`);}
  if(done)await putCache(key,{players:updates,processed,games:data.games});
  messages.push(`NBA: ${done} new regular-season boxes ingested for these teams; ${missing.length-done} remain. Preseason excluded.`);
 }
 await putCache(`sgp:health:${sport}:${fixtureId}`,messages);return {messages};
}
export async function sgpDashboard(date:string,sport:SgpSport,fixtureId:string):Promise<SgpResponse>{
 const fixtures=await researchFixtures(date,sport),f=fixtures.find(f=>f.id===fixtureId)||fixtures.find(f=>!f.completed&&!f.preseason&&!f.unsupported),health=f?await cached<string[]>(`sgp:health:${sport}:${f.id}`):null;
 if(fixtureId&&!fixtures.some(f=>f.id===fixtureId))throw new Error('Selected fixture is not on this league/date slate. Choose a published fixture.');
 if(!f){let nextDate:string|undefined;for(let i=1;i<=8;i++){const next=addDays(date,i);if(next>'2027-06-30')break;if((await researchFixtures(next,sport)).some(g=>!g.completed&&!g.preseason&&!g.unsupported)){nextDate=next;break;}}return {date,sport,fixtures,analysis:null,messages:health?.value||[],nextDate};}
 const {data,at}=await dataset(sport),today=localDay(Date.now()),before=date<today?date:today,rosters:Record<string,SgpRosterPlayer[]>={},stamps:string[]=[],news:NewsItem[]=[];
 for(const team of [f.home,f.away]){const r=await cached<SgpRosterPlayer[]>(`sgp:roster:${sport}:${team.id}`);rosters[team.id]=r?.value||data.rosters[team.id]||[];stamps.push(r?.at||data.snapshot);const n=await cached<NewsItem[]>(`sgp:news:${sport}:${team.id}`);news.push(...n?.value||[]);}
 const rosterAt=stamps.sort()[0]||null,cacheKey=`sgp:analysis:${SGP_MODEL_VERSION}:${sport}:${date}:${f.id}`,old=await cached<{inputs:string;analysis:SgpAnalysis}>(cacheKey),inputs=JSON.stringify([at,stamps,f.start,f.status,f.completed]);
 if(old&&old.value.inputs===inputs&&fresh(old.at,30)&&Date.parse(f.start)>Date.now())return {date,sport,fixtures,analysis:old.value.analysis,messages:health?.value||[]};
 const unavailable=f.completed||f.preseason||f.unsupported||Date.parse(f.start)<=Date.now()||date<today;
 const evaluated=unavailable?{candidates:[],excluded:[]}:playerCandidates(data,f,before,rosters),notes=[
  'Experimental player-prop research model. Probabilities are conditional on participation and projected role; they are not calibrated win rates.',
  'Four completed regular seasons plus available current-season boxes. One-year recency half-life; same-day/future boxes and all preseason results excluded.',
  'Milestones are fixed at the weighted lower quartile, rounded down, before either target is considered. Candidates require 68–95% marginal probability, sufficient history and no unresolved public injury flag.',
  'Same-game joint chance uses 65,536 deterministic Gaussian-copula simulations. Tied rank correlations come from earlier shared games with the same teammate/opponent relationship, shrunk with 30 prior games. Pairs with fewer than 12 shared games use zero correlation; the coverage count shows this limitation. Matrix shrinkage ensures a valid joint model.',
  'Displayed range measures Monte Carlo sampling error only. Roster changes, sparse correlations, lineup risk and model misspecification can cause much larger error.',
  'Prices are MODEL FAIR ODDS = 1 / joint probability. Your current odds plan has no player-prop or bookmaker SGP quotes. The target uses this modeled price, not an available bookmaker payout. No paid API request is made here.',
  'Search adds the supported milestone that preserves the highest joint probability at each step. This greedy search is not guaranteed to find the globally best combination. No harder milestone is substituted to force a target.',
  ...(unavailable?['This fixture is completed, underway, preseason, historical or unsupported. Suggested SGPs are disabled.']:[]),
 ];
 const earlier=Object.values(data.players).flatMap(p=>p.logs).filter(r=>data.games[r[0]][1]<before),relevant=earlier.filter(r=>data.games[r[0]][2]===currentSgpSeason(before,sport));
 const analysis:SgpAnalysis={fixture:f,asOf:before,...evaluated,suggestions:unavailable?[]:suggestedSgps(data,evaluated.candidates,before,sport),excluded:evaluated.excluded,rosterAt,historyAt:at,lastResult:earlier.map(r=>data.games[r[0]][1]).sort().at(-1)||null,currentGames:new Set(relevant.map(r=>r[0])).size,news:news.filter((n,i,a)=>a.findIndex(o=>o.url===n.url)===i).slice(0,12).map(n=>({title:n.title,url:n.url,publishedAt:n.publishedAt})),notes,generatedAt:new Date().toISOString(),modelVersion:SGP_MODEL_VERSION};
 await putCache(cacheKey,{inputs,analysis});return {date,sport,fixtures,analysis,messages:health?.value||[]};
}
