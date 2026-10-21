import { cached,fresh,putCache,database } from './storage';
import { localDay } from './models';
import { cappedSgpTarget } from './sgp-target-search';
import { compactWnbaSlip,wnbaAvailability,WNBA_MODEL_VERSION,WNBA_SLIP_POLICY } from './wnba-model';
import { WNBA_CSV,parseWnbaPlayers,parseWnbaFinals,parseWnbaRoster,mergeWnbaData } from './wnba-data';
import { parseWnbaBox,mergeWnbaFinalBox,reviewedWnbaCandidates,reviewWnbaGame,WNBA_ISSUED_INSERT } from './wnba-review';
import type { SgpRosterPlayer } from './sgp-types';
import { parseSgpGameContext,applySgpGameContext,addSgpLineupEvidence,type SgpGameContext } from './sgp-game-context';
import type { WnbaBoard,WnbaData,WnbaFixture,WnbaSeed,WnbaBox,WnbaIssued } from './wnba-types';
async function seed(){return (await import('./wnba-seed.json')).default as unknown as WnbaSeed;}
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/';
async function get(url:string){const r=await fetch(url,{cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Public source returned HTTP ${r.status}.`);return r;}
export async function refreshWnba(force=false,fixtureId=''){
 const old=await cached<string[]>('wnba:checked');if(!force&&fresh(old?.at,30))return {messages:['Public WNBA data was checked within 30 minutes; using the saved results.',...old!.value]};
 const base=await seed(),messages:string[]=[],saved=await cached<WnbaFixture[]>('wnba:finals');let fixtures=saved&&saved.at>base.snapshot?saved.value:base.fixtures;
 try{const parsed=parseWnbaFinals(await (await get(BASE+'teams/129689/schedule?season=2026&seasontype=3')).json());fixtures=parsed;await putCache('wnba:finals',parsed);messages.push('Finals schedule checked against ESPN.');}catch(e){messages.push(`Schedule: ${(e as Error).message}`);}
 for(const id of Object.keys(base.rosters)){
  try{const roster=parseWnbaRoster(await (await get(BASE+`teams/${id}/roster`)).json());await putCache(`wnba:roster:${id}`,roster);messages.push(`${id==='20'?'Atlanta':'Golden State'} roster and public injury flags checked.`);}catch(e){messages.push(`Roster ${id}: ${(e as Error).message}`);}
 }
 try{const data=parseWnbaPlayers(await (await get(WNBA_CSV)).text(),2026),old=await cached<WnbaData>('wnba:players'),previous=old?.value||base;
  const existing=previous.games.filter(g=>g[2]===2026);if(existing.some(g=>!data.games.some(n=>n[0]===g[0])))throw new Error('Current feed lost previously recorded games; dated history retained.');
  await putCache('wnba:players',data);messages.push(`Current-season statistics checked: ${data.games.length} regular-season/playoff games.`);
 }catch(e){messages.push(`Player boxes: ${(e as Error).message}`);}
 for(const fixture of fixtures.filter(f=>f.completed).slice(-2))try{
  const oldBox=await cached<WnbaBox>(`wnba:box:${fixture.id}`);if(!force&&fresh(oldBox?.at,30))continue;
  const box=parseWnbaBox(await (await get(BASE+`summary?event=${fixture.id}`)).json(),fixture);await putCache(`wnba:box:${fixture.id}`,box);
  const oldPlayers=await cached<WnbaData>('wnba:players');await putCache('wnba:players',mergeWnbaFinalBox(oldPlayers&&oldPlayers.at>base.snapshot?oldPlayers.value:base,box));messages.push(`Game ${fixture.gameNumber}: final box reconciled and included once in player history.`);
 }catch(e){messages.push(`Game ${fixture.gameNumber} final box: ${(e as Error).message}`);}
 const selected=fixtureId?fixtures.find(f=>f.id===fixtureId):fixtures.find(f=>!f.completed&&Date.parse(f.start)>Date.now());
 if(selected&&!selected.completed&&Date.parse(selected.start)>Date.now())try{
  const context=parseSgpGameContext(await (await get(BASE+`summary?event=${selected.id}`)).json(),selected);await putCache(`wnba:game:${selected.id}`,context);messages.push(context.lineupConfirmed?'Current game availability checked; both starting fives are explicitly listed.':'Current game injury report checked. Starting fives are not confirmed in the public feed.');
 }catch(e){messages.push(`Game availability: ${(e as Error).message} Previous dated information retained; lineup status remains unconfirmed.`);}
 const news:WnbaSeed['news']=[];let feeds=0;
 for(const id of Object.keys(base.rosters))try{const payload=await (await get(BASE+`news?team=${id}&limit=8`)).json() as any;if(!Array.isArray(payload.articles))throw new Error('Missing news list.');feeds++;for(const a of payload.articles){const url=a.links?.web?.href;if(a.headline&&/^https:\/\/(www\.)?(espn\.com|wnba\.com)\//.test(url))news.push({title:a.headline,url,publishedAt:a.published||null});}}catch(e){messages.push(`News ${id}: ${(e as Error).message}`);}
 if(feeds===Object.keys(base.rosters).length)await putCache('wnba:news',[...new Map(news.map(n=>[n.url,n])).values()]);
 messages.push('Free public data only. No paid odds API call or paper-wallet stake.');await putCache('wnba:checked',messages);return {messages};
}
async function recordIssued(fixture:WnbaFixture,board:WnbaBoard){
 if(board.unavailable||!board.suggestion.joint||Date.parse(fixture.start)<=Date.now())return;
 const issued:WnbaIssued={fixture,asOf:board.asOf,issuedAt:board.generatedAt,modelVersion:WNBA_MODEL_VERSION,provenance:'First-issued compact pregame research snapshot. Frozen before tipoff; not an actual betting ticket.',suggestion:board.suggestion};
 // Unlike the disposable analysis cache, a first-issued forecast is immutable.
 await database().prepare(WNBA_ISSUED_INSERT).bind(`wnba:issued:v2:${fixture.id}`,JSON.stringify(issued),board.generatedAt).run();
}
export async function wnbaBoard(fixtureId=''):Promise<WnbaBoard>{
 const base=await seed(),[updates,schedule,news,checked]=await Promise.all([cached<WnbaData>('wnba:players'),cached<WnbaFixture[]>('wnba:finals'),cached<WnbaSeed['news']>('wnba:news'),cached<string[]>('wnba:checked')]),useUpdates=updates&&updates.at>base.snapshot,data=useUpdates?mergeWnbaData(base,updates.value):base,fixtures=schedule&&schedule.at>base.snapshot?schedule.value:base.fixtures,now=Date.now(),today=localDay(now),fixture=fixtureId?fixtures.find(f=>f.id===fixtureId):fixtures.find(f=>!f.completed&&Date.parse(f.start)>now)||fixtures.at(-1);
 if(fixtureId&&!fixture)throw new Error('Choose a verified WNBA Finals game.');
 let rosters:Record<string,SgpRosterPlayer[]>={};const stamps:string[]=[];for(const id of fixture?[fixture.home.id,fixture.away.id]:Object.keys(base.rosters)){const r=await cached<SgpRosterPlayer[]>(`wnba:roster:${id}`),use=r&&r.at>base.snapshot;rosters[id]=use?r.value:base.rosters[id]||[];stamps.push(use?r.at:base.snapshot);}
 const gameContext=fixture?await cached<SgpGameContext>(`wnba:game:${fixture.id}`):null,lineup=gameContext&&fresh(gameContext.at,30)?gameContext.value:null;rosters=applySgpGameContext(rosters,lineup);
 const rosterAt=stamps.sort()[0]||base.snapshot,asOf=fixture&&fixture.day<today?fixture.day:today,earlier=data.games.filter(g=>g[1]<asOf&&g[2]===2026),unavailable=wnbaAvailability(fixture,fixtures,data,asOf,rosterAt,now),previous=fixture?.completed?fixture:[...fixtures].reverse().find(f=>f.completed&&f.gameNumber<(fixture?.gameNumber||0));
 const result=previous?await cached<WnbaBox>(`wnba:box:${previous.id}`):null,seedBox=previous?base.results?.[previous.id]:undefined,box=result&&(!seedBox||result.at>seedBox.checkedAt)?result.value:seedBox;
 const historyAt=useUpdates?updates.at:base.snapshot;
 // Every board read runs the deterministic model again. Public input caches and
 // immutable issued forecasts are separate from the live suggestion.
 const evaluated=fixture&&!unavailable?reviewedWnbaCandidates(data,fixture,asOf,rosters):{candidates:[],excluded:[]},suggestion=unavailable?{legs:[],joint:null,targetReached:false,reason:unavailable}:compactWnbaSlip(data,evaluated.candidates,asOf);
 const candidates=addSgpLineupEvidence(evaluated.candidates,rosters,lineup).map(p=>{const logs=data.players[p.playerId].logs.filter(r=>data.games[r[0]][1]<asOf&&data.games[r[0]][2]===2026&&data.phases[data.games[r[0]][0]]===3);return {...p,playoffGames:logs.length,playoffMean:logs.length?logs.reduce((s,r)=>s+Number(r[p.metric+3]),0)/logs.length:null};});
 let review:WnbaBoard['review']=null;
 if(box){const archived=box.fixtureId==='401918305'?(await import('./wnba-game1-pregame.json')).default as unknown as WnbaIssued:(await cached<WnbaIssued>(`wnba:issued:v2:${box.fixtureId}`))?.value||null,next=fixture&&!fixture.completed?fixture:fixtures.find(f=>!f.completed&&Date.parse(f.start)>now),nextCandidates=next&&fresh(rosterAt,24*60)?reviewedWnbaCandidates(data,next,today,rosters).candidates:[];review=reviewWnbaGame(box,archived,nextCandidates,data,today);}
 const fifty=unavailable?{legs:[],joint:null,targetReached:false,reason:unavailable}:cappedSgpTarget(data,evaluated.candidates,asOf,'wnba',50);
 const board:WnbaBoard={fifty,fixtures,fixture:fixture||null,asOf,...evaluated,candidates,suggestion,news:news?.value||base.news,historyAt,rosterAt,lastResult:earlier.map(g=>g[1]).sort().at(-1)||null,playoffGames:earlier.filter(g=>data.phases[g[0]]===3).length,regularGames:earlier.filter(g=>data.phases[g[0]]===2).length,messages:checked?.value||[],needsRefresh:!fresh(checked?.at||base.snapshot,30),unavailable,generatedAt:new Date().toISOString(),publicCheckedAt:checked?.at||null,lineup,review,policy:WNBA_SLIP_POLICY};
 if(fixture)await recordIssued(fixture,board);return board;
}
