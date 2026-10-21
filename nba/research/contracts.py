"""Stable, timestamp-aware contracts for NBA research artifacts."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from math import isfinite
from typing import Any, Mapping


def _parse_aware(value: str, field_name: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty ISO-8601 timestamp.")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"{field_name} must be a valid ISO-8601 timestamp.") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone.")
    return parsed


def _optional_text(value: str | None, field_name: str) -> None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise ValueError(f"{field_name} must be None or a non-empty string.")


def _optional_finite(value: float | None, field_name: str) -> None:
    if value is not None and (isinstance(value, bool) or not isfinite(float(value))):
        raise ValueError(f"{field_name} must be finite when supplied.")


def _json_safe_feature(value: Any, name: str) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError(f"Feature {name!r} must not contain NaN or infinity.")
        return
    raise ValueError(
        f"Feature {name!r} must be a scalar string, bool, int, finite float, or None."
    )


@dataclass(frozen=True)
class PredictionRecord:
    """One immutable pregame model prediction.

    `decision_cutoff` is the latest information time the model is allowed to use.
    `generated_at` may be slightly later than that cutoff, but it must still be
    before the event starts.
    """

    prediction_id: str
    game_id: str
    model_id: str
    model_version: str
    feature_set_id: str
    generated_at: str
    decision_cutoff: str
    event_start: str
    home_team_id: str
    away_team_id: str
    home_win_probability: float | None = None
    expected_home_margin: float | None = None
    expected_home_points: float | None = None
    expected_away_points: float | None = None
    expected_total: float | None = None
    calibration_id: str | None = None
    injury_snapshot_id: str | None = None
    lineup_snapshot_id: str | None = None
    odds_snapshot_id: str | None = None

    def __post_init__(self) -> None:
        for name in (
            "prediction_id",
            "game_id",
            "model_id",
            "model_version",
            "feature_set_id",
            "home_team_id",
            "away_team_id",
        ):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty string.")

        if self.home_team_id == self.away_team_id:
            raise ValueError("A prediction requires different home and away teams.")

        generated = _parse_aware(self.generated_at, "generated_at")
        cutoff = _parse_aware(self.decision_cutoff, "decision_cutoff")
        start = _parse_aware(self.event_start, "event_start")
        if cutoff > generated:
            raise ValueError("decision_cutoff cannot be later than generated_at.")
        if generated >= start:
            raise ValueError("Pregame predictions must be generated before event_start.")

        if self.home_win_probability is not None:
            p = float(self.home_win_probability)
            if not isfinite(p) or not 0 <= p <= 1:
                raise ValueError("home_win_probability must be within [0, 1].")

        for name in (
            "expected_home_margin",
            "expected_home_points",
            "expected_away_points",
            "expected_total",
        ):
            _optional_finite(getattr(self, name), name)

        for name in (
            "calibration_id",
            "injury_snapshot_id",
            "lineup_snapshot_id",
            "odds_snapshot_id",
        ):
            _optional_text(getattr(self, name), name)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class FeatureRow:
    """Feature snapshot for one game at one decision cutoff."""

    game_id: str
    decision_cutoff: str
    feature_set_id: str
    home_team_id: str
    away_team_id: str
    feature_observed_at: str
    features: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("game_id", "feature_set_id", "home_team_id", "away_team_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty string.")
        if self.home_team_id == self.away_team_id:
            raise ValueError("Feature rows require different home and away teams.")

        cutoff = _parse_aware(self.decision_cutoff, "decision_cutoff")
        observed = _parse_aware(self.feature_observed_at, "feature_observed_at")
        if observed > cutoff:
            raise ValueError(
                "Feature data observed after decision_cutoff would create look-ahead leakage."
            )
        if not isinstance(self.features, Mapping):
            raise ValueError("features must be a mapping.")
        for name, value in self.features.items():
            if not isinstance(name, str) or not name:
                raise ValueError("Feature names must be non-empty strings.")
            _json_safe_feature(value, name)

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["features"] = dict(self.features)
        return result
