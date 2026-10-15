"""Shrink player box production, allocate rotations, and estimate roster changes.

These are box-score proxies, not causal player value or adjusted plus/minus.
"""

import numpy as np
import pandas as pd
from scipy.optimize import lsq_linear

from .config import DATA, ModelConfig
from .model import fit_team_model


FEATURES = ["points", "missed_fg", "missed_ft", "oreb", "dreb", "ast", "stl", "blk", "tov", "fg3m"]


def load_players(path=DATA / "player_seasons.csv"):
    players = pd.read_csv(path, dtype={"player_id": str, "team_id": str})
    required = {"player_id", "player_name", "season", "team_id", "games", "minutes", "fgm", "fga", "ftm", "fta", *[key for key in FEATURES if not key.startswith("missed")]}
    if not required.issubset(players.columns):
        raise ValueError(f"Missing player columns: {sorted(required - set(players.columns))}")
    values = players[list(required - {"player_id", "player_name", "team_id"})].apply(pd.to_numeric, errors="raise")
    if not np.isfinite(values).all().all() or values.lt(0).any().any() or players.minutes.le(0).any():
        raise ValueError("Player performance totals must be finite and nonnegative, with positive minutes.")
    if players.fgm.gt(players.fga).any() or players.ftm.gt(players.fta).any():
        raise ValueError("Made shots cannot exceed attempted shots.")
    if players.duplicated(["player_id", "season", "team_id"]).any():
        raise ValueError("Duplicate player season/team stints would double-count performance.")
    players["missed_fg"] = players.fga - players.fgm
    players["missed_ft"] = players.fta - players.ftm
    return players


def project_players(players, target_year, config=None):
    config = config or ModelConfig()
    history = players.loc[players.season.between(target_year - 4, target_year - 1)].copy()
    if history.empty:
        raise ValueError("No player seasons strictly before the target season.")
    history["weight"] = np.exp2(-(target_year - 1 - history.season))
    minutes = history.minutes * history.weight
    league = history[FEATURES].multiply(history.weight, axis=0).sum() / minutes.sum() * 36
    records = []
    for player_id, rows in history.groupby("player_id", sort=True):
        effective_minutes = float((rows.minutes * rows.weight).sum())
        production = rows[FEATURES].multiply(rows.weight, axis=0).sum() * 36
        shrunk = (production + config.player_shrinkage_minutes * league) / (effective_minutes + config.player_shrinkage_minutes)
        latest_year = int(rows.season.max())
        latest = rows.loc[rows.season == latest_year]
        latest_mpg = min(36.0, float(latest.minutes.sum() / latest.games.sum()))
        record = {"player_id": player_id, "player_name": rows.iloc[-1].player_name, "history_minutes": float(rows.minutes.sum()),
                  "effective_minutes": effective_minutes, "latest_season": latest_year, "latest_mpg": latest_mpg,
                  "history_seasons": int(rows.season.nunique()), "has_history": True}
        record.update(shrunk.to_dict())
        records.append(record)
    return pd.DataFrame(records), league


