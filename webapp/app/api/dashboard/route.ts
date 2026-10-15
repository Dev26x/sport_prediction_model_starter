import { getChatGPTUser } from '../../chatgpt-auth';
import { dashboard, validateInput } from '@/lib/service';
export async function GET(request:Request) {
  if(!await getChatGPTUser())return Response.json({error:'Sign in to view your workspace.'},{status:401});
  const q=new URL(request.url).searchParams,date=q.get('date')||'',sport=q.get('sport')||'all',book=q.get('book')||'23';
  try{validateInput(date,sport,book);return Response.json(await dashboard(date,sport,book),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
