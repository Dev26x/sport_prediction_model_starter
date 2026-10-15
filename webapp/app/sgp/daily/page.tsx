import { requireChatGPTUser } from '../../chatgpt-auth';
import { localDay } from '@/lib/models';
import DailyWorkspace from './daily-workspace';
export const dynamic='force-dynamic';
export default async function DailyPage({searchParams}:{searchParams:Promise<{date?:string}>}){await requireChatGPTUser('/sgp/daily');const q=await searchParams;return <DailyWorkspace initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())}/>;}
