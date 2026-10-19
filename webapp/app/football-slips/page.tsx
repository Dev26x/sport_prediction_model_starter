import { requireChatGPTUser } from '../chatgpt-auth';
import { localDay } from '@/lib/models';
import FootballWorkspace from './football-workspace';
export const dynamic='force-dynamic';
export default async function FootballPage({searchParams}:{searchParams:Promise<{date?:string}>}){await requireChatGPTUser('/football-slips');const q=await searchParams;return <FootballWorkspace initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())}/>;}
