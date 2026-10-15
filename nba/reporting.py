"""Season preparation, roster movement reports, and fixture forecasts."""

import hashlib
import json

import numpy as np
import pandas as pd
from scipy.stats import norm

from .config import DATA, REPORTS, ModelConfig, season_label
from .model import fit_team_model, load_games
from .players import FEATURES, roster_analysis, load_players
from .markets import ALIASES


def load_rosters(as_of, target_year):
    roster = pd.read_csv(DATA / "rosters.csv", dtype={"player_id": str, "team_id": str})
    dates = pd.to_datetime(roster.snapshot_at, utc=True).dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize()
    if dates.gt(pd.Timestamp(as_of).normalize()).any():
        raise ValueError("The current roster snapshot was retrieved after the requested as-of date.")
    if "depth_snapshot_at" in roster:
        depth_dates = pd.to_datetime(roster.depth_snapshot_at, utc=True).dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize()
        if depth_dates.gt(pd.Timestamp(as_of).normalize()).any():
            raise ValueError("The projected depth chart was retrieved after the requested as-of date.")
    if not roster.season.eq(target_year).all():
        raise ValueError("Roster snapshot belongs to a different target season.")
    overrides_path = DATA / "rotation_overrides.csv"
    if overrides_path.exists():
        overrides = pd.read_csv(overrides_path, dtype={"player_id": str})
        if overrides.player_id.duplicated().any() or not set(overrides.player_id).issubset(set(roster.player_id)):
            raise ValueError("Rotation overrides contain duplicate or unknown current player IDs.")
        for column in ("availability", "projected_minutes"):
            if column in overrides:
                updates = overrides.dropna(subset=[column]).set_index("player_id")[column]
                mask = roster.player_id.isin(updates.index)
                roster.loc[mask, column] = roster.loc[mask, "player_id"].map(updates)
    return roster


def calibration_scale(as_of, prediction_date, config):
    path = REPORTS / "calibration.json"
    if not path.exists():
        return 1.0
    artifact = json.loads(path.read_text())
    core_settings = ("half_life_days", "team_penalty", "rest_penalty", "min_history_games")
    if artifact.get("scope") != "team_margin_probability_scale" or any(
        artifact.get("model_config", {}).get(key) != config.to_dict()[key] for key in core_settings
    ):
        raise ValueError("NBA calibration does not match this model configuration.")
    if pd.Timestamp(prediction_date).normalize() < pd.Timestamp(artifact["fitted_before"]):
        # Earlier retrospective forecasts can still use raw probabilities.
        return 1.0
    if pd.Timestamp(artifact["calibration_last_result"]) > pd.Timestamp(as_of).normalize():
        raise ValueError("Probability calibration uses results after the as-of date.")
    scale = float(artifact["sigma_scale"])
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError("Invalid probability calibration scale.")
    return scale


def team_performance(games):
    rows = []
    for side, other in (("home", "away"), ("away", "home")):
        table = pd.DataFrame({"season": games.season, "team_id": games[f"{side}_team_id"],
                              "points_for": games[f"{side}_points"], "points_against": games[f"{other}_points"],
                              "win": (games[f"{side}_points"] > games[f"{other}_points"]).astype(int), "venue": side})
        rows.append(table)
    combined = pd.concat(rows, ignore_index=True)
    result = combined.groupby(["season", "team_id"]).agg(games=("win", "size"), wins=("win", "sum"),
                                                         points_for=("points_for", "mean"), points_against=("points_against", "mean")).reset_index()
    result["losses"] = result.games - result.wins
    result["mean_margin"] = result.points_for - result.points_against
    return result


