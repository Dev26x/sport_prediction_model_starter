import { cached,fresh } from './storage';
import { localDay } from './models';
import { dataset } from './sgp-service';
import { researchFixtures } from './service';
import { applySgpGameContext,type SgpGameContext } from './sgp-game-context';
import { playerCandidates } from './sgp-model';
import { mergeWnbaData } from './wnba-data';
import { wnbaAvailability } from './wnba-model';
import { reviewedWnbaCandidates } from './wnba-review';
import { fanDuelSuggestions } from './fanduel-model';
import { fanDuelInputKey,validQuoteTime } from './fanduel-quotes';
import type { FanDuelAnalysis,FanDuelContext,FanDuelGroup,FanDuelInputLine,FanDuelOptions,FanDuelScope } from './fanduel-types';
import type { SgpModelSport,SgpRosterPlayer } from './sgp-types';
import type { WnbaData,WnbaFixture,WnbaSeed } from './wnba-types';

export async function fanDuelContext(date:string,sport:SgpModelSport,id:string):Promise<FanDuelContext>{
 if(!/^202[567]-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Choose a valid research date.');
 const today=localDay(Date.now()),before=date<today?date:today;
 if(sport==='wnba'){
  const base=(await import('./wnba-seed.json')).default as unknown as WnbaSeed,[update,schedule]=await Promise.all([cached<WnbaData>('wnba:players'),cached<WnbaFixture[]>('wnba:finals')]),data=update&&update.at>base.snapshot?mergeWnbaData(base,update.value):base,fixtures=schedule&&schedule.at>base.snapshot?schedule.value:base.fixtures,fixture=fixtures.find(f=>f.id===id&&f.day===date);if(!fixture)throw new Error('Choose a verified WNBA fixture on this date.');
  let rosters:Record<string,SgpRosterPlayer[]>={};const stamps:string[]=[];for(const t of [fixture.home.id,fixture.away.id]){const r=await cached<SgpRosterPlayer[]>(`wnba:roster:${t}`),use=r&&r.at>base.snapshot;rosters[t]=use?r.value:base.rosters[t]||[];stamps.push(use?r.at:base.snapshot);}
  const game=await cached<SgpGameContext>(`wnba:game:${id}`);rosters=applySgpGameContext(rosters,game&&fresh(game.at,30)?game.value:null);const rosterAt=stamps.sort()[0];return {fixture,data,before,rosters,rosterAt,historyAt:update&&update.at>base.snapshot?update.at:base.snapshot,unavailable:wnbaAvailability(fixture,fixtures,data,before,rosterAt)};
 }
 const fixtures=await researchFixtures(date,sport),fixture=fixtures.find(f=>f.id===id);if(!fixture)throw new Error('Choose an NBA/NFL fixture on this date.');const {data,at}=await dataset(sport),stamps:string[]=[];let rosters:Record<string,SgpRosterPlayer[]>={};for(const t of [fixture.home.id,fixture.away.id]){const r=await cached<SgpRosterPlayer[]>(`sgp:roster:${sport}:${t}`);rosters[t]=r?.value||data.rosters[t]||[];stamps.push(r?.at||data.snapshot);}
 const game=await cached<SgpGameContext>(`sgp:game:${sport}:${id}`);rosters=applySgpGameContext(rosters,game&&fresh(game.at,30)?game.value:null);const rosterAt=stamps.sort()[0],unavailable=fixture.completed||fixture.preseason||fixture.unsupported||fixture.status!=='Scheduled'||Date.parse(fixture.start)<=Date.now()+300000||date<today?'This fixture is closed or unsupported for pregame player-prop analysis.':!fresh(rosterAt,24*60)?'Roster data is over 24 hours old. Refresh public player data before analyzing FanDuel lines.':null;return {fixture:{...fixture,sport},data,before,rosters,rosterAt,historyAt:at,unavailable};
}
export async function fanDuelOptions(date:string,sport:SgpModelSport,id:string):Promise<FanDuelOptions>{const c=await fanDuelContext(date,sport,id);return {fixture:c.fixture,players:Object.entries(c.rosters).flatMap(([team,rows])=>rows.map(p=>({id:p.id,name:p.name,team,injury:p.injury}))),metrics:c.data.metrics,rosterAt:c.rosterAt,unavailable:c.unavailable};}
export async function analyzeFanDuelLines(date:string,lines:FanDuelInputLine[],scope:FanDuelScope='single'):Promise<FanDuelAnalysis>{
 if(!lines.length||lines.length>32)throw new Error('Add between one and 32 copied FanDuel Ontario lines.');
 const unique=new Set<string>();for(const q of lines){if(q.region!=='CA-ON'||!['nba','nfl','wnba'].includes(q.sport)||!['over','under'].includes(q.side)||!Number.isFinite(q.line)||q.line<.5||q.line>1000||q.line%1!==.5||!Number.isInteger(q.metric)||q.metric<0||q.metric>4||!Number.isFinite(q.decimalOdds)||q.decimalOdds<=1||q.decimalOdds>100000)throw new Error('Use an exact FanDuel Ontario half-point over/under line and valid decimal price. Integer lines can push and are not supported here.');const key=JSON.stringify([q.sport,q.fixtureId,q.playerId,q.metric,q.side,q.line]);if(unique.has(key))throw new Error('Duplicate player line. Keep one current price for each exact selection.');unique.add(key);if(!validQuoteTime(q.observedAt))throw new Error('A copied line is over 30 minutes old or has an invalid timestamp. Check FanDuel Ontario and enter its current price again.');}
 const keys=[...new Set(lines.map(q=>`${q.sport}:${q.fixtureId}`))],groups:FanDuelGroup[]=[],rejected:string[]=[],rosters:string[]=[],histories:string[]=[];
 for(const key of keys){const supplied=lines.filter(q=>`${q.sport}:${q.fixtureId}`===key),context=await fanDuelContext(date,supplied[0].sport,supplied[0].fixtureId);if(context.unavailable)throw new Error(`${context.fixture.away.abbr} at ${context.fixture.home.abbr}: ${context.unavailable}`);
  for(const q of supplied)if(!Number.isInteger(q.metric)||q.metric<0||q.metric>=context.data.metrics.length||!Object.values(context.rosters).some(rows=>rows.some(p=>p.id===q.playerId)))throw new Error('A copied line does not match a current player/stat in this fixture.');
  const result=context.fixture.sport==='wnba'?reviewedWnbaCandidates(context.data as WnbaData,context.fixture as WnbaFixture,context.before,context.rosters,supplied):playerCandidates(context.data,context.fixture,context.before,context.rosters,Date.now(),supplied);
  for(const q of supplied)if(!result.candidates.some(c=>c.playerId===q.playerId&&c.metric===q.metric&&c.side===q.side&&c.threshold===q.line)){const name=Object.values(context.rosters).flat().find(p=>p.id===q.playerId)?.name||q.playerId,why=result.excluded.find(p=>p.player===name)?.reason;rejected.push(`${name} ${q.side} ${q.line} ${context.data.metrics[q.metric]}: ${why||'Not supported at the 55–95% conditional model threshold or by current role/involvement checks.'}`);}
  groups.push({fixture:context.fixture,data:context.data,before:context.before,candidates:result.candidates});rosters.push(context.rosterAt);histories.push(context.historyAt);
 }
 return {region:'CA-ON',source:'manual',scope,suggestions:fanDuelSuggestions(groups,scope),qualified:groups.flatMap(g=>g.candidates.map(p=>({id:p.id,label:p.label,probability:p.probability,sport:g.fixture.sport}))),rejected,generatedAt:new Date().toISOString(),rosterAt:rosters.sort()[0],historyAt:histories.sort()[0],inputKey:fanDuelInputKey(lines)};
}
