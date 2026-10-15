import { requireChatGPTUser } from './chatgpt-auth';
import { localDay } from '@/lib/models';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{date?:string}>}) {
  const user=await requireChatGPTUser('/'); const today=localDay(Date.now());
  const q=await searchParams;const requested=q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)&&q.date>='2025-10-01'&&q.date<='2027-06-30'?q.date:null;
  const initialDate=requested||(today<='2026-10-17'?'2026-10-17':today);
  return <Workspace initialDate={initialDate} userName={user.fullName||'Your workspace'} />;
}