def prepare_state(as_of, target_year, config=None):
    config = config or ModelConfig()
    if config.preseason_weight != 0:
        raise ValueError("Preseason is currently context-only; preseason_weight must remain zero.")
    quality = json.loads((DATA / "data_quality.json").read_text())
    if not quality.get("regular_season_complete") or not quality.get("player_history_source", "").startswith("Dated") or quality.get("failures"):
        raise ValueError("Historical data is incomplete. Finish nba sync before fitting the roster model.")
    if quality["target_season"] != season_label(target_year):
        raise ValueError("Downloaded data and requested target season do not match.")
    games = load_games(as_of=as_of)
    games = games.loc[games.season.between(target_year - 4, target_year - 1)].reset_index(drop=True)
    if games.season.nunique() != 4 or len(games) != 4920:
        raise ValueError("Season preparation requires four complete 1,230-game regular seasons.")
    players = load_players()
    rosters = load_rosters(as_of, target_year)
    # All supplied whole-season player rows must be finished by this snapshot.
    if games.day.max() > pd.Timestamp(as_of):
        raise ValueError("The historical player sample is not yet complete at this as-of date.")
    fit_date = pd.Timestamp(as_of).normalize() + pd.Timedelta(days=1)
    model = fit_team_model(games, fit_date, config)
    changes, details, moves, translation = roster_analysis(players, rosters, games, target_year, config)
    teams = pd.read_csv(DATA / "teams.csv", dtype={"team_id": str})
    ratings = pd.DataFrame({"team_id": model.team_ids, "team_rating": model.coefficients[:-2]})
    ratings = teams.merge(ratings, on="team_id", validate="one_to_one").merge(changes, on="team_id", validate="one_to_one")
    ratings["roster_adjusted_rating"] = ratings.team_rating + ratings.applied_roster_adjustment
    return games, rosters, model, ratings, details, moves, translation, quality


def upcoming_forecasts(model, ratings, as_of, scale):
    schedule = pd.read_csv(DATA / "schedule.csv", dtype={"game_id": str, "home_team_id": str, "away_team_id": str})
    schedule["day"] = pd.to_datetime(schedule.date, utc=True).dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize()
    schedule = schedule.loc[schedule.day >= pd.Timestamp(as_of).normalize()].sort_values(["day", "game_id"])
    changes = ratings.set_index("team_id").applied_roster_adjustment.to_dict()
    original_last_seen = model.last_seen.copy()
    last_seen = original_last_seen.copy()
    forecasts = []
    for day, group in schedule.groupby("day", sort=True):
        # Rest depends on the known schedule, not on future scores.
        model.last_seen = last_seen.copy()
        for row in group.itertuples():
            raw = model.forecast(row.home_team_id, row.away_team_id, day, sigma_scale=scale, neutral=bool(row.neutral))
            adjusted = model.forecast(row.home_team_id, row.away_team_id, day, changes, scale, neutral=bool(row.neutral))
            forecasts.append({"game_id": row.game_id, "date": row.date, "day": day.date().isoformat(),
                              "home_team_id": row.home_team_id, "away_team_id": row.away_team_id,
                              "team_only_home_win": raw["home_win"], "roster_adjusted_home_win": adjusted["home_win"],
                              "team_only_margin": raw["expected_home_margin"], "roster_adjusted_margin": adjusted["expected_home_margin"],
                              "rest_margin_adjustment": adjusted["rest_margin_adjustment"]})
        for row in group.itertuples():
            last_seen[row.home_team_id] = day
            last_seen[row.away_team_id] = day
    # Restore the fit object so projections do not mutate later forecast state.
    model.last_seen = original_last_seen
    return pd.DataFrame(forecasts)


