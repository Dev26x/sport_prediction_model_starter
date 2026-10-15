import { getChatGPTUser } from '../../chatgpt-auth';
import { validateInput } from '@/lib/service';
import { researchDashboard } from '@/lib/research';
export async function GET(request:Request){if(!await getChatGPTUser())return Response.json({error:'Sign in required.'},{status:401});try{const date=new URL(request.url).searchParams.get('date')||'';validateInput(date,'all','23');return Response.json(await researchDashboard(date),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