def fit_box_translation(players, games, target_year, config=None):
    """Relate known season team box production to opponent-adjusted margins.

    The coefficients explain completed seasons; they are not a prospective
    validation of individual causal effects or of future roster adjustments.
    """
    config = config or ModelConfig()
    history = players.loc[players.season.between(target_year - 4, target_year - 1)]
    training_rows = []
    for year, season_players in history.groupby("season"):
        season_games = games.loc[games.season.eq(year)].copy()
        if season_games.empty:
            continue
        # A full-season table must never be used before that season ends.
        model = fit_team_model(season_games, pd.Timestamp(year=int(year), month=8, day=1), config)
        ratings = dict(zip(model.team_ids, model.coefficients[:-2]))
        for team_id, rows in season_players.groupby("team_id"):
            if team_id not in ratings:
                continue
            team_games = int(((season_games.home_team_id == team_id) | (season_games.away_team_id == team_id)).sum())
            coverage = rows.minutes.sum() / (max(team_games, 1) * 240)
            if coverage < 0.8:
                continue
            features = rows[FEATURES].sum() / rows.minutes.sum() * 180  # Five players, per-36 rates.
            training_rows.append({"season": year, "team_id": team_id, "target": ratings[team_id], "minute_coverage": coverage, **features.to_dict()})
    training = pd.DataFrame(training_rows)
    if len(training) < 60:
        raise ValueError(f"Only {len(training)} sufficiently covered team-seasons for player translation; need 60.")
    center = training[FEATURES].mean().to_numpy()
    scale = training[FEATURES].std(ddof=0).clip(lower=1).to_numpy()
    matrix = (training[FEATURES].to_numpy() - center) / scale
    target = training.target.to_numpy()
    intercept = float(target.mean())
    negative_features = {"missed_fg", "missed_ft", "tov"}
    lower = np.array([-np.inf if name in negative_features else 0.0 for name in FEATURES])
    upper = np.array([0.0 if name in negative_features else np.inf for name in FEATURES])
    fit = lsq_linear(np.vstack([matrix, np.eye(len(FEATURES)) * 5]),
                     np.r_[target - intercept, np.zeros(len(FEATURES))], bounds=(lower, upper))
    if not fit.success:
        raise ValueError("Sign-constrained player box translation did not converge.")
    standardized = fit.x
    coefficients = standardized / scale
    return {"features": FEATURES, "coefficients": coefficients, "center": center, "intercept": intercept,
            "training_team_seasons": len(training), "min_minute_coverage": float(training.minute_coverage.min()),
            "method": "sign-constrained ridge association between season box production and completed-season team margin"}


def allocate_minutes(weights, total=240.0, cap=40.0):
    weights = np.asarray(weights, dtype=float)
    if not np.isfinite(weights).all() or (weights < 0).any() or (weights > 0).sum() * cap < total:
        raise ValueError("Too few available players, or invalid weights, to allocate a 240-minute rotation.")
    allocation = np.zeros_like(weights)
    remaining = weights > 0
    available = total
    while remaining.any():
        indices = np.flatnonzero(remaining)
        proposed = weights[indices] / weights[indices].sum() * available
        over = proposed > cap
        if not over.any():
            allocation[indices] = proposed
            break
        fixed = indices[over]
        allocation[fixed] = cap
        available -= cap * len(fixed)
        remaining[fixed] = False
    return allocation


def rotation_weights(current):
    historical = current.latest_mpg.clip(lower=4, upper=36)
    if "depth_rank" in current:
        role_prior = current.depth_rank.map({1: 30.0, 2: 18.0, 3: 8.0}).fillna(3.0)
        weights = pd.Series(np.where(current.has_history, 0.5 * historical + 0.5 * role_prior, role_prior), index=current.index)
    else:
        weights = historical
    return weights * current.availability


