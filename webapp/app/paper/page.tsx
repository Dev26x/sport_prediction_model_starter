import { requireChatGPTUser } from '../chatgpt-auth';
import PaperWorkspace from './paper-workspace';
export const dynamic='force-dynamic';
export default async function PaperPage(){await requireChatGPTUser('/paper');return <PaperWorkspace/>;}
