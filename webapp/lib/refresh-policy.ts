// Keep paid-provider refreshes explicitly separate from public data updates.
export const ODDS_CACHE_MINUTES = 30;
export type RefreshMode = 'data' | 'odds';
export function refreshSteps(sport: string, mode: RefreshMode): [string, string][] {
  if (mode === 'odds') return [
    ...(sport !== 'epl' ? [['odds-nba', 'Checking NBA bookmaker markets'] as [string, string]] : []),
    ...(sport !== 'nba' ? [['odds-epl', 'Checking Premier League bookmaker markets'] as [string, string]] : []),
  ];
  return [
    ['sources', 'Checking fixtures & team results'],
    ...(sport !== 'epl' ? [
      ['rosters', 'Checking NBA rosters & injury flags'] as [string, string],
      ['depth', 'Checking projected depth charts'] as [string, string],
      ['players', 'Updating available player performances'] as [string, string],
    ] : []),
  ];
}
