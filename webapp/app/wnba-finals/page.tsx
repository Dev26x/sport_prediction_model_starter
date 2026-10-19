import { requireChatGPTUser } from '../chatgpt-auth';
import WnbaWorkspace from './wnba-workspace';
export const dynamic='force-dynamic';
export default async function WnbaFinalsPage({searchParams}:{searchParams:Promise<{fixture?:string}>}){await requireChatGPTUser('/wnba-finals');const q=await searchParams;return <WnbaWorkspace initialFixture={q.fixture&&/^\d{1,16}$/.test(q.fixture)?q.fixture:''}/>;}
