# NFL model

Four completed regular seasons (2022–2025), plus available 2026 results and fixtures. Historical sample: **1,087 games**. Buffalo–Cincinnati in 2022 was cancelled; no final score is invented.

From the project root:

```sh
.venv/bin/python -m nfl sync --refresh
.venv/bin/python -m nfl build
.venv/bin/python -m nfl forecast --home BUF --away KC --date 2026-10-18
```

`sync` reads the public [nflverse results/schedule](https://github.com/nflverse/nfldata/blob/master/data/games.csv). It never calls the paid odds API. `build` performs chronological probability calibration on 2024 and evaluation on 2025. The model fits opponent-adjusted scoring margins, home field and capped rest on strictly earlier Toronto dates. Current completed results update team ratings.

2025 evaluation: **59.6%** winner accuracy on 272 games; always-home baseline **53.7%**. This is a team baseline; quarterback, player, weather, injury and transfer effects are not numerically modeled. No profitable market edge has been established.

Final ties are an explicit third result. Moneyline price comparisons assume tied games are voided; fair odds use win probability conditional on no tie. The app shows unconditional win probabilities and labels tie settlement. Check the bookmaker's actual rules.

`data/games.csv`, `data/teams.csv`, `data/quality.json` and `reports/` contain inputs, provenance and evaluation artifacts. The shared implementation is in `sports_models.py` and `sports_data.py`; `model.py` provides NFL entry points. The web app uses the shared server-side TheRundown key, manual odds refresh and a 30-minute cache.
