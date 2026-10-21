import { env } from 'cloudflare:workers';
import rawSeed from './seed.json';
import { teamResults, formSentence } from './form';
import previousRosters from './nba-previous-rosters.json';
import { parseNews, parseInjuries, rotationProjection, rosterForecast, officialReportFromHtml, type NewsItem, type InjuryItem, type NbaContext } from './nba-context';
import { cached, putCache, fresh } from './storage';
import { localDay, addDays, fitNba, nbaPrediction, normalCdf, plPrediction, MARGIN_SETTINGS } from './models';
import { normalizeQuotes, plName } from './markets';
import { ODDS_CACHE_MINUTES, providerOffsetMinutes } from './refresh-policy';
import { COMPETITIONS, SPORTS, selectedSports, isFootball, canonicalAbbr } from './competitions';
import { extraSeed, extraTeam, extraSnapshot, refreshExtraResults } from './extra-data';
import type { DashboardData, Fixture, MatchCard, NbaGame, PlGame, RosterPlayer, Sport, Option, Quote } from './types';
import { parseFootballMarketCsv,mergeFootballMarketGames } from './football-market-data';
import type { FootballSport,FootballMarketGame } from './football-market-types';

type PlayerPrior={name:string;minutes:number;mpg:number;features:Record<string,number>;impact:number};
type Seed={snapshot:string;nbaGames:NbaGame[];nbaSchedule:NbaGame[];teams:{id:string;abbr:string;name:string}[];plGames:PlGame[];scale:number;translation:Record<string,number>;previousRoster:Record<string,number>;players:Record<string,PlayerPrior>;rosters:Record<string,RosterPlayer[]>;fixtures:Record<string,any>};
const seed=rawSeed as unknown as Seed;
const ESPN='https://site.api.espn.com/apis/site/v2/sports/';
const PATH=Object.fromEntries(SPORTS.map(s=>[s,COMPETITIONS[s].path])) as Record<Sport,string>;
export const BOOKS:Record<string,string>={'23':'FanDuel','19':'DraftKings','3':'Pinnacle'};
export function validateInput(date:string,sport:string,book:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00Z').toISOString().slice(0,10)!==date||date<'2025-10-01'||date>'2027-06-30')throw new Error('Choose a date between October 2025 and June 2027.');
  if(!['all','football',...SPORTS].includes(sport)||!BOOKS[book])throw new Error('Invalid league or bookmaker.');
}
async function fetchJson(url:string,headers?:Record<string,string>) {
  // Workers supports manual/follow only. Never forward the API key across redirects.
  const response=await fetch(url,{headers:{Accept:'application/json',...headers},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(response.status===401||response.status===403?'Provider access was denied. Check the API plan/key.':response.status===429?'Provider rate limit reached. Wait before refreshing.':`Data provider returned HTTP ${response.status}.`);
  return {data:await response.json() as any,headers:response.headers};
}
async function pool<T,R>(items:T[],fn:(item:T)=>Promise<R>,concurrency=5):Promise<PromiseSettledResult<R>[]> {
  const results:PromiseSettledResult<R>[] = Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)}, async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = {status:'fulfilled',value:await fn(items[i])}; }
      catch (reason) { results[i] = {status:'rejected',reason}; }
    }
  }));
  return results;
}
export function parseEvents(payload:any,sport:Sport):Fixture[] {
  const out:Fixture[]=[];
  for(const e of payload.events||[]) {
    const c=e.competitions?.[0],home=c?.competitors?.find((t:any)=>t.homeAway==='home'),away=c?.competitors?.find((t:any)=>t.homeAway==='away');
    if(!c||!home||!away||!Number.isFinite(Date.parse(e.date)))continue;
    const status=c.status?.type||e.status?.type||{},season=e.season||payload.season||{};
    const team=(t:any)=>{const known=extraTeam(sport,t.team.abbreviation);return {id:known?.id||String(t.team.id),espnId:String(t.team.id),name:isFootball(sport)?plName(t.team.shortDisplayName||t.team.displayName):(t.team.displayName||known?.name),abbr:canonicalAbbr(sport,t.team.abbreviation)};};
    const score=(t:any)=>Number(typeof t.score==='object'?t.score.value:t.score);
    const preseason=!isFootball(sport)&&(Number(season.type)===1||season.slug==='preseason');
    const unsupported=!isFootball(sport)&&(![1,2].includes(Number(season.type))||sport==='nba'&&c.type?.abbreviation==='CC');
    out.push({id:String(e.id),sport,start:e.date,day:localDay(e.date),home:team(home),away:team(away),status:status.description||'Unconfirmed',completed:!!status.completed,
      hp:status.completed?score(home):undefined,ap:status.completed?score(away):undefined,neutral:!!c.neutralSite,preseason,unsupported});
  }
  return out;
}
async function fixtureList(date:string,sport:Sport):Promise<{value:Fixture[];at:string|null}> {
  const entry=await cached<Fixture[]>(`fixtures:${sport}:${date}`);
  if(entry)return {...entry,value:entry.value.map(f=>({...f,home:canonicalFixtureTeam(f.home,sport),away:canonicalFixtureTeam(f.away,sport)}))};
  const publicSnapshot=seed.fixtures[`${sport}:${date}`];
  if(publicSnapshot)return {value:parseEvents(publicSnapshot,sport).filter(f=>f.day===date),at:seed.snapshot};
  if(isFootball(sport))return {value:[] as Fixture[],at:null};
  if(sport==='nfl'||sport==='nhl') {const state=extraSeed.margin[sport];return {value:state.games.filter(g=>localDay(g.start)===date).map(g=>({id:g.id,sport,start:g.start,day:date,home:state.teams.find(t=>t.id===g.home)!,away:state.teams.find(t=>t.id===g.away)!,status:g.completed?'Final':'Scheduled',completed:g.completed,hp:g.hp??undefined,ap:g.ap??undefined,neutral:g.neutral,preseason:false})),at:state.snapshot};}
  return {value:seed.nbaSchedule.filter(g=>localDay(g.start)===date).map(g=>({id:g.id,sport,start:g.start,day:date,home:seed.teams.find(t=>t.id===g.home)!,away:seed.teams.find(t=>t.id===g.away)!,status:'Scheduled',completed:false,neutral:g.neutral,preseason:false})),at:seed.snapshot};
}
export async function researchFixtures(date:string,sport:Sport){return (await fixtureList(date,sport)).value;}
function canonicalFixtureTeam(team:Fixture['home'],sport:Sport){
  if(isFootball(sport))return {...team,name:plName(team.name)};
  const known=extraTeam(sport,team.abbr);
  return known?{...team,id:known.id,abbr:known.abbr,name:known.id!==team.id?known.name:team.name}:team;
}
function parseCsv(text:string):Record<string,string>[] {
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}else value+=c;}
  if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}const headers=rows.shift()||[];
  return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
