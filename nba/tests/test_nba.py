from dataclasses import replace
import gzip
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import numpy as np
import pandas as pd

from nba.backtest import fit_probability_scale, metrics
from nba.config import ModelConfig
from nba.http_client import DataAccessError, JsonClient
from nba.ingest import parse_boxscore, parse_event
from nba.markets import american_to_decimal, normalize_moneylines
from nba.model import design_matrix, fit_team_model, load_games, rest_days
from nba.players import FEATURES, allocate_minutes, project_players, rotation_weights
from nba.reporting import calibration_scale, load_rosters, upcoming_forecasts
from nba.rundown import api_key


def sample_games():
    rows = []
    for index in range(12):
        day = pd.Timestamp("2025-01-01") + pd.Timedelta(days=index)
        rows.append({"game_id": str(index), "day": day, "date": day.isoformat() + "Z", "season": 2025,
                     "season_type": 2, "home_team_id": "A" if index % 2 == 0 else "B",
                     "away_team_id": "B" if index % 2 == 0 else "A", "home_points": 110 + index % 5,
                     "away_points": 105 + index % 3, "completed": True, "neutral": False})
    return pd.DataFrame(rows)


def box_fixture(anonymous_gap=0, missing_minutes=False):
    keys = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
            "freeThrowsMade-freeThrowsAttempted", "offensiveRebounds", "defensiveRebounds", "assists", "steals", "blocks", "turnovers", "plusMinus"]
    teams = []
    for team, points in (("A", 10 - anonymous_gap), ("B", 8)):
        athlete = {"athlete": {"id": team + "1", "displayName": "Player " + team}, "didNotPlay": False,
                   "stats": ["48", str(points), "3-5", "0-1", "2-2", "1", "2", "3", "1", "0", "1", "2"]}
        entries = [athlete]
        if anonymous_gap and team == "A":
            entries.append({"athlete": {}, "didNotPlay": False, "stats": ["--", "0", "0-0", "0-0", "0-0", "0", "0", "0", "0", "0", "0", "0"]})
        if missing_minutes:
            athlete["stats"][0] = "--"
        teams.append({"team": {"id": team}, "statistics": [{"keys": keys, "totals": ["", "10" if team == "A" else "8"], "athletes": entries}]})
    return SimpleNamespace(game_id="G", home_team_id="A", away_team_id="B", home_points=10, away_points=8,
                           date="2025-01-01T23:00Z", season=2025), {"header": {"id": "G"}, "boxscore": {"players": teams}}


