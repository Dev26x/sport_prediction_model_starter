import raw from './expanded-seed.json';
import { cached, fresh, putCache } from './storage';
import { localDay } from './models';
import { canonicalAbbr } from './competitions';
import type { NbaGame, PlGame, Sport, Team } from './types';
export type MarginSport='nfl'|'nhl';
export type ExtraSeed={margin:Record<MarginSport,{games:NbaGame[];teams:(Team&{espn_id?:string})[];snapshot:string;scale:number;fittedBefore:string}>;football:Record<string,{games:PlGame[];snapshot:string}>;evaluations:Record<string,{test_games:number;accuracy:number;log_loss:number;baseline_accuracy:number;test_season:string}>};
export const extraSeed=raw as unknown as ExtraSeed;
export function extraTeam(sport:Sport,abbr:string){if(sport!=='nfl'&&sport!=='nhl')return undefined;const state=extraSeed.margin[sport],year=sport==='nfl'?2026:2027;const currentIds=new Set(state.games.filter(g=>g.season===year).flatMap(g=>[g.home,g.away]));return state.teams.find(t=>t.abbr===canonicalAbbr(sport,abbr)&&currentIds.has(t.id));}
export function extraSnapshot(sport:Sport){return sport==='nfl'||sport==='nhl'?extraSeed.margin[sport].snapshot:extraSeed.football[sport]?.snapshot;}
function csv(text:string){const rows:string[][]=[];let row:string[]=[],s='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){s+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(s);s='';}else if(c==='\n'&&!quote){row.push(s.replace(/\r$/,''));rows.push(row);row=[];s='';}else s+=c;}if(s||row.length){row.push(s);rows.push(row);}const headers=rows.shift()||[];return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((k,i)=>[k,r[i]])));}
function easternStart(day:string,time:string){const zone=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).formatToParts(new Date(day+'T12:00Z')).find(p=>p.type==='timeZoneName')?.value.replace('GMT','')||'-05:00';return new Date(`${day}T${time||'13:00'}:00${zone}`).toISOString();}
async function publicFetch(url:string){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Public results feed returned HTTP ${r.status}.`);return r;}
export async function refreshExtraResults(sport:MarginSport) {
  const old=await cached<NbaGame[]>(`${sport}:current`);if(fresh(old?.at,60))return [`${sport.toUpperCase()} results were checked within the last hour.`];
  let games:NbaGame[]=[];
  if(sport==='nfl'){
    const rows=csv(await(await publicFetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv')).text());
    for(const r of rows){if(r.season!=='2026'||r.game_type!=='REG')continue;const complete=r.home_score!==''&&r.away_score!=='';const hp=complete?Number(r.home_score):null,ap=complete?Number(r.away_score):null;if(complete&&(!Number.isInteger(hp)||!Number.isInteger(ap)||hp!<0||ap!<0))throw new Error('Invalid NFL result.');games.push({id:r.espn||r.game_id,start:easternStart(r.gameday,r.gametime),season:2026,home:canonicalAbbr('nfl',r.home_team),away:canonicalAbbr('nfl',r.away_team),hp,ap,completed:complete,neutral:r.location==='Neutral'});}
    if(games.length<250)throw new Error('Incomplete NFL schedule; existing data retained.');
  }else{
    const teams=extraSeed.margin.nhl.teams.filter(t=>extraSeed.margin.nhl.games.some(g=>g.season===2027&&(g.home===t.id||g.away===t.id)));
    // 32 public club requests plus the daily fixture request remain below the
    // per-request Worker subrequest bound. Requests run in bounded batches.
    const collected=new Map<string,NbaGame>();
    for(let i=0;i<teams.length;i+=5)await Promise.all(teams.slice(i,i+5).map(async team=>{
      const payload=await(await publicFetch(`https://api-web.nhle.com/v1/club-schedule-season/${team.abbr}/20262027`)).json() as any;
      for(const g of payload.games||[]){if(g.gameType!==2||Number(g.season)!==20262027)continue;const complete=['FINAL','OFF'].includes(g.gameState),h=g.homeTeam,a=g.awayTeam;if(complete&&(!Number.isInteger(h.score)||!Number.isInteger(a.score)||h.score<0||a.score<0||h.score===a.score))throw new Error('Invalid NHL final result.');collected.set(String(g.id),{id:String(g.id),start:g.startTimeUTC,season:2027,home:String(h.id),away:String(a.id),hp:complete?h.score:null,ap:complete?a.score:null,completed:complete,neutral:!!g.neutralSite});}
    }));
    games=[...collected.values()];if(games.length<1200)throw new Error('Incomplete NHL schedule; existing data retained.');
  }
  const previousCompleted=(old?.value||extraSeed.margin[sport].games.filter(g=>g.season===(sport==='nfl'?2026:2027))).filter(g=>g.completed&&localDay(g.start)<localDay(Date.now())).length;
  if(games.filter(g=>g.completed&&localDay(g.start)<localDay(Date.now())).length<previousCompleted)throw new Error('The public feed lost completed games; previous result snapshot retained.');
  await putCache(`${sport}:current`,games);return [`${sport.toUpperCase()}: checked ${games.filter(g=>g.completed).length} current-season final results and ${games.length} fixtures.`];
}
