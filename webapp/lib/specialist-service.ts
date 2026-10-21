import rawNba from './seed.json';
import rawUcl from './ucl-seed.json';
import {cached,putCache,fresh} from './storage';
import {researchFixtures,refreshSources} from './service';
import {localDay,addDays} from './models';
import {nbaTeamTotals} from './nba-team-totals-model';
import {uclForecast} from './ucl-model';
import type {NbaGame} from './types';
import type {SpecialistKind,SpecialistBoard,ResearchGame,LeagueTable} from './specialist-types';
const ESPN='https://site.api.espn.com/apis/site/v2/sports/';
const seed=rawUcl as {at:string;date:string;tables:LeagueTable[];fixtures:ResearchGame[];results:ResearchGame[]};
export function parseResearchGames(j:any,league:string):ResearchGame[]{return (j.events||[]).flatMap((e:any)=>{const c=e.competitions?.[0],h=c?.competitors?.find((t:any)=>t.homeAway==='home'),a=c?.competitors?.find((t:any)=>t.homeAway==='away');if(!h?.team?.id||!a?.team?.id||!Number.isFinite(Date.parse(e.date)))return [];const score=(t:any)=>Number(typeof t.score==='object'?t.score.value:t.score),status=c.status?.type||e.status?.type||{};if(status.completed&&(!Number.isInteger(score(h))||!Number.isInteger(score(a))||score(h)<0||score(a)<0))return [];return [{id:String(e.id),start:e.date,home:{id:String(h.team.id),name:h.team.displayName},away:{id:String(a.team.id),name:a.team.displayName},completed:!!status.completed,status:status.description||'Scheduled',hp:score(h),ap:score(a),league}];});}
async function json(url:string){const r=await fetch(url,{headers:{Accept:'application/json'},redirect:'follow',signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error(`Public statistics source returned HTTP ${r.status}.`);const j=await r.json() as any;if(j.code>=400||!Array.isArray(j.events))throw Error('The statistics provider did not return a match list.');return j;}
export async function specialistBoard(kind:Exclude<SpecialistKind,'win-totals'>,date:string):Promise<SpecialistBoard>{
 const board:SpecialistBoard={kind,date,at:new Date().toISOString(),fixtures:[],messages:[],sources:[]};
 if(kind==='nba-team-totals'){
  const current=await cached<NbaGame[]>('nba:current'),snapshot=rawNba as unknown as {nbaGames:NbaGame[];snapshot:string;teams:{id:string;name:string}[]},games=[...new Map([...snapshot.nbaGames,...(current?.value||[])].map(g=>[g.id,g])).values()],fixtures=await researchFixtures(date,'nba');
  board.fixtures=fixtures.filter(f=>!f.preseason&&!f.unsupported).map(f=>nbaTeamTotals(games,f,date,Object.fromEntries(snapshot.teams.map(t=>[t.id,t.name]))));board.sources=[{label:'ESPN NBA regular-season results',url:'https://www.espn.com/nba/scoreboard',at:current?.at||snapshot.snapshot}];board.messages.push('Team totals include overtime. Alternative thresholds and prices are model estimates; no sportsbook odds API is called.');
 }else{
  const entry=await cached<{fixtures:ResearchGame[];results:ResearchGame[];tables:LeagueTable[];messages:string[];unavailable?:string[]}>(`specialist:ucl:${date}`),value=entry?.value||{fixtures:date===seed.date?seed.fixtures:[],results:seed.results,tables:seed.tables,messages:[]};
  board.fixtures=value.fixtures.filter(f=>localDay(f.start)===date).map(f=>{const result=uclForecast(f,[...new Map([...seed.results,...value.results].map(g=>[g.id,g])).values()],value.tables,date);if(entry?.value.unavailable?.some(id=>id===f.home.id||id===f.away.id)){result.picks=[];result.combinations=[];result.analysis.unshift("Latest source check was incomplete. Predictions excluded until a successful update.");}return result;});board.messages.push(...value.messages,'Only completed results from before the selected Toronto date are used. No paid API or bookmaker calls.');board.sources=[{label:'ESPN UCL fixtures and match results',url:`https://www.espn.com/soccer/scoreboard/_/league/uefa.champions/date/${date.replaceAll('-','')}`,at:entry?.at||seed.at},{label:'Domestic league-wide baseline snapshot (ESPN)',url:'https://www.espn.com/soccer/',at:seed.at},{label:'Participating-team domestic/UCL updates (ESPN)',url:'https://www.espn.com/soccer/',at:entry?.at||seed.at},{label:'UEFA official fixtures',url:'https://www.uefa.com/uefachampionsleague/fixtures-results/',at:''}];
 }
 return board;
}
export async function refreshSpecialist(kind:Exclude<SpecialistKind,'win-totals'>,date:string){
 const key=`specialist:refresh:${kind}:${date}`,last=await cached(key);if(fresh(last?.at,30))return {messages:['Data already checked within 30 minutes. Reusing that snapshot; no additional provider calls.']};
 if(kind==='nba-team-totals'){
  const result=await refreshSources(date,['nba'],true);await putCache(key,true);return result;
 }
 const data=await json(`${ESPN}soccer/uefa.champions/scoreboard?dates=${date.replaceAll('-','')}&limit=100`),fixtures=parseResearchGames(data,'uefa.champions').filter(f=>localDay(f.start)===date),season=Number(date.slice(0,4))-(Number(date.slice(5,7))<7?1:0),old=await cached<{results:ResearchGame[];tables:LeagueTable[]}>(`specialist:ucl:${date}`),tables=old?.value.tables||seed.tables,results=new Map([...seed.results,...(old?.value.results||[])].map(g=>[g.id,g])),messages:string[]=[];
 const ids=[...new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))];
 // Four in-flight public requests at a time. At most two schedules per participating team.
 let index=0;const unavailable=new Set<string>();await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(index<ids.length){const id=ids[index++],league=tables.find(l=>l.teams.some(t=>t.id===id))?.league;if(!league){unavailable.add(id);messages.push(`${fixtures.flatMap(f=>[f.home,f.away]).find(t=>t.id===id)?.name}: domestic league feed unavailable; fixture excluded from suggestions.`);continue;}try{const merged:ResearchGame[]=[];for(const l of [league,'uefa.champions']){const j=await json(`${ESPN}soccer/${l}/teams/${id}/schedule?season=${season}`);if(Number(j.season?.year)!==season)throw Error('Provider returned a different season.');merged.push(...parseResearchGames(j,l));}for(const g of merged)if(g.completed)results.set(g.id,g);}catch(e){unavailable.add(id);messages.push(`Team ${id}: ${(e as Error).message} Previous records remain visible; fixture excluded from suggestions until a successful check.`);}}}));
 if(fixtures.length){const recent=await Promise.allSettled(Array.from({length:7},(_,i)=>addDays(date,-i-1)).map(async day=>parseResearchGames(await json(`${ESPN}soccer/uefa.champions/scoreboard?dates=${day.replaceAll('-','')}&limit=100`),'uefa.champions')));for(const result of recent)if(result.status==='fulfilled'){for(const g of result.value)if(g.completed)results.set(g.id,g);}else messages.push('A recent UCL result check failed; previous European results retained.');}
 const state={fixtures,results:[...results.values()],tables,messages,unavailable:[...unavailable]};await putCache(`specialist:ucl:${date}`,state);await putCache(key,true);return {messages:messages.length?messages:[`${fixtures.length} UCL fixtures checked; current-season domestic and European results updated.`]};
}
