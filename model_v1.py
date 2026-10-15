import pandas as pd
import numpy as np
from scipy.stats import poisson

DATA_PATH = "data/premier_league_master.csv"


def load_matches():
    df = pd.read_csv(DATA_PATH, parse_dates=["Date"])
    return df.sort_values("Date").reset_index(drop=True)


def weighted_average(values, weights):
    return np.average(values, weights=weights)


def calculate_team_strengths(matches, prediction_date, half_life=180):
    prediction_date = pd.Timestamp(prediction_date)

    history = matches[matches["Date"] < prediction_date].copy()

    if history.empty:
        raise ValueError("No historical matches available.")

    # Recent matches receive greater weight
    age_days = (prediction_date - history["Date"]).dt.days
    history["weight"] = 0.5 ** (age_days / half_life)

    league_home_goals = weighted_average(
        history["FTHG"], history["weight"]
    )

    league_away_goals = weighted_average(
        history["FTAG"], history["weight"]
    )

    teams = set(history["HomeTeam"]) | set(history["AwayTeam"])

    strengths = {}

    # Shrink small samples toward league-average performance
    prior_matches = 8

    for team in teams:
        home = history[history["HomeTeam"] == team]
        away = history[history["AwayTeam"] == team]

        def shrunk_mean(data, column, baseline):
            total_weight = data["weight"].sum()

            return (
                (data[column] * data["weight"]).sum()
                + prior_matches * baseline
            ) / (total_weight + prior_matches)

        strengths[team] = {
            "home_attack": shrunk_mean(
                home, "FTHG", league_home_goals
            ) / league_home_goals,

            "home_defense": shrunk_mean(
                home, "FTAG", league_away_goals
            ) / league_away_goals,

            "away_attack": shrunk_mean(
                away, "FTAG", league_away_goals
            ) / league_away_goals,

            "away_defense": shrunk_mean(
                away, "FTHG", league_home_goals
            ) / league_home_goals,
        }

    return strengths, league_home_goals, league_away_goals


def predict_match(matches, home_team, away_team, prediction_date):
    strengths, league_home, league_away = calculate_team_strengths(
        matches, prediction_date
    )

    if home_team not in strengths or away_team not in strengths:
        raise ValueError("One or both teams are missing from historical data.")

    expected_home = (
        league_home
        * strengths[home_team]["home_attack"]
        * strengths[away_team]["away_defense"]
    )

    expected_away = (
        league_away
        * strengths[away_team]["away_attack"]
        * strengths[home_team]["home_defense"]
    )

    # Calculate score probabilities from 0 to 15 goals
    goals = np.arange(16)

    home_probs = poisson.pmf(goals, expected_home)
    away_probs = poisson.pmf(goals, expected_away)

    score_matrix = np.outer(home_probs, away_probs)
    score_matrix /= score_matrix.sum()

    home_win = np.tril(score_matrix, -1).sum()
    draw = np.trace(score_matrix)
    away_win = np.triu(score_matrix, 1).sum()

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
    }


if __name__ == "__main__":
    matches = load_matches()

    prediction = predict_match(
        matches,
        home_team="Arsenal",
        away_team="Chelsea",
        prediction_date="2026-10-15"
    )

    print("\nPREMIER LEAGUE MODEL V1")
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
        fair_odds = 1 / probability if probability > 0 else float("inf")

        print(
            f"{key:15} "
            f"{probability:6.2%} "
            f"Fair odds: {fair_odds:.2f}"
        )