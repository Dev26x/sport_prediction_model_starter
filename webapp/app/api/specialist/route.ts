import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {validateInput} from '@/lib/service';
import {specialistBoard,refreshSpecialist} from '@/lib/specialist-service';
import {acquireLease,releaseLease} from '@/lib/storage';
const Input=z.object({kind:z.enum(['nba-team-totals','ucl']),date:z.string()});
export async function GET(request:Request){if(!await getChatGPTUser())return Response.json({error:'Sign in to view research.'},{status:401});try{const v=Input.parse(Object.fromEntries(new URL(request.url).searchParams));validateInput(v.date,'nba','23');return Response.json(await specialistBoard(v.kind,v.date),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
export async function POST(request:Request){if(!await getChatGPTUser())return Response.json({error:'Sign in to update research.'},{status:401});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});let token:string|null=null;try{const v=Input.parse(await request.json());validateInput(v.date,'nba','23');token=await acquireLease();if(!token)return Response.json({error:'Another source refresh is running. Retry shortly.'},{status:409});return Response.json(await refreshSpecialist(v.kind,v.date),{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({error:(e as Error).message},{status:e instanceof z.ZodError||/^Choose a date|^Invalid league/.test((e as Error).message)?400:503});}finally{if(token)await releaseLease(token);}}
