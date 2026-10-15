# Football: EPL, La Liga and Serie A

Three independent league models. Each uses four completed seasons (2022–23 through 2025–26), **1,520 historical results per league**, plus available 2026–27 results. Teams and scoring averages are never pooled between leagues.

From the project root:

```sh
.venv/bin/python -m football sync --refresh
.venv/bin/python -m football build
.venv/bin/python -m football forecast --league laliga --home Barcelona --away 'Real Madrid' --date 2026-10-18
.venv/bin/python -m football forecast --league seriea --home Inter --away Milan --date 2026-10-18
```

Results come from [Football-Data](https://www.football-data.co.uk/data.php), using E0, SP1 and I1 files. Public downloads never call the odds API. `model.py` applies the existing root `model_v2.py` configuration separately to each league: independent Poisson goals, a 180-day half-life, venue-specific rates and an eight-match shrinkage prior. Only strictly earlier dates are used.

Chronological 2025–26 checks (380 matches each):

| League | 1X2 accuracy | Historical-frequency baseline |
|---|---:|---:|
| EPL | 50.5% | 42.6% |
| La Liga | 52.4% | 48.9% |
| Serie A | 50.8% | 38.9% |

These are retrospective checks, not evidence of profitable betting. The model has no numerical confirmed-lineup, player or transfer adjustment. Over/under 2.5 and BTTS are exploratory outputs without separate validation. Suggested slips use complete three-way match-result markets for regulation plus stoppage time; extra time and penalties are excluded.

The original root EPL project remains available. The multi-sport web app uses this four-season football dataset, public fixture/result refreshes, and the shared private odds connection with manual refresh and 30-minute caching.