async function updateFixtures(date:string,sport:Sport,force=false) {
  const old=await cached<Fixture[]>(`fixtures:${sport}:${date}`);if(!force&&fresh(old?.at,15))return 'Fixture cache is current.';
  const {data}=await fetchJson(`${ESPN}${PATH[sport]}/scoreboard?dates=${date.replaceAll('-','')}&limit=100`);
  const fixtures=parseEvents(data,sport).filter(f=>f.day===date);await putCache(`fixtures:${sport}:${date}`,fixtures);return `${fixtures.length} fixtures checked.`;
}
export async function refreshSources(date:string,sports:Sport[],forceFixtures=false) {
  const messages:string[]=[];
  for(const sport of sports) {
    try {messages.push(`${sport.toUpperCase()}: ${await updateFixtures(date,sport,forceFixtures)}`);}catch(e){messages.push(`${sport.toUpperCase()} fixtures: ${(e as Error).message}`);}
    if(sport==='nba') {
      const old=await cached<NbaGame[]>('nba:current');
      if(fresh(old?.at,60)){messages.push('NBA results were checked within the last hour.');continue;}
      const results=await pool(seed.teams,async team=>{
        const {data}=await fetchJson(`${ESPN}basketball/nba/teams/${team.id}/schedule?season=2027&seasontype=2`);
        if(Number(data.season?.year)!==2027)throw new Error('Provider returned the wrong NBA season.');
        return parseEvents({...data,season:{year:2027,type:2}},'nba').filter(f=>!f.preseason&&!f.unsupported).map(f=>({id:f.id,start:f.start,season:2027,home:f.home.id,away:f.away.id,hp:f.hp??null,ap:f.ap??null,completed:f.completed,neutral:f.neutral}));
      });
      const values=new Map((old?.value||[]).map(g=>[g.id,g]));let failed=0;
      for(const r of results)if(r.status==='fulfilled'){for(const g of r.value)if(!g.completed||(g.hp!>0&&g.ap!>0&&g.hp!==g.ap))values.set(g.id,g);}else failed++;
      if(!failed){await putCache('nba:current',[...values.values()]);messages.push(`NBA: checked all 30 schedules, ${[...values.values()].filter(g=>g.completed).length} current-season results.`);}
      else {messages.push(`NBA: ${failed} schedule requests failed; retaining the previous complete result snapshot.`);}
    } else if(sport==='nfl'||sport==='nhl') {
      try {messages.push(...await refreshExtraResults(sport));}catch(e){messages.push(`${COMPETITIONS[sport].label} results: ${(e as Error).message}`);}
    } else {
      const old=await cached<PlGame[]>(`${sport}:current`),marketOld=await cached<FootballMarketGame[]>(`${sport}:market-current`);if(fresh(old?.at,60)&&fresh(marketOld?.at,60)){messages.push(`${COMPETITIONS[sport].label} goals and corners were checked within the last hour.`);continue;}
      try {
        const response=await fetch(`https://football-data.co.uk/mmz4281/2627/${COMPETITIONS[sport].footballCode}.csv`,{redirect:'manual',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error(`Results feed returned HTTP ${response.status}.`);
        const text=await response.text(),rows=parseCsv(text),matches:PlGame[]=[];
        for(const r of rows){if(!r.Date||!r.HomeTeam||!r.AwayTeam||r.FTHG===''||r.FTAG==='')continue;const [d,m,y]=r.Date.split('/');const day=`${y.length===2?'20'+y:y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;const hp=Number(r.FTHG),ap=Number(r.FTAG);if(day>='2026-07-01'&&day<=localDay(Date.now())&&Number.isInteger(hp)&&hp>=0&&Number.isInteger(ap)&&ap>=0)matches.push({day,home:r.HomeTeam,away:r.AwayTeam,hp,ap});}
        if(matches.length<(extraSeed.football[sport]?.games||[]).filter(g=>g.day>='2026-07-01').length)throw new Error('Result feed is incomplete; previous snapshot retained.');
        const parsed=parseFootballMarketCsv(text,sport as FootballSport,2027,localDay(Date.now()));
        if(parsed.rejected||parsed.games.length<(marketOld?.value.length||0))throw new Error('Goals/corners feed is incomplete or invalid; previous snapshots retained.');
        await putCache(`${sport}:market-current`,mergeFootballMarketGames(marketOld?.value||[],parsed.games));
        await putCache(`${sport}:current`,matches);messages.push(`${COMPETITIONS[sport].label}: checked ${matches.length} current-season results, including ${parsed.games.filter(g=>g.hc!==null&&g.ac!==null).length} corner records.`);
      }catch(e){messages.push(`${COMPETITIONS[sport].label} results: ${(e as Error).message}`);}
    }
  }
  for(const sport of sports)await putCache(`health:sources:${sport}:${date}`,messages);return {messages};
}
export async function refreshRosters(date:string,depthOnly=false) {
  const fixtures=(await fixtureList(date,'nba')).value.filter(f=>!f.completed&&!f.preseason&&!f.unsupported);
  const ids=[...new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))];
  const results=await pool(ids,async id=>{
    const key=`nba:${depthOnly?'depth':'roster'}:${id}`,old=await cached<any>(key);if(fresh(old?.at,60))return;
    const {data}=await fetchJson(`${ESPN}basketball/nba/teams/${id}/${depthOnly?'depthcharts':'roster'}`);
    if(depthOnly){const ranks:Record<string,number>={};const walk=(v:any)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.athletes)for(const [i,a]of v.athletes.entries())if(a.id)ranks[String(a.id)]=Math.min(ranks[String(a.id)]||99,i+1);for(const[k,item]of Object.entries(v))if(k!=='athletes')walk(item);}};walk(data);if(Object.keys(ranks).length<5)throw new Error('Depth chart incomplete.');await putCache(key,ranks);}
    else {const players:RosterPlayer[]=(data.athletes||[]).map((p:any)=>({id:String(p.id),name:p.displayName,position:p.position?.abbreviation||'',injury:(p.injuries||[]).map((i:any)=>i.status||i.type?.description||'Injury flag').join(', '),injuryAt:p.injuries?.[0]?.date,injurySource:'https://www.espn.com/nba/injuries',depth:99}));if(players.length<10||new Set(players.map(p=>p.id)).size!==players.length)throw new Error('Roster incomplete.');await putCache(key,players);}
  });
  const failures=results.filter(r=>r.status==='rejected').length;
  const messages=[`${depthOnly?'Depth charts':'NBA rosters'}: ${ids.length-failures}/${ids.length} teams checked${failures?'; failed teams retain dated snapshots':''}.`];await putCache(`health:${depthOnly?'depth':'rosters'}`,messages);return {messages};
}
type CurrentPlayer={minutes:number;games:number;features:Record<string,number>};
type CurrentBoxes={processed:string[];players:Record<string,CurrentPlayer>};
function parsePlayerBox(data:any,game:NbaGame) {
  if(String(data.header?.id)!==game.id)throw new Error('Player box identity mismatch.');
  const output:Record<string,CurrentPlayer>={};let teams=0;
  for(const team of data.boxscore?.players||[]) {
    const teamId=String(team.team?.id);if(![game.home,game.away].includes(teamId))throw new Error('Player box team mismatch.');teams++;let sum=0,minutesSum=0;
    for(const table of team.statistics||[])for(const p of table.athletes||[]) {
      if(p.didNotPlay||!p.stats?.length)continue;
      const stats=Object.fromEntries((table.keys||[]).map((k:string,i:number)=>[k,p.stats[i]]));
      if(['--','','DNP'].includes(stats.minutes||''))continue;
      const minute=String(stats.minutes).split(':').map(Number),minutes=minute[0]+(minute[1]||0)/60;
      const pair=(key:string)=>String(stats[key]).split('-').map(Number),fg=pair('fieldGoalsMade-fieldGoalsAttempted'),ft=pair('freeThrowsMade-freeThrowsAttempted'),three=pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
      const features={points:Number(stats.points),missed_fg:fg[1]-fg[0],missed_ft:ft[1]-ft[0],oreb:Number(stats.offensiveRebounds),dreb:Number(stats.defensiveRebounds),ast:Number(stats.assists),stl:Number(stats.steals),blk:Number(stats.blocks),tov:Number(stats.turnovers),fg3m:three[0]};
      if(!p.athlete?.id||![minutes,...Object.values(features)].every(v=>Number.isFinite(v)&&v>=0))throw new Error('Player box has missing or invalid production.');
      sum+=features.points;minutesSum+=minutes;if(minutes>0)output[String(p.athlete.id)]={minutes,games:1,features};
    }
    if(sum!==(teamId===game.home?game.hp:game.ap)||minutesSum<230)throw new Error('Player totals do not reconcile with the result.');
  }
  if(teams!==2)throw new Error('Incomplete player box.');return output;
}
export async function refreshPlayers() {
  const current=await cached<NbaGame[]>('nba:current'),old=await cached<CurrentBoxes>('nba:boxes');const boxes=old?.value||{processed:[],players:{}};
  const missing=(current?.value||[]).filter(g=>g.completed&&!boxes.processed.includes(g.id)).sort((a,b)=>a.start.localeCompare(b.start));
  const batch=missing.slice(0,8),results=await pool(batch,async g=>({id:g.id,players:parsePlayerBox((await fetchJson(`${ESPN}basketball/nba/summary?event=${g.id}`)).data,g)}),4);
  let done=0;for(const r of results)if(r.status==='fulfilled') {if(boxes.processed.includes(r.value.id))continue;boxes.processed.push(r.value.id);done++;for(const[id,p]of Object.entries(r.value.players)){const target=boxes.players[id]||{minutes:0,games:0,features:{}};target.minutes+=p.minutes;target.games++;for(const[k,v]of Object.entries(p.features))target.features[k]=(target.features[k]||0)+v;boxes.players[id]=target;}}
  if(done)await putCache('nba:boxes',boxes);const remaining=missing.length-done;
  return {messages:[`${done} new player boxes updated; ${remaining} awaiting ingestion.`],remaining,failed:batch.length-done};
}
export async function refreshOdds(date:string,sport:Sport,book:string) {
  if(!env.THERUNDOWN_API_KEY) return {messages:['TheRundown runtime key is not configured. Model probabilities remain available.']};
  if(date<localDay(Date.now()))return {messages:['Historical dates show model estimates/results; current odds are not joined to past games.']};
  const key=`odds:${sport}:${date}:${book}`,old=await cached<{quotes:Quote[];usage:Record<string,string>}> (key);
  if(fresh(old?.at,ODDS_CACHE_MINUTES))return {messages:['Odds checked within the last 30 minutes; cached snapshot reused without a new provider request.']};
  const fixtures=(await fixtureList(date,sport)).value.filter(f=>!f.preseason&&!f.unsupported&&!f.completed);
  if(!fixtures.length){await putCache(key,{quotes:[],usage:{}});return {messages:['No supported fixtures to price on this date.']};}
  const cooldown=await cached<{until:number}>('rundown:cooldown');
  if(cooldown&&cooldown.value.until>Date.now())return {messages:['TheRundown rate limit cooldown is active. Retaining dated prices.']};
  const quotes:Quote[]=[],usage:Record<string,string>={};let failed=0;
  // The provider supports a minute offset for its date boundary. One narrow
  // match-winner request normally covers the whole Toronto slate. Only DST
  // boundary outliers need an adjacent date to cover a 23/25-hour calendar day.
  const offset=providerOffsetMinutes(date),windowStart=Date.parse(date+'T00:00Z')+offset*60000;
  const requestDates=[date];if(fixtures.some(f=>Date.parse(f.start)<windowStart))requestDates.push(addDays(date,-1));if(fixtures.some(f=>Date.parse(f.start)>=windowStart+86400000))requestDates.push(addDays(date,1));
  for(const utcDate of requestDates) {
    try {
      // Free access permits one request/second across the account. The database
      // lease serializes refreshes and this timestamp spaces league/date calls.
      const previous=await cached<number>('rundown:last-request');
      const delay=previous?Math.max(0,1200-(Date.now()-previous.value)):0;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      await putCache('rundown:last-request',Date.now());
      const response=await fetch(`https://therundown.io/api/v2/sports/${COMPETITIONS[sport].providerId}/events/${utcDate}?offset=${offset}&affiliate_ids=${book}&market_ids=1&main_line=true&hide_closed=true`,{headers:{Accept:'application/json','X-TheRundown-Key':env.THERUNDOWN_API_KEY},redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!response.ok){
        if(response.status===429){const retry=response.headers.get('Retry-After');const wait=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):60000;await putCache('rundown:cooldown',{until:Date.now()+Math.max(1000,Number.isFinite(wait)?wait:60000)});}
        throw new Error(response.status===429?'Provider rate limit reached. Wait before refreshing.':response.status===401||response.status===403?'Provider access was denied. Check the API plan/key.':`TheRundown returned HTTP ${response.status}.`);
      }
      const data=await response.json(),headers=response.headers;
      const observedAt=new Date().toISOString();quotes.push(...normalizeQuotes(data,fixtures,book,observedAt,sport));
      for(const[k,v]of headers.entries())if(/remaining|datapoints|quota|limit/.test(k)&&!k.includes('key'))usage[k]=v;
    }catch(e){failed++;await putCache(`health:odds:${sport}:${date}:${book}`,[(e as Error).message]);break;}
  }
  if(failed) return {messages:[`TheRundown ${sport.toUpperCase()}: incomplete refresh; previous quote snapshot retained. Check Data status.`]};
  const unique=[...new Map(quotes.map(q=>[`${q.fixtureId}:${q.market}:${q.side}:${q.line}`,q])).values()];await putCache(key,{quotes:unique,usage});await putCache(`health:odds:${sport}:${date}:${book}`,[]);
  return {messages:[`TheRundown ${sport.toUpperCase()}: ${unique.length} complete-market selections observed at ${BOOKS[book]}. Missing markets remain unavailable.`]};
}
export async function refreshNbaContext(date:string){
  const fixtures=(await fixtureList(date,'nba')).value.filter(f=>!f.completed&&!f.preseason&&!f.unsupported),ids=[...new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))];
  if(!ids.length||date<localDay(Date.now()))return {messages:['No upcoming NBA team news to check on this date.']};
  const messages:string[]=[];
  const results=await pool(ids,async id=>{const key=`nba:news:${id}`,old=await cached<NewsItem[]>(key);if(fresh(old?.at,30))return;const team=seed.teams.find(t=>t.id===id);const {data}=await fetchJson(`${ESPN}basketball/nba/news?team=${id}&limit=12`);if(!Array.isArray(data.articles))throw new Error('News response missing articles.');await putCache(key,parseNews(data,id,team?.name||''));},5);
  messages.push(`NBA news: ${ids.length-results.filter(r=>r.status==='rejected').length}/${ids.length} team feeds checked. Headlines are context; no sentiment score is invented.`);
  try{const old=await cached<InjuryItem[]>('nba:injuries');if(!fresh(old?.at,15)){const {data}=await fetchJson(`${ESPN}basketball/nba/injuries`);if(!Array.isArray(data.injuries))throw new Error('Injury response missing its report list.');await putCache('nba:injuries',parseInjuries(data));}const report=await cached<InjuryItem[]>('nba:injuries');messages.push(report?.value.length?'NBA injury feed checked. Only recent, explicitly Out/inactive players are excluded for games within 48 hours.':'NBA injury feed returned no entries. Availability remains unconfirmed; check the official report near tip-off.');}catch(e){messages.push(`NBA injury feed: ${(e as Error).message} Dated flags remain context only.`);}
  const reportIndex='https://official.nba.com/nba-injury-report-2026-27-season/';
  try{const old=await cached<NbaContext['officialReport']>('nba:official-report');if(!fresh(old?.at,30)){const response=await fetch(reportIndex,{redirect:'follow',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('The current-season official report has not been retrieved.');const report=officialReportFromHtml(await response.text(),reportIndex);await putCache('nba:official-report',report);if(!report.available)messages.push('No dated current-season NBA injury PDF is published in the checked index.');}}catch(e){await putCache('nba:official-report',{url:reportIndex,publishedAt:null,available:false});messages.push((e as Error).message+' Use the official report link before tip-off.');}
  await putCache(`health:nba-context:${date}`,messages);return {messages};
}
async function teamRoster(id:string,boxes:CurrentBoxes|null,start:string,injuries:{value:InjuryItem[];at:string}|null) {
  const roster=await cached<RosterPlayer[]>(`nba:roster:${id}`),depth=await cached<Record<string,number>>(`nba:depth:${id}`);
  const players=(roster?.value||seed.rosters[id]||[]).map(p=>{const report=injuries?.value.find(i=>i.teamId===id&&i.playerId===p.id);return {...p,depth:depth?.value[p.id]??p.depth,...(report?{injury:report.status,injuryAt:report.reportedAt||undefined,injurySource:report.url}:{})};});
  const priors=Object.fromEntries(players.map(p=>{const prior=seed.players[p.id],current=boxes?.players[p.id];let impact=prior?.impact||0;const mpg=current&&current.games>=3?Math.min(36,current.minutes/current.games):prior?.mpg||8;if(current&&prior){const denominator=prior.minutes+750+current.minutes;for(const k of Object.keys(seed.translation)){const changed=(prior.features[k]*(prior.minutes+750)+current.features[k]*36)/denominator-prior.features[k];impact+=changed*seed.translation[k];}}return [p.id,{mpg,minutes:prior?.minutes||0,impact}];}));
  const projection=rotationProjection(players,priors,seed.previousRoster[id]||0,start,injuries?.at||roster?.at||null);
  const previous=(previousRosters as Record<string,{id:string;name:string;minutes:number}[]>)[id]||[],currentIds=new Set(players.map(p=>p.id)),priorIds=new Set(previous.map(p=>p.id));
  const changes={arrivals:projection.players.filter(p=>!priorIds.has(p.id)).sort((a,b)=>(b.projectedMinutes||0)-(a.projectedMinutes||0)).slice(0,6).map(p=>p.name),departures:previous.filter(p=>!currentIds.has(p.id)).sort((a,b)=>b.minutes-a.minutes).slice(0,6).map(p=>p.name)};
  return {...projection,changes,at:[roster?.at||seed.snapshot,depth?.at||seed.snapshot].sort()[0]};
}
export async function dashboard(date:string,sportFilter:string,book:string):Promise<DashboardData> {
  const sports=selectedSports(sportFilter);
  const rows=await Promise.all(SPORTS.map(async sport=>[sport,await cached<any[]>(`${sport}:current`)] as const));
  const current=Object.fromEntries(rows) as Record<Sport,{value:any[];at:string}|null>;
  const boxes=await cached<CurrentBoxes>('nba:boxes');
  const injuryFeed=await cached<InjuryItem[]>('nba:injuries'),officialReport=await cached<NbaContext['officialReport']>('nba:official-report');
  const nbaHealth=await cached<string[]>(`health:nba-context:${date}`);
  const marginGames:Record<string,NbaGame[]>={},footballGames:Record<string,PlGame[]>={},counts={} as Record<Sport,number>;
  for(const sport of SPORTS) {
    if(isFootball(sport)) {const base=extraSeed.football[sport]?.games||[];footballGames[sport]=[...new Map([...base,...(current[sport]?.value||[])].map(g=>[`${g.day}:${g.home}:${g.away}`,g])).values()];counts[sport]=footballGames[sport].length;}
    else {const base=sport==='nba'?seed.nbaGames:extraSeed.margin[sport as 'nfl'|'nhl'].games;marginGames[sport]=[...new Map([...base,...(current[sport]?.value||[])].map(g=>[g.id,g])).values()];counts[sport]=marginGames[sport].filter(g=>g.completed).length;}
  }
  const today=localDay(Date.now()),cutoff=date<today?date:today,models:Record<string,ReturnType<typeof fitNba>>={};
  for(const sport of sports)if(!isFootball(sport))models[sport]=fitNba(marginGames[sport],cutoff,MARGIN_SETTINGS[sport]);
  const all:MatchCard[]=[],fixtureTimes:string[]=[],oddsTimes:string[]=[],rosterTimes:string[]=[],resultsTimes:string[]=[],messages:string[]=[];
  for(const sport of sports) {
    const sourceHealth=await cached<string[]>(`health:sources:${sport}:${date}`);if(sourceHealth)messages.push(...sourceHealth.value);
    const feed=await fixtureList(date,sport);if(feed.at)fixtureTimes.push(feed.at);
    const resultSnapshot=current[sport]?.at||(sport==='nba'?seed.snapshot:extraSnapshot(sport))!;
    resultsTimes.push(resultSnapshot);
    const odds=await cached<{quotes:Quote[]}>(`odds:${sport}:${date}:${book}`);if(odds)oddsTimes.push(odds.at);
    for(const f of feed.value) {
      let prediction:MatchCard['prediction'],outcomes:{key:string;side:string;label:string;p:number;experimental:boolean;line?:number}[]=[],roster:MatchCard['roster'],context:MatchCard['context'];
      try {
        if(!isFootball(sport)) {
          const scale=sport==='nba'?(date>='2025-10-01'?seed.scale:1):(date>=extraSeed.margin[sport as 'nfl'|'nhl'].fittedBefore?extraSeed.margin[sport as 'nfl'|'nhl'].scale:1);
          const schedule=[...new Map([...(sport==='nba'?seed.nbaSchedule:marginGames[sport].filter(g=>g.season===COMPETITIONS[sport].season)),...(current[sport]?.value||[])].map(g=>[g.id,g])).values()];
          const p=nbaPrediction(models[sport],f.home.id,f.away.id,date,scale,f.neutral,schedule);prediction=p;
          if(sport==='nba'&&date>=today) {
            const [h,a,hn,an]=await Promise.all([teamRoster(f.home.id,boxes?.value||null,f.start,injuryFeed),teamRoster(f.away.id,boxes?.value||null,f.start,injuryFeed),cached<NewsItem[]>(`nba:news:${f.home.id}`),cached<NewsItem[]>(`nba:news:${f.away.id}`)]);
            const adjusted=rosterForecast(p,h.totalDelta,a.totalDelta,scale),n=models[sport].coefficients.length;
            prediction={...p,...adjusted,rosterHome:adjusted.home,homeRosterDelta:h.rosterDelta,awayRosterDelta:a.rosterDelta,injuryDelta:h.injuryDelta-a.injuryDelta,homeCourt:f.neutral?0:models[sport].coefficients[n-2],strengthMargin:models[sport].coefficients[models[sport].ids.indexOf(f.home.id)]-models[sport].coefficients[models[sport].ids.indexOf(f.away.id)]};
            prediction.restMargin=p.margin-prediction.strengthMargin! -prediction.homeCourt!;
            roster={home:h.players,away:a.players,snapshot:[h.at,a.at].sort()[0],changes:{home:h.changes,away:a.changes}};rosterTimes.push(roster.snapshot);
            context={news:[...(hn?.value||[]),...(an?.value||[])].filter((v,i,rows)=>rows.findIndex(r=>r.url===v.url)===i).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,8),injuries:(injuryFeed?.value||[]).filter(i=>[f.home.id,f.away.id].includes(i.teamId)),checkedAt:injuryFeed?.at||null,officialReport:officialReport?.value||{url:'https://official.nba.com/nba-injury-report-2026-27-season/',publishedAt:null,available:false},messages:nbaHealth?.value||['NBA news and game-day injuries have not yet been checked.']};
          }
          outcomes=[{key:'home',side:'home',label:`${f.home.abbr} to win`,p:prediction.home,experimental:false},{key:'away',side:'away',label:`${f.away.abbr} to win`,p:prediction.away,experimental:false}];
          for(const q of odds?.value.quotes.filter(q=>q.fixtureId===f.id&&q.market==='spread')||[]) {const probability=q.side==='home'?normalCdf((prediction.margin!+q.line!)/(p.sigma*scale)):normalCdf((-prediction.margin!+q.line!)/(p.sigma*scale));outcomes.push({key:`spread:${q.side}`,side:q.side,label:`${q.side==='home'?f.home.abbr:f.away.abbr} ${q.line!>0?'+':''}${q.line}`,p:probability,experimental:true,line:q.line!});}
        } else {
          const p=plPrediction(footballGames[sport],f.home.name,f.away.name,cutoff);prediction=p;
          outcomes=[{key:'home',side:'home',label:`${f.home.name} to win`,p:p.home,experimental:false},{key:'draw',side:'draw',label:'Draw',p:p.draw,experimental:false},{key:'away',side:'away',label:`${f.away.name} to win`,p:p.away,experimental:false},
            {key:'total:over',side:'over',label:'Over 2.5 goals',p:p.over,experimental:true,line:2.5},{key:'total:under',side:'under',label:'Under 2.5 goals',p:1-p.over,experimental:true,line:2.5},{key:'btts:yes',side:'yes',label:'Both teams to score',p:p.btts,experimental:true},{key:'btts:no',side:'no',label:'Both teams to score · No',p:1-p.btts,experimental:true}];
        }
        if(isFootball(sport)){
          const pairs=[{key:'home_draw',p:prediction.home+(prediction.draw||0),label:`${f.home.name} or draw`},{key:'away_draw',p:prediction.away+(prediction.draw||0),label:`${f.away.name} or draw`},{key:'home_away',p:prediction.home+prediction.away,label:'Either team wins · no draw'}];
          outcomes.push(...pairs.map(pair=>({key:`doublechance:${pair.key}`,side:pair.key,label:pair.label,p:pair.p,experimental:false})));
        }
        const inputs=isFootball(sport)?footballGames[sport]:marginGames[sport],homeKey=isFootball(sport)?f.home.name:f.home.id,awayKey=isFootball(sport)?f.away.name:f.away.id;
        const recentForm=formSentence(f.home.name,teamResults(inputs,homeKey,cutoff),isFootball(sport)||sport==='nhl'?'goals':'points')+' '+formSentence(f.away.name,teamResults(inputs,awayKey,cutoff),isFootball(sport)||sport==='nhl'?'goals':'points');
        const options:Option[]=outcomes.map(e=>{
          const market=e.key.includes(':')?e.key.split(':')[0]:'moneyline',push=sport==='nfl'&&market==='moneyline'?(prediction.draw||0):0;
          const comparisonProbability=e.p/(1-push),fairOdds=(1-push)/e.p;
          const quote=odds?.value.quotes.find(q=>q.fixtureId===f.id&&q.market===market&&q.side===e.side&&(e.line===undefined||e.line===q.line))||null;
          const edge=quote?comparisonProbability-quote.marketProbability:null,ev=quote?e.p*quote.decimal+push-1:null;
          const timesGood=fresh(feed.at,360)&&fresh(resultSnapshot,26*60)&&quote&&fresh(quote.observedAt,ODDS_CACHE_MINUTES)&&Date.parse(quote.observedAt)>=Date.parse(resultSnapshot);
          const supported=!!(timesGood&&!e.experimental&&!prediction.unknownTeam&&!f.completed&&!f.preseason&&!f.unsupported&&f.status==='Scheduled'&&Date.parse(f.start)>Date.now()+300000&&date>=today);
          const eligible=supported&&e.p>=.55&&edge!==null&&edge>=.025&&ev!==null&&ev>=.02;
          const suggestionEligible=!!(!e.experimental&&['moneyline','doublechance'].includes(market)&&!prediction.unknownTeam&&!f.completed&&!f.preseason&&!f.unsupported&&f.status==='Scheduled'&&Date.parse(f.start)>Date.now()+300000&&date>=today);
          const pct=(value:number)=>(100*value).toFixed(1)+'%';
          let modelReason=!isFootball(sport)?`${e.label}: ${pct(e.p)} team-model win chance. Opponent-adjusted strength, home court and scheduled rest produce an expected ${f.home.abbr} margin of ${prediction.margin!.toFixed(1)} ${sport==='nhl'?'goals':'points'}.`:`${e.label}: ${pct(e.p)} model chance. Recency-weighted scoring rates project ${prediction.expectedGoals![0].toFixed(2)} goals for ${f.home.name} and ${prediction.expectedGoals![1].toFixed(2)} for ${f.away.name}.`;
          if(sport==='nba'&&prediction.baselineHome!==undefined){const base=e.side==='home'?prediction.baselineHome:1-prediction.baselineHome;modelReason=`${e.label}: ${pct(e.p)} roster-aware model estimate, versus ${pct(base)} from historical team results alone. ${f.home.abbr} margin: historical strength ${prediction.strengthMargin!.toFixed(2)}, home court ${prediction.homeCourt!.toFixed(2)}, rest ${prediction.restMargin!.toFixed(2)}, roster changes ${(prediction.rosterDelta!-prediction.injuryDelta!).toFixed(2)}, recent confirmed absences ${prediction.injuryDelta!.toFixed(2)} points; final ${prediction.margin!.toFixed(2)}. The roster and availability extension is not yet historically calibrated.`;}
          if(market==='doublechance')modelReason=`${e.label}: ${pct(e.p)} estimated chance, calculated by adding the mutually exclusive covered result probabilities from the scoring model. Expected goals: ${f.home.name} ${prediction.expectedGoals![0].toFixed(2)}, ${f.away.name} ${prediction.expectedGoals![1].toFixed(2)}. Double-chance calibration has not been separately evaluated.`;
          modelReason+=' '+recentForm;
          const priceReason=quote?`At ${quote.decimal.toFixed(2)} odds, fair model odds are ${fairOdds.toFixed(2)}. The margin-removed market chance is ${pct(quote.marketProbability)} (${edge!>=0?'+':''}${(edge!*100).toFixed(1)} percentage points of model edge${push?', conditional on a decisive game':''}).`:'No complete bookmaker quote is available for a price comparison.';
          const cautions:string[]=[];
          if(sport==='nba') {cautions.push('Displayed probabilities include an unvalidated roster/availability adjustment; the 63.1% historical accuracy applies only to the team-history baseline. News headlines supply context, not an automatic numerical sentiment boost.');const selected=e.side==='home'?f.home:f.away;const flagged=(e.side==='home'?roster?.home:roster?.away)?.filter(p=>p.injury).length||0;if(flagged)cautions.push(`${selected.abbr} has ${flagged} provider injury flags. Only recent Out/inactive reports within 48 hours of tip-off exclude a player; uncertain or dated flags stay unconfirmed.`);}
          else if(sport==='nfl')cautions.push(`NFL final-tie estimate: ${pct(push)}. Moneyline fair odds assume tied games are voided; a tie may reduce the final slip payout. Quarterback/injury effects are not modeled.`);
          else if(sport==='nhl')cautions.push('Full-game winner includes overtime/shootout. Starting goalie and skater availability are not modeled.');
          else cautions.push('This scoring model has no confirmed lineup adjustment. Recent results are part of the recency-weighted training data; a last-five summary is context, not a separately fitted form coefficient.');
          return {id:`${f.id}:${e.key}:${e.line??''}:${book}`,fixtureId:f.id,sport,matchup:`${f.away.name} at ${f.home.name}`,start:f.start,label:e.label,market,side:e.side,probability:e.p,fairOdds,quote,edge,ev,eligible,suggestionEligible,experimental:e.experimental,reason:modelReason+' '+priceReason,cautions,pushProbability:push};
        });
        all.push({...f,prediction,roster,context,options,note:f.preseason?'Preseason: context only; excluded from suggested slips.':f.unsupported?'This competition is outside the regular-season model.':prediction.unknownTeam?'Neutral prior used for a club without earlier history in this league.':sport==='nba'&&roster?'Roster-aware estimate · unvalidated extension. Expand Match insights for baseline, transfers, injuries and sources.':sport==='nfl'?`NFL: ${(100*(prediction.draw||0)).toFixed(2)}% estimated final-tie probability. Check bookmaker tie settlement.`:sport==='nhl'?'Full-game winner includes overtime/shootout. Goalie availability is not modeled.':undefined});
      }catch {messages.push(`No supported model forecast for ${f.away.name} at ${f.home.name}.`);}
    }
    const errors=await cached<string[]>(`health:odds:${sport}:${date}:${book}`);if(errors)messages.push(...errors.value);
  }
  return {date,today,sportFilter,fixtures:all.sort((a,b)=>a.start.localeCompare(b.start)),book,generatedAt:new Date().toISOString(),counts,evaluations:extraSeed.evaluations,health:{fixturesAt:fixtureTimes.sort()[0]||null,resultsAt:resultsTimes.sort()[0]||null,rosterAt:rosterTimes.sort()[0]||seed.snapshot,oddsAt:oddsTimes.sort()[0]||null,keyConfigured:!!env.THERUNDOWN_API_KEY,messages:[...new Set([...messages,...(nbaHealth?.value||[])])],playerGamesMissing:(current.nba?.value||[]).filter(g=>g.completed&&!boxes?.value.processed.includes(g.id)).length}};
}
