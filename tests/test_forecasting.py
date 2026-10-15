import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd

from backtest import probability_columns, run_backtest
from data_utils import match_dates, validate_matches
from evaluation import (
    apply_temperature,
    calculate_metrics,
    fit_temperature,
    market_probabilities,
    paired_log_loss_comparison,
    reliability_bins,
)
from forecast import load_calibrator
from model_v2 import calculate_team_strengths, predict_match


def fixture_data():
    rows = [
        ("2024-08-01", "A", "B", 2, 1),
        ("2024-08-02", "B", "A", 1, 1),
        ("2025-08-01", "Promoted", "A", 0, 2),
        ("2025-08-01", "B", "A", 1, 0),
        ("2025-08-02", "A", "Promoted", 3, 1),
        ("2026-08-01", "Newcomer", "A", 1, 2),
        ("2026-08-01", "B", "Promoted", 0, 0),
        ("2026-08-02", "A", "Newcomer", 2, 0),
    ]
    frame = pd.DataFrame(rows, columns=["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"])
    frame["Date"] = pd.to_datetime(frame.Date)
    frame[["B365CH", "B365CD", "B365CA"]] = [2.0, 3.0, 4.0]
    return frame


class DataTests(unittest.TestCase):
    def test_iso_and_day_first_dates(self):
        result = match_dates(pd.Series(["2026-10-12", "12/10/2026", "01/09/25"]))
        self.assertEqual(result.dt.strftime("%Y-%m-%d").tolist(), ["2026-10-12", "2026-10-12", "2025-09-01"])

    def test_cutoff_and_unplayed_matches(self):
        matches = fixture_data()
        matches.loc[4, "FTHG"] = np.nan
        result = validate_matches(matches, as_of="2025-08-02")
        self.assertEqual(len(result), 4)
        self.assertTrue((result.Date <= pd.Timestamp("2025-08-02")).all())

    def test_bad_goals_dates_and_conflicting_duplicates_fail(self):
        for column, value in (("FTHG", -1), ("FTAG", "bad"), ("FTHG", 1.5), ("Date", "invalid")):
            with self.subTest(column=column, value=value):
                frame = fixture_data().astype({column: object})
                frame.loc[0, column] = value
                with self.assertRaises(ValueError):
                    validate_matches(frame, as_of="2026-10-15")
        original = fixture_data()
        duplicate = original.iloc[[0]].copy()
        duplicate["FTHG"] = 9
        with self.assertRaisesRegex(ValueError, "conflicting scores"):
            validate_matches(pd.concat([original, duplicate]), as_of="2026-10-15")
        duplicate = original.iloc[[0]].copy()
        duplicate["B365CH"] = 2.2
        with self.assertRaisesRegex(ValueError, "conflicting source"):
            validate_matches(pd.concat([original, duplicate]), as_of="2026-10-15")
        self.assertEqual(len(validate_matches(pd.concat([original, original]), as_of="2026-10-15")), len(original))

    def test_preparation_import_has_no_file_writes_or_output(self):
        import importlib
        import prepare_data
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            importlib.reload(prepare_data)
        self.assertEqual(buffer.getvalue(), "")


class ForecastTests(unittest.TestCase):
    def test_same_day_and_future_results_cannot_change_forecast(self):
        frame = fixture_data()
        original = predict_match(frame, "A", "B", "2025-08-01 20:00")
        altered = frame.copy()
        altered.loc[altered.Date >= "2025-08-01", ["FTHG", "FTAG"]] = [99, 88]
        changed = predict_match(altered, "A", "B", "2025-08-01 20:00")
        self.assertEqual(original, changed)
        self.assertEqual(original["home_history_matches"], 2)

    def test_new_team_gets_prior_and_probabilities_are_coherent(self):
        prediction = predict_match(fixture_data(), "Promoted", "A", "2025-08-01")
        self.assertTrue(prediction["home_new_team"])
        self.assertEqual(prediction["home_history_matches"], 0)
        self.assertAlmostEqual(sum(prediction[key] for key in ("home_win", "draw", "away_win")), 1)
        self.assertAlmostEqual(prediction["over_2_5"] + prediction["under_2_5"], 1)
        self.assertAlmostEqual(prediction["btts_yes"] + prediction["btts_no"], 1)

    def test_invalid_configuration_and_empty_history_fail(self):
        for kwargs in ({"half_life": 0}, {"prior_matches": -1}):
            with self.assertRaises(ValueError):
                calculate_team_strengths(fixture_data(), "2025-08-01", **kwargs)
        with self.assertRaises(ValueError):
            predict_match(fixture_data(), "A", "B", "2024-01-01")


