import { getChatGPTUser } from '../../chatgpt-auth';
import { validateInput, refreshSources, refreshRosters, refreshPlayers, refreshOdds } from '@/lib/service';
import { acquireLease, releaseLease } from '@/lib/storage';
import type { Sport } from '@/lib/types';
import { z } from 'zod';
const RefreshInput = z.object({date:z.string(),sport:z.enum(['all','nba','epl']).default('all'),book:z.enum(['23','19','3']).default('23'),phase:z.enum(['sources','rosters','depth','players','odds-nba','odds-epl']),manualOdds:z.boolean().default(false)});
export async function POST(request:Request) {
  if(!await getChatGPTUser())return Response.json({error:'Sign in to refresh data.'},{status:401});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
  let token:string|null=null;
  try {
    const {date,sport,book,phase,manualOdds}=RefreshInput.parse(await request.json());validateInput(date,sport,book);
    if(phase.startsWith('odds-')&&!manualOdds)return Response.json({error:'Odds update only when you press Refresh odds. Existing snapshots are reused for 30 minutes.'},{status:400});
    if(!['sources','rosters','depth','players','odds-nba','odds-epl'].includes(phase))throw new Error('Invalid refresh step.');
    token=await acquireLease();if(!token)return Response.json({error:'Another refresh is running. Try again shortly.'},{status:409});
    const sports:Sport[]=sport==='all'?['nba','epl']:[sport];
    const result=phase==='sources'?await refreshSources(date,sports):phase==='rosters'?await refreshRosters(date):phase==='depth'?await refreshRosters(date,true):phase==='players'?await refreshPlayers():await refreshOdds(date,phase==='odds-nba'?'nba':'epl',book);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:(e as Error).message},{status:400});}finally{if(token)await releaseLease(token);}
}
