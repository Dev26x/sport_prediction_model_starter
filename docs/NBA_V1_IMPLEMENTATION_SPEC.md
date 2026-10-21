# NBA Prediction System V1 — Repo-Level Implementation Specification

**Repository:** `Dev26x/sport_prediction_model_starter`  
**Baseline branch reviewed:** `main`  
**Current NBA baseline:** `nba-team-margin-b0`  
**Purpose:** preserve the validated NBA team-only benchmark, add a reproducible modern-era research framework, and create the data/experiment contracts required for later injury, lineup, odds, player-prop, and parlay work.

---

## 1. Non-negotiable design rules

1. **Do not rewrite the existing B0 model while building V1 research infrastructure.**
2. **Every historical feature must be knowable at the prediction cutoff.**
3. **Every experiment must use chronological splits.**
4. **The final locked holdout may not be repeatedly used for feature/model selection.**
5. **Prediction quality and betting-value evaluation are separate.**
6. **A new feature or model enters the production headline probability only after it beats the active baseline under the agreed temporal evaluation.**
7. **Current injury, roster, lineup, or odds information must never be backfilled into historical training rows unless a timestamped historical snapshot exists.**
8. **No ROI, CLV, or profitability claim without timestamped executable prices and settlement records.**
9. **Player-prop, totals, SGP, and team-moneyline systems remain separately testable even though they appear in one product.**
10. **The dashboard may be public, but credentials, private API payloads, and provider secrets remain server-side and Git-ignored.**

---

## 2. Files to freeze as B0 reference

Treat these as the canonical baseline implementation during Phase 0/1:

- `nba/model.py`
- `nba/backtest.py`
- `nba/config.py`
- `nba/reports/backtest.json`
- `nba/reports/backtest_predictions.csv`
- `nba/reports/calibration.json`
- `nba/reports/model_state.json`

B0 reference settings:

- half-life: `365 days`
- team ridge penalty: `35`
- home penalty: `0.01`
- rest penalty: `100`
- minimum history: `300 games`
- residual sigma floor: `5`
- calibration scale: `0.73724261462587`
- training/evaluation seasons:
  - initial history: `2022-23`
  - development: `2023-24`
  - calibration: `2024-25`
  - final reported test: `2025-26`

Reported B0 final-test reference:

- games: `1,230`
- accuracy: `63.09%`
- Brier: `0.221918`
- log loss: `0.634919`
- margin MAE: `12.036`
- margin RMSE: `15.314`

These numbers are the baseline comparison artifact. New development must not mutate these historical outputs in place.

---

## 3. New package layout

Add a new research namespace rather than mixing experimental work into B0.

```text
nba/
├── research/
│   ├── __init__.py
│   ├── contracts.py
│   ├── registry.py
│   ├── splits.py
│   ├── metrics.py
│   ├── dataset.py
│   ├── runner.py
│   ├── artifacts.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── b0_adapter.py
│   │   ├── elo.py
│   │   ├── linear.py
│   │   ├── catboost_model.py
│   │   └── lightgbm_model.py
│   ├── features/
│   │   ├── __init__.py
│   │   ├── baseline.py
│   │   ├── recent_form.py
│   │   ├── efficiency.py
│   │   ├── schedule.py
│   │   ├── travel.py
│   │   ├── availability.py
│   │   ├── lineups.py
│   │   ├── matchup.py
│   │   ├── season_context.py
│   │   └── market.py
│   └── ingest/
│       ├── __init__.py
│       ├── wyatt.py
│       ├── injury_report.py
│       └── odds.py
├── tests/
│   ├── test_nba.py
│   ├── test_research_contracts.py
│   ├── test_research_splits.py
│   ├── test_research_features.py
│   ├── test_research_registry.py
│   └── test_research_models.py
└── data/
    ├── research/
    │   ├── raw/
    │   ├── normalized/
    │   ├── feature_snapshots/
    │   └── experiment_runs/
    └── snapshots/
```

Do not create CatBoost/LightGBM code paths until their dependencies are intentionally added. The initial Phase 1 implementation can use only the existing `pandas`, `numpy`, and `scipy` dependencies.

---

## 4. Core interfaces

### 4.1 Game prediction contract

Define a stable prediction object in `nba/research/contracts.py`.

Required fields:

