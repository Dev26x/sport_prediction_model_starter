import { requireChatGPTUser } from '../chatgpt-auth';
import { localDay } from '@/lib/models';
import SgpWorkspace from './sgp-workspace';
export const dynamic='force-dynamic';
export default async function SgpPage({searchParams}:{searchParams:Promise<{date?:string;sport?:string;fixture?:string}>}){await requireChatGPTUser('/sgp');const q=await searchParams;return <SgpWorkspace initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())} initialSport={q.sport==='nfl'?'nfl':'nba'} initialFixture={q.fixture||''}/>;}
