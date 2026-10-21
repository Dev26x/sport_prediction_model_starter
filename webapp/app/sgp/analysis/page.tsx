import { requireChatGPTUser } from '../../chatgpt-auth';
import { localDay } from '@/lib/models';
import CombinedBuilder from '../combined-builder';
export const dynamic='force-dynamic';
export default async function AnalysisPage({searchParams}:{searchParams:Promise<{date?:string;pool?:string}>}){await requireChatGPTUser('/sgp/analysis');const q=await searchParams;return <CombinedBuilder initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())} initialPool={q.pool==='both'||q.pool==='nfl'?q.pool:'nba'} analysisView/>;}
