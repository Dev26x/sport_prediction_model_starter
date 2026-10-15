# NBA 2026-27 preparation

Snapshot: 2026-10-15. Four completed regular seasons, 4,920 games, 877 historical players, and current roster snapshots for all 30 teams.

The team-only margin model has chronological validation. The current roster layer is an experimental box-production adjustment; its probabilities have not been separately calibrated or validated.

| 2025–26 historical test | Games | Accuracy | Binary Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| team_raw | 1230 | 63.09% | 0.2230 | 0.6369 |
| team_calibrated | 1230 | 63.09% | 0.2219 | 0.6349 |
| baseline | 1230 | 55.45% | 0.2471 | 0.6873 |

The first 14 days of that test season cover 103 games: 56.31% model accuracy versus 57.28% baseline. Opening-season uncertainty remains material. No market-edge or ROI claim follows from these results.

## Team outlook

Ratings and roster changes are estimated neutral-court points per game. Win expectations cover only published fixtures; unresolved NBA Cup-dependent games are excluded. They are expectations under fixed current ratings, not confidence intervals or guaranteed records.

| Team | Historical rating | Roster adjustment | Combined rating | Expected wins on known schedule | Games |
| --- | ---: | ---: | ---: | ---: | ---: |
| Oklahoma City Thunder | +7.35 | +0.38 | +7.72 | 60.2 | 80 |
| Boston Celtics | +6.03 | +1.63 | +7.66 | 60.5 | 80 |
| Cleveland Cavaliers | +3.62 | +0.57 | +4.19 | 51.4 | 80 |
| New York Knicks | +3.65 | -0.15 | +3.50 | 49.4 | 80 |
| Denver Nuggets | +3.37 | +0.12 | +3.49 | 49.3 | 80 |
| Detroit Pistons | +2.24 | +0.66 | +2.90 | 48.1 | 80 |
| Los Angeles Lakers | +1.17 | +0.82 | +1.99 | 45.3 | 80 |
| Minnesota Timberwolves | +2.85 | -0.98 | +1.87 | 44.6 | 80 |
| San Antonio Spurs | +1.73 | -0.02 | +1.71 | 44.7 | 80 |
| Houston Rockets | +2.58 | -1.00 | +1.58 | 44.2 | 80 |
| Miami Heat | +1.07 | +0.50 | +1.56 | 44.9 | 80 |
| Toronto Raptors | -0.29 | +1.22 | +0.93 | 42.4 | 80 |
| Golden State Warriors | +0.79 | +0.06 | +0.85 | 42.4 | 80 |
| Atlanta Hawks | +0.62 | +0.02 | +0.64 | 41.5 | 80 |
| Orlando Magic | +0.21 | +0.22 | +0.43 | 41.0 | 80 |
| LA Clippers | +1.82 | -1.75 | +0.07 | 40.0 | 80 |
| Charlotte Hornets | -1.09 | +0.38 | -0.71 | 38.1 | 80 |
| Dallas Mavericks | -2.18 | +1.41 | -0.77 | 37.2 | 80 |
| Memphis Grizzlies | -2.01 | +0.92 | -1.09 | 36.4 | 80 |
| Sacramento Kings | -3.29 | +1.72 | -1.57 | 35.1 | 80 |
| Phoenix Suns | +0.46 | -2.10 | -1.64 | 34.9 | 80 |
| Indiana Pacers | -2.41 | +0.75 | -1.66 | 35.2 | 80 |
| Chicago Bulls | -2.44 | +0.66 | -1.78 | 34.5 | 80 |
| New Orleans Pelicans | -2.83 | +0.55 | -2.29 | 32.7 | 80 |
| Portland Trail Blazers | -1.60 | -0.81 | -2.41 | 32.5 | 80 |
| Milwaukee Bucks | -1.66 | -0.93 | -2.59 | 32.8 | 80 |
| Philadelphia 76ers | -0.93 | -1.73 | -2.66 | 32.0 | 80 |
| Utah Jazz | -5.39 | +0.17 | -5.22 | 25.2 | 80 |
| Brooklyn Nets | -5.55 | -0.05 | -5.60 | 24.3 | 80 |
| Washington Wizards | -7.89 | +0.14 | -7.74 | 19.3 | 80 |

## Roster analysis

Player box production uses all four seasons with recency weights and 750 prior minutes of shrinkage toward the league average. Its relationship to team margin is fitted with sign-constrained ridge regression on completed team-seasons (120 usable team-seasons). That relationship is associative, not a causal player-impact measure. Defense, role, spacing, coaching, age and injury recovery are only partially captured.

Each team gets a provisional 240-minute rotation. Listed depth-chart roles provide 30/18/8-minute weight priors for first/second/third position choices (three for deeper reserves); these blend equally with historical MPG for players with NBA history. The top 11 weights are normalized to 240 minutes, capped at 40 per player. Rookies can enter the rotation through their projected depth-chart role. These are unvalidated minute assumptions. Arrivals carry their own historical performance into the new roster. The change from last season's minute-weighted contributors is damped by 50% and capped at eight points per team. These conservative settings are assumptions, not tuned or validated transfer effects.

`roster_changes.csv` identifies arrivals and departures versus all previous-season contributors, not a verified sequence of trades. A player who changed teams during last season can appear in multiple previous-team comparisons. `player_projections.csv` shows every current player, assigned minutes, injury flags, history coverage, and proxy contribution.

Rookies without NBA history use a neutral production prior. Injury flags do not automatically remove players from a full-season projection; change availability in `data/rotation_overrides.csv` for an explicit scenario. These training-camp snapshots are not confirmed opening-night active lineups.

## Preseason and data access

52 completed preseason games are summarized in `preseason_context.csv`. Their weight in the core model is zero. This keeps a small, irregular exhibition sample from changing regular-season strength estimates.

Historical results and player game boxes come from ESPN's public JSON feeds. The importer validates each box's event/team IDs and reconciles player points with the final score. NBA Cup finals are excluded from the four 1,230-game regular seasons. Raw responses retain URLs and retrieval timestamps in the ignored cache. This feed is undocumented and may change.

Source audit: 7 archived team boxes contain unidentified player slots, leaving 28 team points unassigned to named players. These gaps are recorded in `data/boxscore_audit.csv`; no player points are invented to reconcile them. Team final results remain intact.

The direct TheRundown connection is configured separately. Its authenticated access/usage headers are saved in `data/rundown_connection.json`; private timestamped event/odds responses stay in `data/private/`. Current key entitlement does not include historical statistics. TheRundown data is not part of the historical validation.

[TheRundown authentication](https://docs.therundown.io/authentication) · [Statistics access and historical roster limitations](https://docs.therundown.io/guides/stats-access) · [NBA schedule](https://www.nba.com/schedule)
