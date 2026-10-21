import {requireChatGPTUser} from '../chatgpt-auth';
import {localDay} from '@/lib/models';
import {WINNER_TOTAL_SPORTS,type WinnerTotalSport} from '@/lib/winner-total-model';
import SpecialistWorkspace from '../specialist-workspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{date?:string;sport?:string;line?:string}>}){
 await requireChatGPTUser('/win-totals');const q=await searchParams,sport=q.sport&&Object.hasOwn(WINNER_TOTAL_SPORTS,q.sport)?q.sport as WinnerTotalSport:'nba',value=Number(q.line),line=q.line&&Number.isFinite(value)&&value%1===.5&&(sport==='nba'?value>=100.5&&value<=400.5:value>=.5&&value<=8.5)?String(value):'';
 return <SpecialistWorkspace kind="win-totals" initialSport={sport} initialLine={line} initialDate={q.date&&/^\d{4}-\d{2}-\d{2}$/.test(q.date)?q.date:localDay(Date.now())}/>;
}
