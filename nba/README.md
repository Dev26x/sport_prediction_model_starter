# NBA forecasting and 2026–27 season preparation

This subproject is independent of the Premier League scripts. It combines four completed NBA regular seasons, player game-box history, current rosters and projected depth charts, a roster-change scenario model, and a direct TheRundown connection.

The first version is built and populated. Start with [the season preview](reports/season_preview.md), [the team outlook](reports/team_outlook.csv), and [player projections](reports/player_projections.csv).

## What is loaded

Snapshot as of **October 15, 2026**, preparing for **2026–27**:

| Input | Coverage |
| --- | --- |
| Historical regular seasons | 2022–23, 2023–24, 2024–25, 2025–26 |
| Completed regular-season games | 4,920; 1,230 per season and 82 per team |
| Historical players | 877 |
| Player/team/season stints | 2,580 |
| Current roster snapshots | 627 training-camp players across 30 teams |
| Projected depth charts | All 30 teams |
| Completed preseason games | 52 |
| Published upcoming regular-season fixtures | 1,200; currently 80 per team |
| TheRundown | Key authenticated; opening-night moneylines retrieved and joined |

Historical results and player box scores come from ESPN's public JSON feeds. These feeds are undocumented and can change. Raw responses are cached with the source URL and retrieval timestamp. Dates are interpreted in America/Toronto; same-day results are excluded from a game's training history.

The importer excludes NBA Cup championship games, which appear in season schedules but do not count toward regular-season records. It builds historical player stints from actual game boxes, including retired/departed players. The provider's season-level athlete catalog returned the same current list for all four historical years and is therefore **not** used as the historical population.

Seven archived Chicago team boxes contain an anonymous player slot: **28 final team points cannot be assigned to named players**. Named-player statistics remain as supplied; no points are fabricated. The discrepancies are recorded in `data/boxscore_audit.csv`. Team final results are complete. Displayed game-box minutes can be rounded; the lowest team-season minute coverage is about 99.69% of 82 × 240 minutes.

## Run commands

Run these from the parent `football_model_starter` directory, using its existing virtual environment. No new Python dependencies were needed; pandas, NumPy and SciPy are sufficient. The network client uses system curl when available, keeping TLS verification enabled and credentials out of process arguments.

```sh
# Inspect commands.
.venv/bin/python -m nba --help

# Refresh public results, rosters and depth charts; keep successful historical caches.
.venv/bin/python -m nba sync --as-of 2026-10-15

# Evaluate the historical team-only model and fit its probability scale.
.venv/bin/python -m nba backtest

# Build player/roster estimates, team outlook and season report.
.venv/bin/python -m nba build --as-of 2026-10-15

# Home team first; these examples are on the published opening-night schedule.
.venv/bin/python -m nba forecast DET BOS --date 2026-10-20 --as-of 2026-10-15
.venv/bin/python -m nba forecast NYK PHI --date 2026-10-20 --as-of 2026-10-15 --team-only

# Optional half-point home handicap; integer-line pushes are not modeled.
.venv/bin/python -m nba forecast DET BOS --date 2026-10-20 --as-of 2026-10-15 --spread -2.5

# Verification; no API calls or real credentials are used by these tests.
.venv/bin/python -m unittest discover -s nba/tests -v
```

NBA season IDs use the ending year: `2027` means 2026–27. `sync --target-year 2027` selects the four preceding completed seasons. Default as-of dates follow America/Toronto. Historical files stay cached; current-season schedules, rosters and depth charts refresh after one hour. `--refresh` refreshes everything and makes thousands of public requests, so use it only when correcting a historical source update. A failed partial box download keeps successes cached and does not overwrite the player training table; rerun `sync` to retry.

For a later day, use that day's as-of date when syncing. A newly retrieved current roster cannot reconstruct a past lineup. Dated roster snapshots are preserved in `data/snapshots/`; keep the October 15 files to reproduce this initial report. This version prepares the season from the four completed historical seasons; it does not yet ingest new regular-season results into daily team updates after opening night.

## Model design

### Team results model

The team model predicts the home scoring margin as:

`home team strength − away team strength + home-court advantage + rest adjustment`

It fits opponent-adjusted team ratings with ridge regression, a 365-day recency half-life, team penalty 35 and rest penalty 100. Home-court advantage is learned from the data; neutral-site games receive none. Rest uses earlier known games, capped at three days off. At least 300 earlier regular-season games are required. The historical backtest refits once per match date and never uses that day's results.

