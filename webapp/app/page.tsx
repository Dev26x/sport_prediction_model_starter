import { requireChatGPTUser } from './chatgpt-auth';
import { localDay } from '@/lib/models';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user=await requireChatGPTUser('/'); const today=localDay(Date.now());
  const initialDate=today<='2026-10-17'?'2026-10-17':today;
  return <Workspace initialDate={initialDate} userName={user.fullName||'Your workspace'} />;
}
