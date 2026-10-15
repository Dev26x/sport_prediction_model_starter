import type { NbaGame, PlGame } from './types';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'});
export function localDay(value: string | number | Date): string { return DAY_FORMAT.format(new Date(value)); }
export function days(a: string, b: string) { return Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000); }
export function addDays(day: string, count: number) { return new Date(Date.parse(day + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10); }
export function normalCdf(x: number) {
  const z = Math.abs(x), t = 1 / (1 + .2316419 * z);
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t * (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}
function solve(matrix: number[][], vector: number[]) {
  const a = matrix.map((row, i) => [...row, vector[i]]), n = a.length;
  for (let p = 0; p < n; p++) {
    let pivot = p;
    for (let i = p + 1; i < n; i++) if (Math.abs(a[i][p]) > Math.abs(a[pivot][p])) pivot = i;
    [a[p], a[pivot]] = [a[pivot], a[p]];
    if (Math.abs(a[p][p]) < 1e-12) throw new Error('Model matrix is singular.');
    const v = a[p][p]; for (let j = p; j <= n; j++) a[p][j] /= v;
    for (let i = 0; i < n; i++) if (i !== p) { const f = a[i][p]; for (let j = p; j <= n; j++) a[i][j] -= f * a[p][j]; }
  }
  return a.map(row => row[n]);
}
function rest(last: string | undefined, day: string,cap=3) { return last ? Math.max(0, Math.min(cap, days(day, last) - 1)) : cap; }
export type MarginSettings={halfLife:number;teamPenalty:number;restPenalty:number;restCap:number;sigmaFloor:number;minHistory:number;nflTies?:boolean};
export const MARGIN_SETTINGS:Record<string,MarginSettings>={
  nba:{halfLife:365,teamPenalty:35,restPenalty:100,restCap:3,sigmaFloor:5,minHistory:300},
  nfl:{halfLife:365,teamPenalty:6,restPenalty:100,restCap:10,sigmaFloor:7,minHistory:200,nflTies:true},
  nhl:{halfLife:180,teamPenalty:20,restPenalty:100,restCap:3,sigmaFloor:1.5,minHistory:600},
};
export function fitNba(games: NbaGame[], before: string,settings:MarginSettings=MARGIN_SETTINGS.nba) {
  const history = games.filter(g => g.completed && g.hp !== null && g.ap !== null && localDay(g.start) < before).sort((a,b)=>a.start.localeCompare(b.start));
  if (history.length < settings.minHistory) throw new Error(`At least ${settings.minHistory} earlier regular-season games are required.`);
  const ids = [...new Set(history.flatMap(g => [g.home, g.away]))].sort();
  const ix = new Map(ids.map((id, i) => [id, i])), n = ids.length + 2;
  const a = Array.from({length:n}, (_,i)=>Array.from({length:n},(_,j)=>i===j ? i<n-2?settings.teamPenalty:i===n-2?.01:settings.restPenalty : 0));
  const b = Array(n).fill(0), last: Record<string,string> = {}, records: {x:number[];y:number;w:number}[] = [];
  let pending: NbaGame[] = [], current = '';
  for (const g of history) {
    const day = localDay(g.start);
    if (day !== current) { for (const old of pending) {last[old.home]=current;last[old.away]=current;} pending=[];current=day; }
    const x = Array(n).fill(0); x[ix.get(g.home)!]=1;x[ix.get(g.away)!]=-1;x[n-2]=g.neutral?0:1;x[n-1]=rest(last[g.home],day,settings.restCap)-rest(last[g.away],day,settings.restCap);
    const w = 2 ** (-days(before,day)/settings.halfLife), y = g.hp! - g.ap!;
    const nonzero=x.map((v,i)=>[v,i]).filter(([v])=>v!==0);
    for(const [v,i] of nonzero) {b[i]+=v*y*w;for(const [v2,j] of nonzero)a[i][j]+=v*v2*w;}
    records.push({x,y,w}); pending.push(g);
  }
  for(const g of pending){last[g.home]=current;last[g.away]=current;}
  const coefficients=solve(a,b), weight=records.reduce((s,r)=>s+r.w,0);
  const sigma=Math.max(settings.sigmaFloor,Math.sqrt(records.reduce((s,r)=>s+r.w*(r.y-r.x.reduce((v,x,i)=>v+x*coefficients[i],0))**2,0)/weight));
  const tieProbability=settings.nflTies?(records.filter(r=>r.y===0).reduce((s,r)=>s+r.w,0)+2)/(weight+500):0;
  return {ids,coefficients,sigma,last,history:history.length,lastResult:current,restCap:settings.restCap,tieProbability};
}
export function nbaPrediction(model: ReturnType<typeof fitNba>, home: string, away: string, day: string, scale: number, neutral=false, schedule: NbaGame[]=[]) {
  const h=model.ids.indexOf(home),a=model.ids.indexOf(away),n=model.coefficients.length;
  if(h<0||a<0||h===a)throw new Error('Team identity does not match NBA history.');
  const seen={...model.last};
  for(const g of schedule) { const d=localDay(g.start); if(d<day && d>=(seen[g.home]||''))seen[g.home]=d;if(d<day && d>=(seen[g.away]||''))seen[g.away]=d; }
  const margin=model.coefficients[h]-model.coefficients[a]+(neutral?0:model.coefficients[n-2])+model.coefficients[n-1]*(rest(seen[home],day,model.restCap)-rest(seen[away],day,model.restCap));
  const conditionalHome=normalCdf(margin/(model.sigma*scale)),draw=model.tieProbability;
  return {margin,home:(1-draw)*conditionalHome,away:(1-draw)*(1-conditionalHome),draw,conditionalHome,sigma:model.sigma,history:model.history,lastResult:model.lastResult};
}
export function plPrediction(games: PlGame[], home: string, away: string, before: string) {
  const history=games.filter(g=>g.day<before).map(g=>({...g,w:2**(-days(before,g.day)/180)}));
  const total=history.reduce((s,g)=>s+g.w,0); if(!total)throw new Error('No earlier Premier League results.');
  const lh=history.reduce((s,g)=>s+g.w*g.hp,0)/total,la=history.reduce((s,g)=>s+g.w*g.ap,0)/total;
  const shrunk=(team:string,side:'home'|'away',key:'hp'|'ap',base:number)=>{
    const rows=history.filter(g=>g[side]===team);return(rows.reduce((s,g)=>s+g.w*g[key],0)+8*base)/(rows.reduce((s,g)=>s+g.w,0)+8)/base;
  };
  const eh=lh*shrunk(home,'home','hp',lh)*shrunk(away,'away','hp',lh),ea=la*shrunk(away,'away','ap',la)*shrunk(home,'home','ap',la);
  const poisson=(mean:number)=>{const p=[Math.exp(-mean)];for(let i=1;i<=15;i++)p.push(p[i-1]*mean/i);return p;};
  const ph=poisson(eh),pa=poisson(ea);let hw=0,draw=0,aw=0,over=0,btts=0,sum=0;
  for(let i=0;i<=15;i++)for(let j=0;j<=15;j++){const p=ph[i]*pa[j];sum+=p;if(i>j)hw+=p;else if(i===j)draw+=p;else aw+=p;if(i+j>=3)over+=p;if(i>0&&j>0)btts+=p;}
  return {home:hw/sum,draw:draw/sum,away:aw/sum,over:over/sum,btts:btts/sum,expectedGoals:[eh,ea],history:history.length,lastResult:history.map(g=>g.day).sort().at(-1)!,unknownTeam:![home,away].every(t=>history.some(g=>g.home===t||g.away===t))};
}
export function americanToDecimal(price:number) {if(!Number.isFinite(price)||Math.abs(price)<100)throw new Error('Invalid/off-board odds');return price>0?1+price/100:1+100/Math.abs(price);}