class TeamModelTests(unittest.TestCase):
    def setUp(self):
        self.games = sample_games()
        self.config = replace(ModelConfig(), min_history_games=3)

    def test_future_and_same_day_scores_cannot_change_prediction(self):
        cutoff = "2025-01-08"
        model = fit_team_model(self.games, cutoff, self.config)
        altered = self.games.copy()
        altered.loc[altered.day >= cutoff, ["home_points", "away_points"]] = [200, 50]
        other = fit_team_model(altered, cutoff, self.config)
        np.testing.assert_array_equal(model.coefficients, other.coefficients)
        self.assertEqual(model.forecast("A", "B", cutoff), other.forecast("A", "B", cutoff))
        self.assertEqual(model.history_games, 7)

    def test_precomputed_design_agrees_without_lookahead(self):
        teams = ["A", "B"]
        direct = fit_team_model(self.games, "2025-01-08", self.config)
        cached = fit_team_model(self.games, "2025-01-08", self.config, (design_matrix(self.games, teams), teams))
        np.testing.assert_allclose(direct.coefficients, cached.coefficients)

    def test_win_probabilities_and_neutral_court(self):
        model = fit_team_model(self.games, "2025-01-10", self.config)
        home = model.forecast("A", "B", "2025-01-11")
        neutral = model.forecast("A", "B", "2025-01-11", neutral=True)
        self.assertAlmostEqual(home["home_win"] + home["away_win"], 1)
        self.assertAlmostEqual(home["expected_home_margin"] - neutral["expected_home_margin"], home["home_court_points"])
        with self.assertRaises(ValueError):
            model.forecast("A", "B", "2025-01-09")

    def test_roster_delta_is_applied_once(self):
        model = fit_team_model(self.games, "2025-01-10", self.config)
        raw = model.forecast("A", "B", "2025-01-11")
        changed = model.forecast("A", "B", "2025-01-11", {"A": 2, "B": -1})
        self.assertAlmostEqual(changed["expected_home_margin"] - raw["expected_home_margin"], 3)
        self.assertGreater(changed["home_win"], raw["home_win"])
        self.assertEqual(changed["team_only_home_win"], raw["home_win"])

    def test_win_calibration_does_not_relabel_margin_variance(self):
        model = fit_team_model(self.games, "2025-01-10", self.config)
        raw = model.forecast("A", "B", "2025-01-11")
        calibrated = model.forecast("A", "B", "2025-01-11", sigma_scale=0.8)
        self.assertEqual(raw["margin_sd"], calibrated["margin_sd"])
        self.assertNotEqual(raw["home_win"], calibrated["home_win"])

    def test_rest_is_capped_and_design_accepts_nonconsecutive_index(self):
        self.assertEqual(rest_days(None, pd.Timestamp("2025-01-01")), 3)
        self.assertEqual(rest_days(pd.Timestamp("2025-01-01"), pd.Timestamp("2025-01-02")), 0)
        self.assertEqual(rest_days(pd.Timestamp("2025-01-01"), pd.Timestamp("2025-10-01")), 3)
        games = self.games.copy()
        games.index = np.arange(len(games)) + 100
        np.testing.assert_array_equal(design_matrix(games, ["A", "B"]), design_matrix(self.games, ["A", "B"]))

    def test_local_game_date_and_invalid_final_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.csv"
            frame = self.games.drop(columns="day").iloc[:1].copy()
            frame["date"] = "2025-01-02T01:30:00Z"
            frame.to_csv(path, index=False)
            self.assertEqual(load_games(path).iloc[0].day, pd.Timestamp("2025-01-01"))
            frame["away_points"] = frame.home_points
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "tied"):
                load_games(path)


class PlayerTests(unittest.TestCase):
    def test_rookie_starter_gets_a_role_prior_and_out_players_get_zero(self):
        current = pd.DataFrame({"latest_mpg": [8.0, 12.0, 36.0], "has_history": [False, True, True],
                                "depth_rank": [1, 3, 1], "availability": [1.0, 1.0, 0.0]})
        weights = rotation_weights(current)
        self.assertGreater(weights.iloc[0], weights.iloc[1])
        self.assertEqual(weights.iloc[2], 0)

    def test_rotations_total_240_and_respect_unavailability(self):
        result = allocate_minutes([100, 20, 20, 15, 10, 10, 10, 10, 0])
        self.assertAlmostEqual(result.sum(), 240)
        self.assertLessEqual(result.max(), 40)
        self.assertEqual(result[-1], 0)
        with self.assertRaises(ValueError):
            allocate_minutes([1, 1, 1, 1, 1])

    def test_player_future_season_is_excluded_and_prior_shrinks(self):
        rows = [{"player_id": "P", "player_name": "Player", "team_id": "A", "season": 2026, "games": 10,
                 "minutes": 100.0, **{feature: 10.0 for feature in FEATURES}},
                {"player_id": "Q", "player_name": "Other", "team_id": "B", "season": 2026, "games": 80,
                 "minutes": 2000.0, **{feature: 100.0 for feature in FEATURES}}]
        history = pd.DataFrame(rows)
        original, league = project_players(history, 2027)
        future = pd.DataFrame([{**rows[0], "season": 2027, "points": 99999}])
        changed, _ = project_players(pd.concat([history, future]), 2027)
        pd.testing.assert_frame_equal(original, changed)
        shrunk = original.loc[original.player_id == "P"].iloc[0].points
        self.assertGreater(shrunk, league.points)
        self.assertLess(shrunk, 10 / 100 * 36)

    def test_current_rosters_cannot_be_used_before_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pd.DataFrame([{"snapshot_at": "2026-10-15T05:00Z", "season": 2027, "player_id": "P", "team_id": "A"}]).to_csv(root / "rosters.csv", index=False)
            with patch("nba.reporting.DATA", root):
                with self.assertRaisesRegex(ValueError, "after"):
                    load_rosters("2026-10-14", 2027)


