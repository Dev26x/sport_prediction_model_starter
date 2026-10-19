import type { Fixture } from './types';
import type { SgpPool,SgpSport } from './sgp-types';
export const SGP_POOLS=[{id:'both',label:'NBA + NFL'},{id:'nba',label:'NBA only'},{id:'nfl',label:'NFL only'}] as const;
export function sgpPoolSports(pool:SgpPool):SgpSport[]{return pool==='both'?['nba','nfl']:[pool];}
export function inSgpPool(sport:string,pool:SgpPool){return (sport==='nba'||sport==='nfl')&&(pool==='both'||sport===pool);}
export function dailySgpFixtures(fixtures:Fixture[],pool:SgpPool,now=Date.now()){
 return [...new Map(fixtures.filter(f=>inSgpPool(f.sport,pool)&&!f.completed&&!f.preseason&&!f.unsupported&&Date.parse(f.start)>now+300000&&/^scheduled$/i.test(f.status)).map(f=>[`${f.sport}:${f.id}`,f])).values()].sort((a,b)=>a.start.localeCompare(b.start)||a.sport.localeCompare(b.sport)||a.id.localeCompare(b.id));
}
