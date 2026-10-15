"""Forecast a named fixture using completed matches before its date."""

import argparse
import difflib
import json
from pathlib import Path

import numpy as np
import pandas as pd

import model_v2
from backtest import MODEL_CONFIG, PROBABILITY_KEYS
from data_utils import DATA_PATH, load_matches, today
from evaluation import OUTCOMES, apply_temperature


def load_calibrator(path, prediction_date):
    artifact = json.loads(Path(path).read_text())
    if (artifact.get("schema_version") != 1 or artifact.get("model") != "model_v2"
            or artifact.get("model_config") != MODEL_CONFIG
            or artifact.get("method") != "temperature_scaling_1x2"):
        raise ValueError("Calibration artifact does not match the current V2 model.")
    cutoff = pd.Timestamp(artifact["fitted_before"]).normalize()
    last_date = pd.Timestamp(artifact["calibration_last_date"]).normalize()
    if pd.isna(cutoff) or pd.isna(last_date) or last_date >= cutoff:
        raise ValueError("Calibration artifact has invalid date boundaries.")
    if pd.Timestamp(prediction_date).normalize() < cutoff:
        raise ValueError(f"This calibration can only forecast dates on or after {cutoff.date()}.")
    temperature = artifact["temperature"]
    if not np.isfinite(temperature) or temperature <= 0:
        raise ValueError("Calibration temperature must be finite and positive.")
    return artifact


def forecast(matches, home, away, prediction_date, allow_new_team=False, calibrator=None):
    prediction_date = pd.Timestamp(prediction_date).normalize()
    known_teams = set(matches.HomeTeam) | set(matches.AwayTeam)
    for team in (home, away):
        if team not in known_teams and not allow_new_team:
            candidates = difflib.get_close_matches(team, sorted(known_teams), n=3)
            suggestion = f" Similar names: {', '.join(candidates)}." if candidates else ""
            raise ValueError(f"Unknown team '{team}'.{suggestion} Use --allow-new-team for an intentional new team.")
    history = matches.loc[matches.Date < prediction_date]
    if len(history) < 100:
        raise ValueError("Need at least 100 completed matches before the fixture date.")
    prediction = model_v2.predict_match(matches, home, away, prediction_date)
    output = {
        "fixture": {"home": home, "away": away, "date": prediction_date.date().isoformat()},
        "model": "model_v2",
        "history": {
            "matches": len(history),
            "latest_result": history.Date.max().date().isoformat(),
            "home_matches": prediction["home_history_matches"],
            "away_matches": prediction["away_history_matches"],
            "home_neutral_prior": prediction["home_new_team"],
            "away_neutral_prior": prediction["away_new_team"],
        },
        "expected_goals": {
            "home": float(prediction["expected_home_goals"]),
            "away": float(prediction["expected_away_goals"]),
        },
        "raw_probabilities": {key: float(prediction[key]) for key in (
            "home_win", "draw", "away_win", "over_2_5", "under_2_5", "btts_yes", "btts_no"
        )},
    }
    if calibrator is not None:
        calibrated = apply_temperature(
            [[prediction[key] for key in PROBABILITY_KEYS]], calibrator["temperature"]
        )[0]
        output["calibrated_1x2"] = dict(zip(OUTCOMES, calibrated.tolist()))
        output["calibration_fitted_before"] = calibrator["fitted_before"]
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("home", help="Quote team names containing spaces.")
    parser.add_argument("away")
    parser.add_argument("--date", required=True, help="Fixture date, YYYY-MM-DD.")
    parser.add_argument("--as-of", default=today().date().isoformat(), help="Latest available result date.")
    parser.add_argument("--data", type=Path, default=DATA_PATH)
    parser.add_argument("--calibration", type=Path, help="Optional earlier fitted 1X2 calibration artifact.")
    parser.add_argument("--allow-new-team", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        matches = load_matches(args.data, as_of=args.as_of)
        calibrator = load_calibrator(args.calibration, args.date) if args.calibration else None
        if calibrator and pd.Timestamp(calibrator["calibration_last_date"]) > pd.Timestamp(args.as_of):
            raise ValueError("Calibration uses results later than the requested as-of date.")
        output = forecast(matches, args.home, args.away, args.date, args.allow_new_team, calibrator)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.error(str(error))
    output["as_of"] = pd.Timestamp(args.as_of).date().isoformat()
    if args.json:
        print(json.dumps(output, indent=2, allow_nan=False))
        return
    print(f"{args.home} vs {args.away} | {output['fixture']['date']}")
    print(f"Results available as of {output['as_of']}; last training result {output['history']['latest_result']}")
    print(f"Expected goals: {output['expected_goals']['home']:.2f} - {output['expected_goals']['away']:.2f}")
    print("\nRaw V2 probabilities")
    for label, value in output["raw_probabilities"].items():
        fair_odds = 1 / value if value else float("inf")
        print(f"{label:15} {value:7.2%} | fair decimal odds {fair_odds:.2f}")
    if "calibrated_1x2" in output:
        print(f"\nCalibrated 1X2 (fitted before {output['calibration_fitted_before']})")
        for label, value in output["calibrated_1x2"].items():
            print(f"{label:15} {value:7.2%} | fair decimal odds {1 / value:.2f}")
    print(f"\nTeam history: {output['history']['home_matches']} home-team matches, "
          f"{output['history']['away_matches']} away-team matches (all venues).")
    if output["history"]["home_neutral_prior"] or output["history"]["away_neutral_prior"]:
        print("An unseen team uses an unvalidated neutral league prior.")


if __name__ == "__main__":
    main()
