import {requireChatGPTUser} from '../chatgpt-auth';
import {localDay} from '@/lib/models';
import SpecialistWorkspace from '../specialist-workspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{date?:string}>}){await requireChatGPTUser('/nba-team-totals');const q=await searchParams;return <SpecialistWorkspace kind="nba-team-totals" initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())}/>;}
