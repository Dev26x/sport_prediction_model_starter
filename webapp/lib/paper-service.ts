import { env } from 'cloudflare:workers';
import { database,cached,putCache,fresh } from './storage';
import { dashboard,validateInput,parseEvents,refreshSources,refreshRosters,refreshPlayers,refreshNbaContext } from './service';
import { localDay } from './models';
import { COMPETITIONS,SPORTS } from './competitions';
import { buildSuggestedSlips,SLIP_PROFILES,legPrice } from './slips';
import { PAPER_STAKE_CENTS,PAPER_MODEL_VERSION,paperPriceBasis,settlePaperLeg,settlePaperSlip,summarizePaper,paperCaptureWindow } from './paper-model';
import { paperCaptureSql } from './paper-sql';
import type { PaperFrozen,PaperRecord,PaperResult,PaperSnapshot,PaperDashboard } from './paper-types';
import type { Sport } from './types';
type Row={id:string;day:string;profile:PaperRecord['profile'];frozen:string;stake_cents:number;status:PaperRecord['status'];gross_cents:number;results:string;unresolved_legs:number;settled_at:string|null;checked_at:string|null};
function record(r:Row):PaperRecord{return {id:r.id,day:r.day,profile:r.profile,frozen:JSON.parse(r.frozen),stakeCents:r.stake_cents,status:r.status,grossCents:r.gross_cents,results:JSON.parse(r.results),unresolvedLegs:r.unresolved_legs,settledAt:r.settled_at,checkedAt:r.checked_at};}
export async function paperRecords(mode:'all'|'open'|'recent'='all'){const sql=mode==='open'?"SELECT * FROM paper_slips WHERE stake_cents > 0 AND (status = 'pending' OR unresolved_legs > 0) ORDER BY day DESC,id":mode==='recent'?"SELECT * FROM paper_slips WHERE day >= date('now','-90 days') ORDER BY day DESC,id":'SELECT * FROM paper_slips ORDER BY day DESC,id';return (await database().prepare(sql).all<Row>()).results.map(record);}
export async function paperDashboard():Promise<PaperDashboard>{const rows=await paperRecords('recent'),totals=await database().prepare("SELECT id,day,profile,stake_cents,status,gross_cents,settled_at,checked_at,unresolved_legs,json_object('priceBasis',json_extract(frozen,'$.priceBasis')) AS frozen,'[]' AS results FROM paper_slips ORDER BY day,id").all<Row>(),days=await database().prepare("SELECT snapshot FROM paper_days WHERE day >= date('now','-90 days') ORDER BY day DESC").all<{snapshot:string}>(),health=await cached<string[]>('paper:health'),automation=await cached<{configured:boolean;description:string}>('paper:automation');return {today:localDay(Date.now()),days:days.results.map(r=>JSON.parse(r.snapshot)),slips:rows,summary:summarizePaper(totals.results.map(record)),updatedAt:new Date().toISOString(),messages:health?.value||[],automation:automation?.value||{configured:false,description:'Updates when this page is opened or refreshed. Unattended daily run is not configured.'}};}
export async function capturePaperDay(){
 const now=Date.now(),day=localDay(now),db=database();validateInput(day,'all','23');const existing=await db.prepare('SELECT day FROM paper_days WHERE day = ?').bind(day).first();
 if(existing)return {messages:[`${day}: daily slips are already frozen. No duplicate stakes or price changes.`]};
 if(!paperCaptureWindow(now))return {messages:['Daily paper capture opens at 06:00 Toronto time. No stakes recorded yet.']};
 const board=await dashboard(day,'all','23'),eligible=board.fixtures.filter(f=>!f.preseason&&!f.unsupported&&!f.completed&&Date.parse(f.start)>now+300000),started=board.fixtures.filter(f=>!f.preseason&&!f.unsupported&&Date.parse(f.start)<=now+300000).length;
 const capturedAt=new Date(now).toISOString(),suggestions=buildSuggestedSlips(board.fixtures.flatMap(f=>f.options),'23',now);
 const snapshot:PaperSnapshot={day,capturedAt,modelVersion:PAPER_MODEL_VERSION,book:'23',asOf:day,fixtures:board.fixtures.length,eligibleFixtures:eligible.length,startedOmitted:started,dataMessages:board.health.messages,captureReason:started?'Late first capture: started games omitted; no retrospective bets.':'Captured before the selected fixtures started. Future dates are not booked in advance.'};
 const frozenSlips:PaperFrozen[]=[];
 for(const profile of SLIP_PROFILES){const s=suggestions.find(r=>r.id===profile.id)!;
  const valid=s.legs.length>0&&s.legs.every(o=>legPrice(o)!>1)&&s.decimalOdds!==null&&Number.isFinite(s.decimalOdds)&&Number.isSafeInteger(Math.round(PAPER_STAKE_CENTS*s.decimalOdds));
  const frozen:PaperFrozen={profile:profile.id,legs:valid?s.legs:[],odds:valid?s.decimalOdds:null,probability:valid?s.probability:null,targetReached:s.targetReached,reason:valid?s.reason:'No supported priced selections at capture. No stake taken.',priceBasis:paperPriceBasis(s.legs,now),capturedAt,modelVersion:PAPER_MODEL_VERSION};
  frozenSlips.push(frozen);
 }
 // One atomic D1 batch. Unique day/profile IDs make concurrent retries harmless;
 // each insert checks the ledger balance after the preceding insert.
 await db.batch(paperCaptureSql(snapshot,frozenSlips).map(q=>db.prepare(q.sql).bind(...q.args)));return {messages:[`${day}: four daily profiles frozen at CAD $5 each when supported and affordable. No SGP stakes. No paid odds refresh.`]};
}
export function parsePaperResults(payload:any,sport:Sport,at:string):PaperResult[]{
 const fixtures=parseEvents(payload,sport),out:PaperResult[]=[];
 for(const f of fixtures){const e=payload.events?.find((r:any)=>String(r.id)===f.id),status=e?.competitions?.[0]?.status?.type||e?.status?.type||{},voided=/CANCEL|ABANDON/i.test(`${status.name||''} ${status.description||''}`);out.push({fixtureId:f.id,sport,homeId:f.home.id,awayId:f.away.id,completed:f.completed,homeScore:f.hp??null,awayScore:f.ap??null,status:f.status,voided,at,source:`https://www.espn.com/${sport==='epl'||sport==='laliga'||sport==='seriea'?'soccer':sport}/game/_/gameId/${f.id}`});}return out;
}
export async function resultGroups(){const records=await paperRecords('open');return [...new Set(records.filter(r=>r.stakeCents>0&&(r.status==='pending'||r.unresolvedLegs>0)).flatMap(r=>r.frozen.legs.filter((_,i)=>['pending','review'].includes(r.results[i]?.state||'pending')).map(l=>`${r.day}:${l.sport}`)))].sort();}
export async function settlePaperGroup(day:string,sport:Sport){
 const key=`paper:results:${day}:${sport}`,old=await cached<PaperResult[]>(key),now=new Date().toISOString();let results=old?.value;
 if(!fresh(old?.at,15)){
  const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${COMPETITIONS[sport].path}/scoreboard?dates=${day.replaceAll('-','')}&limit=100`,{redirect:'manual',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Public ${sport.toUpperCase()} results returned HTTP ${response.status}; pending stakes retained.`);const payload=await response.json() as any;if(!Array.isArray(payload.events))throw new Error('Results feed missing event list.');results=parsePaperResults(payload,sport,now);await putCache(key,results);
 }
 const indexed=new Map((results||[]).map(r=>[r.fixtureId,r])),records=(await paperRecords('open')).filter(r=>r.day===day&&r.stakeCents>0&&(r.status==='pending'||r.unresolvedLegs>0));let updated=0;
 for(const r of records){const legResults=r.frozen.legs.map((l,i)=>l.sport===sport?settlePaperLeg(l,indexed.get(l.fixtureId),r.results[i]):r.results[i]),settled=settlePaperSlip(r.frozen,r.stakeCents,legResults),settledAt=settled.status==='pending'?null:r.settledAt||now;
  await database().prepare('UPDATE paper_slips SET status = ?, gross_cents = ?, results = ?, unresolved_legs = ?, settled_at = ?, checked_at = ? WHERE id = ?').bind(settled.status,settled.grossCents,JSON.stringify(legResults),settled.unresolvedLegs,settledAt,now,r.id).run();updated++;
 }
 return {messages:[`${day} ${sport.toUpperCase()}: checked ${results?.length||0} public fixtures; reconciled ${updated} paper slips. Unfinished/postponed/missing results stay pending.`]};
}
export async function paperStep(action:string,sport?:Sport,day?:string){
 if(action==='source'){if(!sport||!SPORTS.includes(sport))throw new Error('Choose a supported source.');return refreshSources(localDay(Date.now()),[sport]);}
 if(action==='rosters')return refreshRosters(localDay(Date.now()));
 if(action==='depth')return refreshRosters(localDay(Date.now()),true);
 if(action==='players')return refreshPlayers();
 if(action==='nba-context')return refreshNbaContext(localDay(Date.now()));
 if(action==='capture')return capturePaperDay();
 if(action==='settle'){if(!sport||!day||!(await resultGroups()).includes(`${day}:${sport}`))return {messages:['No unresolved paper legs for that result group.']};return settlePaperGroup(day,sport);}
 throw new Error('Unsupported paper update step.');
}
export async function runnerAuthorized(request:Request){const configured=env.PAPER_RUNNER_HASH,provided=request.headers.get('X-Paper-Runner-Key');if(!configured||!provided||provided.length!==64)return false;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(provided)))).map(b=>b.toString(16).padStart(2,'0')).join('');let difference=hash.length^configured.length;for(let i=0;i<hash.length;i++)difference|=hash.charCodeAt(i)^(configured.charCodeAt(i)||0);return difference===0;}