```python
PredictionRecord(
    prediction_id: str,
    game_id: str,
    model_id: str,
    model_version: str,
    feature_set_id: str,
    generated_at: str,
    decision_cutoff: str,
    event_start: str,
    home_team_id: str,
    away_team_id: str,
    home_win_probability: float | None,
    expected_home_margin: float | None,
    expected_home_points: float | None,
    expected_away_points: float | None,
    expected_total: float | None,
    calibration_id: str | None,
    injury_snapshot_id: str | None,
    lineup_snapshot_id: str | None,
    odds_snapshot_id: str | None,
)
```

Rules:

- `generated_at <= event_start`
- every historical feature row must satisfy `feature_observed_at <= decision_cutoff`
- no future result may enter a prediction
- probability must be within `[0, 1]`
- the exact model and feature versions must be recoverable

### 4.2 Feature-row contract

```python
FeatureRow(
    game_id,
    decision_cutoff,
    feature_set_id,
    home_team_id,
    away_team_id,
    feature_observed_at,
    ...features
)
```

A row must be rejected if any source timestamp exceeds `decision_cutoff`.

### 4.3 Odds observation contract

```text
odds_observation_id
provider
sportsbook
region
game_id
market
selection
line
american_odds
decimal_odds
provider_updated_at
observed_at
event_start
is_live
```

For V1:

- `is_live = false`
- FanDuel and bet365 are preferred display books
- other books may be retained for best-price comparison
- provider update time and local observation time are separate fields

### 4.4 Injury observation contract

```text
injury_observation_id
game_id
team_id
player_id
status
reason
source_report_at
observed_at
previous_status
status_changed
```

Never overwrite prior states.

---

## 5. Normalized research schema

Phase 1 should normalize the historical basketball source into the following tables.

### `games`

Primary key: `game_id`

Important fields:

```text
game_id
season
season_type
game_date
event_start
home_team_id
away_team_id
home_points
away_points
neutral
completed
source
source_observed_at
```

### `team_game_stats`

Primary key:

```text
game_id + team_id
```

Fields should include available pre-feature raw inputs such as:

```text
points
possessions
off_rating
def_rating
net_rating
pace
efg_pct
tov_pct
orb_pct
ft_rate
oreb
dreb
assists
turnovers
fg3a
fg3m
fta
ftm
```

Do not calculate rolling features here. Store raw observed game-level values.

### `player_games`

Primary key:

```text
game_id + player_id + team_id
```

Core fields:

```text
minutes
starter
points
rebounds
assists
three_pm
fga
fta
turnovers
steals
blocks
plus_minus
did_not_play
```

### `lineup_stints`

Where source coverage exists:

```text
game_id
team_id
lineup_id
player_ids
minutes
possessions
off_rating
def_rating
net_rating
```

### `team_identity_map`

```text
canonical_team_id
source
source_team_id
abbreviation
valid_from
valid_to
```

### `player_identity_map`

```text
canonical_player_id
source
source_player_id
display_name
valid_from
valid_to
```

Do not rely on display names as join keys.

---

## 6. Historical source ingestion

Primary historical source:

`https://www.kaggle.com/datasets/wyattowalsh/basketball`

The ingestion code belongs in:

```text
nba/research/ingest/wyatt.py
```

Phase 1 must:

1. read the source without changing raw files;
2. write normalized outputs under `nba/data/research/normalized/`;
3. create a source manifest containing:
   - source name
   - source version/date
   - local import timestamp
   - row counts
   - date coverage
   - SHA256 hashes
4. validate:
   - unique game IDs
   - home != away
   - completed NBA games cannot end tied
   - season/date consistency
   - duplicate player-game rows
   - invalid negative statistics
   - malformed identities
5. preserve modern-era data even if earlier historical seasons are also present.

No model training occurs during ingestion.

---

## 7. Training-window experiments

Do not choose one training window in advance.

Register these experiments:

```text
WIN-2010-EXPANDING
WIN-2014-EXPANDING
WIN-2017-EXPANDING
WIN-ROLLING-5Y
WIN-ROLLING-8Y
WIN-EXPANDING-RECENCY
```

The exact evaluation years should be chosen only after checking source coverage, but the principle is:

- use several development seasons;
- all splits are chronological;
- the same evaluation seasons are used across competing windows;
- no final locked holdout is used to choose the window.

