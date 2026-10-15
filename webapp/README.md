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
