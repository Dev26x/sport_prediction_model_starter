# Premier League forecasting

Research forecasts from the existing season CSV files. The current model is V2: independent Poisson goals, venue-specific scoring/conceding rates, a 180-day recency half-life, and eight prior matches of shrinkage toward league averages. Teams with no earlier EPL history receive a neutral league prior. V2 extends V1's coverage; its probabilities agree with V1 when both teams have history.

The project now includes data validation, complete chronological evaluation, an earlier calibration period, a historical market benchmark, and a fixture forecast command. These results do not establish a profitable betting system.

## Setup

Use the existing virtual environment, or create one and install the requirements:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Existing data

The supplied files contain 820 completed matches:

| Season | Matches | Last result |
| --- | ---: | --- |
| 2024–25 | 380 | 2025-05-25 |
| 2025–26 | 380 | 2026-05-24 |
| 2026–27 | 60 | 2026-10-12 |

Source files are `data/E0_2425.csv`, `data/E0_2526.csv`, and `data/E0_2627.csv`. Their merged dataset is `data/premier_league_master.csv`. Raw files are preserved. The supplied results and odds have not been independently authenticated against the provider.

Required columns: `Date`, `HomeTeam`, `AwayTeam`, `FTHG`, `FTAG`. Optional closing-price benchmark columns: `B365CH`, `B365CD`, `B365CA`. xG is present only in the 60 current-season rows; earlier seasons cannot support a comparable xG backtest yet.

To rebuild the master dataset:

```sh
.venv/bin/python prepare_data.py --as-of 2026-10-15
```

Preparation parses ISO dates and day-first source dates, trims team names, ignores unplayed/future fixtures, removes identical duplicates, and rejects invalid completed records or conflicting duplicates. Team spellings follow the supplied source; aliases are not inferred. Default `--as-of` is today's date in America/Toronto. Input and default output paths are relative to the scripts, so commands also work from another directory.

Provider downloads: [Football-Data](https://www.football-data.co.uk/data.php). Column meanings: [provider notes](https://football-data.co.uk/notes.txt).

## Reproduce the evaluation

```sh
.venv/bin/python backtest.py --as-of 2026-10-15
```

The default split is fixed in advance of this evaluation run:

1. Matches before `2025-08-01` provide the initial history. At least 100 earlier matches are required for a forecast.
2. Walk-forward forecasts from `2025-08-01` until `2026-08-01` fit a single 1X2 temperature parameter by log loss. The fit uses 380 matches. Bounds are 0.5–3.0; samples below 100 use identity calibration.
3. Matches from `2026-08-01` form the later test period: all 60 available fixtures. Team strengths update as earlier results become available; the temperature stays fixed.

Each forecast uses only results from strictly earlier **dates**. Results from the same date are excluded regardless of kickoff time. Test outcomes do not fit the temperature. This is a retrospective test on existing files, not an untouched prospective trial. In-sample calibrated probabilities are deliberately omitted from the calibration rows.

Test results as of October 15, 2026:

| Forecast | Matches | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| V2 | 60 | 45.00% | 0.6358 | 1.0553 |
| Calibrated V2 | 60 | 45.00% | 0.6359 | 1.0554 |
| Historical outcome frequencies | 60 | 38.33% | 0.6686 | 1.1023 |
| Closing-price benchmark | 60 | 45.00% | 0.6322 | 1.0496 |

Lower Brier/log loss is better; multiclass Brier sums the three squared outcome errors (range 0–2). Calibration did not improve test log loss, so raw V2 remains the default. V2's mean log loss difference from the baseline is −0.0470, with a date-bootstrap 95% interval of [−0.0857, −0.0160]. Its difference from the closing-price benchmark is +0.0057 [−0.0737, +0.0844], providing no demonstrated advantage over that benchmark. These intervals cover only 20 match dates and do not fully capture dependence across dates or future seasons.

Market probabilities normalize inverse Bet365 closing decimal odds to sum to one. All three prices must be finite and greater than one; missing quotes never remove a fixture from model evaluation. Market comparisons use only paired fixtures. Closing prices may postdate the forecast, and the CSV does not establish a quote available at a requested forecast timestamp. There is no ROI or executable-edge claim.

Outputs:

- `data/backtest_results.csv`: 440 date-level forecasts, explicit calibration/test labels, model coverage flags, and separate probability columns.
- `reports/backtest_report.md`: readable findings and methodology.
- `reports/backtest_summary.json`: metrics, coverage, data file hash, and paired log loss intervals (2,000 whole-date bootstrap samples, seed 42).
- `reports/calibration.json`: frozen calibration, its dates, and matching model configuration.
- `reports/calibration_bins.csv`: test-only reliability bins for home/draw/away outcomes.

Custom periods and paths are available through `backtest.py --help`. Changing periods creates a different retrospective experiment; preserve previous outputs with `--output` and `--report-dir` when comparing experiments.

## Forecast a fixture

This is an example matchup; no fixture schedule is inferred or downloaded:

```sh
.venv/bin/python forecast.py Arsenal Chelsea --date 2026-10-17 --as-of 2026-10-15
```

The command shows expected goals, raw 1X2, over/under 2.5, BTTS, fair decimal odds, training dates, and team coverage. Totals and BTTS have not been evaluated or calibrated by the new 1X2 backtest. Raw V2 is the default. Add `--json` for structured output; quote names with spaces.

To explicitly inspect calibrated 1X2 alongside raw probabilities:

```sh
.venv/bin/python forecast.py Arsenal Chelsea --date 2026-10-17 --as-of 2026-10-15 --calibration reports/calibration.json --json
```

An artifact cannot forecast a date before its fitting cutoff, use results after `--as-of`, or silently apply to a different model configuration. Unknown team spellings raise an error with suggestions; use `--allow-new-team` only for an intentional new entrant. Neutral priors remain unvalidated promoted-team estimates.

## Verification and earlier scripts

```sh
.venv/bin/python -m unittest discover -s tests -v
```

Tests cover date cutoffs, malformed data, duplicate conflicts, unseen-team coverage, same-day/future leakage, calibration separation, scoring rules, missing odds, and calibration artifacts.

`model.py`, `model_v1.py`, and `backtest_v1.py` retain the earlier experiments. `backtest_v2.py` remains the all-period V1/V2 comparison: it now retains all 440 fixtures, marks V1's five unavailable forecasts, and reports V2 on both the full set and the 435 common fixtures. Use `backtest.py` for the calibrated temporal evaluation above.

## Next research milestone

Add an opponent-adjusted attack/defense model, including a better promoted-team prior, and compare it with frozen V2 on new data. Build longer xG and lineup histories with availability timestamps before adding those features. Any later price comparison needs timestamped quotes matched to the actual forecast time.
