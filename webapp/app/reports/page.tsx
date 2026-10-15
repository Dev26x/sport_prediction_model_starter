import { requireChatGPTUser } from '../chatgpt-auth';
import { localDay } from '@/lib/models';
import ReportsWorkspace from './reports-workspace';
export const dynamic='force-dynamic';
export default async function ReportsPage({searchParams}:{searchParams:Promise<{date?:string;fixture?:string}>}){await requireChatGPTUser('/reports');const q=await searchParams;return <ReportsWorkspace initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())} initialFixture={q.fixture||''}/>;}