The existing 2025-26 B0 result remains a historical reference, but it is no longer the repeatedly tuned final holdout.

---

## 8. Temporal split policy

Implement split generation in `nba/research/splits.py`.

Recommended development protocol after modern history is available:

```text
Fold 1
Train: through season N-3
Validate: season N-2

Fold 2
Train: through season N-2
Validate: season N-1

Fold 3
Train: through season N-1
Validate: season N
```

For every validation game:

```text
training game date < validation game decision cutoff
```

No random K-fold splitting is allowed for final model-selection evidence.

Hyperparameter selection must happen inside the development period.

A later season or prospective shadow period must remain locked until the research cycle is frozen.

---

## 9. Model registry

Create `nba/research/registry.py`.

Every model receives a permanent ID.

### Existing baseline

```text
B0-RIDGE-MARGIN
```

Adapter:

```text
nba/research/models/b0_adapter.py
```

This calls the frozen B0 code without modifying it.

### New simple challengers

```text
B1-ELO-MARGIN
B2-LOGISTIC-WIN
B3-PROBIT-WIN
```

### Nonlinear challengers, later phase

```text
C1-CATBOOST-WIN
C2-LIGHTGBM-WIN
```

Do not add C1/C2 to production until the simple-model comparison and feature ablations are complete.

---

## 10. Feature-set registry

Every experiment must reference a feature-set ID.

### `FS00_B0`

```text
team identity contrast
home court
capped rest difference
```

### `FS01_RECENT_FORM`

Add:

```text
last_5_win_pct
last_5_avg_margin
last_10_avg_margin
last_20_avg_margin
last_5_net_rating
last_10_net_rating
last_20_net_rating
opponent_adjusted_recent_margin
```

### `FS02_EFFICIENCY`

Add:

```text
off_rating
def_rating
net_rating
pace
```

for multiple prior windows.

### `FS03_FOUR_FACTORS`

Add:

```text
efg_pct
tov_pct
orb_pct
ft_rate
opponent equivalents
home-minus-away matchup interactions
```

### `FS04_SCHEDULE`

Add:

```text
rest_days
rest_difference
back_to_back
games_last_4_days
games_last_7_days
overtime_minutes_recent
```

### `FS05_TRAVEL`

Later, once venue/travel data is validated:

```text
distance_since_previous_game
time_zones_crossed
road_trip_game_number
first_home_game_after_trip
```

### `FS06_AVAILABILITY`

Only after historical timestamped availability exists:

```text
expected_starter_minutes_available
expected_bench_minutes_available
expected_team_value_available
rotation_players_questionable
minutes_lost_since_prior_report
```

### `FS07_LINEUPS`

```text
expected_starting_lineup_quality
starting_lineup_minutes_together
top_8_rotation_continuity
bench_unit_quality
```

### `FS08_MATCHUP`

Later research:

```text
rim_offense_vs_rim_defense
three_point_profile_vs_opponent_defense
turnover_pressure_interaction
rebounding_interaction
player_archetype_matchups
```

### `FS09_SEASON_CONTEXT`

```text
season_progress
games_remaining
seed
games_from_6th
games_from_10th
eliminated
clinched
playoff_leverage
```

### `FS10_MARKET`

Only when historical timestamped market records exist:

```text
opening_no_vig_probability
current_no_vig_probability
line_move
book_disagreement
```

---

## 11. Feature acceptance rule

A feature group must not be promoted because:

- it has high SHAP importance;
- it sounds basketball-relevant;
- it improves training accuracy;
- it improves one season only.

Promotion requires:

1. lower mean validation log loss or Brier across chronological folds;
2. no serious calibration deterioration;
3. stable direction across multiple seasons;
4. no timing leakage;
5. reproducible feature generation;
6. acceptable missingness;
7. measurable incremental value in an ablation test.

Run both:

```text
BASE + GROUP
```

and:

```text
FULL - GROUP
```

before declaring a group useful.

---

## 12. Experiment registry schema

Create append-only:

```text
nba/data/research/experiment_runs/experiment_registry.csv
```

Columns:

