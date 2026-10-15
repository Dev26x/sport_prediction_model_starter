// Keep paid-provider refreshes explicitly separate from public data updates.
export const ODDS_CACHE_MINUTES = 30;
export function providerOffsetMinutes(date:string) {
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',timeZoneName:'longOffset'}).formatToParts(new Date(date+'T12:00Z')).find(p=>p.type==='timeZoneName')!.value;
  const match=offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  if(!match)throw new Error('Unable to determine the Toronto date boundary.');
  return (match[1]==='-'?1:-1)*(Number(match[2])*60+Number(match[3]));
}
export type RefreshMode = 'data' | 'odds';
import { COMPETITIONS, selectedSports } from './competitions';
export function refreshSteps(sport: string, mode: RefreshMode): [string, string][] {
  const sports=selectedSports(sport);
  if (mode === 'odds') return sports.map(s=>[`odds-${s}`,`Checking ${COMPETITIONS[s].label} bookmaker markets`]);
  return [
    ...sports.map(s=>[`sources-${s}`,`Checking ${COMPETITIONS[s].label} fixtures & results`] as [string,string]),
    ...(sports.includes('nba') ? [
      ['rosters', 'Checking NBA rosters & injury flags'] as [string, string],
      ['depth', 'Checking projected depth charts'] as [string, string],
      ['players', 'Updating available player performances'] as [string, string],
      ['nba-context', 'Checking NBA team news & injury reports'] as [string, string],
    ] : []),
  ];
}
