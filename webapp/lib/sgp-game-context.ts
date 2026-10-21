import type { SgpCandidate,SgpModelFixture,SgpModelSport,SgpRosterPlayer } from './sgp-types';

export type SgpGameContext={fixtureId:string;sport:SgpModelSport;checkedAt:string;injuries:{team:string;playerId:string;status:string;reportedAt:string|null}[];starters:Record<string,string[]>;lineupConfirmed:boolean};

/** A game feed can add an explicit availability flag. An absent entry never
 * clears an injury flag or establishes that a player is active. */
export function parseSgpGameContext(payload:any,fixture:SgpModelFixture,espnIds:Record<string,string>={}):SgpGameContext{
 const competition=payload.header?.competitions?.[0],teams=[fixture.home.id,fixture.away.id],ids=Object.fromEntries(teams.map(id=>[espnIds[id]||id,id])),competitors=competition?.competitors;
 if(String(payload.header?.id)!==fixture.id||!Array.isArray(competitors)||competitors.length!==2||new Set(competitors.map((c:any)=>String(c.id))).size!==2||competitors.some((c:any)=>!ids[String(c.id)]))throw new Error('Game availability feed does not match this fixture.');
 if(competition.status?.type?.completed||competition.status?.type?.state!=='pre')throw new Error('Game availability feed is not pregame.');
 const injuries:SgpGameContext['injuries']=[],starters:Record<string,string[]>={};
 if(!Array.isArray(payload.injuries))throw new Error('Game injury report is unavailable; an empty injury list cannot be assumed.');
 for(const group of payload.injuries){const team=ids[String(group.team?.id)];if(!team||!Array.isArray(group.injuries))throw new Error('Game injury report has an invalid team.');
  for(const injury of group.injuries){const playerId=String(injury.athlete?.id||''),status=String(injury.status||injury.type?.description||'Unresolved injury flag').trim();if(!/^\d+$/.test(playerId)||!status)throw new Error('Game injury report has an invalid player/status.');injuries.push({team,playerId,status,reportedAt:injury.date||null});}
 }
 // Only explicit game-specific starter flags count. A season leader list,
 // depth chart, previous starting five or empty box is never a confirmed lineup.
 for(const group of payload.boxscore?.players||[]){const team=ids[String(group.team?.id)];if(!team)throw new Error('Game lineup has an invalid team.');const seen=new Set<string>();
  for(const table of group.statistics||[])for(const row of table.athletes||[])if(row.starter===true&&!row.didNotPlay){const id=String(row.athlete?.id||'');if(!/^\d+$/.test(id)||seen.has(id))throw new Error('Game lineup has duplicate or invalid players.');seen.add(id);}
  starters[team]=[...seen];
 }
 const lineupConfirmed=fixture.sport!=='nfl'&&teams.every(id=>starters[id]?.length===5);
 return {fixtureId:fixture.id,sport:fixture.sport,checkedAt:new Date().toISOString(),injuries,starters,lineupConfirmed};
}
export function applySgpGameContext(rosters:Record<string,SgpRosterPlayer[]>,context:SgpGameContext|null|undefined){
 if(!context)return rosters;
 return Object.fromEntries(Object.entries(rosters).map(([team,players])=>[team,players.map(p=>{const flags=context.injuries.filter(i=>i.team===team&&i.playerId===(p.espnId||p.id)&&!/^active$|^available$|^healthy$/i.test(i.status));return flags.length?{...p,injury:[...new Set([...p.injury.split(',').map(s=>s.trim()),...flags.map(i=>i.status)].filter(Boolean))].join(', ')}:p;})]));
}
export function addSgpLineupEvidence<T extends SgpCandidate>(candidates:T[],rosters:Record<string,SgpRosterPlayer[]>,context:SgpGameContext|null|undefined):T[]{
 if(!context?.lineupConfirmed)return candidates;
 return candidates.map(p=>{const member=rosters[p.team]?.find(r=>r.id===p.playerId),starter=context.starters[p.team]?.includes(member?.espnId||p.playerId);return {...p,warnings:[...p.warnings,starter?'The current public game feed lists this player as a starter. Minutes remain a historical projection.':'This player is outside the reported starting five. Bench participation and minutes remain uncertain.']};});
}