```text
experiment_id
created_at
git_commit
dataset_version
training_window_id
feature_set_id
model_id
model_version
hyperparameter_json
calibration_method
train_start
train_end
validation_start
validation_end
games
accuracy
brier
log_loss
margin_mae
margin_rmse
calibration_error
notes
artifact_path
status
```

Valid status values:

```text
planned
running
completed
rejected
promoted
```

Never overwrite completed experiment rows.

---

## 13. Experiment artifact layout

Each run writes:

```text
nba/data/research/experiment_runs/<experiment_id>/
├── config.json
├── predictions.csv
├── metrics.json
├── calibration_bins.csv
├── data_manifest.json
├── feature_manifest.json
└── README.md
```

`config.json` must be sufficient to reproduce the run.

---

## 14. Evaluation metrics

### Probability models

Primary:

```text
log loss
Brier score
calibration error
reliability bins
```

Secondary:

```text
accuracy
ROC-AUC
```

Accuracy must not determine model promotion by itself.

### Margin models

```text
MAE
RMSE
error by predicted-margin bucket
error by season
error by home/away confidence bucket
```

### Later market evaluation

Only after historical odds exist:

```text
model probability
book probability
no-vig probability
edge
expected value
closing-line value
ROI
max drawdown
bet count
results by edge bucket
results by market
results by sportsbook
```

---

## 15. B0 reproducibility gate

Before any new model work, create a Phase 0 test that asserts the frozen B0 artifact matches the stored reference within tight tolerances.

Required assertions:

```text
games == 1230
accuracy == 0.6308943089430894
Brier == 0.22191822378275342
log_loss == 0.6349192770318305
margin_MAE == 12.035974322032025
margin_RMSE == 15.314099553906699
sigma_scale == 0.73724261462587
```

Do not regenerate and overwrite the existing artifact as part of ordinary V1 experiments.

Create a new reference file:

```text
nba/research/baselines/b0_reference.json
```

that points to the existing artifact and includes its hash.

---

## 16. Phase 1 CLI additions

Extend `python -m nba` only after the underlying functions are implemented.

Suggested commands:

```bash
python -m nba research-import --source /path/to/wyatt-data
python -m nba research-validate
python -m nba research-windows
python -m nba research-run --experiment EXP_ID
python -m nba research-report --experiment EXP_ID
```

The existing commands must remain behaviorally unchanged:

```text
sync
connection
rundown-events
compare-odds
build
backtest
forecast
```

---

## 17. Injury archive collector

Begin building this in parallel with historical-model work.

Module:

```text
nba/research/ingest/injury_report.py
```

Responsibilities:

1. discover official NBA injury report publications;
2. save source report metadata;
3. hash every report;
4. skip exact duplicate files;
5. parse team/player/status/reason;
6. forward-fill repeated table fields where required;
7. normalize player/team identity;
8. append observations;
9. compare with previous state;
10. emit status changes.

Storage:

```text
nba/data/research/raw/injuries/
nba/data/research/normalized/injury_observations.parquet
```

For each report preserve both:

```text
source_report_at
observed_at
```

Missing player status must remain unknown, not silently converted to healthy.

Suggested automatic collection cadence:

```text
morning
~3 hours before tip
~1 hour before tip
~30 minutes before tip
whenever a newly published report is detected
```

Also expose a manual refresh action in the web app.

---

## 18. Odds-history collector

Module:

```text
nba/research/ingest/odds.py
```

V1 scope:

```text
pregame only
moneyline
spread
game total
team total where provider supports it
```

Preferred display:

```text
FanDuel
bet365
```

Retain other sportsbooks for best-price comparison.

Append-only record requirements:

```text
observed_at
provider_updated_at
sportsbook
region
market
selection
line
price
event_start
```

Do not treat a provider fetch timestamp as the bookmaker price update time.

The existing `nba/markets.py` no-vig logic can be reused through an adapter, not copied.

---

## 19. Player model implementation order

Do not start player props before team-data and experiment infrastructure is reproducible.

First player markets:

```text
points
rebounds
assists
3PM
```

Then derived/combo markets:

```text
PRA
PR
PA
RA
```

The player pipeline should conceptually estimate:

```text
P(active)
E(minutes | active)
production distribution | minutes, role, opponent
```

Do not use one unconditional mean as a complete player-prop model.

---

## 20. Dashboard contract

The web app should consume serialized prediction records rather than reproduce training logic.

Primary game card:

