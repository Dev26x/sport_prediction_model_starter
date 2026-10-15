import numpy as np
import pandas as pd
from pathlib import Path

from model_v1 import load_matches, predict_match


TEST_START = pd.Timestamp("2026-08-01")
OUTPUT_PATH = Path("data/backtest_v1_results.csv")

OUTCOMES = ["H", "D", "A"]


def actual_result(row):
    if row["FTHG"] > row["FTAG"]:
        return "H"
    if row["FTHG"] < row["FTAG"]:
        return "A"
    return "D"


def calculate_metrics(actual, probabilities):
    actual = np.asarray(actual)
    probabilities = np.asarray(probabilities, dtype=float)

    # Protect log loss from log(0)
    safe_probs = np.clip(probabilities, 1e-12, 1.0)

    outcome_indices = np.array(
        [OUTCOMES.index(result) for result in actual]
    )

    one_hot = np.eye(3)[outcome_indices]

    accuracy = np.mean(
        np.argmax(probabilities, axis=1) == outcome_indices
    )

    brier = np.mean(
        np.sum((probabilities - one_hot) ** 2, axis=1)
    )

    log_loss = -np.mean(
        np.log(safe_probs[np.arange(len(actual)), outcome_indices])
    )

    return accuracy, brier, log_loss


def main():
    matches = load_matches()

    test_matches = matches[
        matches["Date"] >= TEST_START
    ].copy()

    results = []

    for _, match in test_matches.iterrows():
        match_date = match["Date"]

        try:
            prediction = predict_match(
                matches,
                home_team=match["HomeTeam"],
                away_team=match["AwayTeam"],
                prediction_date=match_date,
            )
        except ValueError as error:
            print(
                f"Skipping {match['HomeTeam']} vs "
                f"{match['AwayTeam']}: {error}"
            )
            continue

        result = actual_result(match)

        # Baseline: historical home/draw/away frequencies,
        # calculated using only matches before this date.
        history = matches[matches["Date"] < match_date]

        historical_results = history.apply(
            actual_result, axis=1
        )

        # Laplace smoothing prevents zero probabilities.
        counts = historical_results.value_counts()

        baseline = np.array([
            (counts.get(outcome, 0) + 1) / (len(history) + 3)
            for outcome in OUTCOMES
        ])

        results.append({
            "Date": match_date,
            "HomeTeam": match["HomeTeam"],
            "AwayTeam": match["AwayTeam"],
            "Actual": result,
            "Model_H": prediction["home_win"],
            "Model_D": prediction["draw"],
            "Model_A": prediction["away_win"],
            "Baseline_H": baseline[0],
            "Baseline_D": baseline[1],
            "Baseline_A": baseline[2],
        })

    if not results:
        print("No matches could be evaluated.")
        return

    df = pd.DataFrame(results)

    actual = df["Actual"].to_numpy()

    model_probs = df[
        ["Model_H", "Model_D", "Model_A"]
    ].to_numpy()

    baseline_probs = df[
        ["Baseline_H", "Baseline_D", "Baseline_A"]
    ].to_numpy()

    model_metrics = calculate_metrics(actual, model_probs)
    baseline_metrics = calculate_metrics(actual, baseline_probs)

    print("\nPREMIER LEAGUE MODEL V1 BACKTEST")
    print("--------------------------------")
    print(f"Matches evaluated: {len(df)}")

    print(
        f"\n{'Metric':<15}"
        f"{'Model V1':>12}"
        f"{'Baseline':>12}"
    )

    print("-" * 39)

    for label, model_value, baseline_value in zip(
        ["Accuracy", "Brier score", "Log loss"],
        model_metrics,
        baseline_metrics,
    ):
        if label == "Accuracy":
            print(
                f"{label:<15}"
                f"{model_value:>11.2%}"
                f"{baseline_value:>12.2%}"
            )
        else:
            print(
                f"{label:<15}"
                f"{model_value:>12.4f}"
                f"{baseline_value:>12.4f}"
            )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\nResults saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()