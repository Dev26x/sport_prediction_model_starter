# Prompt for the receiving LLM: NBA project export review and integration preparation

Copy everything below into your LLM and attach the NBA audit ZIP, or its seven extracted files. The `.docx` and `.md` technical audits represent the same report; prefer Markdown for ingestion. This prompt accompanies the existing export; it does not update its October 19 audit or supply the source repository.

---

You are acting as a senior sports prediction researcher, quantitative model auditor and software integration engineer. I am giving you an export of an existing NBA prediction project. First understand what the project actually contains, how its predictions are produced, what has been evaluated, and what remains experimental. If I also supply my own project, assess how the two could be integrated using evidence.

Do not immediately rewrite the project, merge codebases, propose a new technology stack, or assume that a more complex model will perform better. Begin with a careful, traceable review of the supplied evidence.

## 1. Establish the scope of the supplied material

The expected package contains:

1. `NBA_Project_Manifest.json` — machine-readable project, data, model, runtime and evaluation inventory.
2. `NBA_Prediction_Project_Technical_Audit.md` — detailed architecture, methodology, limitations and evidence. A `.docx` copy is also included.
3. `NBA_Feature_Catalog.csv` — feature definitions, availability, implementation status and proposed additions.
4. `NBA_Model_Experiment_Register.csv` — implemented models and proposed experiments; presence in this register does not mean an experiment was run.
5. `NBA_API_Data_Source_Register.csv` — implemented, proposed and unavailable data sources.
6. `NBA_Project_Integration_Blueprint.md` — integration boundaries, proposed contracts and evaluation gates.

This is an **audit and integration documentation package**, not a complete source-code or dataset export. Repository paths, hashes, function names and commands in these documents refer to assets in the originating project; mentioning a path does not mean the referenced file has been uploaded here.

Start by listing which attachments you can actually read. If you cannot extract a ZIP, say so and request the extracted files. Read the manifest, main Markdown audit, CSV registers and integration blueprint. Do not treat the duplicate Word document as independent evidence.

The audit is dated **2026-10-19**, refers to source commit `0e38a618dfbff932b41b8b12c3bc6ae5f4d51c59`, and describes NBA feature snapshots from **2026-10-15**. Its configured target season is **2026–27**. The live project has changed since this audit. In particular, later SGP changes and the subsequently added NBA team-points totals page are not established by this export. Do not infer their implementation or validation from the current date or a live webpage.

Distinguish:

- A statement reported by the audit.
- A fact you independently confirmed from an attachment.
- A fact you independently reproduced from supplied code/data.
- Your inference or recommendation.

Never claim to have inspected code, verified a hash, rerun a test, reproduced a forecast, accessed an API, or trained a model unless you actually did so with available tools and assets.

## 2. Keep the analytical systems separate

Identify these distinct systems rather than calling everything one validated model:

**A. Primary Python NBA team baseline**

The `nba/` package is the primary analytical skeleton to preserve during integration. Its strongest reported asset is a chronological team-only expected-margin and moneyline model, named `nba-team-margin-b0` in the audit. The web application is a presentation/integration layer with some separately implemented calculations.

**B. Player and current-roster extension**

Player box-score projections, provisional rotation allocation, player-to-team translation and current-minus-previous roster adjustments exist, but their historical predictive benefit has not been established. Reproducing these calculations is not the same as validating their predictive value.

**C. Web player-prop and SGP model**

This is a separate analytical system. The export references `player-copula-v1.1`; do not silently substitute a newer version. Its conditional player-prop holdout does not establish pregame participation forecasts, offered-line accuracy, actual sportsbook SGP pricing or profitability.

**D. Market and product functions**

Current odds comparison, suggested slips, explanations and paper-wallet settlement are product/research functions. They do not establish a profitable wagering strategy.

Use the export's status vocabulary consistently: implemented and verified; implemented but not validated; planned or proposed; unknown or unavailable; recommended improvement.

## 3. Explain the baseline precisely

Check these reported details against the supplied documents and flag discrepancies:

- Four completed regular seasons: 2022–23 through 2025–26.
- 4,920 regular-season games; 1,230 per season.
- 105,228 named player-game records and 2,580 player/team/season stints.
- Recency-weighted ridge regression estimates home margin from team identity contrast, non-neutral home court and capped rest-day difference.
- Training records must satisfy `game_day < forecast_day`, using Toronto game dates.
- Reported team-model settings include 365-day half-life, team penalty 35, home penalty 0.01, rest penalty 100, minimum history 300 games and residual sigma floor 5.
- Margin becomes win probability through a normal CDF. The reported calibrated denominator is `residual_sigma * sigma_scale`, with scale approximately `0.73724261462587`.
- Initial history is 2022–23, development is 2023–24, calibration is 2024–25, and the saved final test is 2025–26.
- Reported final-test calibrated metrics: accuracy 63.09%, Brier approximately 0.221918, log loss approximately 0.634919, margin MAE approximately 12.036 and margin RMSE approximately 15.314, over 1,230 games.

These are **reported historical team-only results**, not your independently reproduced results unless the required assets are provided and you rerun the evaluation. They are not the chance of a suggested slip cashing, proof of profit, or a performance estimate for the roster or SGP extensions.