```text
matchup
start time

model win probability
predicted score
expected margin
spread cover probability
game-total probability

best FanDuel price
best bet365 price
best other price if materially better
no-vig market probability
model-minus-market difference

status:
PASS
WATCH
VALUE
STRONG VALUE

short context:
recent form
availability
rest
lineup uncertainty
data freshness
```

The dashboard status thresholds remain disabled until historical/prospective market evaluation establishes them.

Until then show:

```text
RESEARCH ONLY
```

or a non-betting descriptive status.

No stake-sizing recommendation in V1.

---

## 21. Parlay contract

Automatic outputs eventually include:

```text
Best 2-leg
Best 3-leg
Best 4-leg
Best SGP
```

Rules:

1. never force a requested leg count;
2. never add a weaker line only to reach a target payout;
3. same-game legs require dependence modeling;
4. different games may use independence initially, but the assumption must be explicit;
5. model fair odds and actual sportsbook combined price are separate values;
6. the sportsbook combined quote must correspond to the exact displayed selection set.

---

## 22. Public-dashboard security

The page may be public.

Keep private:

```text
API credentials
provider secrets
raw paid-provider payloads
private account/session data
```

Public prediction artifacts may include:

```text
model version
prediction timestamp
probabilities
prices
book name
feature freshness
research explanation
```

The browser must never receive provider keys.

---

## 23. Phase 0 implementation tasks

### P0.1 Freeze reference metadata

Add:

```text
nba/research/baselines/b0_reference.json
```

Containing:

```json
{
  "model_id": "B0-RIDGE-MARGIN",
  "artifact": "nba/reports/backtest.json",
  "test_season": "2025-26",
  "test_games": 1230,
  "accuracy": 0.6308943089430894,
  "brier": 0.22191822378275342,
  "log_loss": 0.6349192770318305,
  "margin_mae": 12.035974322032025,
  "margin_rmse": 15.314099553906699,
  "sigma_scale": 0.73724261462587
}
```

Add artifact hash at implementation time.

### P0.2 Baseline adapter

Create:

```text
nba/research/models/b0_adapter.py
```

It should expose B0 through the common research model interface without changing `nba/model.py`.

### P0.3 Baseline tests

Create:

```text
nba/tests/test_research_baseline.py
```

Acceptance:

- stored artifact parses;
- reference metrics match;
- B0 adapter forecasts without modifying B0 files;
- same-day/future leakage behavior remains unchanged.

---

## 24. Phase 1 implementation tasks

### P1.1 Wyatt ingestion

Implement:

```text
nba/research/ingest/wyatt.py
```

Deliver:

```text
source_manifest.json
games.parquet
team_game_stats.parquet
player_games.parquet
team_identity_map.parquet
player_identity_map.parquet
```

### P1.2 Research validation

Implement checks for:

- duplicates
- impossible scores
- invalid dates
- season continuity
- missing identities
- malformed stat rows
- conflicting game records

### P1.3 Split engine

Implement:

```text
nba/research/splits.py
```

with explicit time boundaries.

### P1.4 Experiment registry

Implement append-only experiment logging.

### P1.5 Window comparison

Run only simple B0-compatible or linear baselines initially.

Compare:

```text
2010+
2014+
2017+
rolling 5 years
rolling 8 years
expanding recency-weighted
```

Do not use CatBoost/LightGBM yet.

---

## 25. Phase 1 acceptance criteria

Phase 1 is complete only when all are true:

1. B0 is unchanged.
2. Historical source import is deterministic.
3. Imported dataset has hashes and row-count manifests.
4. Every training/validation row has a clear historical cutoff.
5. Same-day and future results fail leakage tests.
6. At least five candidate training windows can be evaluated through one command.
7. Experiment artifacts are append-only and reproducible.
8. Metrics are written in a common schema.
9. No final locked holdout was used to choose the training window.
10. Existing NBA tests still pass.
11. New research tests pass.
12. No API credentials or paid raw payloads are committed.

---

## 26. Required tests to add

### `test_research_contracts.py`

Test:

- timestamps
- probability range
- invalid future source timestamps
- event/prediction ordering
- stable IDs

### `test_research_splits.py`

Test:

- no future game in training
- same-day exclusion
- chronological folds
- rolling-window boundaries
- expanding-window boundaries

