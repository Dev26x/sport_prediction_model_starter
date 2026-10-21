# PR1 — NBA Research Harness

This patch implements Phase 0 / PR1 from the NBA V1 implementation specification.

## Adds

- timestamp-aware prediction and feature contracts;
- append-only experiment registry;
- chronological expanding/rolling season split helpers;
- immutable artifact helpers;
- a frozen B0 reference;
- a research adapter around the existing B0 ridge-margin model;
- unit tests for baseline integrity, contracts, splits, and registry behavior.

## Deliberately does not change

- `nba/model.py`
- `nba/backtest.py`
- `nba/config.py`
- existing `nba/reports/*`
- current CLI behavior
- current web application
- current production probabilities

It adds no new dependency.

## Apply

The research package, tests, and `docs/NBA_V1_IMPLEMENTATION_SPEC.md` are included.
The implementation specification is a roadmap; this PR delivers only PR1 infrastructure.

Then run:

```bash
.venv/bin/python -m unittest discover -s nba/tests -v
```

The first gate is that the current B0 stored artifact still verifies exactly. The next PR should implement Wyatt/Kaggle historical-data normalization, not model replacement.

## Frozen B0

- model: `B0-RIDGE-MARGIN`
- final historical test: 2025-26
- games: 1,230
- accuracy: 63.09%
- Brier: 0.22191822378275342
- log loss: 0.6349192770318305
- margin MAE: 12.035974322032025
- margin RMSE: 15.314099553906699
- historical sigma scale: 0.73724261462587

The old calibration scale is reference metadata only. `B0Adapter` defaults to raw probability scale `1.0` so a future research fold cannot silently reuse a calibration parameter fitted on another period.

## Review corrections and validation

See [QA_REPORT.md](QA_REPORT.md) for the full 55-test result, environment, fixes
to the supplied package, and limitations. All 24 pre-existing NBA tests pass.
Corrections address naive Toronto-date leakage, concurrent artifact/registry
writes, experiment-directory traversal, and nonfinite probability scales.
No existing repository files or production probabilities changed.
