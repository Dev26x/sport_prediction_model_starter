import type { ResearchNews } from './research-types';
export function rosterPlayers(value:any):any[]{if(!Array.isArray(value))return[];return value.flatMap(v=>Array.isArray(v.items)?rosterPlayers(v.items):v.athlete?[v.athlete]:v.id&&v.displayName?[v]:[]);}
export function publicAvailability(payload:any,teamName:string,observedAt:string):ResearchNews[]{
 const out:ResearchNews[]=[];
 for(const p of rosterPlayers(payload.athletes)){
  const injuries=Array.isArray(p.injuries)?p.injuries:[];
  for(const injury of injuries){const status=String(injury.status||injury.type?.description||'Unconfirmed injury flag'),at=injury.date||injury.lastUpdated,publishedAt=at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(observedAt)?at:null;let url='https://www.espn.com/';try{const candidate=new URL(p.links?.find((l:any)=>l.rel?.includes('playercard'))?.href);if(candidate.protocol==='https:'&&(candidate.hostname==='espn.com'||candidate.hostname.endsWith('.espn.com')))url=candidate.href;}catch{}
   out.push({title:`${p.displayName}: ${status}`,url,publishedAt,observedAt,source:'ESPN roster availability',playerName:p.displayName,teamName,status,note:String(injury.shortComment||injury.details?.detail||injury.details?.type||'Provider roster flag; verify the dated game-day report.').slice(0,350)});
  }
 }
 return out;
}
