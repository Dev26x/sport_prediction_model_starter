import numpy as np
import pandas as pd
from scipy.stats import poisson

from data_utils import DATA_PATH, load_matches

HALF_LIFE_DAYS = 180
PRIOR_MATCHES = 8
MAX_GOALS = 15


def weighted_mean(values, weights):
    total_weight = weights.sum()

    if total_weight <= 0:
        raise ValueError("Cannot calculate weighted mean.")

    return np.sum(values * weights) / total_weight


def shrunk_mean(data, column, baseline, prior_matches):
    """
    Estimate a team-specific average while shrinking
    small samples toward the league average.
    """

    if data.empty:
        return baseline

    weighted_sum = np.sum(
        data[column].to_numpy() *
        data["weight"].to_numpy()
    )

    effective_weight = data["weight"].sum()

    return (
        weighted_sum + prior_matches * baseline
    ) / (
        effective_weight + prior_matches
    )


def calculate_team_strengths(
    matches,
    prediction_date,
    half_life=HALF_LIFE_DAYS,
    prior_matches=PRIOR_MATCHES,
):
    prediction_date = pd.Timestamp(prediction_date)

    if pd.isna(prediction_date):
        raise ValueError("Prediction date must be valid.")
    if not np.isfinite(half_life) or half_life <= 0:
        raise ValueError("Half-life must be finite and positive.")
    if not np.isfinite(prior_matches) or prior_matches <= 0:
        raise ValueError("Prior matches must be finite and positive.")

    # Prevent future information leakage.
    history = matches[
        matches["Date"] < prediction_date
    ].copy()

    if history.empty:
        raise ValueError(
            "No historical matches before prediction date."
        )

    age_days = (
        prediction_date - history["Date"]
    ).dt.days.to_numpy()

    history["weight"] = np.power(
        0.5,
        age_days / half_life
    )

    league_home_goals = weighted_mean(
        history["FTHG"].to_numpy(),
        history["weight"].to_numpy()
    )

    league_away_goals = weighted_mean(
        history["FTAG"].to_numpy(),
        history["weight"].to_numpy()
    )

    if league_home_goals <= 0 or league_away_goals <= 0:
        raise ValueError("History must include home and away goals.")

    teams = set(history["HomeTeam"]) | set(history["AwayTeam"])

    strengths = {}

    for team in teams:
        home = history[
            history["HomeTeam"] == team
        ]

        away = history[
            history["AwayTeam"] == team
        ]

        home_attack = shrunk_mean(
            home,
            "FTHG",
            league_home_goals,
            prior_matches
        ) / league_home_goals

        home_defense = shrunk_mean(
            home,
            "FTAG",
            league_away_goals,
            prior_matches
        ) / league_away_goals

        away_attack = shrunk_mean(
            away,
            "FTAG",
            league_away_goals,
            prior_matches
        ) / league_away_goals

        away_defense = shrunk_mean(
            away,
            "FTHG",
            league_home_goals,
            prior_matches
        ) / league_home_goals

        strengths[team] = {
            "home_attack": home_attack,
            "home_defense": home_defense,
            "away_attack": away_attack,
            "away_defense": away_defense,
            "home_matches": len(home),
            "away_matches": len(away),
            "home_effective_weight": home["weight"].sum(),
            "away_effective_weight": away["weight"].sum(),
            "new_team": False,
        }

    return strengths, league_home_goals, league_away_goals


def default_team_strength():
    """
    Neutral prior for a team with no EPL history.

    This is a temporary assumption, not a validated
    promoted-team strength estimate.
    """

    return {
        "home_attack": 1.0,
        "home_defense": 1.0,
        "away_attack": 1.0,
        "away_defense": 1.0,
        "home_matches": 0,
        "away_matches": 0,
        "home_effective_weight": 0.0,
        "away_effective_weight": 0.0,
        "new_team": True,
    }


def predict_match(
    matches,
    home_team,
    away_team,
    prediction_date,
):
    strengths, league_home, league_away = (
        calculate_team_strengths(
            matches,
            prediction_date
        )
    )

    return predict_from_strengths(
        strengths, league_home, league_away, home_team, away_team
    )


def predict_from_strengths(strengths, league_home, league_away, home_team, away_team):
    """Reuse one pre-match state for every fixture on the same date."""
    if home_team == away_team:
        raise ValueError("A team cannot play itself.")

    home = strengths.get(
        home_team,
        default_team_strength()
    )

    away = strengths.get(
        away_team,
        default_team_strength()
    )

    expected_home = (
        league_home
        * home["home_attack"]
        * away["away_defense"]
    )

    expected_away = (
        league_away
        * away["away_attack"]
        * home["home_defense"]
    )

    goals = np.arange(MAX_GOALS + 1)

    home_probs = poisson.pmf(
        goals,
        expected_home
    )

    away_probs = poisson.pmf(
        goals,
        expected_away
    )

    score_matrix = np.outer(
        home_probs,
        away_probs
    )

    score_matrix /= score_matrix.sum()

    home_win = np.tril(
        score_matrix, -1
    ).sum()

    draw = np.trace(
        score_matrix
    )

    away_win = np.triu(
        score_matrix, 1
    ).sum()

    over_25 = sum(
        score_matrix[i, j]
        for i in goals
        for j in goals
        if i + j >= 3
    )

    btts = score_matrix[1:, 1:].sum()

    return {
        "home_team": home_team,
        "away_team": away_team,
        "expected_home_goals": expected_home,
        "expected_away_goals": expected_away,
        "home_win": home_win,
        "draw": draw,
        "away_win": away_win,
        "over_2_5": over_25,
        "under_2_5": 1 - over_25,
        "btts_yes": btts,
        "btts_no": 1 - btts,
        "home_new_team": home["new_team"],
        "away_new_team": away["new_team"],
        "home_history_matches": (
            home["home_matches"] +
            home["away_matches"]
        ),
        "away_history_matches": (
            away["home_matches"] +
            away["away_matches"]
        ),
    }


if __name__ == "__main__":
    matches = load_matches()

    prediction = predict_match(
        matches,
        home_team="Arsenal",
        away_team="Coventry",
        prediction_date="2026-10-15"
    )

    print("\nPREMIER LEAGUE MODEL V2")
    print("-----------------------")

    print(
        f"{prediction['home_team']} vs "
        f"{prediction['away_team']}"
    )

    print(
        f"Expected goals: "
        f"{prediction['expected_home_goals']:.2f} - "
        f"{prediction['expected_away_goals']:.2f}"
    )

    print("\nMATCH PROBABILITIES")

    for key in [
        "home_win",
        "draw",
        "away_win",
        "over_2_5",
        "under_2_5",
        "btts_yes",
        "btts_no",
    ]:
        probability = prediction[key]

        fair_odds = (
            1 / probability
            if probability > 0
            else float("inf")
        )

        print(
            f"{key:15} "
            f"{probability:6.2%} "
            f"Fair odds: {fair_odds:.2f}"
        )

    print("\nDATA COVERAGE")

    print(
        f"Home team historical matches: "
        f"{prediction['home_history_matches']}"
    )

    print(
        f"Away team historical matches: "
        f"{prediction['away_history_matches']}"
    )

    if (
        prediction["home_new_team"]
        or prediction["away_new_team"]
    ):
        print(
            "\nWARNING: At least one team has no "
            "previous EPL history."
        )

        print(
            "A neutral prior was used. "
            "Treat this prediction as highly uncertain."
        )