Raw win probabilities use a normal margin approximation. A single probability-scale parameter is fitted on an earlier season and then frozen. That classification calibration changes win probabilities; it does not redefine the raw margin standard deviation. Spread probabilities use the raw margin approximation and have not been separately validated.

### Player performances and roster changes

The player layer uses per-36 production from points, missed field/free throws, offensive/defensive rebounds, assists, steals, blocks, turnovers and made threes. Four season totals receive weights 0.125/0.25/0.5/1, with 750 prior minutes of shrinkage toward league-average production. Traded-player stints are retained under their actual historical team IDs.

A sign-constrained ridge fit relates team-season box production to completed-season opponent-adjusted margins, using all 120 team-seasons. Positive production cannot receive a negative coefficient; missed shots and turnovers cannot receive positive coefficients. This is an **associative box-production proxy**, not causal player impact, RAPM or a salary valuation. Some skills can receive near-zero weight because these box scores do not isolate them well.

Current projected depth-chart ranks supply provisional minute weights: 30/18/8 for the first three choices at a position, three for deeper reserves. For players with NBA history these blend equally with their historical MPG. The top 11 weights become a 240-minute rotation, capped at 40 minutes per player. Players without NBA history use their depth-chart role for minutes and a neutral production prior; these rookie assumptions are uncertain.

For each team, the new rotation's player-production proxy is compared with the previous season's actual minute-weighted contributors. Half the estimated change is added to the historical team rating, capped at eight points per team. Both that 50% blend and the cap are explicit, unvalidated assumptions. The output shows the raw change and applied change separately.

The roster CSV reflects training-camp membership; the depth chart is a projected rotation. Neither is a confirmed opening-night active lineup. Injury flags are included, while availability defaults to 1 for a full-season scenario. Injury recovery, aging, coaching changes, defensive roles and lineup interactions remain incomplete.

`roster_changes.csv` compares current membership with **all previous-season team contributors**. It does not authenticate individual transactions, their exact dates, draft compensation or contracts. A player traded during the previous season can appear against more than one prior team. This provides a transparent starting estimate of basketball impact for additions and departures.

### Review minutes and availability

Edit `data/rotation_overrides.csv`, then rerun `build`. The file survives data refreshes. Use the stable ESPN player IDs shown in `player_projections.csv`.

```csv
player_id,projected_minutes,availability
EXISTING_PLAYER_ID,,0
```

Replace the example with a real ID. Availability is between 0 and 1; zero excludes that player and reallocates the rotation. Do not infer injury severity from a single status flag. For exact minutes, provide values for **every player on that team's current roster**, including zero-minute reserves, totaling 240. Otherwise leave every projected-minute entry for that team blank. Unknown/stale player IDs and inconsistent rotations raise an error.

### Preseason

Preseason results are summarized separately by team in `preseason_context.csv`. Their weight in the core model is **zero**. They provide a rotation/results review aid without allowing a small, irregular exhibition sample to move the historical rating. An empirical nonzero preseason weight remains future research.

## Historical validation

The chronology is fixed:

| Role | Season |
| --- | --- |
| Initial training history | 2022–23 |
| Development forecasts | 2023–24 |
| Probability-scale calibration | 2024–25 |
| Later test | 2025–26 |

Test results, across all **1,230 games**:

| Forecast | Accuracy | Binary Brier | Log loss |
| --- | ---: | ---: | ---: |
| Raw team model | 63.09% | 0.2230 | 0.6369 |
| Calibrated team model | 63.09% | 0.2219 | 0.6349 |
| Earlier home-win frequency | 55.45% | 0.2471 | 0.6873 |

Lower Brier/log loss is better. Binary Brier uses one home-win probability and ranges from 0 to 1; it is not the same convention as the football project's three-class score. Margin MAE is 12.04 points. The calibrated-minus-baseline log loss difference is −0.0524, with a whole-date bootstrap 95% interval [−0.0718, −0.0329] across 164 match dates. Calibration's improvement over the raw model is small and its comparison interval crosses zero.

The first 14 days of the test season are harder: **56.31% model accuracy versus 57.28% baseline** across 103 games, although probability scoring improves on the baseline. This matters for opening-night expectations.

