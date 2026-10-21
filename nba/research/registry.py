"""Append-only experiment registry for NBA model research."""

from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
from datetime import datetime
import json
from math import isfinite
from pathlib import Path
import re
from typing import Any


STATUSES = {"planned", "running", "completed", "rejected", "promoted"}

COLUMNS = [
    "experiment_id",
    "created_at",
    "git_commit",
    "dataset_version",
    "training_window_id",
    "feature_set_id",
    "model_id",
    "model_version",
    "hyperparameter_json",
    "calibration_method",
    "train_start",
    "train_end",
    "validation_start",
    "validation_end",
    "games",
    "accuracy",
    "brier",
    "log_loss",
    "margin_mae",
    "margin_rmse",
    "calibration_error",
    "notes",
    "artifact_path",
    "status",
]


def _aware_timestamp(value: str) -> None:
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError("created_at must be valid ISO-8601.") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("created_at must include a timezone.")


def _metric(value, name: str):
    if value is None:
        return None
    number = float(value)
    if not isfinite(number):
        raise ValueError(f"{name} must be finite when supplied.")
    return number


@dataclass(frozen=True)
class ExperimentRecord:
    experiment_id: str
    created_at: str
    git_commit: str
    dataset_version: str
    training_window_id: str
    feature_set_id: str
    model_id: str
    model_version: str
    hyperparameters: dict[str, Any]
    calibration_method: str
    train_start: str
    train_end: str
    validation_start: str
    validation_end: str
    games: int | None
    accuracy: float | None
    brier: float | None
    log_loss: float | None
    margin_mae: float | None
    margin_rmse: float | None
    calibration_error: float | None
    notes: str
    artifact_path: str
    status: str

    def __post_init__(self) -> None:
        required = (
            "experiment_id",
            "git_commit",
            "dataset_version",
            "training_window_id",
            "feature_set_id",
            "model_id",
            "model_version",
            "calibration_method",
            "train_start",
            "train_end",
            "validation_start",
            "validation_end",
            "artifact_path",
            "status",
        )
        for name in required:
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty string.")
        _aware_timestamp(self.created_at)
        if not re.fullmatch(r"[0-9a-fA-F]{7,40}", self.git_commit):
            raise ValueError("git_commit must be a 7-40 character hexadecimal Git SHA.")
        if self.status not in STATUSES:
            raise ValueError(f"status must be one of {sorted(STATUSES)}.")
        if not isinstance(self.hyperparameters, dict):
            raise ValueError("hyperparameters must be a dict.")
        if self.games is not None and (isinstance(self.games, bool) or int(self.games) < 1):
            raise ValueError("games must be a positive integer when supplied.")
        for name in (
            "accuracy",
            "brier",
            "log_loss",
            "margin_mae",
            "margin_rmse",
            "calibration_error",
        ):
            _metric(getattr(self, name), name)

    def to_row(self) -> dict[str, str]:
        source = asdict(self)
        source["hyperparameter_json"] = json.dumps(
            source.pop("hyperparameters"),
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        row = {}
        for column in COLUMNS:
            value = source[column]
            if value is None:
                row[column] = ""
            elif isinstance(value, float):
                row[column] = repr(value)
            else:
                row[column] = str(value)
        return row


class ExperimentRegistry:
    """CSV registry with one immutable row per experiment ID.

    Writers use an exclusive sibling lock directory and fail rather than wait
    if another writer is active. After a process crash, inspect the CSV and
    remove a stale lock only after confirming that no writer is running.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def rows(self) -> list[dict[str, str]]:
        if not self.path.exists():
            return []
        with self.path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != COLUMNS:
                raise ValueError("Experiment registry schema does not match the expected columns.")
            return list(reader)

    def append(self, record: ExperimentRecord) -> None:
        row = record.to_row()  # Reject unserializable config before touching disk.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_name(self.path.name + ".lock")
        lock.mkdir(exist_ok=False)
        try:
            existing = self.rows()
            if any(item["experiment_id"] == record.experiment_id for item in existing):
                raise ValueError(
                    f"Experiment {record.experiment_id!r} already exists; completed/rejected runs are immutable."
                )
            new_file = not self.path.exists()
            with self.path.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="raise")
                if new_file:
                    writer.writeheader()
                writer.writerow(row)
        finally:
            lock.rmdir()

    def get(self, experiment_id: str) -> dict[str, str]:
        matches = [row for row in self.rows() if row["experiment_id"] == experiment_id]
        if len(matches) != 1:
            raise KeyError(experiment_id)
        return matches[0]