class IngestionTests(unittest.TestCase):
    def test_game_box_ids_scores_and_source_gaps(self):
        game, box = box_fixture()
        rows = parse_boxscore(game, box)
        self.assertEqual(sum(row["points"] for row in rows if row["team_id"] == "A"), 10)
        game, box = box_fixture(anonymous_gap=2)
        rows = parse_boxscore(game, box)
        home = [row for row in rows if row["team_id"] == "A"]
        self.assertEqual(home[0]["points"], 8)
        self.assertEqual(home[0]["unassigned_team_points"], 2)
        box["header"]["id"] = "wrong"
        with self.assertRaisesRegex(ValueError, "event ID"):
            parse_boxscore(game, box)

    def test_missing_minutes_with_nonzero_production_fails(self):
        game, box = box_fixture(missing_minutes=True)
        with self.assertRaisesRegex(ValueError, "Missing minutes"):
            parse_boxscore(game, box)

    def test_unexplained_scoring_difference_is_rejected(self):
        game, box = box_fixture()
        box["boxscore"]["players"][0]["statistics"][0]["athletes"][0]["stats"][1] = "5"
        with self.assertRaisesRegex(ValueError, "disagree"):
            parse_boxscore(game, box)

    def test_cup_final_is_identified_and_wrong_season_rejected(self):
        event = {"id": "G", "date": "2025-12-17T01:30Z", "season": {"year": 2026}, "seasonType": {"type": 2},
                 "competitions": [{"type": {"abbreviation": "CC"}, "status": {"type": {"completed": True}},
                                   "competitors": [{"id": "A", "homeAway": "home", "team": {"abbreviation": "AAA"}, "score": {"value": 100}},
                                                   {"id": "B", "homeAway": "away", "team": {"abbreviation": "BBB"}, "score": {"value": 90}}]}]}
        self.assertTrue(parse_event(event, 2026, 2)["cup_final"])
        with self.assertRaises(ValueError):
            parse_event(event, 2025, 2)


class CalibrationTests(unittest.TestCase):
    def test_binary_scoring_and_scale(self):
        self.assertEqual(metrics([0, 1], [0, 1])["brier"], 0)
        self.assertAlmostEqual(metrics([0, 1], [0.5, 0.5])["log_loss"], np.log(2))
        actual = np.array([1] * 60 + [0] * 40)
        scale = fit_probability_scale(actual, np.ones(100) * 15, np.ones(100) * 10)
        self.assertGreater(scale, 1)

    def test_scale_artifact_rejects_future_information(self):
        config = ModelConfig()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = {"scope": "team_margin_probability_scale", "model_config": config.to_dict(),
                        "sigma_scale": 0.9, "fitted_before": "2025-10-01", "calibration_last_result": "2025-04-13"}
            (root / "calibration.json").write_text(json.dumps(artifact))
            with patch("nba.reporting.REPORTS", root):
                self.assertEqual(calibration_scale("2024-01-01", "2024-01-02", config), 1)
                with self.assertRaisesRegex(ValueError, "after"):
                    calibration_scale("2025-04-01", "2025-10-01", config)
                self.assertEqual(calibration_scale("2026-10-15", "2026-10-20", config), 0.9)