class EvaluationTests(unittest.TestCase):
    def test_scoring_rule_values_and_validation(self):
        scores = calculate_metrics(["H", "D", "A"], np.eye(3))
        self.assertEqual(scores, {"matches": 3, "accuracy": 1.0, "brier": 0.0, "log_loss": 0.0})
        uniform = calculate_metrics(["H"], [[1 / 3] * 3])
        self.assertAlmostEqual(uniform["brier"], 2 / 3)
        self.assertAlmostEqual(uniform["log_loss"], np.log(3))
        for probabilities in ([], [[0.2, 0.2, 0.2]], [[np.nan, 0, 1]], [[-1, 1, 1]]):
            with self.assertRaises(ValueError):
                calculate_metrics(["H"], probabilities)

    def test_temperature_fitting_and_small_sample_identity(self):
        probabilities = np.tile([0.8, 0.1, 0.1], (120, 1))
        actual = ["H"] * 60 + ["D"] * 30 + ["A"] * 30
        temperature, status = fit_temperature(actual, probabilities)
        self.assertEqual(status, "fitted")
        self.assertGreater(temperature, 1)
        self.assertLess(calculate_metrics(actual, apply_temperature(probabilities, temperature))["log_loss"],
                        calculate_metrics(actual, probabilities)["log_loss"])
        self.assertEqual(fit_temperature(actual[:10], probabilities[:10]),
                         (1.0, "insufficient_calibration_matches"))
        np.testing.assert_array_equal(apply_temperature(probabilities, 1), probabilities)

    def test_odds_require_complete_valid_triplets(self):
        frame = pd.DataFrame({"B365CH": [2, 2, 1, np.inf], "B365CD": [3, np.nan, 3, 3], "B365CA": [4, 4, 4, 4]})
        probabilities, valid = market_probabilities(frame)
        np.testing.assert_array_equal(valid, [True, False, False, False])
        np.testing.assert_allclose(probabilities[0], np.array([1 / 2, 1 / 3, 1 / 4]) / (1 / 2 + 1 / 3 + 1 / 4))
        self.assertTrue(np.isnan(probabilities[1:]).all())
        self.assertFalse(market_probabilities(frame.drop(columns="B365CA"))[1].any())

    def test_reliability_includes_probability_one(self):
        bins = reliability_bins(["H", "D", "A"], np.eye(3))
        home = [row for row in bins if row["outcome"] == "H"]
        self.assertEqual(sum(row["matches"] for row in home), 3)
        self.assertEqual(home[-1]["matches"], 1)
        self.assertEqual(home[-1]["observed_frequency"], 1)

    def test_bootstrap_pairs_same_dates_and_is_deterministic(self):
        probabilities = np.array([[0.5, 0.3, 0.2]] * 3)
        args = (["H", "D", "A"], probabilities, probabilities, ["2026-08-01", "2026-08-01", "2026-08-02"])
        result = paired_log_loss_comparison(*args)
        self.assertEqual(result["match_dates"], 2)
        self.assertEqual(result["interval_95"], [0, 0])
        self.assertEqual(result, paired_log_loss_comparison(*args))


class BacktestTests(unittest.TestCase):
    def run_small_backtest(self, matches=None):
        return run_backtest(fixture_data() if matches is None else matches, min_history_matches=1, min_calibration_matches=1)

    def test_promoted_teams_are_retained_and_periods_are_separate(self):
        forecasts, summary, bins = self.run_small_backtest()
        self.assertEqual(len(forecasts), 6)
        self.assertEqual(summary["coverage"]["v1_unavailable"], 2)
        self.assertEqual(summary["test"]["evaluated_matches"], 3)
        self.assertEqual(summary["test"]["new_team_fixtures"], 1)
        self.assertEqual(summary["metrics"]["V2"]["matches"], 3)
        self.assertEqual(summary["v1_common_cohort"]["V1"]["matches"], 2)
        self.assertEqual(summary["v1_common_cohort"]["V1"], summary["v1_common_cohort"]["V2"])
        self.assertTrue(forecasts.loc[forecasts.Period == "calibration", probability_columns("Calibrated")].isna().all().all())
        self.assertEqual(summary["calibration"]["matches"], 3)
        self.assertEqual(len(bins), 120)

    def test_holdout_outcomes_do_not_fit_temperature(self):
        original, first, _ = self.run_small_backtest()
        changed = fixture_data()
        changed.loc[changed.Date >= "2026-08-01", ["FTHG", "FTAG"]] = [9, 0]
        altered, second, _ = self.run_small_backtest(changed)
        self.assertEqual(first["calibration"], second["calibration"])
        columns = probability_columns("V2") + probability_columns("Calibrated")
        np.testing.assert_allclose(original.loc[original.Date == "2026-08-01", columns],
                                   altered.loc[altered.Date == "2026-08-01", columns])

    def test_missing_market_does_not_remove_model_fixtures(self):
        matches = fixture_data().drop(columns=["B365CH", "B365CD", "B365CA"])
        _, summary, _ = self.run_small_backtest(matches)
        self.assertEqual(summary["metrics"]["V2"]["matches"], 3)
        self.assertIsNone(summary["metrics"]["Market"])
        self.assertNotIn("V2_minus_Market", summary["paired_log_loss_comparisons"])

    def test_calibration_artifact_rejects_earlier_dates_and_wrong_model(self):
        _, summary, _ = self.run_small_backtest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "calibration.json"
            path.write_text(json.dumps(summary["calibration"]))
            with self.assertRaisesRegex(ValueError, "on or after"):
                load_calibrator(path, "2025-08-01")
            self.assertEqual(load_calibrator(path, "2026-08-01"), summary["calibration"])
            artifact = summary["calibration"].copy()
            artifact["model_config"] = {"half_life_days": 999}
            path.write_text(json.dumps(artifact))
            with self.assertRaisesRegex(ValueError, "does not match"):
                load_calibrator(path, "2026-08-01")


if __name__ == "__main__":
    unittest.main()
