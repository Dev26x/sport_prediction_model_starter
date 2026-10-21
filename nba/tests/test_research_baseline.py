import json
from pathlib import Path
import tempfile
import unittest

import pandas as pd

from nba.config import ModelConfig
from nba.model import fit_team_model
from nba.research.models.b0_adapter import B0Adapter, load_b0_reference, verify_b0_reference


class FrozenBaselineTests(unittest.TestCase):
    def test_current_stored_b0_matches_reference(self):
        result = verify_b0_reference()
        self.assertTrue(result["verified"])
        self.assertEqual(result["model_id"], "B0-RIDGE-MARGIN")

    def test_reference_detects_metric_change(self):
        reference = load_b0_reference()
        source = Path(__file__).resolve().parents[1] / "reports" / "backtest.json"
        artifact = json.loads(source.read_text())
        artifact["metrics"]["team_calibrated"]["log_loss"] += 0.01
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backtest.json"
            path.write_text(json.dumps(artifact))
            with self.assertRaisesRegex(ValueError, "log_loss"):
                verify_b0_reference(artifact_path=path)

    def test_b0_adapter_uses_existing_model_without_roster_adjustment(self):
        rows = []
        for index in range(12):
            day = pd.Timestamp("2025-01-01") + pd.Timedelta(days=index)
            rows.append(
                {
                    "game_id": str(index),
                    "day": day,
                    "date": day.isoformat() + "Z",
                    "season": 2025,
                    "season_type": 2,
                    "home_team_id": "A" if index % 2 == 0 else "B",
                    "away_team_id": "B" if index % 2 == 0 else "A",
                    "home_points": 110 + index % 5,
                    "away_points": 105 + index % 3,
                    "completed": True,
                    "neutral": False,
                }
            )
        games = pd.DataFrame(rows)
        adapter = B0Adapter(config=ModelConfig(min_history_games=3)).fit(games, "2025-01-08")
        prediction = adapter.predict("A", "B", "2025-01-09")
        self.assertEqual(prediction["model_id"], "B0-RIDGE-MARGIN")
        self.assertEqual(prediction["history_games"], 7)
        self.assertGreaterEqual(prediction["home_win_probability"], 0)
        self.assertLessEqual(prediction["home_win_probability"], 1)
        direct = fit_team_model(games, "2025-01-08", ModelConfig(min_history_games=3))
        for neutral in (False, True):
            expected = direct.forecast("A", "B", "2025-01-09", neutral=neutral)
            actual = adapter.predict("A", "B", "2025-01-09", neutral=neutral)
            self.assertEqual(actual["home_win_probability"], expected["home_win"])
            self.assertEqual(actual["expected_home_margin"], expected["expected_home_margin"])
            self.assertEqual(actual["probability_scale"], 1.0)
        altered = games.copy()
        altered.loc[altered.day >= "2025-01-08", ["home_points", "away_points"]] = [200, 50]
        other = B0Adapter(config=ModelConfig(min_history_games=3)).fit(altered, "2025-01-08")
        self.assertEqual(prediction, other.predict("A", "B", "2025-01-09"))

    def test_adapter_rejects_invalid_scale_and_unfitted_prediction(self):
        for scale in (0, -1, float("nan"), float("inf"), -float("inf")):
            with self.subTest(scale=scale), self.assertRaises(ValueError):
                B0Adapter(probability_scale=scale)
        with self.assertRaisesRegex(ValueError, "fit"):
            B0Adapter().predict("A", "B", "2025-01-09")

    def test_old_calibration_scale_is_explicit_not_automatic(self):
        self.assertAlmostEqual(
            B0Adapter.frozen_reference_probability_scale(),
            0.73724261462587,
        )
        self.assertEqual(B0Adapter().probability_scale, 1.0)


if __name__ == "__main__":
    unittest.main()
