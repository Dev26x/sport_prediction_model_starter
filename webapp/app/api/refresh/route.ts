import { refreshResearchNews, refreshResearchAvailability } from '@/lib/research';
import { getChatGPTUser } from '../../chatgpt-auth';
import { validateInput, refreshSources, refreshRosters, refreshPlayers, refreshOdds, refreshNbaContext } from '@/lib/service';
import { acquireLease, releaseLease } from '@/lib/storage';
import type { Sport } from '@/lib/types';
import { z } from 'zod';
import { SPORTS,selectedSports } from '@/lib/competitions';
const RefreshInput = z.object({date:z.string(),sport:z.enum(['all','football','nba','nfl','nhl','epl','laliga','seriea']).default('all'),book:z.enum(['23','19','3']).default('23'),phase:z.string(),manualOdds:z.boolean().default(false)});
export async function POST(request:Request) {
  if(!await getChatGPTUser())return Response.json({error:'Sign in to refresh data.'},{status:401});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
  let token:string|null=null;
  try {
    const {date,sport,book,phase,manualOdds}=RefreshInput.parse(await request.json());validateInput(date,sport,book);
    if(phase.startsWith('odds-')&&!manualOdds)return Response.json({error:'Odds update only when you press Refresh odds. Existing snapshots are reused for 30 minutes.'},{status:400});
    if(!['rosters','depth','players','nba-context',...SPORTS.map(s=>'sources-'+s),...SPORTS.map(s=>'research-'+s),...SPORTS.map(s=>'availability-'+s),...SPORTS.map(s=>'odds-'+s)].includes(phase))throw new Error('Invalid refresh step.');
    token=await acquireLease();if(!token)return Response.json({error:'Another refresh is running. Try again shortly.'},{status:409});
    const league=(phase.startsWith('sources-')||phase.startsWith('odds-')||phase.startsWith('research-')||phase.startsWith('availability-'))?phase.split('-')[1] as Sport:undefined;
    if(league&&!selectedSports(sport).includes(league))throw new Error('Refresh league is outside the selected filter.');
    const result=phase.startsWith('sources-')?await refreshSources(date,[league!]):phase==='rosters'?await refreshRosters(date):phase==='depth'?await refreshRosters(date,true):phase==='players'?await refreshPlayers():phase==='nba-context'?await refreshNbaContext(date):phase.startsWith('research-')?await refreshResearchNews(date,league!):phase.startsWith('availability-')?await refreshResearchAvailability(date,league!):await refreshOdds(date,league!,book);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:(e as Error).message},{status:400});}finally{if(token)await releaseLease(token);}
}