### `test_research_registry.py`

Test:

- completed experiment rows cannot be overwritten
- experiment ID uniqueness
- artifact existence
- JSON config serializability

### `test_research_features.py`

Test:

- rolling stats are shifted
- current game never enters its own features
- rolling windows contain only prior games
- missing features remain explicitly missing
- opponent adjustments are based only on prior information

### `test_research_models.py`

Test:

- B0 adapter
- Elo deterministic update
- logistic/probit probability bounds
- fixed seed where stochastic methods are later introduced

---

## 27. Initial experiment sequence

Do not skip directly to gradient boosting.

### Stage A — history-window experiment

```text
EXP-WIN-001  B0-style features / 2010+
EXP-WIN-002  B0-style features / 2014+
EXP-WIN-003  B0-style features / 2017+
EXP-WIN-004  B0-style features / rolling 5 seasons
EXP-WIN-005  B0-style features / rolling 8 seasons
EXP-WIN-006  B0-style features / expanding recency
```

### Stage B — simple model tournament

```text
EXP-MOD-001  B0 ridge
EXP-MOD-002  Elo margin
EXP-MOD-003  logistic
EXP-MOD-004  probit
```

### Stage C — feature groups

```text
EXP-FTR-001  FS00
EXP-FTR-002  FS00 + recent form
EXP-FTR-003  FS00 + efficiency
EXP-FTR-004  FS00 + Four Factors
EXP-FTR-005  FS00 + schedule
EXP-FTR-006  cumulative selected groups
```

### Stage D — nonlinear challengers

Only after Stage C freezes a stable feature set:

```text
EXP-ML-001  CatBoost
EXP-ML-002  LightGBM/XGBoost
```

Use equal tuning budgets.

---

## 28. Promotion policy

A candidate may replace the active production team model only if:

```text
1. better mean chronological log loss;
2. better or comparable Brier;
3. no material calibration degradation;
4. improvement appears in more than one validation season;
5. no leakage;
6. reproducible artifact;
7. feature availability exists in production;
8. complexity is justified by measurable gain.
```

If a complex model ties a simpler model, retain the simpler one.

---

## 29. Next implementation order after Phase 1

Once Phase 1 is accepted:

```text
Phase 2
Efficiency + recent form + Four Factors

Phase 3
Official injury-report archive
Expected availability
Expected minutes
Lineup continuity

Phase 4
Historical/pregame odds archive
FanDuel + bet365 focus
No-vig market comparison

Phase 5
Team scoring / spread / total distributions

Phase 6
Points / rebounds / assists / 3PM

Phase 7
Parlay and SGP dependence

Phase 8
Public web dashboard integration
Prospective shadow evaluation
```

---

## 30. Immediate coding checklist

The first implementation pull request should contain only:

```text
nba/research/__init__.py
nba/research/contracts.py
nba/research/registry.py
nba/research/splits.py
nba/research/artifacts.py
nba/research/models/b0_adapter.py
nba/research/baselines/b0_reference.json
nba/tests/test_research_baseline.py
nba/tests/test_research_contracts.py
nba/tests/test_research_splits.py
```

It should **not** yet contain:

```text
CatBoost
LightGBM
new production probabilities
injury-derived numerical adjustments
sportsbook-value labels
stake sizing
parlay recommendations
```

The first PR is successful when it creates a safe research harness around B0 without changing B0.

---

## 31. Second implementation pull request

Add:

```text
nba/research/ingest/wyatt.py
nba/research/dataset.py
nba/research/features/baseline.py
nba/tests/test_research_ingest.py
nba/tests/test_research_features.py
```

Deliver normalized modern-era historical data and source manifests.

No model promotion occurs in this PR.

---

## 32. Third implementation pull request

Add:

```text
nba/research/models/elo.py
nba/research/models/linear.py
nba/research/metrics.py
nba/research/runner.py
nba/tests/test_research_models.py
```

Run:

```text
training-window comparison
B0 vs Elo vs logistic vs probit
```

Only after those results are recorded do we decide which feature work starts next.

---

# Final implementation rule

**The existing validated B0 team model is the control group. The new system grows around it, and every model, feature, injury adjustment, lineup input, market signal, and parlay mechanism has to earn promotion through timestamp-correct chronological evidence.**
