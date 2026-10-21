import type { FanDuelInputLine } from './fanduel-types';
import type { SgpCandidate } from './sgp-types';
export const FANDUEL_QUOTE_MINUTES=30;
export function decimalPrice(value:string|number,format:'decimal'|'american'='decimal'){
 const text=String(value).trim(),n=Number(text);if(!text||!Number.isFinite(n))throw new Error('Enter a valid price.');
 if(format==='decimal'){if(n<=1||n>100000)throw new Error('Decimal odds must be above 1 and at most 100,000.');return n;}
 if(!Number.isInteger(n)||Math.abs(n)<100||Math.abs(n)>9999900)throw new Error('American odds must be an integer of +100 or higher, or -100 or lower.');return n>0?1+n/100:1+100/Math.abs(n);
}
export function validQuoteTime(at:string,now=Date.now()){const t=Date.parse(at);return Number.isFinite(t)&&t<=now+60000&&now-t<FANDUEL_QUOTE_MINUTES*60000;}
export function fanDuelInputKey(lines:FanDuelInputLine[]){return JSON.stringify([...lines].map(q=>[q.sport,q.fixtureId,q.playerId,q.metric,q.side,q.line,q.decimalOdds,q.observedAt,q.region]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function fanDuelSelectionKey(legs:SgpCandidate[]){return JSON.stringify(legs.map(p=>[p.id,p.playerId,p.metric,p.side,p.threshold,p.quote?.fixtureId,p.quote?.decimalOdds,p.quote?.observedAt,p.quote?.region]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function quotedReturn({stake,quote,selectionKey,now=Date.now()}:{stake:number;quote:{decimal:number;selectionKey:string;enteredAt:string}|null;selectionKey:string;now?:number}){
 if(!Number.isFinite(stake)||stake<=0||stake>100000||!quote||quote.selectionKey!==selectionKey||!selectionKey||!validQuoteTime(quote.enteredAt,now)||!Number.isFinite(quote.decimal)||quote.decimal<=1||quote.decimal>100000)return null;
 let selections:unknown;try{selections=JSON.parse(selectionKey);}catch{return null;}
 if(!Array.isArray(selections)||selections.length<2||selections.length>10||selections.some(row=>!Array.isArray(row)||row[8]!=='CA-ON'||!validQuoteTime(row[7],now)))return null;
 return {decimal:quote.decimal,total:stake*quote.decimal,profit:stake*(quote.decimal-1)};
}
