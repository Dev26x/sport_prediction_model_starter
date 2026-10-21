import unittest

import pandas as pd

from nba.research.splits import (
    apply_season_fold,
    expanding_season_folds,
    rolling_season_folds,
    strict_history,
)


class ResearchSplitTests(unittest.TestCase):
    def test_b0_naive_days_exclude_same_day_and_future(self):
        from nba.model import load_games

        games = load_games()
        cutoff = games.day.iloc[len(games) // 2]
        pd.testing.assert_frame_equal(
            strict_history(games, cutoff), games.loc[games.day < cutoff]
        )

    def test_mixed_dates_and_start_boundary(self):
        frame = pd.DataFrame({"day": [
            "2026-10-19", pd.Timestamp("2026-10-20"),
            "2026-10-21T01:30:00Z", "2026-10-21", "2026-10-22",
        ]})
        self.assertEqual(
            strict_history(frame, "2026-10-21", start="2026-10-20").index.tolist(),
            [1, 2],
        )

    def test_missing_dates_fail_closed_and_empty_input_is_supported(self):
        for value in (None, pd.NaT, "not-a-date"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                strict_history(pd.DataFrame({"day": [value]}), "2026-10-21")
        frame = pd.DataFrame({"day": []})
        self.assertTrue(strict_history(frame, "2026-10-21").empty)

    def test_same_toronto_day_is_excluded(self):
        frame = pd.DataFrame(
            {
                "game_id": ["old", "same", "future"],
                "day": [
                    "2026-10-20T23:00:00Z",
                    "2026-10-21T01:30:00Z",  # Oct 20 Toronto, still historical
                    "2026-10-21T23:00:00Z",  # Oct 21 Toronto, same day as cutoff
                ],
            }
        )
        rows = strict_history(frame, "2026-10-21")
        self.assertEqual(rows.game_id.tolist(), ["old", "same"])

        # A game that occurs earlier on the same Toronto date is still excluded.
        frame = pd.DataFrame(
            {
                "game_id": ["yesterday", "same_day"],
                "day": ["2026-10-20T23:00:00Z", "2026-10-21T15:00:00-04:00"],
            }
        )
        self.assertEqual(strict_history(frame, "2026-10-21").game_id.tolist(), ["yesterday"])

    def test_expanding_folds_use_only_prior_seasons(self):
        folds = expanding_season_folds(range(2015, 2021), min_train_seasons=3)
        self.assertEqual(folds[0].train_seasons, (2015, 2016, 2017))
        self.assertEqual(folds[0].validation_season, 2018)
        self.assertEqual(folds[-1].validation_season, 2020)

    def test_rolling_window_boundaries(self):
        folds = rolling_season_folds(range(2015, 2021), window=3)
        self.assertEqual(folds[-1].train_seasons, (2017, 2018, 2019))
        self.assertEqual(folds[-1].validation_season, 2020)

    def test_fold_application_has_no_season_overlap(self):
        frame = pd.DataFrame(
            {"season": [2017, 2018, 2019, 2020], "value": [1, 2, 3, 4]}
        )
        fold = rolling_season_folds(frame.season, window=2)[-1]
        train, validation = apply_season_fold(frame, fold)
        self.assertEqual(train.season.tolist(), [2018, 2019])
        self.assertEqual(validation.season.tolist(), [2020])
        self.assertLess(train.season.max(), validation.season.min())


if __name__ == "__main__":
    unittest.main()
