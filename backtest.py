"""Evaluate V2 on every eligible fixture with an earlier calibration period."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import model_v1
import model_v2
from data_utils import DATA_PATH, ROOT, load_matches, today
from evaluation import (
    OUTCOMES,
    apply_temperature,
    calculate_metrics,
    fit_temperature,
    market_probabilities,
    paired_log_loss_comparison,
    reliability_bins,
)


MODEL_CONFIG = {
    "half_life_days": model_v2.HALF_LIFE_DAYS,
    "prior_matches": model_v2.PRIOR_MATCHES,
    "max_goals": model_v2.MAX_GOALS,
}
PROBABILITY_KEYS = ("home_win", "draw", "away_win")


def probability_columns(name):
    return [f"{name}_{outcome}" for outcome in OUTCOMES]


def generate_predictions(matches, start, min_history_matches=100):
    """All forecasts on one date share a state containing earlier dates only."""
    if min_history_matches < 1:
        raise ValueError("Minimum history must be positive.")
    selected = matches.loc[matches.Date >= pd.Timestamp(start)].copy()
    market, _ = market_probabilities(selected)
    selected[probability_columns("Market")] = market
    records, skipped = [], []
    for match_date, fixtures in selected.groupby("Date", sort=True):
        history = matches.loc[matches.Date < match_date]
        if len(history) < min_history_matches:
            skipped.extend({
                "Date": match_date.date().isoformat(),
                "HomeTeam": row.HomeTeam,
                "AwayTeam": row.AwayTeam,
                "reason": "insufficient_history",
            } for row in fixtures.itertuples())
            continue
        strengths, league_home, league_away = model_v2.calculate_team_strengths(
            matches, match_date
        )
        historical_outcomes = np.where(
            history.FTHG > history.FTAG, "H",
            np.where(history.FTHG < history.FTAG, "A", "D"),
        )
        counts = pd.Series(historical_outcomes).value_counts()
        baseline = [(counts.get(outcome, 0) + 1) / (len(history) + 3) for outcome in OUTCOMES]
        for _, row in fixtures.iterrows():
            prediction = model_v2.predict_from_strengths(
                strengths, league_home, league_away, row.HomeTeam, row.AwayTeam
            )
            v1_available = row.HomeTeam in strengths and row.AwayTeam in strengths
            # V1 remains a separate calculation so future changes are compared
            # honestly. Missing team history only affects V1's own coverage.
            v1 = model_v1.predict_match(
                matches, row.HomeTeam, row.AwayTeam, match_date
            ) if v1_available else None
            record = {
                "Date": match_date,
                "Season": row.get("Season", ""),
                "HomeTeam": row.HomeTeam,
                "AwayTeam": row.AwayTeam,
                "Actual": "H" if row.FTHG > row.FTAG else "A" if row.FTHG < row.FTAG else "D",
                "History_matches": len(history),
                "Home_new_team": prediction["home_new_team"],
                "Away_new_team": prediction["away_new_team"],
                "V1_available": v1_available,
            }
            for index, (outcome, key) in enumerate(zip(OUTCOMES, PROBABILITY_KEYS)):
                record[f"V1_{outcome}"] = v1[key] if v1 is not None else np.nan
                record[f"V2_{outcome}"] = prediction[key]
                record[f"Baseline_{outcome}"] = baseline[index]
                record[f"Market_{outcome}"] = row[f"Market_{outcome}"]
            records.append(record)
    if not records:
        raise ValueError("No fixtures have enough earlier history to evaluate.")
    return pd.DataFrame(records), skipped


def run_backtest(
    matches,
    calibration_start="2025-08-01",
    test_start="2026-08-01",
    min_history_matches=100,
    min_calibration_matches=100,
):
    calibration_start = pd.Timestamp(calibration_start).normalize()
    test_start = pd.Timestamp(test_start).normalize()
    if pd.isna(calibration_start) or pd.isna(test_start) or calibration_start >= test_start:
        raise ValueError("Calibration start must be a valid date earlier than test start.")
    forecasts, skipped = generate_predictions(matches, calibration_start, min_history_matches)
    calibration = forecasts.loc[forecasts.Date < test_start]
    test_mask = forecasts.Date >= test_start
    if calibration.empty or not test_mask.any():
        raise ValueError("Both calibration and later test periods must contain forecasts.")
    temperature, status = fit_temperature(
        calibration.Actual,
        calibration[probability_columns("V2")],
        min_matches=min_calibration_matches,
    )
    forecasts["Period"] = np.where(test_mask, "test", "calibration")
    # Do not publish in-sample calibrated probabilities as evaluated forecasts.
    for column in probability_columns("Calibrated"):
        forecasts[column] = np.nan
    forecasts.loc[test_mask, probability_columns("Calibrated")] = apply_temperature(
        forecasts.loc[test_mask, probability_columns("V2")], temperature
    )
    test = forecasts.loc[test_mask]
    calibrator = {
        "schema_version": 1,
        "model": "model_v2",
        "model_config": MODEL_CONFIG,
        "method": "temperature_scaling_1x2",
        "temperature": temperature,
        "status": status,
        "matches": len(calibration),
        "calibration_first_date": calibration.Date.min().date().isoformat(),
        "calibration_last_date": calibration.Date.max().date().isoformat(),
        "fitted_before": test_start.date().isoformat(),
    }
    metrics, bins = {}, []
    for name in ("V2", "Calibrated", "Baseline", "Market"):
        available = test[probability_columns(name)].notna().all(axis=1)
        cohort = test.loc[available]
        metrics[name] = calculate_metrics(
            cohort.Actual, cohort[probability_columns(name)]
        ) if len(cohort) else None
        if len(cohort):
            bins.extend({"model": name, **row} for row in reliability_bins(
                cohort.Actual, cohort[probability_columns(name)]
            ))
    comparisons = {}
    for first, second in (("V2", "Baseline"), ("Calibrated", "V2"), ("V2", "Market")):
        columns = probability_columns(first) + probability_columns(second)
        common = test.loc[test[columns].notna().all(axis=1)]
        if len(common):
            comparisons[f"{first}_minus_{second}"] = paired_log_loss_comparison(
                common.Actual, common[probability_columns(first)],
                common[probability_columns(second)], common.Date,
            )
    common_v1 = test.loc[test.V1_available]
    summary = {
        "calibration": calibrator,
        "test": {
            "start": test_start.date().isoformat(),
            "first_match": test.Date.min().date().isoformat(),
            "last_match": test.Date.max().date().isoformat(),
            "eligible_matches": int((matches.Date >= test_start).sum()),
            "evaluated_matches": len(test),
            "new_team_fixtures": int((test.Home_new_team | test.Away_new_team).sum()),
            "market_matches": int(test[probability_columns("Market")].notna().all(axis=1).sum()),
        },
        "metrics": metrics,
        "paired_log_loss_comparisons": comparisons,
        "v1_common_cohort": {
            name: calculate_metrics(common_v1.Actual, common_v1[probability_columns(name)])
            for name in ("V1", "V2")
        } if len(common_v1) else {},
        "coverage": {
            "eligible_matches": int((matches.Date >= calibration_start).sum()),
            "evaluated_matches": len(forecasts),
            "v1_unavailable": int((~forecasts.V1_available).sum()),
            "skipped": skipped,
        },
        "market": {
            "columns": ["B365CH", "B365CD", "B365CA"],
            "normalization": "(1 / decimal_odds) / sum(1 / decimal_odds)",
            "role": "Historical closing-price accuracy benchmark; not a timestamped tradable quote.",
            "source_notes": "https://football-data.co.uk/notes.txt",
        },
    }
    return forecasts, summary, pd.DataFrame(bins)


def render_report(summary):
    test = summary["test"]
    calibration = summary["calibration"]
    lines = [
        "# Premier League forecasting evaluation", "",
        f"Data: {summary['data']['matches']} completed matches, "
        f"{summary['data']['first_match']} through {summary['data']['last_match']}; "
        f"snapshot as of {summary['data']['as_of']}.", "",
        f"Calibration: {calibration['matches']} walk-forward V2 forecasts from "
        f"{calibration['calibration_first_date']} through {calibration['calibration_last_date']}. "
        f"Temperature {calibration['temperature']:.4f} ({calibration['status']}); fixed before "
        f"{calibration['fitted_before']}.", "",
        f"Later test period: {test['evaluated_matches']} / {test['eligible_matches']} fixtures, "
        f"{test['first_match']} through {test['last_match']}, including "
        f"{test['new_team_fixtures']} fixtures using a neutral prior for an unseen team.", "",
        "| Forecast | Matches | Accuracy | Brier | Log loss |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for name, metrics in summary["metrics"].items():
        if metrics:
            lines.append(f"| {name} | {metrics['matches']} | {metrics['accuracy']:.2%} | "
                         f"{metrics['brier']:.4f} | {metrics['log_loss']:.4f} |")
    lines.extend([
        "", "Lower Brier and log loss are better. Brier sums the three squared outcome "
        "errors (range 0–2). Market rows can have less coverage; paired comparisons below "
        "always use the same fixtures for both forecasts.", "",
        "| Paired log loss difference | Matches | Match dates | Mean | 95% interval |",
        "| --- | ---: | ---: | ---: | --- |",
    ])
    for name, comparison in summary["paired_log_loss_comparisons"].items():
        interval = comparison["interval_95"]
        label = f"[{interval[0]:.4f}, {interval[1]:.4f}]" if interval else "Insufficient dates"
        lines.append(f"| {name.replace('_', ' ')} | {comparison['matches']} | "
                     f"{comparison['match_dates']} | {comparison['mean_log_loss_difference']:.4f} | {label} |")
    lines.extend([
        "", "Negative differences favor the first forecast. Intervals use 2,000 paired "
        "bootstrap samples of whole match dates (seed 42); cross-date dependence and "
        "season-to-season variation are not fully captured.", "",
        "The underlying team strengths update using strictly earlier match dates. "
        "Calibration uses only the earlier period and stays fixed throughout the test. "
        "No test outcomes select the temperature or change model parameters. This is a "
        "retrospective evaluation on existing data, not an untouched prospective trial.", "",
        f"V1 cannot forecast {summary['coverage']['v1_unavailable']} fixtures across the "
        "calibration and test periods because a team has no earlier EPL history. "
        "Those fixtures remain in V2's evaluation. The separate V1 comparison in "
        "backtest_summary.json uses only common fixtures.", "",
        "Market probabilities use proportional margin removal from Bet365 closing odds "
        "B365CH/B365CD/B365CA, as defined in the "
        "[provider notes](https://football-data.co.uk/notes.txt). Closing quotes may postdate "
        "the model forecast. This benchmark does not establish an executable betting edge.", "",
        "The supplied files have not been independently authenticated. Neutral priors for "
        "promoted teams remain unvalidated. xG is available only in the 60 current-season "
        "rows, so it is excluded from this cross-season comparison. Over/under and BTTS "
        "forecasts are not evaluated or calibrated in this report.", "",
        "Raw V2 remains the default forecast; calibrated 1X2 probabilities require explicitly "
        "loading the calibration artifact. A small retrospective sample does not establish "
        "calibration quality, stable profitability, or a betting recommendation.", "",
    ])
    return "\n".join(lines)


def main(argv=None, default_output=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA_PATH)
    parser.add_argument("--calibration-start", default="2025-08-01")
    parser.add_argument("--test-start", default="2026-08-01")
    parser.add_argument("--as-of", default=today().date().isoformat())
    parser.add_argument("--min-history", type=int, default=100)
    parser.add_argument("--min-calibration", type=int, default=100)
    parser.add_argument("--output", type=Path, default=default_output or ROOT / "data/backtest_results.csv")
    parser.add_argument("--report-dir", type=Path, default=ROOT / "reports")
    args = parser.parse_args(argv)
    try:
        matches = load_matches(args.data, as_of=args.as_of)
        forecasts, summary, bins = run_backtest(
            matches, args.calibration_start, args.test_start, args.min_history, args.min_calibration
        )
    except (ValueError, OSError) as error:
        parser.error(str(error))
    summary["data"] = {
        "path": str(args.data.resolve()),
        "sha256": hashlib.sha256(args.data.read_bytes()).hexdigest(),
        "as_of": pd.Timestamp(args.as_of).date().isoformat(),
        "matches": len(matches),
        "first_match": matches.Date.min().date().isoformat(),
        "last_match": matches.Date.max().date().isoformat(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    forecasts.to_csv(args.output, index=False)
    bins.to_csv(args.report_dir / "calibration_bins.csv", index=False)
    (args.report_dir / "backtest_summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    (args.report_dir / "calibration.json").write_text(json.dumps(summary["calibration"], indent=2, allow_nan=False) + "\n")
    report = render_report(summary)
    (args.report_dir / "backtest_report.md").write_text(report)
    print(report)
    print(f"Forecast rows: {args.output}\nReports: {args.report_dir}")


if __name__ == "__main__":
    main()
