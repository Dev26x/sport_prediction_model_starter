import { researchFixtures } from './service';
import { sgpDashboard } from './sgp-service';
import { sgpPrefixes,aggregateSgps,SGP_MODEL_VERSION } from './sgp-model';
import { cached,putCache,fresh } from './storage';
import type { DailySgpResponse,SgpPrefixSet,SgpSport,SgpPool } from './sgp-types';
import { dailySgpFixtures,sgpPoolSports } from './sgp-pool';
import { dataset } from './sgp-service';
import { localDay } from './models';
import type { Fixture } from './types';
const key=(date:string,sport:string,id:string)=>`sgp:daily-prefix:${SGP_MODEL_VERSION}:${date}:${sport}:${id}`;
async function inputRevision(f:Fixture){const entries=await Promise.all([`sgp:players:${f.sport}`,`sgp:roster:${f.sport}:${f.home.id}`,`sgp:roster:${f.sport}:${f.away.id}`].map(k=>cached(k)));return JSON.stringify([localDay(Date.now()),f.start,f.status,...entries.map(e=>e?.at||null)]);}
export async function analyzeDailyGame(date:string,sport:SgpSport,id:string){
 const response=await sgpDashboard(date,sport,id),a=response.analysis;if(!a||!dailySgpFixtures([a.fixture],sport).length)throw new Error('Choose an upcoming supported fixture.');
 const revision=await inputRevision(a.fixture),old=await cached<SgpPrefixSet>(key(date,sport,id));if(old&&fresh(old.at,30)&&old.value.generatedAt===a.generatedAt&&old.value.inputRevision===revision)return {ready:true,fixtureId:id,candidates:a.candidates.length};
 const {data}=await dataset(sport),prefixes=sgpPrefixes(data,a.candidates,a.asOf,sport);await putCache(key(date,sport,id),{fixture:a.fixture,candidates:a.candidates,prefixes,generatedAt:a.generatedAt,modelVersion:SGP_MODEL_VERSION,inputRevision:revision} satisfies SgpPrefixSet);return {ready:true,fixtureId:id,candidates:a.candidates.length};
}
export async function dailySgpDashboard(date:string,pool:SgpPool='both'):Promise<DailySgpResponse>{
 const fixtures=dailySgpFixtures((await Promise.all(sgpPoolSports(pool).map(s=>researchFixtures(date,s)))).flat(),pool),sets:SgpPrefixSet[]=[],missing:typeof fixtures=[];
 for(const f of fixtures){const entry=await cached<SgpPrefixSet>(key(date,f.sport,f.id));if(entry&&fresh(entry.at,30)&&entry.value.inputRevision===await inputRevision(f))sets.push(entry.value);else missing.push(f);}
 return {date,pool,fixtures,ready:sets.length,missing,suggestions:missing.length?[]:aggregateSgps(sets,pool),generatedAt:new Date().toISOString()};
}
