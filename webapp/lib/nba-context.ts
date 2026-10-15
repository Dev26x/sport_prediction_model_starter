import { normalCdf } from './models';
import type { RosterPlayer } from './types';
export type NewsItem={title:string;url:string;publishedAt:string;source:string};
export type InjuryItem={teamId:string;playerId:string;name:string;status:string;reportedAt:string|null;detail:string;url:string};
export type NbaContext={news:NewsItem[];injuries:InjuryItem[];checkedAt:string|null;officialReport:{url:string;publishedAt:string|null;available:boolean};messages:string[]};
export function sourceUrl(value:unknown):string|null{try{const u=new URL(String(value));return u.protocol==='https:'&&(u.hostname==='espn.com'||u.hostname.endsWith('.espn.com')||u.hostname==='nba.com'||u.hostname.endsWith('.nba.com'))?u.href:null;}catch{return null;}}
export function parseNews(payload:any,teamId:string,teamName:string,now=Date.now()):NewsItem[]{
  const keywords=teamName.toLowerCase().split(' ').filter(w=>w.length>3);
  return (payload.articles||[]).filter((a:any)=>{const ids=(a.categories||[]).filter((c:any)=>c.type==='team').map((c:any)=>String(c.teamId||c.team?.id||''));return ids.includes(teamId)||!ids.length&&keywords.some(w=>String(a.headline).toLowerCase().includes(w));}).flatMap((a:any)=>{const url=sourceUrl(a.links?.web?.href),at=a.published||a.lastModified;return url&&a.headline&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now?[{title:String(a.headline).slice(0,220),url,publishedAt:at,source:'ESPN'}]:[];}).sort((a:NewsItem,b:NewsItem)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,6);
}
export function parseInjuries(payload:any):InjuryItem[]{
  const output:InjuryItem[]=[];
  for(const group of payload.injuries||[]){const teamId=String(group.id||group.team?.id||'');for(const row of group.injuries||[]){const p=row.athlete||{},at=row.date||row.lastUpdated||p.injuries?.[0]?.date;const playerId=String(p.id||'');if(!teamId||!playerId||!row.status)continue;output.push({teamId,playerId,name:p.displayName||p.fullName||playerId,status:String(row.status),reportedAt:Number.isFinite(Date.parse(at))?at:null,detail:String(row.shortComment||row.details?.type||'').slice(0,250),url:sourceUrl(p.links?.find((l:any)=>l.rel?.includes('playercard'))?.href)||'https://www.espn.com/nba/injuries'});}}
  return output;
}
export function currentStatus(player:RosterPlayer,start:string,checkedAt:string|null,now=Date.now()):string{
  const at=Date.parse(player.injuryAt||'');
  // Old training-camp flags are context, never confirmed match-day exclusions.
  if(!checkedAt||!Number.isFinite(at)||at>now||now-at>48*3600000||now-Date.parse(checkedAt)>30*60000||Date.parse(start)>now+48*3600000)return 'Unconfirmed';
  return player.injury||'Available';
}
export function rotationProjection(players:RosterPlayer[],priors:Record<string,{mpg:number;minutes:number;impact:number}>,previous:number,start:string,checkedAt:string|null,now=Date.now()){
  const ranked=players.map(p=>{const prior=priors[p.id],role=p.depth===1?30:p.depth===2?18:p.depth===3?8:3;return {...p,status:currentStatus(p,start,checkedAt,now),weight:prior?.minutes?(.5*Math.max(4,prior.mpg)+.5*role):role,impact:prior?.impact||0};}).sort((a,b)=>b.weight-a.weight);
  function allocate(excludeOut:boolean){const active=ranked.filter(p=>!excludeOut||!/^out$|^suspended$|^inactive$/i.test(p.status)).slice(0,11),minutes=Array(active.length).fill(0);let remaining=240,indices=active.map((_,i)=>i);if(active.length<6)return {value:previous,minutes:new Map<string,number>(),complete:false};while(indices.length){const sum=indices.reduce((s,i)=>s+active[i].weight,0),over=indices.filter(i=>active[i].weight/sum*remaining>40);if(!over.length){for(const i of indices)minutes[i]=active[i].weight/sum*remaining;break;}for(const i of over){minutes[i]=40;remaining-=40;}indices=indices.filter(i=>!over.includes(i));}return {value:active.reduce((s,p,i)=>s+p.impact*minutes[i]/48,0),minutes:new Map(active.map((p,i)=>[p.id,minutes[i]])),complete:true};}
  const all=allocate(false),available=allocate(true),clamp=(n:number)=>Math.max(-8,Math.min(8,n));
  const rosterDelta=clamp(.5*(all.value-previous)),totalDelta=clamp(.5*(available.value-previous));
  return {players:ranked.map(p=>({...p,projectedMinutes:available.minutes.get(p.id)||0,impact:p.impact})),rosterDelta,injuryDelta:totalDelta-rosterDelta,totalDelta,complete:available.complete,excluded:ranked.filter(p=>/^out$|^suspended$|^inactive$/i.test(p.status)).map(p=>p.name)};
}
export function rosterForecast(base:{margin:number;sigma:number;home:number},homeDelta:number,awayDelta:number,scale:number){const margin=base.margin+homeDelta-awayDelta,home=normalCdf(margin/(base.sigma*scale));return {margin,home,away:1-home,baselineMargin:base.margin,baselineHome:base.home,rosterDelta:homeDelta-awayDelta};}
export function officialReportFromHtml(html:string,indexUrl:string,now=Date.now()){
  const links=[...html.matchAll(/https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_\d{4}-\d{2}-\d{2}_[^"'<>\s]+\.pdf/g)].map(m=>m[0]).filter(u=>{const day=u.match(/Report_(\d{4}-\d{2}-\d{2})/)?.[1];return !!day&&day<=new Date(now).toISOString().slice(0,10);}).sort();
  return {url:links.at(-1)||indexUrl,publishedAt:links.at(-1)?.match(/Report_(\d{4}-\d{2}-\d{2})/)?.[1]||null,available:links.length>0};
}