def build_reports(as_of, target_year, config=None):
    config = config or ModelConfig()
    games, rosters, model, ratings, details, moves, translation, quality = prepare_state(as_of, target_year, config)
    scale = calibration_scale(as_of, f"{target_year - 1}-10-01", config)
    schedule_forecasts = upcoming_forecasts(model, ratings, as_of, scale)
    for name, column in (("team_only", "team_only_home_win"), ("roster_adjusted", "roster_adjusted_home_win")):
        home = schedule_forecasts.groupby("home_team_id")[column].agg(["sum", "size"])
        away = schedule_forecasts.assign(away_win=1 - schedule_forecasts[column]).groupby("away_team_id").away_win.agg(["sum", "size"])
        total = home.add(away, fill_value=0)
        ratings[f"scheduled_{name}_expected_wins"] = ratings.team_id.map(total["sum"])
        ratings["known_schedule_games"] = ratings.team_id.map(total["size"]).fillna(0).astype(int)
    ratings["unscheduled_games"] = 82 - ratings.known_schedule_games
    if ratings.unscheduled_games.lt(0).any():
        raise ValueError("Upcoming regular-season schedule exceeds 82 games for a team.")
    # NBA Cup-dependent games can have unresolved opponents. Do not invent
    # fixtures; publish known-schedule win expectations separately.
    ratings["scheduled_roster_win_change"] = ratings.scheduled_roster_adjusted_expected_wins - ratings.scheduled_team_only_expected_wins
    ratings = ratings.sort_values("roster_adjusted_rating", ascending=False).reset_index(drop=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    ratings.to_csv(REPORTS / "team_outlook.csv", index=False)
    details.to_csv(REPORTS / "player_projections.csv", index=False)
    moves = moves.merge(ratings[["team_id", "team", "team_name"]], on="team_id", validate="many_to_one")
    moves.to_csv(REPORTS / "roster_changes.csv", index=False)
    schedule_forecasts.to_csv(REPORTS / "schedule_forecasts.csv", index=False)
    team_performance(games).merge(ratings[["team_id", "team", "team_name"]], on="team_id").to_csv(REPORTS / "historical_team_performance.csv", index=False)
    preseason = pd.read_csv(DATA / "preseason.csv", dtype={"home_team_id": str, "away_team_id": str})
    preseason_summary = []
    for team in ratings.itertuples():
        home = preseason.loc[preseason.home_team_id == team.team_id]
        away = preseason.loc[preseason.away_team_id == team.team_id]
        margins = np.r_[home.home_points - home.away_points, away.away_points - away.home_points]
        preseason_summary.append({"team_id": team.team_id, "team": team.team, "games": len(margins),
                                  "wins": int((margins > 0).sum()), "mean_margin": float(margins.mean()) if len(margins) else np.nan,
                                  "weight_in_core_model": config.preseason_weight})
    pd.DataFrame(preseason_summary).to_csv(REPORTS / "preseason_context.csv", index=False)
    metadata = {"as_of": as_of, "target_season": season_label(target_year), "historical_games": len(games),
                "historical_players": quality["historical_players"], "roster_players": len(rosters), "roster_teams": int(rosters.team_id.nunique()),
                "player_boxes_with_unassigned_points": quality.get("player_boxes_with_unassigned_points", 0),
                "unassigned_player_points": quality.get("unassigned_player_points", 0),
                "model_config": config.to_dict(), "home_court_points": float(model.coefficients[-2]),
                "rest_points_per_day_capped": float(model.coefficients[-1]), "raw_margin_sd": model.sigma, "probability_sigma_scale": scale,
                "player_translation_training_team_seasons": translation["training_team_seasons"],
                "player_translation_min_minute_coverage": translation["min_minute_coverage"],
                "player_translation_coefficients": dict(zip(FEATURES, translation["coefficients"].tolist())),
                "historical_player_minutes_precision": "Sum of provider's displayed game-box minutes; minute displays can be rounded.",
                "roster_adjustments_validated": False, "rotation_assumption": "240 minutes per team, provisional 11-player depth-chart/history rotation unless manually overridden",
                "rookie_assumption": "Neutral league box-production prior when no historical NBA minutes exist; high uncertainty",
                "injury_assumption": "Provider flags are shown; availability defaults to 1 until overridden. This is not a confirmed active lineup.",
                "known_schedule_games": len(schedule_forecasts), "preseason_games": len(preseason),
                "move_definition": "Current roster compared with all previous-season team contributors; not an authenticated transaction ledger or salary valuation"}
    snapshot_columns = [rosters.snapshot_at]
    if "depth_snapshot_at" in rosters:
        snapshot_columns.append(rosters.depth_snapshot_at)
    metadata["latest_feature_snapshot_at"] = pd.to_datetime(pd.concat(snapshot_columns, ignore_index=True), utc=True).max().isoformat()
    metadata["input_sha256"] = {name: hashlib.sha256((DATA / name).read_bytes()).hexdigest() for name in
                                ("games.csv", "player_seasons.csv", "rosters.csv", "depthcharts.csv", "rotation_overrides.csv", "schedule.csv")}
    (REPORTS / "model_state.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
    write_season_report(ratings, moves, metadata)
    return {"report": str(REPORTS / "season_preview.md"), "metadata": metadata}


def write_season_report(ratings, moves, metadata):
    backtest_path = REPORTS / "backtest.json"
    backtest = json.loads(backtest_path.read_text()) if backtest_path.exists() else None
    lines = [f"# NBA {metadata['target_season']} preparation", "",
             f"Snapshot: {metadata['as_of']}. Four completed regular seasons, {metadata['historical_games']:,} games, "
             f"{metadata['historical_players']} historical players, and current roster snapshots for all 30 teams.", "",
             "The team-only margin model has chronological validation. The current roster layer is an experimental "
             "box-production adjustment; its probabilities have not been separately calibrated or validated.", ""]
    if backtest:
        lines += ["| 2025–26 historical test | Games | Accuracy | Binary Brier | Log loss |",
                  "| --- | ---: | ---: | ---: | ---: |"]
        for name in ("team_raw", "team_calibrated", "baseline"):
            m = backtest["metrics"][name]
            lines.append(f"| {name} | {m['games']} | {m['accuracy']:.2%} | {m['brier']:.4f} | {m['log_loss']:.4f} |")
        early = backtest["opening_14_days"]
        lines += ["", f"The first 14 days of that test season cover {early['team_calibrated']['games']} games: "
                  f"{early['team_calibrated']['accuracy']:.2%} model accuracy versus {early['baseline']['accuracy']:.2%} baseline. "
                  "Opening-season uncertainty remains material. No market-edge or ROI claim follows from these results.", ""]
    lines += ["## Team outlook", "", "Ratings and roster changes are estimated neutral-court points per game. "
              "Win expectations cover only published fixtures; unresolved NBA Cup-dependent games are excluded. "
              "They are expectations under fixed current ratings, not confidence intervals or guaranteed records.", "",
              "| Team | Historical rating | Roster adjustment | Combined rating | Expected wins on known schedule | Games |",
              "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in ratings.itertuples():
        lines.append(f"| {row.team_name} | {row.team_rating:+.2f} | {row.applied_roster_adjustment:+.2f} | "
                     f"{row.roster_adjusted_rating:+.2f} | {row.scheduled_roster_adjusted_expected_wins:.1f} | {row.known_schedule_games} |")
    lines += ["", "## Roster analysis", "", "Player box production uses all four seasons with recency weights and 750 prior minutes "
              "of shrinkage toward the league average. Its relationship to team margin is fitted with sign-constrained ridge regression on completed "
              f"team-seasons ({metadata['player_translation_training_team_seasons']} usable team-seasons). That relationship is associative, "
              "not a causal player-impact measure. Defense, role, spacing, coaching, age and injury recovery are only partially captured.", "",
              "Each team gets a provisional 240-minute rotation. Listed depth-chart roles provide 30/18/8-minute weight priors "
              "for first/second/third position choices (three for deeper reserves); these blend equally with historical MPG for "
              "players with NBA history. The top 11 weights are normalized to 240 minutes, capped at 40 per player. "
              "Rookies can enter the rotation through their projected depth-chart role. These are unvalidated minute assumptions. "
              "Arrivals carry their own historical performance into the new roster. "
              "The change from last season's minute-weighted contributors is damped by 50% and capped at eight points per team. "
              "These conservative settings are assumptions, not tuned or validated transfer effects.", "",
              "`roster_changes.csv` identifies arrivals and departures versus all previous-season contributors, not a verified sequence "
              "of trades. A player who changed teams during last season can appear in multiple previous-team comparisons. "
              "`player_projections.csv` shows every current player, assigned minutes, injury flags, history coverage, and proxy contribution.", "",
              "Rookies without NBA history use a neutral production prior. Injury flags do not automatically remove players from a full-season "
              "projection; change availability in `data/rotation_overrides.csv` for an explicit scenario. These training-camp snapshots are "
              "not confirmed opening-night active lineups.", "",
              "## Preseason and data access", "", f"{metadata['preseason_games']} completed preseason games are summarized in "
              "`preseason_context.csv`. Their weight in the core model is zero. This keeps a small, irregular exhibition sample from "
              "changing regular-season strength estimates.", "",
              "Historical results and player game boxes come from ESPN's public JSON feeds. The importer validates each box's event/team IDs "
              "and reconciles player points with the final score. NBA Cup finals are excluded from the four 1,230-game regular seasons. "
              "Raw responses retain URLs and retrieval timestamps in the ignored cache. This feed is undocumented and may change.", "",
              f"Source audit: {metadata['player_boxes_with_unassigned_points']} archived team boxes contain unidentified player slots, "
              f"leaving {metadata['unassigned_player_points']:.0f} team points unassigned to named players. These gaps are recorded in "
              "`data/boxscore_audit.csv`; no player points are invented to reconcile them. Team final results remain intact.", "",
              "The direct TheRundown connection is configured separately. Its authenticated access/usage headers are saved in "
              "`data/rundown_connection.json`; private timestamped event/odds responses stay in `data/private/`. Current key entitlement "
              "does not include historical statistics. TheRundown data is not part of the historical validation.", "",
              "[TheRundown authentication](https://docs.therundown.io/authentication) · "
              "[Statistics access and historical roster limitations](https://docs.therundown.io/guides/stats-access) · "
              "[NBA schedule](https://www.nba.com/schedule)", ""]
    (REPORTS / "season_preview.md").write_text("\n".join(lines))


def forecast_fixture(home, away, prediction_date, as_of, spread=None, team_only=False):
    config = ModelConfig()
    teams = pd.read_csv(DATA / "teams.csv", dtype={"team_id": str})
    def resolve(name):
        abbreviation = ALIASES.get(name.upper(), name)
        mask = teams.team.str.casefold().eq(abbreviation.casefold()) | teams.team_name.str.casefold().eq(name.casefold()) | teams.team_id.eq(name)
        if mask.sum() != 1:
            raise ValueError(f"Unknown team '{name}'. Use a team abbreviation from nba/data/teams.csv.")
        return teams.loc[mask].iloc[0]
    home_row, away_row = resolve(home), resolve(away)
    day = pd.Timestamp(prediction_date).normalize()
    games = load_games(as_of=as_of)
    model = fit_team_model(games, min(day, pd.Timestamp(as_of).normalize() + pd.Timedelta(days=1)), config)
    scale = calibration_scale(as_of, day, config)
    changes = None
    if not team_only:
        roster = load_rosters(as_of, int(games.season.max()) + 1)
        snapshot_day = pd.to_datetime(roster.snapshot_at, utc=True).dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize().max()
        if day < snapshot_day:
            raise ValueError("Current roster snapshot is later than this fixture; use --team-only for historical forecasts.")
        # Recompute from source tables so edits to minutes/availability cannot
        # silently leave a stale precomputed team outlook in the forecast.
        changes_table, _, _, _ = roster_analysis(load_players(), roster, games, int(games.season.max()) + 1, config)
        changes = changes_table.set_index("team_id").applied_roster_adjustment.to_dict()
    schedule = pd.read_csv(DATA / "schedule.csv", dtype={"home_team_id": str, "away_team_id": str})
    schedule["day"] = pd.to_datetime(schedule.date, utc=True).dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize()
    for row in schedule.loc[(schedule.day < day) & (schedule.day > model.last_result)].itertuples():
        for team in (row.home_team_id, row.away_team_id):
            model.last_seen[team] = max(model.last_seen.get(team, row.day), row.day)
    fixture = schedule.loc[(schedule.day == day) & (schedule.home_team_id == home_row.team_id) & (schedule.away_team_id == away_row.team_id)]
    neutral = bool(fixture.iloc[0].neutral) if len(fixture) == 1 else False
    prediction = model.forecast(home_row.team_id, away_row.team_id, day, changes, scale, neutral=neutral)
    prediction.update({"home_team": home_row.team_name, "away_team": away_row.team_name, "as_of": as_of,
                       "roster_adjustment_scope": "excluded" if team_only else "experimental; current provisional rotation",
                       "probability_calibration_scope": "team-only model; current roster changes are unvalidated"})
    if spread is not None:
        if not np.isfinite(spread) or not np.isclose(abs(spread) % 1, 0.5):
            raise ValueError("Spread estimates currently require a half-point line to avoid unmodeled pushes.")
        prediction["home_handicap"] = spread
        prediction["home_cover_probability"] = float(norm.cdf((prediction["expected_home_margin"] + spread) / prediction["margin_sd"]))
        prediction["cover_probability_scope"] = "Raw normal-margin approximation; not separately validated or calibrated for spreads."
    return prediction
