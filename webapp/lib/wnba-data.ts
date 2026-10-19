import { csvRows,flattenRoster,mergePlayerUpdates } from './sgp-data';
import { localDay } from './models';
import type { SgpRosterPlayer } from './sgp-types';
import type { WnbaData,WnbaFixture } from './wnba-types';

export const WNBA_CSV='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_wnba_player_boxscores/player_box_2026.csv';
export function parseWnbaPlayers(text:string,season:number):WnbaData{
 const rows=csvRows(text,['athlete_id','game_id','season_type','points','minutes','team_id','opponent_team_id']),games:WnbaData['games']=[],players:WnbaData['players']={},phases:Record<string,number>={},indices=new Map<string,number>(),totals=new Map<string,{points:number;minutes:number;score:number}>();
 for(const r of rows){
  if(Number(r.season)!==season||![2,3].includes(Number(r.season_type)))continue;
  const home=r.home_away==='home'?r.team_id:r.opponent_team_id,away=r.home_away==='away'?r.team_id:r.opponent_team_id;
  if(!/^\d+$/.test(r.game_id)||!/^\d+$/.test(r.athlete_id)||!/^\d+$/.test(home)||!/^\d+$/.test(away)||home===away||!/^\d{4}-\d{2}-\d{2}$/.test(r.game_date))throw new Error('Invalid WNBA identity or date.');
  let index=indices.get(r.game_id);if(index===undefined){index=games.length;indices.set(r.game_id,index);games.push([r.game_id,r.game_date,season,home,away]);phases[r.game_id]=Number(r.season_type);}
  const g=games[index];if(g[1]!==r.game_date||g[3]!==home||g[4]!==away||phases[g[0]]!==Number(r.season_type))throw new Error('Conflicting WNBA game metadata.');
  if(r.did_not_play.toLowerCase()==='true'||r.active.toLowerCase()==='false'&&r.minutes===''&&r.points==='')continue;
  const time=r.minutes.split(':').map(Number),minutes=time[0]+(time[1]||0)/60,stats=['points','rebounds','assists','three_point_field_goals_made'].map(k=>r[k]===''?NaN:Number(r[k]));
  if(![minutes,...stats].every(v=>Number.isFinite(v)&&v>=0)||minutes>65||!stats.every(Number.isInteger))throw new Error('Invalid or missing WNBA player production.');
  // The public file rounds short appearances down to zero minutes. Keep their
  // recorded production so team totals and low-usage appearances stay intact.
  const p=players[r.athlete_id]||{name:r.athlete_display_name,position:r.athlete_position_abbreviation,logs:[]};if(p.logs.some(l=>l[0]===index))throw new Error('Duplicate WNBA player game.');
  p.logs.push([index,r.team_id,minutes,...stats]);players[r.athlete_id]=p;
  const key=`${index}:${r.team_id}`,t=totals.get(key)||{points:0,minutes:0,score:Number(r.team_score)};if(t.score!==Number(r.team_score))throw new Error('Conflicting WNBA team score.');t.points+=stats[0];t.minutes+=minutes;totals.set(key,t);
 }
 if(!games.length||!Object.keys(players).length)throw new Error('No WNBA boxes in feed; dated history retained.');
 for(let i=0;i<games.length;i++)for(const team of [games[i][3],games[i][4]]){const t=totals.get(`${i}:${team}`);if(!t||t.points!==t.score||t.minutes<185)throw new Error('WNBA player totals do not reconcile with full-game team scores.');}
 return {snapshot:new Date().toISOString(),source:'SportsDataverse / ESPN WNBA player boxes',games,players,phases,rosters:{},metrics:['points','rebounds','assists','threes']};
}
export function mergeWnbaData(base:WnbaData,update:WnbaData):WnbaData{
 const games=[...base.games],indices=new Map(games.map((g,i)=>[g[0],i])),map=new Map<number,number>();
 update.games.forEach((g,i)=>{let index=indices.get(g[0]);if(index===undefined){index=games.length;indices.set(g[0],index);games.push(g);}else if(JSON.stringify(games[index])!==JSON.stringify(g))throw new Error('WNBA update conflicts with stored fixture.');map.set(i,index);});
 const players=Object.fromEntries(Object.entries(update.players).map(([id,p])=>[id,{...p,logs:p.logs.map(r=>[map.get(r[0])!,...r.slice(1)] as typeof r)}]));
 return {...base,...mergePlayerUpdates({...base,games},players),phases:{...base.phases,...update.phases}};
}
export function parseWnbaRoster(payload:any):SgpRosterPlayer[]{
 if(!Array.isArray(payload.athletes))throw new Error('WNBA roster missing athletes.');
 const rows=flattenRoster(payload.athletes).filter(a=>/^\d+$/.test(String(a.id))&&a.displayName).map(a=>({id:String(a.id),espnId:String(a.id),name:a.displayName,position:a.position?.abbreviation||'',injury:(a.injuries||[]).map((i:any)=>i.status||'Unresolved injury flag').join(', '),injuryAt:a.injuries?.[0]?.date,depth:99}));
 if(rows.length<10||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Incomplete or duplicate WNBA roster; previous roster retained.');return rows;
}
export function parseWnbaFinals(payload:any):WnbaFixture[]{
 if(!Array.isArray(payload.events))throw new Error('WNBA schedule missing events.');const fixtures:WnbaFixture[]=[];
 for(const e of payload.events){const c=e.competitions?.[0],note=(c?.notes||[]).map((n:any)=>n.headline||'').join(' '),match=note.match(/WNBA Finals\s*-\s*Game\s*(\d)/i);if(!match||!String(e.date).startsWith('2026-'))continue;
  const h=c.competitors?.find((t:any)=>t.homeAway==='home'),a=c.competitors?.find((t:any)=>t.homeAway==='away'),status=c.status?.type||e.status?.type;
  if(!/^\d+$/.test(String(e.id))||!h?.team?.id||!a?.team?.id||!Number.isFinite(Date.parse(e.date))||!status)throw new Error('Incomplete WNBA Finals fixture.');
  if(/cancel/i.test(status.name||''))continue;
  const team=(t:any)=>({id:String(t.id),name:t.displayName,abbr:t.abbreviation,espnId:String(t.id)});
  fixtures.push({id:String(e.id),sport:'wnba',start:e.date,day:localDay(Date.parse(e.date)),home:team(h.team),away:team(a.team),status:status.description||status.name,completed:!!status.completed,hp:status.completed?Number(h.score?.value??h.score):undefined,ap:status.completed?Number(a.score?.value??a.score):undefined,neutral:!!c.neutralSite,preseason:false,gameNumber:Number(match[1]),conditional:/if necessary/i.test(note),venue:c.venue?.fullName||''});
 }
 if(!fixtures.length||new Set(fixtures.map(f=>f.id)).size!==fixtures.length)throw new Error('No verified 2026 WNBA Finals fixtures; previous schedule retained.');return fixtures.sort((a,b)=>a.gameNumber-b.gameNumber);
}
