import { PAPER_OPENING_CENTS,PAPER_STAKE_CENTS,pendingLeg } from './paper-model';
import type { PaperFrozen,PaperSnapshot } from './paper-types';
import { SLIP_PROFILES } from './slips';
export function paperCaptureSql(snapshot:PaperSnapshot,slips:PaperFrozen[]){
 if(slips.some(f=>!SLIP_PROFILES.some(p=>p.id===f.profile))||new Set(slips.map(f=>f.profile)).size!==slips.length)throw new Error('Only distinct normal daily profiles can enter the paper wallet.');
 const cash=`(${PAPER_OPENING_CENTS}-COALESCE((SELECT SUM(stake_cents) FROM paper_slips),0)+COALESCE((SELECT SUM(gross_cents) FROM paper_slips),0))`;
 return [{sql:'INSERT OR IGNORE INTO paper_days (day,captured_at,snapshot) VALUES (?,?,?)',args:[snapshot.day,snapshot.capturedAt,JSON.stringify(snapshot)]},...slips.map(f=>{const valid=f.legs.length&&f.odds!==null&&Number.isFinite(f.odds)&&f.odds>1&&Number.isSafeInteger(Math.round(PAPER_STAKE_CENTS*f.odds)),canStake=valid?`${cash} >= ${PAPER_STAKE_CENTS}`:'0';return {sql:`INSERT OR IGNORE INTO paper_slips (id,day,profile,frozen,stake_cents,status,gross_cents,results,unresolved_legs) SELECT ?,?,?,?,CASE WHEN ${canStake} THEN ${PAPER_STAKE_CENTS} ELSE 0 END,CASE WHEN ${canStake} THEN 'pending' ELSE 'skipped' END,0,?,CASE WHEN ${canStake} THEN ? ELSE 0 END`,args:[`${snapshot.day}:${f.profile}`,snapshot.day,f.profile,JSON.stringify(f),JSON.stringify(f.legs.map(pendingLeg)),f.legs.length]};})];
}
