import { plName } from './markets';
import type { FootballMarketGame,FootballSport } from './football-market-types';
const CODES={epl:'E0',laliga:'SP1',seriea:'I1'};
export function footballCsvRows(text:string){
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw new Error('Unterminated football CSV field.');
 if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}const headers=rows.shift()||[];
 if(!['Div','Date','HomeTeam','AwayTeam','FTHG','FTAG'].every(h=>headers.includes(h)))throw new Error('Football statistics columns missing.');
 return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
export function parseFootballMarketCsv(text:string,sport:FootballSport,season:number,asOf:string){
 const games:FootballMarketGame[]=[],seen=new Set<string>();let rejected=0;
 const count=(s:string|undefined,max:number)=>s!==undefined&&s.trim()!==''&&/^\d+$/.test(s.trim())&&Number(s)<=max?Number(s):null;
 for(const r of footballCsvRows(text)){
  if(r.FTHG===''&&r.FTAG==='')continue;
  if(r.Div!==CODES[sport])throw new Error('Football statistics league mismatch.');
  const bits=r.Date.split('/'),year=bits[2]?.length===2?'20'+bits[2]:bits[2],day=`${year}-${bits[1]?.padStart(2,'0')}-${bits[0]?.padStart(2,'0')}`;
  const home=plName(r.HomeTeam||''),away=plName(r.AwayTeam||''),hp=count(r.FTHG,30),ap=count(r.FTAG,30),hc=count(r.HC,100),ac=count(r.AC,100);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day+'T12:00Z').toISOString().slice(0,10)!==day||day<`${season-1}-07-01`||day>=`${season}-07-01`||hp===null||ap===null||!home||!away||home===away){rejected++;continue;}
  if(day>asOf)continue;const key=`${day}:${home}:${away}`;if(seen.has(key))throw new Error('Duplicate football result; snapshot retained.');seen.add(key);
  games.push({day,home,away,hp,ap,hc,ac,season});
 }
 return {games:games.sort((a,b)=>a.day.localeCompare(b.day)),rejected};
}
export function mergeFootballMarketGames(base:FootballMarketGame[],updates:FootballMarketGame[]){const map=new Map(base.map(g=>[`${g.day}:${g.home}:${g.away}`,g]));for(const g of updates){const key=`${g.day}:${g.home}:${g.away}`,old=map.get(key);map.set(key,{...g,hc:g.hc??old?.hc??null,ac:g.ac??old?.ac??null});}return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day));}
