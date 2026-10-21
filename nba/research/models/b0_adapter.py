"""Adapter that exposes the frozen B0 ridge-margin model to research code.

The adapter deliberately imports the existing model lazily. PR1 does not change
`nba/model.py`, `nba/backtest.py`, or the stored B0 artifacts.
"""

from __future__ import annotations

import json
from math import isclose, isfinite
from pathlib import Path
from typing import Any

from ..artifacts import canonical_json_sha256


NBA_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_PATH = Path(__file__).resolve().parents[1] / "baselines" / "b0_reference.json"


def load_b0_reference(path: str | Path = REFERENCE_PATH) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _invariants_from_artifact(artifact: dict[str, Any], reference: dict[str, Any]) -> dict[str, Any]:
    calibrated = artifact["metrics"]["team_calibrated"]
    return {
        "model_id": reference["model_id"],
        "test_season": artifact["seasons"]["test"],
        "test_games": artifact["test_games"],
        "accuracy": calibrated["accuracy"],
        "brier": calibrated["brier"],
        "log_loss": calibrated["log_loss"],
        "margin_mae": calibrated["margin_mae"],
        "margin_rmse": calibrated["margin_rmse"],
        "sigma_scale": artifact["calibration"]["sigma_scale"],
    }


def verify_b0_reference(
    *,
    reference_path: str | Path = REFERENCE_PATH,
    artifact_path: str | Path | None = None,
    tolerance: float = 1e-12,
) -> dict[str, Any]:
    """Verify stored B0 results against immutable reference invariants."""
    reference = load_b0_reference(reference_path)
    artifact_path = Path(artifact_path) if artifact_path is not None else NBA_ROOT / "reports" / "backtest.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    actual = _invariants_from_artifact(artifact, reference)

    for key in (
        "model_id",
        "test_season",
        "test_games",
    ):
        if actual[key] != reference[key]:
            raise ValueError(f"B0 reference mismatch for {key}: {actual[key]!r} != {reference[key]!r}")

    for key in (
        "accuracy",
        "brier",
        "log_loss",
        "margin_mae",
        "margin_rmse",
        "sigma_scale",
    ):
        if not isclose(float(actual[key]), float(reference[key]), rel_tol=0.0, abs_tol=tolerance):
            raise ValueError(f"B0 reference mismatch for {key}: {actual[key]!r} != {reference[key]!r}")

    if artifact.get("data_sha256") != reference["games_data_sha256"]:
        raise ValueError("B0 games data hash no longer matches the frozen reference.")

    fingerprint = canonical_json_sha256(actual)
    if fingerprint != reference["invariant_sha256"]:
        raise ValueError("B0 invariant fingerprint no longer matches the frozen reference.")
    return {
        "verified": True,
        "model_id": reference["model_id"],
        "artifact": str(artifact_path),
        "invariant_sha256": fingerprint,
    }


class B0Adapter:
    """Research-facing wrapper around the existing team ridge model.

    Probability calibration is explicit. The adapter defaults to raw B0
    (`probability_scale=1.0`) so future experiments cannot silently reuse a
    calibration parameter fitted on a different evaluation period.
    """

    model_id = "B0-RIDGE-MARGIN"
    model_version = "1"

    def __init__(self, *, config=None, probability_scale: float = 1.0):
        if not isfinite(probability_scale) or probability_scale <= 0:
            raise ValueError("probability_scale must be positive and finite.")
        self.config = config
        self.probability_scale = float(probability_scale)
        self._model = None

    def fit(self, games, before):
        from nba.config import ModelConfig
        from nba.model import fit_team_model

        config = self.config or ModelConfig()
        self._model = fit_team_model(games, before, config)
        return self

    def predict(self, home_team_id: str, away_team_id: str, day, *, neutral: bool = False) -> dict:
        if self._model is None:
            raise ValueError("Call fit() before predict().")
        raw = self._model.forecast(
            home_team_id,
            away_team_id,
            day,
            roster_adjustments=None,
            sigma_scale=self.probability_scale,
            neutral=neutral,
        )
        return {
            "model_id": self.model_id,
            "model_version": self.model_version,
            "home_team_id": raw["home_team_id"],
            "away_team_id": raw["away_team_id"],
            "date": raw["date"],
            "home_win_probability": raw["home_win"],
            "expected_home_margin": raw["expected_home_margin"],
            "margin_sd": raw["margin_sd"],
            "history_games": raw["history_games"],
            "last_training_result": raw["last_training_result"],
            "probability_scale": raw["win_probability_scale"],
        }

    @staticmethod
    def frozen_reference_probability_scale() -> float:
        """Return the historical 2024-25-fitted scale for reference checks only."""
        return float(load_b0_reference()["sigma_scale"])
