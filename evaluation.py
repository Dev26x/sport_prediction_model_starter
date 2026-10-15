"""Proper scoring rules, temporal calibration, and paired comparisons."""

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp


OUTCOMES = ("H", "D", "A")


def probability_array(probabilities):
    array = np.asarray(probabilities, dtype=float)
    if array.ndim != 2 or array.shape[1] != 3 or len(array) == 0:
        raise ValueError("Expected a nonempty N by 3 probability array (H, D, A).")
    if not np.isfinite(array).all() or (array < 0).any() or (array > 1).any():
        raise ValueError("Probabilities must be finite and between zero and one.")
    if not np.allclose(array.sum(axis=1), 1, atol=1e-8, rtol=0):
        raise ValueError("Each probability row must sum to one.")
    return array


def outcome_indices(actual):
    try:
        return np.array([OUTCOMES.index(value) for value in actual], dtype=int)
    except ValueError as error:
        raise ValueError("Actual outcomes must be H, D, or A.") from error


def log_losses(actual, probabilities):
    array = probability_array(probabilities)
    indices = outcome_indices(actual)
    if len(indices) != len(array):
        raise ValueError("Outcomes and probabilities must have equal lengths.")
    return -np.log(np.clip(array[np.arange(len(array)), indices], 1e-12, 1))


def calculate_metrics(actual, probabilities):
    array = probability_array(probabilities)
    losses = log_losses(actual, array)
    indices = outcome_indices(actual)
    return {
        "matches": len(array),
        "accuracy": float(np.mean(array.argmax(axis=1) == indices)),
        "brier": float(np.mean(np.sum((array - np.eye(3)[indices]) ** 2, axis=1))),
        "log_loss": float(losses.mean()),
    }


def apply_temperature(probabilities, temperature):
    array = probability_array(probabilities)
    if not np.isfinite(temperature) or temperature <= 0:
        raise ValueError("Temperature must be finite and positive.")
    if temperature == 1:
        return array.copy()
    logits = np.log(np.clip(array, 1e-12, 1)) / temperature
    return np.exp(logits - logsumexp(logits, axis=1, keepdims=True))


def fit_temperature(actual, probabilities, min_matches=100):
    array = probability_array(probabilities)
    identity_loss = float(log_losses(actual, array).mean())
    if min_matches < 1:
        raise ValueError("Calibration requires a positive minimum sample size.")
    if len(array) < min_matches:
        return 1.0, "insufficient_calibration_matches"
    optimum = minimize_scalar(
        lambda value: log_losses(actual, apply_temperature(array, value)).mean(),
        bounds=(0.5, 3.0),
        method="bounded",
    )
    if not optimum.success:
        raise RuntimeError("Temperature fitting failed.")
    if optimum.fun >= identity_loss:
        return 1.0, "identity_has_lower_calibration_loss"
    return float(optimum.x), "fitted"


def market_probabilities(frame, columns=("B365CH", "B365CD", "B365CA")):
    """Proportional overround removal; require all three valid decimal odds."""
    odds = frame.reindex(columns=list(columns)).apply(pd.to_numeric, errors="coerce")
    values = odds.to_numpy(dtype=float)
    valid = np.isfinite(values).all(axis=1) & (values > 1).all(axis=1)
    probabilities = np.full(values.shape, np.nan)
    inverse = 1 / values[valid]
    probabilities[valid] = inverse / inverse.sum(axis=1, keepdims=True)
    return probabilities, valid


def reliability_bins(actual, probabilities, bins=10):
    array = probability_array(probabilities)
    observed = np.eye(3)[outcome_indices(actual)]
    if len(observed) != len(array):
        raise ValueError("Outcomes and probabilities must have equal lengths.")
    records = []
    for index, outcome in enumerate(OUTCOMES):
        assignment = np.minimum((array[:, index] * bins).astype(int), bins - 1)
        for number in range(bins):
            mask = assignment == number
            records.append({
                "outcome": outcome,
                "bin_lower": number / bins,
                "bin_upper": (number + 1) / bins,
                "matches": int(mask.sum()),
                "mean_probability": float(array[mask, index].mean()) if mask.any() else None,
                "observed_frequency": float(observed[mask, index].mean()) if mask.any() else None,
            })
    return records


def paired_log_loss_comparison(actual, first, second, dates, samples=2000, seed=42):
    """Resample whole match dates; negative differences favor the first model."""
    difference = log_losses(actual, first) - log_losses(actual, second)
    dates = pd.to_datetime(list(dates), errors="raise").normalize()
    if len(dates) != len(difference) or dates.isna().any():
        raise ValueError("Every paired forecast must have a valid match date.")
    grouped = pd.DataFrame({"date": dates, "difference": difference}).groupby("date")
    totals = grouped["difference"].sum().to_numpy()
    counts = grouped.size().to_numpy()
    output = {
        "matches": len(difference),
        "match_dates": len(totals),
        "mean_log_loss_difference": float(difference.mean()),
        "interval_95": None,
    }
    if len(totals) > 1:
        rng = np.random.default_rng(seed)
        draws = rng.integers(0, len(totals), size=(samples, len(totals)))
        bootstrap = totals[draws].sum(axis=1) / counts[draws].sum(axis=1)
        output["interval_95"] = np.quantile(bootstrap, [0.025, 0.975]).tolist()
    return output