class NetworkAndMarketTests(unittest.TestCase):
    def test_key_stays_local_and_is_loaded_without_shell_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("THERUNDOWN_API_KEY=test-private-key\n")
            with patch("nba.rundown.ROOT", root), patch.dict("os.environ", {}, clear=True):
                self.assertEqual(api_key(), "test-private-key")

    def test_cache_avoids_repeated_api_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            client = JsonClient(directory)
            with patch.object(client, "_read", return_value=(b'{"events": []}', {"X-Datapoints": "1"})) as read:
                first = client.get("https://example.test/events")
                self.assertEqual(first, client.get("https://example.test/events"))
                self.assertEqual(read.call_count, 1)
                self.assertNotIn("key", first["source_url"])

    def test_current_data_cache_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            client = JsonClient(directory, max_cache_age_seconds=3600)
            with patch.object(client, "_read", return_value=(b'{"events": []}', {})) as read:
                client.get("https://example.test/roster")
                cache_path = next(Path(directory).glob("*.gz"))
                cached = json.loads(gzip.decompress(cache_path.read_bytes()))
                cached["fetched_at"] = "2000-01-01T00:00:00+00:00"
                cache_path.write_bytes(gzip.compress(json.dumps(cached).encode()))
                client.get("https://example.test/roster")
                self.assertEqual(read.call_count, 2)

    def test_curl_key_is_in_stdin_and_absent_from_process_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            client = JsonClient(directory, headers={"X-TheRundown-Key": "test-private-key"})
            def transport(command, **kwargs):
                self.assertNotIn("test-private-key", " ".join(command))
                self.assertIn(b"test-private-key", kwargs["input"])
                header_path = Path(command[command.index("--dump-header") + 1])
                header_path.write_text("HTTP/2 200\nX-Datapoints: 0\n")
                return SimpleNamespace(returncode=0, stdout=b'{"sample": true}\n__NBA_HTTP_200', stderr=b"")
            with patch("nba.http_client.shutil.which", return_value="/usr/bin/curl"), patch("nba.http_client.subprocess.run", side_effect=transport):
                response = client.get("https://example.test/stats/sample")
                self.assertTrue(response["data"]["sample"])
                self.assertNotIn("test-private-key", json.dumps(response))

    def test_denied_entitlement_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            client = JsonClient(directory, retries=3)
            with patch.object(client, "_read", side_effect=HTTPError("https://example.test", 403, "Denied", {}, None)) as read:
                with self.assertRaisesRegex(DataAccessError, "entitlement"):
                    client.get("https://example.test/events")
                self.assertEqual(read.call_count, 1)

    def test_american_odds_and_off_board_values(self):
        self.assertEqual(american_to_decimal(150), 2.5)
        self.assertEqual(american_to_decimal(-200), 1.5)
        for price in [0, 0.0001, np.nan]:
            with self.assertRaises(ValueError):
                american_to_decimal(price)

    def test_moneylines_pair_same_book_and_preserve_timestamps(self):
        teams = pd.DataFrame([{"team_id": "ESPN_A", "team": "BOS"}, {"team_id": "ESPN_B", "team": "NY"}])
        snapshot = {"fetched_at": "2026-10-15T12:00Z", "data": {"events": [{"event_id": "E", "event_date": "2026-10-20T23:00Z",
                   "teams": [{"team_id": 1, "abbreviation": "BOS", "is_away": True}, {"team_id": 2, "abbreviation": "NYK", "is_home": True}],
                   "markets": [{"market_id": 1, "period_id": 0, "participants": [
                       {"id": 1, "type": "TYPE_TEAM", "lines": [{"prices": {"19": {"price": 100, "updated_at": "2026-10-15T11:00Z"}}}]},
                       {"id": 2, "type": "TYPE_TEAM", "lines": [{"prices": {"19": {"price": -120, "updated_at": "2026-10-15T11:00Z"}}}]}]}]}]}}
        quotes, skipped = normalize_moneylines(snapshot, teams)
        self.assertEqual(len(quotes), 1)
        self.assertEqual(quotes.iloc[0].home_team_id, "ESPN_B")
        self.assertEqual(quotes.iloc[0].affiliate_id, "19")
        self.assertEqual(skipped, [])
        self.assertIn("home_price_updated_at", quotes)
        snapshot["data"]["events"][0]["markets"][0]["participants"][1]["lines"][0]["prices"] = {"23": {"price": -120, "updated_at": "2026-10-15T11:00Z"}}
        self.assertTrue(normalize_moneylines(snapshot, teams)[0].empty)


if __name__ == "__main__":
    unittest.main()
