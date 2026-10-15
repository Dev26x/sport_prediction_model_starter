"""Opponent-adjusted NBA margin model fitted on strictly earlier dates."""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import norm

from .config import DATA, ModelConfig


def load_games(path=DATA / "games.csv", as_of=None):
    frame = pd.read_csv(path, dtype={"game_id": str, "home_team_id": str, "away_team_id": str})
    required = {"game_id", "date", "season", "season_type", "home_team_id", "away_team_id", "home_points", "away_points", "completed", "neutral"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Missing game columns: {sorted(required - set(frame.columns))}")
    frame["day"] = pd.to_datetime(frame.date, utc=True, errors="raise").dt.tz_convert("America/Toronto").dt.tz_localize(None).dt.normalize()
    frame = frame.loc[frame.completed.astype(str).str.lower().eq("true") & frame.season_type.eq(2)].copy()
    if as_of:
        frame = frame.loc[frame.day <= pd.Timestamp(as_of).normalize()].copy()
    for column in ("home_points", "away_points"):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
        if (~np.isfinite(frame[column]) | frame[column].le(0) | frame[column].mod(1).ne(0)).any():
            raise ValueError("Completed NBA scores must be positive integers.")
    if frame.home_points.eq(frame.away_points).any():
        raise ValueError("Final NBA scores cannot be tied.")
    if frame.home_team_id.eq(frame.away_team_id).any() or frame.game_id.duplicated().any():
        raise ValueError("Invalid or duplicated NBA fixture.")
    frame["neutral"] = frame.neutral.astype(str).str.lower().eq("true")
    return frame.sort_values(["day", "game_id"]).reset_index(drop=True)


def rest_days(last_day, day):
    return 3.0 if last_day is None else float(np.clip((day - last_day).days - 1, 0, 3))


def design_matrix(games, team_ids):
    games = games.reset_index(drop=True)
    index = {team: number for number, team in enumerate(team_ids)}
    matrix = np.zeros((len(games), len(team_ids) + 2))
    last_seen = {}
    for _, group in games.groupby("day", sort=True):
        for row in group.itertuples():
            position = row.Index
            matrix[position, index[row.home_team_id]] = 1
            matrix[position, index[row.away_team_id]] = -1
            matrix[position, -2] = 0 if row.neutral else 1
            matrix[position, -1] = rest_days(last_seen.get(row.home_team_id), row.day) - rest_days(last_seen.get(row.away_team_id), row.day)
        for row in group.itertuples():
            last_seen[row.home_team_id] = row.day
            last_seen[row.away_team_id] = row.day
    return matrix


@dataclass
class TeamModel:
    team_ids: list
    coefficients: np.ndarray
    sigma: float
    fitted_before: pd.Timestamp
    last_result: pd.Timestamp
    last_seen: dict
    history_games: int
    config: ModelConfig

    def forecast(self, home, away, day, roster_adjustments=None, sigma_scale=1.0, neutral=False):
        day = pd.Timestamp(day).normalize()
        if day < self.fitted_before:
            raise ValueError("The team model contains results after the forecast cutoff.")
        if home == away or home not in self.team_ids or away not in self.team_ids:
            raise ValueError("Forecast needs two different teams with historical NBA results.")
        if not np.isfinite(sigma_scale) or sigma_scale <= 0:
            raise ValueError("Probability scale must be positive and finite.")
        ratings = dict(zip(self.team_ids, self.coefficients[:-2]))
        rest_difference = rest_days(self.last_seen.get(home), day) - rest_days(self.last_seen.get(away), day)
        margin = ratings[home] - ratings[away] + (0 if neutral else self.coefficients[-2]) + self.coefficients[-1] * rest_difference
        adjustments = roster_adjustments or {}
        roster_delta = float(adjustments.get(home, 0) - adjustments.get(away, 0))
        final_margin = float(margin + roster_delta)
        sigma = float(self.sigma * sigma_scale)
        return {"home_team_id": home, "away_team_id": away, "date": day.date().isoformat(),
                "home_win": float(norm.cdf(final_margin / sigma)), "away_win": float(norm.cdf(-final_margin / sigma)),
                "team_only_home_win": float(norm.cdf(float(margin) / sigma)),
                "expected_home_margin": final_margin, "team_only_home_margin": float(margin),
                "roster_margin_adjustment": roster_delta, "margin_sd": float(self.sigma),
                "win_probability_scale": float(sigma_scale),
                "home_court_points": float(0 if neutral else self.coefficients[-2]),
                "rest_difference_days_capped": rest_difference, "rest_margin_adjustment": float(self.coefficients[-1] * rest_difference),
                "history_games": self.history_games, "last_training_result": self.last_result.date().isoformat()}


def fit_team_model(games, before, config=None, precomputed=None):
    config = config or ModelConfig()
    if config.half_life_days <= 0 or config.team_penalty <= 0 or config.rest_penalty <= 0:
        raise ValueError("Model half-life and regularization penalties must be positive.")
    before = pd.Timestamp(before).normalize()
    if pd.isna(before):
        raise ValueError("Forecast cutoff must be a valid date.")
    history = games.loc[games.day < before].copy().reset_index(drop=True)
    if len(history) < config.min_history_games:
        raise ValueError(f"Need at least {config.min_history_games} strictly earlier regular-season games.")
    if precomputed is None:
        team_ids = sorted(set(history.home_team_id) | set(history.away_team_id))
        matrix = design_matrix(history, team_ids)
    else:
        all_matrix, team_ids = precomputed
        matrix = all_matrix[(games.day < before).to_numpy()]
    age_days = (before - history.day).dt.days.to_numpy()
    weights = np.exp2(-age_days / config.half_life_days)
    target = (history.home_points - history.away_points).to_numpy()
    penalty = np.diag([config.team_penalty] * len(team_ids) + [0.01, config.rest_penalty])
    coefficients = np.linalg.solve(matrix.T @ (matrix * weights[:, None]) + penalty, matrix.T @ (target * weights))
    residual = target - matrix @ coefficients
    sigma = max(5.0, float(np.sqrt(np.average(residual ** 2, weights=weights))))
    seen = pd.concat([history[["home_team_id", "day"]].rename(columns={"home_team_id": "team"}),
                      history[["away_team_id", "day"]].rename(columns={"away_team_id": "team"})]).groupby("team").day.max().to_dict()
    return TeamModel(team_ids, coefficients, sigma, before, history.day.max(), seen, len(history), config)
