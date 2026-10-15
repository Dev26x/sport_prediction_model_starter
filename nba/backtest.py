"""Temporal evaluation of the team-only model; roster effects stay separate."""

import hashlib
import json

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.special import ndtr

from .config import DATA, REPORTS, ModelConfig, season_label
from .model import design_matrix, fit_team_model, load_games


def metrics(actual, probabilities, margins=None, actual_margins=None):
    actual = np.asarray(actual, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    if not len(actual) or actual.shape != probabilities.shape or not np.isin(actual, [0, 1]).all():
        raise ValueError("Binary outcomes and probabilities must be equal nonempty vectors.")
    if not np.isfinite(probabilities).all() or not ((probabilities >= 0) & (probabilities <= 1)).all():
        raise ValueError("Win probabilities must be finite and within [0, 1].")
    safe = np.clip(probabilities, 1e-12, 1 - 1e-12)
    result = {"games": len(actual), "accuracy": float(np.mean((probabilities >= 0.5) == actual)),
              "brier": float(np.mean((probabilities - actual) ** 2)),
              "log_loss": float(np.mean(-actual * np.log(safe) - (1 - actual) * np.log1p(-safe)))}
    if margins is not None:
        errors = np.asarray(margins) - np.asarray(actual_margins)
        result.update({"margin_mae": float(np.abs(errors).mean()), "margin_rmse": float(np.sqrt(np.mean(errors ** 2)))})
    return result


def fit_probability_scale(actual, margin, sigma):
    def objective(scale):
        return metrics(actual, ndtr(np.asarray(margin) / (np.asarray(sigma) * scale)))["log_loss"]
    fit = minimize_scalar(objective, method="bounded", bounds=(0.65, 1.75))
    if not fit.success:
        raise ValueError("Probability calibration failed.")
    return float(fit.x) if fit.fun < objective(1.0) else 1.0


def paired_interval(frame, first="calibrated_home_win", second="baseline_home_win"):
    y = frame.actual_home_win.to_numpy()
    def losses(column):
        p = np.clip(frame[column].to_numpy(), 1e-12, 1 - 1e-12)
        return -y * np.log(p) - (1 - y) * np.log1p(-p)
    differences = pd.DataFrame({"day": frame.day, "difference": losses(first) - losses(second)})
    grouped = differences.groupby("day").difference.agg(["sum", "size"])
    rng = np.random.default_rng(42)
    indices = rng.integers(0, len(grouped), size=(2000, len(grouped)))
    sums, counts = grouped["sum"].to_numpy(), grouped["size"].to_numpy()
    values = sums[indices].sum(axis=1) / counts[indices].sum(axis=1)
    return {"first": first, "second": second, "games": len(frame), "match_dates": len(grouped),
            "mean_log_loss_difference": float(differences.difference.mean()),
            "interval_95": np.quantile(values, [0.025, 0.975]).tolist()}


def run_backtest(games=None, config=None, write=True):
    config = config or ModelConfig()
    games = load_games() if games is None else games.sort_values(["day", "game_id"]).reset_index(drop=True)
    years = sorted(games.season.unique())
    if len(years) != 4:
        raise ValueError("NBA evaluation requires exactly four historical regular seasons.")
    team_ids = sorted(set(games.home_team_id) | set(games.away_team_id))
    precomputed = design_matrix(games, team_ids), team_ids
    predictions = []
    for day, fixtures in games.loc[games.season > years[0]].groupby("day", sort=True):
        model = fit_team_model(games, day, config, precomputed)
        history = games.loc[games.day < day]
        baseline = (int((history.home_points > history.away_points).sum()) + 1) / (len(history) + 2)
        for game in fixtures.itertuples():
            prediction = model.forecast(game.home_team_id, game.away_team_id, day, neutral=game.neutral)
            predictions.append({"game_id": game.game_id, "day": day, "season": game.season,
                                "home_team_id": game.home_team_id, "away_team_id": game.away_team_id,
                                "actual_home_win": int(game.home_points > game.away_points),
                                "actual_margin": float(game.home_points - game.away_points),
                                "predicted_margin": prediction["expected_home_margin"],
                                "margin_sd": prediction["margin_sd"], "raw_home_win": prediction["home_win"],
                                "baseline_home_win": baseline, "history_games": model.history_games,
                                "last_training_result": model.last_result.date().isoformat()})
    frame = pd.DataFrame(predictions)
    calibration = frame.loc[frame.season == years[-2]]
    test = frame.loc[frame.season == years[-1]].copy()
    if len(calibration) < 500 or len(test) < 500:
        raise ValueError("Need substantial separate calibration and test seasons.")
    scale = fit_probability_scale(calibration.actual_home_win, calibration.predicted_margin, calibration.margin_sd)
    frame["period"] = np.select([frame.season == years[-2], frame.season == years[-1]], ["calibration", "test"], default="development")
    frame["calibrated_home_win"] = np.nan
    frame.loc[frame.period.eq("test"), "calibrated_home_win"] = ndtr(test.predicted_margin.to_numpy() / (test.margin_sd.to_numpy() * scale))
    test = frame.loc[frame.period.eq("test")]
    output = {
        "scope": "team-only walk-forward forecasts; current-roster adjustments are not validated by this backtest",
        "model_config": config.to_dict(), "seasons": {"initial_history": season_label(years[0]),
        "development": season_label(years[1]), "calibration": season_label(years[2]), "test": season_label(years[3])},
        "calibration": {"schema_version": 1, "scope": "team_margin_probability_scale", "sigma_scale": scale,
                        "model_config": config.to_dict(), "calibration_games": len(calibration),
                        "calibration_last_result": calibration.day.max().date().isoformat(),
                        "fitted_before": pd.Timestamp(year=int(years[-1] - 1), month=10, day=1).date().isoformat()},
        "test_games": len(test),
        "metrics": {name: metrics(test.actual_home_win, test[column], test.predicted_margin if name != "baseline" else None,
                                   test.actual_margin if name != "baseline" else None)
                    for name, column in [("team_raw", "raw_home_win"), ("team_calibrated", "calibrated_home_win"), ("baseline", "baseline_home_win")]},
        "calibrated_minus_baseline": paired_interval(test),
        "calibrated_minus_raw": paired_interval(test, "calibrated_home_win", "raw_home_win"),
        "opening_14_days": {},
        "reliability_bins": [],
        "notes": ["Current roster snapshots and whole-season player totals are never fed into earlier game predictions.",
                  "Team parameters are fixed; sigma scale is fitted only on the earlier calibration season.",
                  "Date bootstrap intervals do not fully capture serial or team dependence.",
                  "No bookmaker or TheRundown data is used in this historical validation."],
    }
    early = test.loc[test.day < test.day.min() + pd.Timedelta(days=14)]
    output["opening_14_days"] = {name: metrics(early.actual_home_win, early[column]) for name, column in
                                 [("team_calibrated", "calibrated_home_win"), ("baseline", "baseline_home_win")]}
    for name, column in [("team_raw", "raw_home_win"), ("team_calibrated", "calibrated_home_win")]:
        probabilities = test[column].to_numpy()
        assignment = np.minimum((probabilities * 10).astype(int), 9)
        for index in range(10):
            mask = assignment == index
            output["reliability_bins"].append({"model": name, "bin_lower": index / 10, "bin_upper": (index + 1) / 10,
                                               "games": int(mask.sum()), "mean_probability": float(probabilities[mask].mean()) if mask.any() else None,
                                               "observed_home_win": float(test.actual_home_win.to_numpy()[mask].mean()) if mask.any() else None})
    if write:
        REPORTS.mkdir(parents=True, exist_ok=True)
        output["data_sha256"] = hashlib.sha256((DATA / "games.csv").read_bytes()).hexdigest()
        frame.to_csv(REPORTS / "backtest_predictions.csv", index=False)
        (REPORTS / "backtest.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
        (REPORTS / "calibration.json").write_text(json.dumps(output["calibration"], indent=2) + "\n")
    return output
