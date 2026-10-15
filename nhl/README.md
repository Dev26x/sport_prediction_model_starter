# NHL model

Four completed regular seasons (2022–23 through 2025–26), **5,248 final results**, plus the published 2026–27 schedule and available results. Finals include overtime/shootout; this is a full-game winner model.

From the project root:

```sh
.venv/bin/python -m nhl sync --refresh
.venv/bin/python -m nhl build
.venv/bin/python -m nhl forecast --home 10 --away 13 --date 2026-10-17
```

Team IDs and abbreviations are listed in `data/teams.csv`. Results come from the [NHL's official club-season API](https://api-web.nhle.com/v1/club-schedule-season/BOS/20222023). Public ingestion does not use TheRundown credits.

The opponent-adjusted margin model uses recency, home ice and capped rest. It trains on strictly earlier Toronto dates. Probability scaling is fitted on 2024–25 and frozen before the 2025–26 test. That test covers **1,311 games**, with **52.9%** winner accuracy versus **52.2%** always-home accuracy. One game was excluded because its new official team identity had no earlier results. This is modest evidence, not a proven betting advantage.

Arizona, Utah Hockey Club and Utah Mammoth retain the provider's distinct IDs; results are not silently reassigned across identities. Starting-goalie, skater availability and player/transfer effects are not numerically modeled. Regulation-only three-way moneylines, player props and totals are unsupported.

The shared implementation is in `sports_models.py` and `sports_data.py`; this folder holds its own data, quality report, calibration and test predictions. In the web app, full-game moneylines use the shared private key, manual refresh and a 30-minute cache.