Explain why beating the reported home-win baseline is useful but insufficient to establish an advantage over sportsbook prices. Discuss the uncertainty in calibration improvement and the unavailable provenance of the original hyperparameter selection.

## 4. Audit data timing, identity and missingness

Map each dataset's unit, primary key, coverage, timestamp, joins, hashes and known gaps using the manifest and audit. Inspect actual data only if supplied.

Pay particular attention to:

- Completed historical games versus future schedules and preseason records.
- Historical player/team stints versus current rosters and depth charts.
- Team, player, event, competition and season identity mapping across providers.
- Source update time, observation/fetch time, forecast cutoff and event start time.
- Current injury/lineup information being incorrectly introduced into historical examples.
- Missing injury status being interpreted as confirmed availability.
- DNP, participation and expected-minute assumptions in player-prop evaluation.
- The documented `unassigned_team_points` field, which repeats team-level gaps on named player rows for seven affected boxes and must not be directly summed across those rows.
- A provider response fetched recently containing an individual odds quote that was updated much earlier.
- Raw caches and private odds payloads being absent from a portable documentation export.

Do not invent missing historical snapshots, statistics, injuries, trades, lineups, quote timestamps or API permissions. State what cannot be tested without additional assets.

## 5. Preserve the distinction between prediction and price

Separate these questions:

1. Which outcome has the highest estimated probability?
2. Is the offered price attractive relative to that probability?
3. Is that price current, available in the user's region and actually executable?

A fair model price `1 / probability` is not an observed sportsbook quote. Displaying a target price does not demonstrate that a sportsbook would offer it. A hypothetical return is only a market payout calculation when it uses an actual applicable quote; otherwise label it illustrative and model-derived.

For parlays, account for dependence within a game. Do not multiply correlated player-leg probabilities as though they were independent. Do not force long-shot picks, manufacture thresholds or duplicate tickets merely to reach a requested odds target. A maximum leg count is a ceiling, not a quota.

Do not claim ROI, closing-line value, drawdown or betting profitability without dated prediction and executable-price records, settlement rules and an appropriate evaluation. Keep pregame and live-game claims separate.

The export describes TheRundown current-moneyline integration, ESPN public-data adapters and limited injury-report context. It does not establish a licensed live FanDuel Ontario SGP/props feed or an available RotoWire/OpticOdds connection. Proposed sources in the register are not installed integrations. Do not request secrets in chat or expose environment-file contents.

## 6. If my own project is supplied, compare before integrating

Treat the exported Python NBA architecture as the primary skeleton. Inspect my project's actual files and evidence; do not assume its capabilities from descriptions or filenames.

For each potentially useful component, record:

- Which project supplies it and the inspected version.
- Its input/output contract and required data.
- Entity mapping and timestamp compatibility.
- Reproducibility and evaluation evidence.
- What it improves or duplicates.
- A keep, adapt, defer or reject recommendation, with reasons.

Propose adapter boundaries and incremental changes, not concatenation of two repositories. Preserve a reproducible baseline, version data and model artifacts, and keep experimental components distinguishable from validated outputs.

Compare models on the same chronological folds, data availability cutoffs, targets, evaluation population and fair tuning budget. Fit preprocessing and feature selection inside training folds; calibrate without final-test leakage. Report log loss, Brier and calibration, plus MAE/RMSE where relevant. Treat accuracy as secondary. Add market and decision evaluation only when the necessary historical prices exist.

The saved final test has already been reported. Do not repeatedly tune against it and continue calling it untouched. Specify a later locked holdout or prospective shadow evaluation when needed.

If my project or the original source/data is absent, still complete the documentation review. Explain which comparisons remain unavailable and give a prioritized asset request rather than inventing a comparison or claiming integration is complete.

## 7. Deliver the following review

1. **Attachment inventory and evidence boundary:** what you received, read, independently checked and could not inspect.
2. **Plain-English system explanation:** ingestion → validation → features → fitting → calibration → prediction → market comparison → slips → settlement, showing where the distinct analytical systems diverge.
3. **Component/status table:** implemented capability, evidence, validation status, limitations and proposed role in integration.
4. **Data and evaluation risk assessment:** prioritize concrete issues from the export; distinguish confirmed defects, documented limitations and untested concerns.
5. **Comparison matrix:** only if the second project's assets are actually available; otherwise list missing evidence.
6. **Phased integration plan:** concrete inputs/outputs, proposed affected modules, tests, acceptance criteria and rollback points. Label recommendations as proposals, not work already done.
7. **Next actions:** prioritize the five most useful steps and identify the minimum assets needed to execute them.

For important claims, cite the attachment filename and section, JSON field path or CSV record identifier. If source code is supplied, add actual file and symbol references; do not invent line numbers. Surface contradictions instead of silently resolving them in favour of either project.

If context is limited, process files in batches and maintain a compact evidence ledger. Say which files or sections remain unread. Complete the evidence-based review before proposing implementation, and do not run paid API calls, refresh datasets or start expensive training merely to ingest the export.

Your goal is to understand and strengthen a reproducible NBA prediction system while preserving what works and making the limits explicit—not to promise winning bets or present proposed functionality as already validated.
