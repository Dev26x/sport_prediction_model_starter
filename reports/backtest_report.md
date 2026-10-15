# Premier League forecasting evaluation

Data: 820 completed matches, 2024-08-16 through 2026-10-12; snapshot as of 2026-10-15.

Calibration: 380 walk-forward V2 forecasts from 2025-08-15 through 2026-05-24. Temperature 0.9795 (fitted); fixed before 2026-08-01.

Later test period: 60 / 60 fixtures, 2026-08-21 through 2026-10-12, including 2 fixtures using a neutral prior for an unseen team.

Temperature calibration did not improve test-period log loss (raw 1.055342; calibrated 1.055355). Raw V2 remains the default forecast.

| Forecast | Matches | Accuracy | Brier | Log loss |
| --- | ---: | ---: | ---: | ---: |
| V2 | 60 | 45.00% | 0.6358 | 1.0553 |
| Calibrated | 60 | 45.00% | 0.6359 | 1.0554 |
| Baseline | 60 | 38.33% | 0.6686 | 1.1023 |
| Market | 60 | 45.00% | 0.6322 | 1.0496 |

Lower Brier and log loss are better. Brier sums the three squared outcome errors (range 0–2). Market rows can have less coverage; paired comparisons below always use the same fixtures for both forecasts.

| Paired log loss difference | Matches | Match dates | Mean | 95% interval |
| --- | ---: | ---: | ---: | --- |
| V2 minus Baseline | 60 | 20 | -0.0470 | [-0.0857, -0.0160] |
| Calibrated minus V2 | 60 | 20 | 0.0000 | [-0.0016, 0.0014] |
| V2 minus Market | 60 | 20 | 0.0057 | [-0.0737, 0.0844] |

Negative differences favor the first forecast. Intervals use 2,000 paired bootstrap samples of whole match dates (seed 42); cross-date dependence and season-to-season variation are not fully captured.

The underlying team strengths update using strictly earlier match dates. Calibration uses only the earlier period and stays fixed throughout the test. No test outcomes select the temperature or change model parameters. This is a retrospective evaluation on existing data, not an untouched prospective trial.

V1 cannot forecast 5 fixtures across the calibration and test periods because a team has no earlier EPL history. Those fixtures remain in V2's evaluation. The separate V1 comparison in backtest_summary.json uses only common fixtures.

Market probabilities use proportional margin removal from Bet365 closing odds B365CH/B365CD/B365CA, as defined in the [provider notes](https://football-data.co.uk/notes.txt). Closing quotes may postdate the model forecast. This benchmark does not establish an executable betting edge.

The supplied files have not been independently authenticated. Neutral priors for promoted teams remain unvalidated. xG is excluded from this cross-season comparison because the supplied earlier seasons lack it. Over/under and BTTS forecasts are not evaluated or calibrated in this report.

Raw V2 remains the default forecast; calibrated 1X2 probabilities require explicitly loading the calibration artifact. A small retrospective sample does not establish calibration quality, stable profitability, or a betting recommendation.
