import { requireChatGPTUser } from '../chatgpt-auth';
import { localDay } from '@/lib/models';
import SgpWorkspace from './sgp-workspace';
import DailyWorkspace from './daily/daily-workspace';
export const dynamic='force-dynamic';
export default async function SgpPage({searchParams}:{searchParams:Promise<{date?:string;sport?:string;fixture?:string;mode?:string;pool?:string}>}){await requireChatGPTUser('/sgp');const q=await searchParams,date=q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now());return q.mode!=='single'&&!q.fixture?<DailyWorkspace initialDate={date} initialPool={q.pool==='both'||q.pool==='nfl'?q.pool:q.sport==='nfl'?'nfl':'nba'} combined/>:<SgpWorkspace initialDate={date} initialSport={q.sport==='nfl'?'nfl':'nba'} initialFixture={q.fixture||''}/>;}
