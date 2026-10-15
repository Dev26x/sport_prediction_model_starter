import { env } from 'cloudflare:workers';
import rawSeed from './seed.json';
import { cached, putCache, fresh } from './storage';
import { localDay, addDays, fitNba, nbaPrediction, normalCdf, plPrediction } from './models';
import { normalizeQuotes, plName } from './markets';
import { ODDS_CACHE_MINUTES } from './refresh-policy';
import type { DashboardData, Fixture, MatchCard, NbaGame, PlGame, RosterPlayer, Sport, Option, Quote } from './types';

type PlayerPrior={name:string;minutes:number;mpg:number;features:Record<string,number>;impact:number};
type Seed={snapshot:string;nbaGames:NbaGame[];nbaSchedule:NbaGame[];teams:{id:string;abbr:string;name:string}[];plGames:PlGame[];scale:number;translation:Record<string,number>;previousRoster:Record<string,number>;players:Record<string,PlayerPrior>;rosters:Record<string,RosterPlayer[]>;fixtures:Record<string,any>};
const seed=rawSeed as unknown as Seed;
const ESPN='https://site.api.espn.com/apis/site/v2/sports/';
const PATH:Record<Sport,string>={nba:'basketball/nba',epl:'soccer/eng.1'};
export const BOOKS:Record<string,string>={'23':'FanDuel','19':'DraftKings','3':'Pinnacle'};
export function validateInput(date:string,sport:string,book:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00Z').toISOString().slice(0,10)!==date||date<'2025-10-01'||date>'2027-06-30')throw new Error('Choose a date between October 2025 and June 2027.');
  if(!['all','nba','epl'].includes(sport)||!BOOKS[book])throw new Error('Invalid league or bookmaker.');
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
    const team=(t:any)=>({id:String(t.team.id),name:sport==='epl'?plName(t.team.shortDisplayName||t.team.displayName):t.team.displayName,abbr:t.team.abbreviation});
    const score=(t:any)=>Number(typeof t.score==='object'?t.score.value:t.score);
    const preseason=sport==='nba'&&(Number(season.type)===1||season.slug==='preseason');
    const unsupported=sport==='nba'&&(![1,2].includes(Number(season.type))||c.type?.abbreviation==='CC');
    out.push({id:String(e.id),sport,start:e.date,day:localDay(e.date),home:team(home),away:team(away),status:status.description||'Unconfirmed',completed:!!status.completed,
      hp:status.completed?score(home):undefined,ap:status.completed?score(away):undefined,neutral:!!c.neutralSite,preseason,unsupported});
  }
  return out;
}
async function fixtureList(date:string,sport:Sport):Promise<{value:Fixture[];at:string|null}> {
  const entry=await cached<Fixture[]>(`fixtures:${sport}:${date}`);
  if(entry)return entry;
  const publicSnapshot=seed.fixtures[`${sport}:${date}`];
  if(publicSnapshot)return {value:parseEvents(publicSnapshot,sport).filter(f=>f.day===date),at:seed.snapshot};
  if(sport==='epl')return {value:[] as Fixture[],at:null};
  return {value:seed.nbaSchedule.filter(g=>localDay(g.start)===date).map(g=>({id:g.id,sport,start:g.start,day:date,home:seed.teams.find(t=>t.id===g.home)!,away:seed.teams.find(t=>t.id===g.away)!,status:'Scheduled',completed:false,neutral:g.neutral,preseason:false})),at:seed.snapshot};
}
function parseCsv(text:string):Record<string,string>[] {
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}else value+=c;}
  if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}const headers=rows.shift()||[];
  return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
