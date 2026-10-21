# Matchday web app

Private research dashboard for **NBA, NFL, NHL, EPL, La Liga and Serie A**. The date board shows model probabilities, available bookmaker quotes, model/market differences and per-selection explanations. It cannot place bets.

## View locally

From a terminal:

```sh
cd /Users/hakeembraimah/Documents/sb-model/football_model_starter/webapp
npm run dev
```

Open **http://127.0.0.1:5173/**. If prompted by the local development authentication, visit **http://127.0.0.1:5173/signin-with-chatgpt?return_to=/**. The simulated local identity is Seedy. Keep the terminal running while using the local app. A `127.0.0.1` address works only on this computer; it is not internet hosting.

The already-installed dependencies require Node >=22.13. For a fresh checkout, run `npm run install:ci` and `npm run build`, then initialize the local database once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_acoustic_tempest.sql
```

Skip initialization if those tables already exist. Runtime credentials belong in ignored `.dev.vars` (local) and Sites secrets (hosted). `THERUNDOWN_API_KEY` is server-only. The source manifest contains the existing private Site identity. The hosted address is returned only after successful publication; local and hosted saved slips use separate databases.

## API usage controls

- **Odds are manual.** Only pressing **Refresh all-sport odds** calls TheRundown. Opening the app, changing dates, board filters or books, updating public data, switching odds targets, building/copying slips, and reading explanations make no paid odds requests.
- Snapshots are cached for **30 minutes per date, league and bookmaker**, including empty observations. Repeated button clicks during that period reuse the snapshot. There is no background odds polling or unattended scheduler.
- Requests fetch only **match-winner market 1** from the selected bookmaker. The provider's Toronto date offset normally allows one request per active league instead of two UTC dates. Rare DST boundary outliers can require an adjacent date. Account requests are spaced to respect the free-plan rate limit; HTTP 429 cooldowns are retained.
- Public fixtures/results and NBA roster/depth/player updates are separate. These use ESPN, nflverse, the NHL official API and Football-Data. Public source requests are bounded and cached. Missing/incomplete sources retain dated snapshots.
- Provider plan delays still apply. Observation time and last price change are displayed separately. No odds are invented when a market is absent.

## Suggested slips

Toggle **10+**, **20–40**, **50–200**, or **Jackpot 500+ decimal odds**, then choose **Use this slip** to copy the proposal into your saved slip. Suggestions scan **all six competitions on the selected date**, regardless of the board filter. There is **no game-count cap**. Every game first contributes its **most probable supported outcome**, including modelled win-or-draw coverage for football. The no-draw (12) market remains available manually and is not used by suggestions. Opposing underdogs are never substituted to increase the payout. Combinations use one match-winner selection per game and the selected bookmaker. The search then chooses among those per-game outcomes to maximize joint modeled win probability within the target to a relative numerical tolerance of 0.01%. This numerical tolerance says nothing about the model’s predictive accuracy.

Every proposal shows its estimated joint win probability, with an independence assumption. Higher odds can mean a very low chance of success. If the strongest per-game outcomes cannot reach a target, the app shows the available strongest selection set with **target not reached**. It does not downgrade outcomes or invent games to reach it.

**Automatic prices:** a valid bookmaker quote takes precedence. When the feed has no quote, the app uses model fair odds, explicitly marked as an estimate. These estimates are not offered bookmaker prices, so a target that includes them is indicative. Dated bookmaker prices remain labeled research snapshots. Press **Refresh all-sport odds** to check current quotes; the 30-minute cache and manual-only rule still apply.

Enter a hypothetical stake to see **return including stake** and **profit after subtracting stake**. Combined accumulator odds are the **product** of leg prices, not their sum. Prices and calculations fill automatically; there is no manual-price entry. NFL tied games may void a leg and reduce the odds. Explanations and calculations require no LLM API calls.

## NBA rosters, team news and injuries

The displayed NBA forecast now adds the current roster/availability adjustment to the historical team margin. **Match insights** shows both the historical baseline and roster-aware estimate, projected minutes, arrivals/departures relative to last season’s contributors, and linked news/injury sources. **Why the model favours…** explains strength, home court, rest, roster and absence contributions. This may still disagree with the bookmaker; the app flags that disagreement.

- **Update data** refreshes ESPN roster membership, projected depth charts, current player boxes, relevant team news (30-minute public cache) and injury feeds (15-minute public cache). These are separate from paid odds calls.
- Only a recent (within 48 hours), explicitly Out/inactive/suspended report, checked within 30 minutes, removes a player from a game within 48 hours. Projected minutes then redistribute to a 240-minute rotation, capped at 40 per player. Old or uncertain flags remain unconfirmed. An empty injury feed does not establish that players are healthy.
- Official current-season NBA injury PDFs are linked when discoverable. A report that has not been published or retrieved is labeled accordingly. PDF contents are not automatically parsed into player availability; ESPN’s dated structured reports drive the numerical adjustment.
- News is linked factual context. No numerical sentiment score or unsupported trade impact is invented from a headline. Current membership changes can include offseason signings and players traded during the prior season; the NBA official trade tracker is linked for confirmation.

The player box-production proxy, half-weight roster changes and eight-point team caps are **unvalidated assumptions**. Historical NBA accuracy of 63.1% applies to the team-history baseline only, not the roster-aware extension. NFL quarterback/injury and NHL goalie/skater effects are not numerically modeled. Football models do not adjust for confirmed lineups. No model has established a profitable market edge.

## Fixture reports

Open **Fixture reports** from the workspace, or **Full fixture report** on a match card. The separate `/reports` page covers all six competitions. Choose the date and league, then a fixture to read:

- Last five completed league games, scores, opponents and home/away status.
- Current-season W/D/L, scoring and conceding rates, and home/away records.
- Four historical seasons plus the available current season; recent head-to-head results.
- Expected goals/margin, model probabilities, double-chance probabilities, and an explanation grounded in the actual inputs.
- Dated public team news, roster availability flags and source checks. NBA reports include current projected rotations and membership changes.

**Update research** checks public ESPN news and roster feeds, Football-Data, nflverse and NHL data. Public news/availability is cached for 30 minutes. No RotoWire key, OpticOdds subscription or paid odds requests are used by the reporting page. The unused RotoWire integration and secret fields were removed. Empty or unavailable injury data is not treated as a clean bill of health. Advanced xG/possession statistics and unvalidated player effects are not invented.

Football double chance adds mutually exclusive result probabilities. The current low-cost odds feed only requests match-winner quotes; unquoted double chance is explicitly **model-priced**, so its target and payout are indicative until checked with a bookmaker. No 1X2 price is passed off as a quoted double-chance price.

## Verify and rebuild seeds

```sh
npm run typecheck
npm test
npm run build
```

The new folders have independent public-data CLIs. After rebuilding their artifacts, regenerate the server seed from the repository root:

```sh
.venv/bin/python webapp/scripts/export-expanded-seed.py
```

The original NBA seed can be regenerated with `webapp/scripts/export-model-seed.py`. Server seed JSON contains public model inputs, no credentials or paid raw odds. D1 stores dated cache records and user-specific slips; it is distinct between local preview and hosted deployment.

## FanDuel Ontario exact-line analysis

Individual-game SGP pages retain **FanDuel Ontario · copied lines**, including WNBA Finals and NBA/NFL single-game analysis. The automatic combined-slip page has no copied-line or pricing-mode controls. There is **no automatic FanDuel Ontario player-prop or custom-SGP quote connection**. TheRundown Free excludes props, and generic FanDuel coverage does not verify Ontario prices. No paid request or subscription is added by this feature. The existing model milestones remain available under **Model research · unquoted**; they are not represented as FanDuel lines.

Copy the exact player, stat, over/under side, half-point line and individual price from FanDuel Ontario. Decimal and American prices are accepted. Up to 32 supplied markets can be analyzed. Single-game suggestions never exceed ten props. In the combined NBA/NFL builder, each selected game may contribute up to ten props with no whole-game probability cutoff; the search may stop with fewer. Integer O/U lines can push and are explicitly unsupported by this analyzer. Supplied markets are checked against the correct dated fixture, current roster, injury flags, history and role checks. WNBA Game 1 rotation holds still apply. Quoted-line estimates round opponent/role-adjusted historical production to integers, apply the exact O/U event and shrink the weighted hit rate. Unders reverse the latent direction in the correlation simulation. Same-player/stat alternatives are reduced to the most probable supplied outcome before either target is considered; a line is never hardened to force a target.

Two copied-line profiles are available: **Compact · 8+ target** (minimum 68% marginal model chance) and **50× target · higher risk** (minimum 55%). Both use bounded search over supplied, supported lines, same-game dependence and independence between different games. The 50 profile searches a 50–60 **model-fair** band; this does not establish the bookmaker price. The fixed-milestone research view also adds a capped 50-target option for WNBA and NBA/NFL single games. Targets can be unavailable within the cap; no invented quote or longshot is substituted.

To calculate a FanDuel return, copy its **combined SGP or SGP+ quote for the exact selected legs** into the separate combined-quote field. Individual prices are never multiplied to manufacture this value. The CAD calculator uses only that manually entered total quote; without it, the bookmaker return is unavailable. Entered prices are not independently verified. The quote is bound to the exact selection set and individual quote timestamps/prices, expires after 30 minutes and clears on reanalysis or changed selections. Refresh rechecks public inputs and reruns fresh copied lines, but it never refreshes a bookmaker timestamp on its own. Lines are retained only in this browser, not in the shared wallet or an actual betting account. No bet is placed.

## WNBA Finals player-prop page

Open **WNBA Finals** from the workspace or `/wnba-finals`. The dedicated 2026 page covers the seven published Finals fixtures (Games 5–7 are conditional), with an **8+ decimal model-fair odds target**, an eight-prop preference and a strict ten-prop maximum, player-prop explanations, last five results, current-season and playoff averages, opponent context, public injury exclusions and a CAD hypothetical-return calculator. A default CAD 10 stake illustrates CAD 80+ returned including stake when that model target is met. It leaves the daily paper wallet and NBA/NFL daily SGP aggregates unchanged.

The server snapshot contains 27,338 player appearances from 2022–2026, including regular-season and playoff boxes. Every page load, browser reload, fixture change and **Refresh & recalculate SGP** checks free ESPN schedules, rosters, game-specific injury reports/news and the SportsDataverse current-season CSV again, then recalculates the live suggestion. These explicit checks bypass the public-data freshness cache. Unchanged inputs can produce the same deterministic picks. A failed source retains its dated snapshot and appears in the page’s check messages; a refreshed roster is not a confirmed starting lineup. No paid odds API is used. Rebuild the snapshot from `webapp/` with `node scripts/export-wnba-data.mjs`.

WNBA uses calendar seasons and 40-minute games. Fixed lower-quartile player milestones enter the correlation model before the target search. A compatible-subset search first searches up to eight props, then allows nine or ten only when needed. It shows a compact fallback and marks the target missed if 8+ cannot be reached within the cap. The current public probability is the highest joint simulation chance found under that count policy; it is not a demonstrated real-world win rate. Prices are **1 / modeled joint probability**, not bookmaker SGP quotes. Lineup participation is assumed, and WNBA SGP probabilities are not calibrated. Suggestions pause at tipoff, for unresolved schedule status, stale rosters, or missing earlier completed Finals boxes. `npm test` includes WNBA data integrity, target, correlation, no-lookahead and availability checks.

The page includes a postgame review: team/quarter statistics, all original player-line results, missed-line explanations and the next-game reassessment. `lib/wnba-game1-pregame.json` recovers the original 17-line v1 display from the published pregame seed and model, with its input hash and source commit; it is not an actual betting ticket or proof of a later refreshed version. Its thresholds and probabilities remain frozen. The Game 1 review resolves 14 hits and three misses against the reconciled ESPN final box, without treating 82.4% leg hit rate as slip cashing rate. Future compact first-issued forecasts use an insert-only per-fixture archive.

A final box enters history once, with player/team score and minute reconciliation. A miss receives no extra penalty and a hit no bonus. A latest current-team minutes drop below 60% of the preceding ten appearances (at least five earlier appearances and an 18+ minute baseline) triggers a role hold regardless of the last prop outcome. This flags both Bonner’s missed lines and Thornton’s winning rebound line, while Hayes’s shooting miss remains eligible if its updated probability and role pass. The rule is a transparent uncertainty guard, not a validated causal model of coaching decisions. Run `node scripts/export-wnba-review.mjs` after retrieving the current inputs into ignored `work/wnba-review/`; never regenerate the original forecast from postgame data.

## NBA / NFL player-prop SGP builder

Open **Player-prop SGP** in the workspace, or `/sgp`. Choose an NBA/NFL date and fixture, then **Update player data**. The page has **40–60** and **Jackpot 1000+** targets, player evidence/explanations, current-season averages, last five results, opponent history, exclusions, public news, correlation coverage, a copy/download action and a hypothetical stake illustration. It leaves the personal multi-game slip separate.

This is an **experimental research model**, not a bookmaker SGP quoting connection. The current TheRundown plan excludes player props. No extra paid requests were added. Prices are **model fair decimal odds = 1 / joint probability**; target attainment and hypothetical returns use that modeled price. They are not available sportsbook prices or promised payouts.

- Four completed regular seasons plus available current-season NBA/NFL player boxes. NBA points/rebounds/assists/made threes; NFL passing/rushing/receiving yards, receptions and passing touchdowns. Preseason and same-day/future results are excluded. NBA rookies without history receive no invented projection.
- Weighted player distributions have a one-year half-life. NBA recent minutes adjust roles provisionally. NFL requires current-team involvement and recent attempt/target/carry volume; backup QBs are excluded. Opponent team stat allowances use a 180-day half-life, 20-game league-average shrinkage and a +/-15% adjustment cap. These are disclosed model assumptions, not fitted profitability claims. Head-to-head samples are displayed, without an extra small-sample boost.
- Milestones are fixed at the weighted lower quartile, rounded down, independently of either odds target. Candidates require enough history and 68–95% conditional probability. All unresolved public injury flags are excluded until cleared by a new roster snapshot. Availability is still not confirmed.
- Same-game probabilities use 65,536 deterministic Gaussian-copula simulations of earlier shared-game tied rank correlations, shrunk with 30 prior games. Pairs need at least 12 matching games with the same teammate/opponent relationship; sparse pairs use zero correlation and their count is prominently shown. Further shrinkage ensures a positive-definite matrix. The simulation interval covers numerical sampling error only, not model/lineup uncertainty.
- Greedy selection preserves the greatest remaining joint chance at each step. It is not a proven global optimum. Duplicate and logically nested props are blocked. Single-game suggestions stop at ten props; ten is a hard maximum rather than a target. The builder never toughens a line or adds a low-probability prop to force a target; it explicitly marks unsupported targets as missed. Jackpot will often be unsupported.
- No standalone-odds multiplication for SGP pricing. Participation/role assumptions and incomplete correlation coverage materially limit the result. NFL weekly offensive boxes can omit zero-involvement active games. Bookmaker combination limits, supported alternate lines and settlement/void rules are not available from the free feed.
- Public rosters/news cache for 30 minutes; NFL current-season boxes cache for one hour. NBA game boxes update in batches of eight, reconcile player points with final scores, and retain stable game indices across retries. Repeat Update player data if ingestion remains. No unattended odds polling.

The server-only compact seeds contain 104,854 NBA player boxes and 25,657 NFL offensive player boxes at initial export. Sources: existing reconciled ESPN NBA boxes, [nflverse stats_player](https://github.com/nflverse/nflverse-data/releases/tag/stats_player), and public ESPN current rosters. NFL GSIS IDs are joined to ESPN rosters only by unique normalized full names; numeric IDs from different providers are never assumed to match. Missing/ambiguous identities are excluded.

Rebuild public inputs from `webapp` with `python3 scripts/export-sgp-data.py --download` (requires the existing root NBA CSVs and NFL schedule). Run `node scripts/evaluate-sgp.mjs` after model changes. `lib/sgp-validation.json` records a walk-forward development diagnostic on 64 prior-season games per sport. It conditions on the completed box participant list and therefore **does not validate availability, DNP handling, live lines, SGP prices or profit**. It is too small to calibrate rare SGP/Jackpot probabilities. `npm test` includes both the existing model/slip checks and the SGP math/data checks.

## Forward paper wallet and daily SGP+

**Model challenge** (`/paper`) is a shared forward-only CAD experiment. The opening value is CAD 200; each of the four normal daily suggestions stakes CAD 5 when supported and affordable. SGPs are excluded. Cash reserves stakes immediately; wallet value includes unresolved stakes at cost. Wins credit the frozen payout, losses lose the stake, and voided legs reduce the price. The page shows cashing rate, ROI, drawdown, a wallet chart, per-leg final scores/source links, frozen explanations and CSV export. The ledger lists 90 days; headline totals cover the entire run.

Daily snapshots are immutable by Toronto day/profile. No past predictions are regenerated after results. Capture opens at 06:00 America/Toronto, or the first page visit after that time if the cloud run has not captured the day. Started games are omitted on late first capture. Each displayed fallback suggestion is still tested when its target was missed, with that fact recorded. Empty or unaffordable slips take no stake. Overlapping/identical profiles remain four separately staked suggestions; their outcomes are not independent. There are no automatic deposits, resets or actual bets.

Prices distinguish fresh bookmaker observations, dated quotes, mixed prices and model-only prices. Model-priced payouts are illustrations and cannot establish real-world betting profit. The result feed is public ESPN final scores, cached for 15 minutes. Football uses league full-time results; NHL includes OT/shootout final winners. Tied NFL two-way winner legs and officially cancelled/abandoned games void under the paper rules. NBA/NHL tied finals need review; postponed, missing and unfinished results remain pending. Actual bookmaker settlement rules may differ. Final recorded leg outcomes are not silently rewritten for later score corrections.

The hosted cloud task uses the Site's published `/paper-runner.mjs` and purpose-scoped authenticated updater. Only the hash of the updater key is configured as the private `PAPER_RUNNER_HASH` secret. Follow [PAPER_AUTOMATION.md](./PAPER_AUTOMATION.md) for its verified source/access/readback process. No credentials are stored in the source or schedule. Routine runs make no paid odds requests and do not republish. Local and hosted ledgers are separate; the local page checks results while open. Schema migration `0001_quiet_proudstar.sql` adds only the two paper tables.

**Refresh behavior:** NBA/NFL single-game and combined SGP builders also check public rosters, injury reports, news and available player boxes on page load and refresh, then rerun the model. Live SGP calculations are not reused from the former 30-minute analysis cache. Explicit refresh bypasses roster/news and NFL-box freshness caches; bulk NBA completed-result schedules retain their hourly cache and new player boxes are ingested in batches of eight. Only explicit starter flags for both complete basketball starting fives are labeled as a reported lineup. Missing injury/lineup data never implies that a player is active. Original pregame archives remain immutable, and the paid odds manual/30-minute policy is unchanged.

**Best across games** is now a builder mode on `/sgp?mode=combined&pool=both`; the existing `/sgp/daily` link opens the same builder. Choose **NBA only**, **NFL only**, or **NBA + NFL**, and a Toronto date. The selected pool is enforced in fixture loading and in the combination search, retained in the URL, and included in copied slips. All eligible games are considered, with one compatible prop group per selected game. Every selected group contains no more than ten props; fewer props remain valid. The previous 40% cutoff has been removed. There is no slate-wide cap on the number of different games. Sport coverage and incomplete analysis are shown; a failed game must be retried before the page claims a complete combined result. Switching pools cancels the old request queue. Games within five minutes of starting, postponed games and unsupported fixtures are excluded; a displayed slate that crosses that cutoff is disabled until rebuilt.

**Automatic combined player-prop slips:** `/sgp`, `/sgp/daily` and `/sgp?mode=combined` now default to NBA and automatically show one grouped slip under each of four tabs: 20, 50, 200 and Jackpot 1000+. NFL or both can still be selected explicitly. Manual price entry, per-game option dropdowns and pricing modes are removed from this page. Supported fixed player milestones enter a target-independent search over compatible subsets with 2–10 props per included game. Unlike the old strongest-prefix chain, the subset beam keeps combinations across the joint-probability range at every leg count. Within a 0.025 log-probability bucket, compact combinations are preferred to avoid adding redundant legs. Large-pool search uses a 128-state diverse beam; it is an approximation, not a global-optimum claim. At least two games are used when two supported games are available. The combined search maximizes the estimated joint chance found within model-fair reference bands 20–21, 50–52.5, 200–210 and 1000+. It can use different leg counts from different games; it never pads every game to ten. When a target is unreachable it returns no ticket for that target and explains the shortfall. It never repeats a shared maximum-length fallback under different target labels. Odds and stake returns are explicitly model estimates because no live FanDuel SGP quote feed is connected. No sportsbook price is claimed. The slip is one continuous numbered list, with the fixture noted under each prop. The analysis lives separately at `/sgp/analysis`, with supporting player evidence and links to individual fixture research. No paid odds calls or paper-wallet stakes are added.


## Football corners and BTTS builders

`/football-slips?date=2026-10-17` provides separate corners and BTTS pools for
EPL, La Liga and Serie A. Both reuse the existing probability-first combination
search and four normal profiles: 10+, 20–40, 50–200 and Jackpot 500+. No game-count
cap, opposing-outcome substitution, automatic harder corner line or forced target.
Unreachable ranges show the supported available set and explicitly miss the target.

The corner line is a user-selected half-integer (6.5–13.5; default 8.5), fixed
before target search. Suggestions may compare over and under or use an explicit
one-side filter. BTTS similarly supports best-side, Yes-only and No-only pools.
Manual picks automatically replace another selection from the same fixture.
Selection IDs persist in the current browser per date/league/market/line; current
model prices are used after a reload. Both builders include CAD stake, return and
profit calculations and copy/download research slips. These markets remain outside
the normal suggested-slip pools and the shared paper wallet.

`lib/football-markets-seed.json` contains 4,758 dated matches with actual HC/AC
corner counts: 2022–23 through 2025–26 plus the available 2026–27 games. Sources
and field definitions: https://www.football-data.co.uk/notes.txt . Reproduce with
`python3 scripts/export-football-markets.py`; raw CSVs stay in ignored `work/`.
The existing public football refresh now retains goal and corner columns from the
same hourly request; incomplete feeds retain their previous snapshot. New-page
fixture refreshes reuse the 15-minute fixture cache. No TheRundown requests or
additional paid API access are used by this page.

Corners use venue-specific rates for corners produced/conceded, 180-day recency
weighting, 12 effective league-prior matches and a negative-binomial total-count
distribution fitted to league-level overdispersion (Poisson limit if necessary).
Require 200 earlier league games, 12 corner games per club, five per relevant
venue. BTTS reuses the existing goal rates and analytic independent-Poisson
probability that both score; require 200 league games and eight games per club.
Both exclude same-day/future observations and unsupported fixtures. Probabilities
are experimental and neither model adjusts for confirmed lineups or weather.

No connected bookmaker quote is available for these markets. Displayed odds are
model fair odds (1 / probability), so target achievement and returns are research
illustrations rather than available sportsbook prices. Different-fixture chances
are multiplied assuming independence. Corners and BTTS for one game are not
combined as independent events.

`node scripts/evaluate-football-markets.mjs` reproduces the 2025–26 chronological
single-market development check in `lib/football-markets-evaluation.json`. It fixes
the 8.5 corner line and all model settings before evaluating each match against
strictly earlier dates. Results are exposed on the page, including the weighted
league baseline. BTTS did not outperform that baseline in any of the three leagues;
corners did so only in La Liga. No demonstrated betting edge or calibrated slip
win rate is claimed. `npm test` includes the specialist model/data/search checks.


### Combined SGP subset-search regression

`node scripts/test-sgp-subsets.mjs` replays the actual public-data analysis snapshots from the three NBA fixtures saved on 2026-10-20. It first reproduces the rejected 30-leg, 18.78-model-odds fallback under every target, then verifies four distinct target-reaching combinations, variable per-game counts, unchanged supported lines, compatibility, and recalculated joint probabilities. These are research reference prices and a software regression, not available sportsbook quotes or a profitability backtest. `test-simple-sgp.mjs` verifies one continuous ticket, separate analysis, and no fallback ticket when a target is unavailable.

### NBA team totals and Champions League

- `/nba-team-totals`: opponent-adjusted team scoring model using the last four NBA seasons plus earlier current-season regular-season results; alternatives for each team's over/under points (overtime included). Both-team selections in one fixture use a deterministic joint scoring simulation with empirical scoring correlation. One selection per team; no conflicting over/under stacking.
- `/ucl`: dated UCL slate, current-season domestic and UCL result analysis, last five results, win/double-chance/goals/BTTS candidates. A regularised Poisson model fits shared attack/defence ratings with competition scoring baselines and UCL matches connecting leagues. Norway uses its calendar-year season. Missing domestic coverage is explicit (the public Ukrainian feed is unavailable), and those fixtures have no suggested pick.
- Both pages include Best picks, independent 20/50/200/1000+ model-price targets, manual selections, CAD stake calculations, copying and collapsed analysis. If a target cannot be reached by supported candidates, no fallback ticket is relabeled as reaching it. Different fixtures are assumed independent. Predictions exclude all results on or after the selected Toronto date.
- `/api/specialist` provides authenticated GET boards and origin-checked POST public-data updates. Source checks are cached for 30 minutes; no TheRundown, RotoWire or FanDuel API calls are made. A failed per-team UCL update removes that fixture's suggestions while retaining its research and the other supported games.
- All thresholds, probabilities, odds and returns are experimental model estimates. No verified sportsbook lines/prices, profit claims, automatic bet placement or paper-wallet entries. Confirmed lineups/injuries are not quantitatively incorporated into these new specialist models.
- The committed UCL seed includes checked fixtures and current-season results across 11 domestic leagues and all 36 UCL participants. A maintained full snapshot can be regenerated with `node scripts/update-ucl-seed.mjs YYYY-MM-DD` (public sources only). Live page updates check the participating teams and the previous seven days of UCL results; the initial league-wide baseline is the shipped snapshot, not an always-live full league import. `npm test` includes specialist model, target-search, cutoff, source-cache and provider-failure regression checks.

### Win + over/under builder

`/win-totals` adds a single combined slip of team-to-win **and** full-game total outcomes for NBA, EPL, La Liga, Serie A and UCL. Select a date and competition; choose a half-point total, or use the NBA automatic alternative total. Automatic NBA lines are fixed at projected total plus half a predictive standard deviation, rounded to a half point; this supplies a more conservative under alternative before any payout-target search. The displayed threshold is not a confirmed sportsbook offer.

- A combination is one event with two conditions. Football probabilities sum a joint Poisson score grid; draws lose the win condition. NBA probabilities use the same joint scoring distribution as the team-totals model, with 65,536 deterministic simulations. Winner and total marginals are not simply multiplied.
- Football markets are 90 minutes plus stoppage time, excluding extra time/penalties; NBA is full game including overtime. Existing specialist/model limitations still apply. The new winner/total estimates have not had a separate calibration or sportsbook-price backtest.
- Suggested targets are 20, 50, 200 and 1000+ model-estimated odds. The highest-probability combined event at the selected line is fixed per fixture before target search; weaker opposing outcomes or alternate lines are not substituted to manufacture a target. An unreachable target returns no ticket. Manual selections may choose another combination, with one combined event per fixture.
- The stake/return calculator uses joint model fair prices, not live FanDuel prices. No bet is placed or paper-wallet entry created. Source checks reuse NBA/UCL snapshots and the existing domestic football model, with a 30-minute refresh guard and no paid odds calls. Changing a line recalculates the model without refreshing providers.
- `/api/win-totals` validates competition, date and half-point line; authentication and same-origin checks protect source refreshes. Tests cover analytic soccer score events, draw losses, impossible combinations, dependence, monotonicity, source failures, unchanged lines, per-fixture exclusivity and all supported football services.
