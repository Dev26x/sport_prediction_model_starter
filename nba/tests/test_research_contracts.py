import unittest

from nba.research.contracts import FeatureRow, PredictionRecord


class PredictionContractTests(unittest.TestCase):
    def valid(self, **changes):
        row = dict(
            prediction_id="p1",
            game_id="g1",
            model_id="B0-RIDGE-MARGIN",
            model_version="1",
            feature_set_id="FS00_B0",
            generated_at="2026-10-21T22:01:00-04:00",
            decision_cutoff="2026-10-21T22:00:00-04:00",
            event_start="2026-10-21T23:30:00-04:00",
            home_team_id="A",
            away_team_id="B",
            home_win_probability=0.61,
            expected_home_margin=4.2,
        )
        row.update(changes)
        return PredictionRecord(**row)

    def test_valid_prediction_is_serializable(self):
        self.assertEqual(self.valid().to_dict()["home_win_probability"], 0.61)

    def test_prediction_rejects_post_tip_generation(self):
        with self.assertRaisesRegex(ValueError, "before event_start"):
            self.valid(generated_at="2026-10-21T23:31:00-04:00")

    def test_prediction_rejects_future_cutoff(self):
        with self.assertRaisesRegex(ValueError, "decision_cutoff"):
            self.valid(decision_cutoff="2026-10-21T22:05:00-04:00")

    def test_prediction_rejects_bad_probability(self):
        for value in (-0.1, 1.2, float("nan"), float("inf"), -float("inf")):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, r"\[0, 1\]"):
                self.valid(home_win_probability=value)
        for value in (0.0, 1.0):
            self.assertEqual(self.valid(home_win_probability=value).home_win_probability, value)

    def test_naive_timestamps_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "timezone"):
            self.valid(generated_at="2026-10-21T22:01:00")


class FeatureContractTests(unittest.TestCase):
    def test_cutoff_compares_instants_across_offsets(self):
        fields = dict(
            game_id="g1", decision_cutoff="2026-10-21T22:00:00-04:00",
            feature_set_id="FS00", home_team_id="A", away_team_id="B",
        )
        FeatureRow(**fields, feature_observed_at="2026-10-22T02:00:00Z")
        with self.assertRaisesRegex(ValueError, "look-ahead"):
            FeatureRow(**fields, feature_observed_at="2026-10-22T02:00:01Z")

    def test_feature_observation_must_exist_by_cutoff(self):
        row = FeatureRow(
            game_id="g1",
            decision_cutoff="2026-10-21T22:00:00-04:00",
            feature_set_id="FS01_RECENT_FORM",
            home_team_id="A",
            away_team_id="B",
            feature_observed_at="2026-10-21T21:59:00-04:00",
            features={"home_last_5_margin": 4.1, "injury_state": None},
        )
        self.assertEqual(row.features["home_last_5_margin"], 4.1)

        with self.assertRaisesRegex(ValueError, "look-ahead"):
            FeatureRow(
                game_id="g1",
                decision_cutoff="2026-10-21T22:00:00-04:00",
                feature_set_id="FS01_RECENT_FORM",
                home_team_id="A",
                away_team_id="B",
                feature_observed_at="2026-10-21T22:00:01-04:00",
                features={"home_last_5_margin": 4.1},
            )

    def test_nonfinite_feature_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "NaN"):
            FeatureRow(
                game_id="g1",
                decision_cutoff="2026-10-21T22:00:00Z",
                feature_set_id="FS01",
                home_team_id="A",
                away_team_id="B",
                feature_observed_at="2026-10-21T21:00:00Z",
                features={"bad": float("nan")},
            )


if __name__ == "__main__":
    unittest.main()
