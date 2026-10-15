import { legPrice,hasCurrentQuote } from './slips';
import type { Option } from './types';
import type { PaperFrozen,PaperRecord,PaperLegResult,PaperResult,PaperPriceBasis,PaperSummary } from './paper-types';
export const PAPER_OPENING_CENTS=20000,PAPER_STAKE_CENTS=500,PAPER_MODEL_VERSION='paper-v1:probability-first-team-v3';
export function paperCaptureWindow(now:number){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Toronto',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)))>=6;}
export function paperPriceBasis(legs:Option[],now:number):PaperPriceBasis {const n=legs.filter(l=>!!l.quote).length;return !n?'model':n<legs.length?'mixed':legs.every(l=>hasCurrentQuote(l,now))?'quoted-current':'quoted-dated';}
export function pendingLeg(o:Option):PaperLegResult{return {id:o.id,state:'pending',homeScore:null,awayScore:null,status:'Awaiting official final result',checkedAt:null,source:null};}
export function settlePaperLeg(option:Option,result:PaperResult|undefined,previous= pendingLeg(option)):PaperLegResult{
 if(['won','lost','void'].includes(previous.state)||!result)return previous;
 const base={...previous,homeScore:result.homeScore,awayScore:result.awayScore,status:result.status,checkedAt:result.at,source:result.source};
 if(result.fixtureId!==option.fixtureId||result.sport!==option.sport)return {...base,state:'review',status:'Result identity mismatch; no settlement'};
 if(result.voided)return {...base,state:'void',status:'Officially cancelled/abandoned; paper leg voided'};
 if(!result.completed)return {...base,state:'pending'};
 const h=result.homeScore,a=result.awayScore;if(h===null||a===null||![h,a].every(v=>Number.isFinite(v)&&v>=0))return {...base,state:'review',status:'Final score missing or invalid'};
 if(h===a&&['nba','nhl'].includes(option.sport))return {...base,state:'review',status:'A tied NBA/NHL score is not a supported final winner'};
 if(option.market==='moneyline'){
  if(option.sport==='nfl'&&h===a)return {...base,state:'void',status:'NFL tie: two-way winner leg voided under paper rules'};
  if(!['home','away','draw'].includes(option.side))return {...base,state:'review',status:'Unsupported result side'};
  const won=option.side==='home'?h>a:option.side==='away'?a>h:h===a;return {...base,state:won?'won':'lost'};
 }
 if(option.market==='doublechance'){
  if(!['epl','laliga','seriea'].includes(option.sport)||!['home_draw','away_draw','home_away'].includes(option.side))return {...base,state:'review',status:'Unsupported double-chance selection'};
  const won=option.side==='home_draw'?h>=a:option.side==='away_draw'?a>=h:h!==a;return {...base,state:won?'won':'lost'};
 }
 return {...base,state:'review',status:'Unsupported market; no automatic settlement'};
}
export function settlePaperSlip(frozen:PaperFrozen,stakeCents:number,results:PaperLegResult[]){
 const unresolved=results.filter(r=>r.state==='pending'||r.state==='review').length;
 if(stakeCents===0)return {status:'skipped' as const,grossCents:0,unresolvedLegs:0};
 if(results.length!==frozen.legs.length||!results.length||results.some((r,i)=>r.id!==frozen.legs[i].id))throw new Error('Paper leg/result identities do not match.');
 if(results.some(r=>r.state==='lost'))return {status:'lost' as const,grossCents:0,unresolvedLegs:unresolved};
 if(unresolved)return {status:'pending' as const,grossCents:0,unresolvedLegs:unresolved};
 if(results.every(r=>r.state==='void'))return {status:'void' as const,grossCents:stakeCents,unresolvedLegs:0};
 const multiplier=frozen.legs.reduce((p,l,i)=>results[i].state==='void'?p:p*legPrice(l)!,1),grossCents=Math.round(stakeCents*multiplier);
 if(!Number.isSafeInteger(grossCents)||grossCents<stakeCents)throw new Error('Paper return exceeds safe money precision. Manual review required.');
 return {status:'won' as const,grossCents,unresolvedLegs:0};
}
export function summarizePaper(records:PaperRecord[]):PaperSummary{
 const stakedCents=records.reduce((s,r)=>s+r.stakeCents,0),gross=records.reduce((s,r)=>s+r.grossCents,0),openStakeCents=records.filter(r=>r.status==='pending').reduce((s,r)=>s+r.stakeCents,0),cashCents=PAPER_OPENING_CENTS-stakedCents+gross;
 const won=records.filter(r=>r.status==='won').length,lost=records.filter(r=>r.status==='lost').length,voided=records.filter(r=>r.status==='void').length,settled=records.filter(r=>['won','lost','void'].includes(r.status)),profitCents=settled.reduce((s,r)=>s+r.grossCents-r.stakeCents,0),settledStakeCents=records.filter(r=>r.status==='won'||r.status==='lost').reduce((s,r)=>s+r.stakeCents,0);
 const curve:{at:string;equityCents:number}[]=[{at:'Opening balance',equityCents:PAPER_OPENING_CENTS}];let equity=PAPER_OPENING_CENTS,peak=equity,maxDrawdownCents=0;
 for(const r of [...settled].sort((a,b)=>(a.settledAt||'').localeCompare(b.settledAt||'')||a.id.localeCompare(b.id))){equity+=r.grossCents-r.stakeCents;peak=Math.max(peak,equity);maxDrawdownCents=Math.max(maxDrawdownCents,peak-equity);curve.push({at:r.settledAt||r.day,equityCents:equity});}
 return {openingCents:PAPER_OPENING_CENTS,cashCents,openStakeCents,equityCents:cashCents+openStakeCents,profitCents,settledStakeCents,roi:settledStakeCents?profitCents/settledStakeCents:null,cashRate:won+lost?won/(won+lost):null,won,lost,voided,pending:records.filter(r=>r.status==='pending').length,skipped:records.filter(r=>r.status==='skipped').length,stakedCents,priceGroups:(['quoted-current','quoted-dated','mixed','model'] as const).map(basis=>{const rows=records.filter(r=>r.frozen.priceBasis===basis);return {basis,won:rows.filter(r=>r.status==='won').length,lost:rows.filter(r=>r.status==='lost').length,pending:rows.filter(r=>r.status==='pending').length,profitCents:rows.filter(r=>r.status!=='pending'&&r.status!=='skipped').reduce((s,r)=>s+r.grossCents-r.stakeCents,0)};}),curve,maxDrawdownCents};
}
