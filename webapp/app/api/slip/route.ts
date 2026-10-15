import { getChatGPTUser } from '../../chatgpt-auth';
import { database } from '@/lib/storage';
export async function GET() {
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in required.'},{status:401});
  const row=await database().prepare('SELECT value, updated_at FROM saved_slips WHERE user_id = ?').bind(user.userId).first<{value:string;updated_at:string}>();
  return Response.json(row?{...JSON.parse(row.value),updatedAt:row.updated_at}:{legs:[],stake:''},{headers:{'Cache-Control':'private, no-store'}});
}
export async function PUT(request:Request) {
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in required.'},{status:401});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
  try {
    const text=await request.text();if(text.length>1000000)throw new Error('Slip payload is too large.');const value=JSON.parse(text);
    if(!Array.isArray(value.legs)||new Set(value.legs.map((l:any)=>l.fixtureId)).size!==value.legs.length)throw new Error('Use one selection per game.');
    if(value.legs.some((l:any)=>!l.id||!l.fixtureId||!Number.isFinite(l.probability)||l.probability<=0||l.probability>=1||!Number.isFinite(Date.parse(l.start))))throw new Error('Invalid selection.');
    if(value.legs.some((l:any)=>l.manualDecimalOdds!==undefined&&l.manualDecimalOdds!==null&&(!Number.isFinite(l.manualDecimalOdds)||l.manualDecimalOdds<=0)))throw new Error('Enter a valid decimal price.');
    if(value.stake!==''&&(!Number.isFinite(Number(value.stake))||Number(value.stake)<0||Number(value.stake)>100000))throw new Error('Enter an amount between 0 and 100,000.');
    const updatedAt=new Date().toISOString();await database().prepare('INSERT INTO saved_slips (user_id,value,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(user.userId,JSON.stringify({legs:value.legs,stake:String(value.stake||'')}),updatedAt).run();
    return Response.json({saved:true,updatedAt});
  }catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