async function updateFixtures(date:string,sport:Sport) {
  const old=await cached<Fixture[]>(`fixtures:${sport}:${date}`);if(fresh(old?.at,15))return 'Fixture cache is current.';
  const {data}=await fetchJson(`${ESPN}${PATH[sport]}/scoreboard?dates=${date.replaceAll('-','')}&limit=100`);
  const fixtures=parseEvents(data,sport).filter(f=>f.day===date);await putCache(`fixtures:${sport}:${date}`,fixtures);return `${fixtures.length} fixtures checked.`;
}
export async function refreshSources(date:string,sports:Sport[]) {
  const messages:string[]=[];
  for(const sport of sports) {
    try {messages.push(`${sport.toUpperCase()}: ${await updateFixtures(date,sport)}`);}catch(e){messages.push(`${sport.toUpperCase()} fixtures: ${(e as Error).message}`);}
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
    } else {
      const old=await cached<PlGame[]>('epl:current');if(fresh(old?.at,60)){messages.push('PL results were checked within the last hour.');continue;}
      try {
        const response=await fetch('https://football-data.co.uk/mmz4281/2627/E0.csv',{redirect:'manual',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error(`Results feed returned HTTP ${response.status}.`);
        const rows=parseCsv(await response.text()),matches:PlGame[]=[];
        for(const r of rows){if(!r.Date||!r.HomeTeam||!r.AwayTeam||r.FTHG===''||r.FTAG==='')continue;const [d,m,y]=r.Date.split('/');const day=`${y.length===2?'20'+y:y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;const hp=Number(r.FTHG),ap=Number(r.FTAG);if(day>='2026-07-01'&&day<=localDay(Date.now())&&Number.isInteger(hp)&&hp>=0&&Number.isInteger(ap)&&ap>=0)matches.push({day,home:r.HomeTeam,away:r.AwayTeam,hp,ap});}
        if(matches.length<seed.plGames.filter(g=>g.day>='2026-07-01').length)throw new Error('Result feed is incomplete; previous snapshot retained.');
        await putCache('epl:current',matches);messages.push(`PL: checked ${matches.length} current-season results.`);
      }catch(e){messages.push(`PL results: ${(e as Error).message}`);}
    }
  }
  await putCache('health:sources',messages);return {messages};
}
export async function refreshRosters(date:string,depthOnly=false) {
  const fixtures=(await fixtureList(date,'nba')).value.filter(f=>!f.completed&&!f.preseason&&!f.unsupported);
  const ids=[...new Set(fixtures.flatMap(f=>[f.home.id,f.away.id]))];
  const results=await pool(ids,async id=>{
    const key=`nba:${depthOnly?'depth':'roster'}:${id}`,old=await cached<any>(key);if(fresh(old?.at,60))return;
    const {data}=await fetchJson(`${ESPN}basketball/nba/teams/${id}/${depthOnly?'depthcharts':'roster'}`);
    if(depthOnly){const ranks:Record<string,number>={};const walk=(v:any)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.athletes)for(const [i,a]of v.athletes.entries())if(a.id)ranks[String(a.id)]=Math.min(ranks[String(a.id)]||99,i+1);for(const[k,item]of Object.entries(v))if(k!=='athletes')walk(item);}};walk(data);if(Object.keys(ranks).length<5)throw new Error('Depth chart incomplete.');await putCache(key,ranks);}
    else {const players:RosterPlayer[]=(data.athletes||[]).map((p:any)=>({id:String(p.id),name:p.displayName,position:p.position?.abbreviation||'',injury:(p.injuries||[]).map((i:any)=>i.status||i.type?.description||'Injury flag').join(', '),depth:99}));if(players.length<10||new Set(players.map(p=>p.id)).size!==players.length)throw new Error('Roster incomplete.');await putCache(key,players);}
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
  // Provider calendar is UTC. Fetch both UTC dates for a Toronto calendar day.
  for(const utcDate of [date,addDays(date,1)]) {
    try {
      // Free access permits one request/second across the account. The database
      // lease serializes refreshes and this timestamp spaces league/date calls.
      const previous=await cached<number>('rundown:last-request');
      const delay=previous?Math.max(0,1200-(Date.now()-previous.value)):0;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      await putCache('rundown:last-request',Date.now());
      const response=await fetch(`https://therundown.io/api/v2/sports/${sport==='nba'?4:11}/events/${utcDate}?affiliate_ids=${book}&market_ids=${sport==='nba'?'1,2':'1,3'}&main_line=true&hide_closed=true`,{headers:{Accept:'application/json','X-TheRundown-Key':env.THERUNDOWN_API_KEY},redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!response.ok){
        if(response.status===429){const retry=response.headers.get('Retry-After');const wait=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):60000;await putCache('rundown:cooldown',{until:Date.now()+Math.max(1000,Number.isFinite(wait)?wait:60000)});}
        throw new Error(response.status===429?'Provider rate limit reached. Wait before refreshing.':response.status===401||response.status===403?'Provider access was denied. Check the API plan/key.':`TheRundown returned HTTP ${response.status}.`);
      }
      const data=await response.json(),headers=response.headers;
      const observedAt=new Date().toISOString();quotes.push(...normalizeQuotes(data,fixtures,book,observedAt,sport));
      for(const[k,v]of headers.entries())if(/remaining|datapoints|quota|limit/.test(k)&&!k.includes('key'))usage[k]=v;
    }catch(e){failed++;await putCache(`health:odds:${sport}`,[(e as Error).message]);break;}
  }
  if(failed) return {messages:[`TheRundown ${sport.toUpperCase()}: incomplete refresh; previous quote snapshot retained. Check Data status.`]};
  const unique=[...new Map(quotes.map(q=>[`${q.fixtureId}:${q.market}:${q.side}:${q.line}`,q])).values()];await putCache(key,{quotes:unique,usage});await putCache(`health:odds:${sport}`,[]);
  return {messages:[`TheRundown ${sport.toUpperCase()}: ${unique.length} complete-market selections observed at ${BOOKS[book]}. Missing markets remain unavailable.`]};
}
async function teamRoster(id:string,boxes:CurrentBoxes|null) {
  const roster=await cached<RosterPlayer[]>(`nba:roster:${id}`),depth=await cached<Record<string,number>>(`nba:depth:${id}`);
  const players=(roster?.value||seed.rosters[id]||[]).map(p=>({...p,depth:depth?.value[p.id]??p.depth}));
  const ranked=players.map(p=>{const prior=seed.players[p.id],current=boxes?.players[p.id];const mpg=current&&current.games>=3?Math.min(36,current.minutes/current.games):prior?.mpg||8;const role=p.depth===1?30:p.depth===2?18:p.depth===3?8:3;const weight=prior?.minutes?(.5*Math.max(4,mpg)+.5*role):role;let impact=prior?.impact||0;
    if(current&&prior){const denominator=prior.minutes+750+current.minutes;for(const k of Object.keys(seed.translation)){const changed=(prior.features[k]*(prior.minutes+750)+current.features[k]*36)/denominator-prior.features[k];impact+=changed*seed.translation[k];}}
    return {...p,weight,impact};}).sort((a,b)=>b.weight-a.weight);
  const active=ranked.slice(0,11),alloc=Array(active.length).fill(0);let remaining=240,indices=active.map((_,i)=>i);
  if(active.length>=6)while(indices.length){const sum=indices.reduce((s,i)=>s+active[i].weight,0),over=indices.filter(i=>active[i].weight/sum*remaining>40);if(!over.length){for(const i of indices)alloc[i]=active[i].weight/sum*remaining;break;}for(const i of over){alloc[i]=40;remaining-=40;}indices=indices.filter(i=>!over.includes(i));}
  const value=active.reduce((s,p,i)=>s+p.impact*alloc[i]/48,0),delta=Math.max(-8,Math.min(8,.5*(value-seed.previousRoster[id])));
  return {players,delta,at:[roster?.at||seed.snapshot,depth?.at||seed.snapshot].sort()[0]};
}
export async function dashboard(date:string,sportFilter:string,book:string):Promise<DashboardData> {
  const sports:Sport[]=sportFilter==='all'?['nba','epl']:[sportFilter as Sport];
  const [nbaCurrent,plCurrent,boxes,health]=await Promise.all([cached<NbaGame[]>('nba:current'),cached<PlGame[]>('epl:current'),cached<CurrentBoxes>('nba:boxes'),cached<string[]>('health:sources')]);
  const mergedNba=[...new Map([...seed.nbaGames,...(nbaCurrent?.value||[])].map(g=>[g.id,g])).values()];
  const mergedPl=[...new Map([...seed.plGames,...(plCurrent?.value||[])].map(g=>[`${g.day}:${g.home}:${g.away}`,g])).values()];
  const today=localDay(Date.now()),cutoff=date<today?date:today;
  const model=sports.includes('nba')?fitNba(mergedNba,cutoff):null;
  const all:MatchCard[]=[],fixtureTimes:string[]=[],oddsTimes:string[]=[],rosterTimes:string[]=[],resultsTimes:string[]=[],messages=health?.value||[];
  for(const sport of sports) {
    const feed=await fixtureList(date,sport);if(feed.at)fixtureTimes.push(feed.at);
    resultsTimes.push((sport==='nba'?nbaCurrent:plCurrent)?.at||seed.snapshot);
    const odds=await cached<{quotes:Quote[]}>(`odds:${sport}:${date}:${book}`);if(odds)oddsTimes.push(odds.at);
    for(const fixture of feed.value) {
      const f=fixture;let prediction:MatchCard['prediction'],extra:{key:string;side:string;label:string;p:number;experimental:boolean;line?:number}[]=[];let roster:MatchCard['roster'];
      try {
        if(sport==='nba') {
          const p=nbaPrediction(model!,f.home.id,f.away.id,date,date>='2025-10-01'?seed.scale:1,f.neutral,[...seed.nbaSchedule,...(nbaCurrent?.value||[])]);prediction=p;
          if(date>=today) {const [h,a]=await Promise.all([teamRoster(f.home.id,boxes?.value||null),teamRoster(f.away.id,boxes?.value||null)]);prediction.rosterDelta=h.delta-a.delta;prediction.rosterHome=normalCdf((p.margin+h.delta-a.delta)/(p.sigma*seed.scale));roster={home:h.players,away:a.players,snapshot:[h.at,a.at].sort()[0]};rosterTimes.push(roster.snapshot);}
          extra=[{key:'home',side:'home',label:`${f.home.abbr} to win`,p:p.home,experimental:false},{key:'away',side:'away',label:`${f.away.abbr} to win`,p:p.away,experimental:false}];
          for(const q of odds?.value.quotes.filter(q=>q.fixtureId===f.id&&q.market==='spread')||[]) {const probability=q.side==='home'?normalCdf((p.margin+q.line!)/p.sigma):normalCdf((-p.margin+q.line!)/p.sigma);extra.push({key:`spread:${q.side}`,side:q.side,label:`${q.side==='home'?f.home.abbr:f.away.abbr} ${q.line!>0?'+':''}${q.line}`,p:probability,experimental:true,line:q.line!});}
        } else {
          const p=plPrediction(mergedPl,f.home.name,f.away.name,cutoff);prediction=p;
          extra=[{key:'home',side:'home',label:`${f.home.name} to win`,p:p.home,experimental:false},{key:'draw',side:'draw',label:'Draw',p:p.draw,experimental:false},{key:'away',side:'away',label:`${f.away.name} to win`,p:p.away,experimental:false},
            {key:'total:over',side:'over',label:'Over 2.5 goals',p:p.over,experimental:true,line:2.5},{key:'total:under',side:'under',label:'Under 2.5 goals',p:1-p.over,experimental:true,line:2.5},{key:'btts:yes',side:'yes',label:'Both teams to score',p:p.btts,experimental:true},{key:'btts:no',side:'no',label:'Both teams to score · No',p:1-p.btts,experimental:true}];
        }
        const options:Option[]=extra.map(e=>{
          const market=e.key.includes(':')?e.key.split(':')[0]:'moneyline';
          const quote=odds?.value.quotes.find(q=>q.fixtureId===f.id&&q.market===market&&q.side===e.side&&(e.line===undefined||e.line===q.line))||null;
          const edge=quote?e.p-quote.marketProbability:null,ev=quote?e.p*quote.decimal-1:null;
          const resultSnapshot=(sport==='nba'?nbaCurrent:plCurrent)?.at;
          const timesGood=fresh(feed.at,360)&&fresh(resultSnapshot,26*60)&&quote&&fresh(quote.observedAt,ODDS_CACHE_MINUTES)&&Date.parse(quote.observedAt)>=Date.parse(resultSnapshot||seed.snapshot);
          const supported=!!(timesGood&&!e.experimental&&!prediction.unknownTeam&&!f.completed&&!f.preseason&&!f.unsupported&&f.status==='Scheduled'&&Date.parse(f.start)>Date.now()+300000&&date>=today);
          const eligible=supported&&e.p>=.55&&edge!==null&&edge>=.025&&ev!==null&&ev>=.02;
          const suggestionEligible=supported&&market==='moneyline'&&e.p>=.5&&edge!==null&&edge>0&&ev!==null&&ev>0;
          const pct=(value:number)=>(100*value).toFixed(1)+'%';
          const selected=e.side==='home'?f.home:f.away;
          const modelReason=sport==='nba'?`${e.label}: ${pct(e.p)} team-model chance. The opponent-adjusted strength, home court and scheduled rest produce an expected ${f.home.abbr} margin of ${prediction.margin!.toFixed(1)} points.`:`${e.label}: ${pct(e.p)} model chance. Recency-weighted scoring rates project ${prediction.expectedGoals![0].toFixed(2)} goals for ${f.home.name} and ${prediction.expectedGoals![1].toFixed(2)} for ${f.away.name}.`;
          const priceReason=quote?`At ${quote.decimal.toFixed(2)} odds, fair model odds are ${(1/e.p).toFixed(2)}. The margin-removed market chance is ${pct(quote.marketProbability)} (${edge!>=0?'+':''}${(edge!*100).toFixed(1)} percentage points of model edge).`:'No complete bookmaker quote is available for a price comparison.';
          const cautions:string[]=[];
          if(sport==='nba') {cautions.push('Uses team-history probability; the unvalidated roster scenario is shown separately.');const flagged=(e.side==='home'?roster?.home:roster?.away)?.filter(p=>p.injury).length||0;if(flagged)cautions.push(`${selected.abbr} has ${flagged} provider injury flags. Verify the active lineup; flags are not automatic exclusions.`);}
          else cautions.push('The PL scoring model has no confirmed lineup adjustment.');
          return {id:`${f.id}:${e.key}:${e.line??''}:${book}`,fixtureId:f.id,sport,matchup:`${f.away.name} at ${f.home.name}`,start:f.start,label:e.label,market,side:e.side,probability:e.p,fairOdds:1/e.p,quote,edge,ev,eligible,suggestionEligible,experimental:e.experimental,reason:modelReason+' '+priceReason,cautions};
        });
        all.push({...f,prediction,roster,options,note:f.preseason?'Preseason: context only; excluded from suggested slips.':f.unsupported?'This competition is outside the regular-season model.':prediction.unknownTeam?'Neutral prior used for a club without Premier League history.':undefined});
      }catch {messages.push(`No supported model forecast for ${f.away.name} at ${f.home.name}.`);}
    }
    const errors=await cached<string[]>(`health:odds:${sport}`);if(errors)messages.push(...errors.value);
  }
  return {date,today,fixtures:all.sort((a,b)=>a.start.localeCompare(b.start)),book,generatedAt:new Date().toISOString(),counts:{nba:mergedNba.filter(g=>g.completed).length,epl:mergedPl.length},health:{fixturesAt:fixtureTimes.sort()[0]||null,resultsAt:resultsTimes.sort()[0]||null,rosterAt:rosterTimes.sort()[0]||seed.snapshot,oddsAt:oddsTimes.sort()[0]||null,keyConfigured:!!env.THERUNDOWN_API_KEY,messages:[...new Set(messages)],playerGamesMissing:(nbaCurrent?.value||[]).filter(g=>g.completed&&!boxes?.value.processed.includes(g.id)).length}};
}
