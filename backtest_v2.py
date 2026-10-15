import numpy as np
import pandas as pd
from pathlib import Path

import model_v1
import model_v2


TEST_START = pd.Timestamp("2025-08-01")
OUTPUT_PATH = Path("data/backtest_v2_results.csv")

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

    indices = np.array([
        OUTCOMES.index(result) for result in actual
    ])

    one_hot = np.eye(3)[indices]

    accuracy = np.mean(
        np.argmax(probabilities, axis=1) == indices
    )

    brier = np.mean(
        np.sum((probabilities - one_hot) ** 2, axis=1)
    )

    safe_probs = np.clip(probabilities, 1e-12, 1.0)

    log_loss = -np.mean(
        np.log(safe_probs[np.arange(len(actual)), indices])
    )

    return accuracy, brier, log_loss


def main():
    matches = model_v2.load_matches()

    test_matches = matches[
        matches["Date"] >= TEST_START
    ].copy()

    results = []

    for _, match in test_matches.iterrows():
        match_date = match["Date"]
        home = match["HomeTeam"]
        away = match["AwayTeam"]

        try:
            v1 = model_v1.predict_match(
                matches, home, away, match_date
            )
            v2 = model_v2.predict_match(
                matches, home, away, match_date
            )
        except ValueError:
            # Compare only matches both models can predict.
            continue

        result = actual_result(match)

        history = matches[matches["Date"] < match_date]

        historical_results = history.apply(
            actual_result, axis=1
        )

        counts = historical_results.value_counts()

        baseline = np.array([
            (counts.get(outcome, 0) + 1)
            / (len(history) + 3)
            for outcome in OUTCOMES
        ])

        results.append({
            "Date": match_date,
            "HomeTeam": home,
            "AwayTeam": away,
            "Actual": result,
            "V1_H": v1["home_win"],
            "V1_D": v1["draw"],
            "V1_A": v1["away_win"],
            "V2_H": v2["home_win"],
            "V2_D": v2["draw"],
            "V2_A": v2["away_win"],
            "Baseline_H": baseline[0],
            "Baseline_D": baseline[1],
            "Baseline_A": baseline[2],
        })

    if not results:
        print("No matches evaluated.")
        return

    df = pd.DataFrame(results)

    actual = df["Actual"].to_numpy()

    print("\nPREMIER LEAGUE MODEL COMPARISON")
    print("--------------------------------")
    print(f"Matches evaluated: {len(df)}")

    print(
        f"\n{'Model':<12}"
        f"{'Accuracy':>12}"
        f"{'Brier':>12}"
        f"{'Log Loss':>12}"
    )

    print("-" * 48)

    for name, columns in [
        ("V1", ["V1_H", "V1_D", "V1_A"]),
        ("V2", ["V2_H", "V2_D", "V2_A"]),
        (
            "Baseline",
            ["Baseline_H", "Baseline_D", "Baseline_A"]
        ),
    ]:
        accuracy, brier, log_loss = calculate_metrics(
            actual,
            df[columns].to_numpy()
        )

        print(
            f"{name:<12}"
            f"{accuracy:>11.2%}"
            f"{brier:>12.4f}"
            f"{log_loss:>12.4f}"
        )

    OUTPUT_PATH.parent.mkdir(
        parents=True, exist_ok=True
    )

    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\nResults saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()