These are retrospective results from the public historical feed. **They validate the team-only layer. They do not validate the current roster adjustment**, whose current snapshots and whole-season player totals are deliberately excluded from earlier game forecasts. No historical bookmaker comparison, executable edge or ROI has been established. Whole-date bootstrap intervals do not fully account for serial/team dependence.

## TheRundown connection

The direct key is in the private, Git-ignored `nba/.env` or `THERUNDOWN_API_KEY` environment variable. `.env.example` contains only the setting name. Requests use the `X-TheRundown-Key` header. The key is never printed, placed in a URL or put in curl's process arguments.

```sh
# Authenticated, zero-data-point sample; saves access headers without the key.
.venv/bin/python -m nba connection

# Bounded current moneyline read: Pinnacle, DraftKings and FanDuel.
.venv/bin/python -m nba rundown-events --date 2026-10-20 --books 3 19 23

# Join the saved snapshot to model probabilities without another network call.
.venv/bin/python -m nba compare-odds nba/data/private/rundown_events_2026-10-20.json
```

The initial snapshot retrieved **two events**, with two-sided DraftKings/FanDuel prices, and used **12 data points**. All four event/book pairs match published fixtures. Pinnacle prices were not returned. This is the provider's available subset, not proof of complete opening-night coverage.

The connection's effective headers report 20,000 daily / 200,000 monthly points. Current-season statistics evaluation access is active; historical statistics and live statistics access are false. The evaluation expiry returned by the API is `2026-10-22T04:15:40Z` (October 22 at 12:15 a.m. Toronto time). Recheck `connection` for current entitlements rather than inferring them from a plan name.

Responses preserve observation time, per-book price update times, provider event IDs and actual American odds. Moneyline comparisons require both sides from the same sportsbook, remove margin proportionally, exclude closed/off-board/invalid prices, and join provider IDs through explicit team abbreviation mapping. Provider IDs are never assumed to equal ESPN IDs. A price update timestamp need not prove a recently confirmed executable quote.

Raw/derived odds stay in ignored `data/private/`, including `market_comparison.csv`. That file shows model-minus-market probabilities for research; it makes no recommendation or sizing decision. A current market snapshot is not fed into the historical backtest. The provider's documentation also states that backtesting with its data requires prior written permission; obtain that separately before extending this project to historical TheRundown validation.

Sources: [authentication](https://docs.therundown.io/authentication), [stats access and historical association limits](https://docs.therundown.io/guides/stats-access), [V2 data model](https://docs.therundown.io/reference/data-model), [book IDs](https://docs.therundown.io/reference/sportsbooks).

## Files

| File | Purpose |
| --- | --- |
| `data/games.csv` | Four completed regular seasons |
| `data/player_games.csv` | Historical named-player game boxes |
| `data/player_seasons.csv` | Aggregated player/team/season stints |
| `data/rosters.csv`, `data/depthcharts.csv` | Current snapshots and projected roles |
| `data/schedule.csv`, `data/preseason.csv` | Published season fixtures and preseason context |
| `data/data_quality.json`, `data/boxscore_audit.csv` | Coverage and source gaps |
| `reports/season_preview.md` | Season preparation report |
| `reports/team_outlook.csv` | Team ratings, roster effects and scheduled-game expected wins |
| `reports/player_projections.csv` | Current player history, role, minutes and contribution estimates |
| `reports/roster_changes.csv` | Arrivals/departures versus previous-season contributors |
| `reports/historical_team_performance.csv` | Four-season team W/L and scoring summaries |
| `reports/schedule_forecasts.csv` | Team-only and experimental roster-adjusted game probabilities |
| `reports/preseason_context.csv` | Preseason summary, zero core weight |
| `reports/backtest.json`, `reports/backtest_predictions.csv` | Chronological evaluation and reliability bins |
| `reports/calibration.json`, `reports/model_state.json` | Fit configuration, scope and provenance |

The published schedule currently has 80 fixtures per team, with two NBA Cup-dependent regular-season opponents unresolved. Expected wins cover those **80 known games**, not an invented 82-game schedule. They are fixed-rating expectations, not confidence intervals, playoff odds or guarantees.

## Next research work

Validate a historical player/availability layer using information available before each game; test aging, rookie and injury priors; improve defensive and lineup effects; ingest post-opening-night game updates; and assess timestamp-matched market forecasts prospectively. Keep current roster adjustments labeled experimental until that validation exists.
