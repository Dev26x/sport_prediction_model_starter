import { localDay } from './models';
import type { NbaGame,PlGame } from './types';
export type ResultRow={id:string;day:string;opponent:string;home:boolean;for:number;against:number;result:'W'|'D'|'L'};
export function teamResults(games:(NbaGame|PlGame)[],team:string,before:string):ResultRow[]{
  return games.flatMap((g)=>{const margin='start'in g,day=margin?localDay(g.start):g.day;if(day>=before||margin&&!g.completed||g.hp===null||g.ap===null||![g.home,g.away].includes(team))return[];const home=g.home===team,f=home?g.hp:g.ap,a=home?g.ap:g.hp;return [{id:margin?g.id:`${day}:${g.home}:${g.away}`,day,opponent:home?g.away:g.home,home,for:f,against:a,result:f>a?'W':f<a?'L':'D'} as ResultRow];}).sort((a,b)=>b.day.localeCompare(a.day)||b.id.localeCompare(a.id));
}
export function resultSummary(rows:ResultRow[]){const n=rows.length,w=rows.filter(r=>r.result==='W').length,d=rows.filter(r=>r.result==='D').length,scored=rows.reduce((s,r)=>s+r.for,0),allowed=rows.reduce((s,r)=>s+r.against,0);return {games:n,wins:w,draws:d,losses:n-w-d,scored,allowed,scoredPerGame:n?scored/n:null,allowedPerGame:n?allowed/n:null,winRate:n?w/n:null,form:rows.slice(0,5).map(r=>r.result).join(' · ')};}
export function formSentence(name:string,rows:ResultRow[],unit:string){const last=rows.slice(0,5),s=resultSummary(last);return s.games?`${name} last ${s.games}: ${s.wins}W ${s.draws}D ${s.losses}L, ${s.scored} ${unit} scored and ${s.allowed} conceded.`:`${name} has no earlier results in the available history.`;}