def roster_analysis(players, rosters, games, target_year, config=None):
    config = config or ModelConfig()
    if rosters.duplicated("player_id").any():
        raise ValueError("A current player appears on multiple teams.")
    if rosters.team_id.nunique() != 30:
        raise ValueError("Current season report requires roster snapshots for all 30 teams.")
    projection, league = project_players(players, target_year, config)
    translation = fit_box_translation(players, games, target_year, config)
    coefficients = translation["coefficients"]
    projection["box_impact_proxy"] = (projection[FEATURES].to_numpy() - league.to_numpy()) @ coefficients
    latest_stints = players.loc[players.season.eq(target_year - 1)].copy()
    previous_team_sets = latest_stints.groupby("player_id").team_id.agg(lambda value: set(value)).to_dict()
    details, teams, moves = [], [], []
    for team_id, roster in rosters.groupby("team_id", sort=True):
        current = roster.merge(projection.drop(columns="player_name"), on="player_id", how="left", validate="one_to_one")
        current["has_history"] = current.has_history.fillna(False).astype(bool)
        for feature in FEATURES:
            current[feature] = current[feature].fillna(float(league[feature]))
        current["box_impact_proxy"] = current.box_impact_proxy.fillna(0.0)
        current["latest_mpg"] = current.latest_mpg.fillna(8.0)
        current["availability"] = pd.to_numeric(current.availability, errors="raise")
        if not current.availability.between(0, 1).all():
            raise ValueError("Roster availability must be between zero and one.")
        supplied = pd.to_numeric(current.projected_minutes, errors="coerce")
        if supplied.notna().any():
            if supplied.isna().any() or not np.isfinite(supplied).all() or not supplied.between(0, 48).all() or abs(supplied.sum() - 240) > 1e-6:
                raise ValueError(f"Team {team_id}: supply all projected minutes and make them total 240, or leave all blank.")
            if ((current.availability == 0) & supplied.gt(0)).any():
                raise ValueError("Unavailable players cannot have positive projected minutes.")
            current["rotation_minutes"] = supplied
        else:
            # Training-camp rosters contain many fringe players. The highest
            # historical-minute players form a provisional 11-player rotation.
            weights = rotation_weights(current)
            keep = weights.nlargest(min(11, len(weights))).index
            weights.loc[~weights.index.isin(keep)] = 0
            current["rotation_minutes"] = allocate_minutes(weights)
        current["roster_contribution_points"] = current.box_impact_proxy * current.rotation_minutes / 48
        previous = latest_stints.loc[latest_stints.team_id.eq(team_id)].merge(
            projection[["player_id", "box_impact_proxy"]], on="player_id", how="left", validate="many_to_one")
        if previous.empty:
            raise ValueError(f"No previous-season player composition for team {team_id}.")
        previous["previous_contribution_points"] = previous.box_impact_proxy.fillna(0) * previous.minutes / previous.minutes.sum() * 5
        previous_value = float(previous.previous_contribution_points.sum())
        current_value = float(current.roster_contribution_points.sum())
        raw_change = current_value - previous_value
        adjustment = float(np.clip(config.roster_blend * raw_change, -config.max_roster_adjustment, config.max_roster_adjustment))
        previous_ids = set(previous.player_id)
        current_ids = set(current.player_id)
        arrivals, departures = current_ids - previous_ids, previous_ids - current_ids
        for row in current.itertuples():
            record = row._asdict()
            record.pop("Index", None)
            details.append(record)
            if row.player_id in arrivals:
                moves.append({"team_id": team_id, "player_id": row.player_id, "player_name": row.player_name, "direction": "arrival",
                              "prior_team_ids": ",".join(sorted(previous_team_sets.get(row.player_id, set()))),
                              "production_contribution_points": float(row.roster_contribution_points),
                              "projected_minutes": float(row.rotation_minutes), "has_nba_history": bool(row.has_history)})
        for row in previous.loc[previous.player_id.isin(departures)].itertuples():
            moves.append({"team_id": team_id, "player_id": row.player_id, "player_name": row.player_name, "direction": "departure",
                          "prior_team_ids": team_id, "production_contribution_points": -float(row.previous_contribution_points),
                          "projected_minutes": 0.0, "has_nba_history": True})
        teams.append({"team_id": team_id, "previous_roster_proxy": previous_value, "current_roster_proxy": current_value,
                      "raw_roster_change_points": raw_change, "applied_roster_adjustment": adjustment,
                      "players_arriving_vs_previous_season": len(arrivals), "players_departing_vs_previous_season": len(departures),
                      "new_player_projected_minutes": float(current.loc[~current.has_history, "rotation_minutes"].sum()),
                      "injury_status_flags": int(current.injury_status.fillna("").ne("").sum()),
                      "rotation_minutes": float(current.rotation_minutes.sum()),
                      "rotation_method": "manual" if supplied.notna().any() else "provisional 11-player depth-chart/history weights"})
    return pd.DataFrame(teams), pd.DataFrame(details), pd.DataFrame(moves), translation
