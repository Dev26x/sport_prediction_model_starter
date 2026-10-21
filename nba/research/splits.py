"""Chronological split helpers for leakage-safe NBA research."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import pandas as pd


def toronto_day(value) -> pd.Timestamp:
    """Return a timezone-naive Toronto calendar day."""
    stamp = pd.Timestamp(value)
    if pd.isna(stamp):
        raise ValueError("Date/cutoff cannot be missing.")
    if stamp.tzinfo is not None:
        stamp = stamp.tz_convert("America/Toronto").tz_localize(None)
    return stamp.normalize()


def strict_history(frame: pd.DataFrame, cutoff, *, day_col: str = "day", start=None) -> pd.DataFrame:
    """Return rows strictly before the Toronto cutoff day.

    Same-day rows are excluded even if their clock time is earlier. This matches
    the existing B0 NBA historical convention and prevents same-day result
    ordering from becoming an implicit feature. Naive values are already local
    Toronto dates (as returned by B0 load_games); aware values are converted.
    """
    if day_col not in frame:
        raise ValueError(f"Missing day column: {day_col}")
    cutoff_day = toronto_day(cutoff)
    days = pd.Series(
        [toronto_day(value) for value in frame[day_col]],
        index=frame.index,
        dtype="datetime64[ns]",
    )
    mask = days < cutoff_day
    if start is not None:
        mask &= days >= toronto_day(start)
    return frame.loc[mask].copy()


@dataclass(frozen=True)
class SeasonFold:
    fold_id: str
    train_seasons: tuple[int, ...]
    validation_season: int

    def __post_init__(self) -> None:
        if not self.fold_id:
            raise ValueError("fold_id must be non-empty.")
        if not self.train_seasons:
            raise ValueError("A fold needs at least one training season.")
        if tuple(sorted(set(self.train_seasons))) != self.train_seasons:
            raise ValueError("train_seasons must be unique and ascending.")
        if max(self.train_seasons) >= self.validation_season:
            raise ValueError("Training seasons must be strictly earlier than validation season.")


def _seasons(values: Iterable[int]) -> list[int]:
    seasons = sorted({int(value) for value in values})
    if len(seasons) < 2:
        raise ValueError("At least two seasons are required.")
    return seasons


def expanding_season_folds(
    seasons: Iterable[int],
    *,
    min_train_seasons: int = 3,
    validation_seasons: Sequence[int] | None = None,
) -> list[SeasonFold]:
    ordered = _seasons(seasons)
    if min_train_seasons < 1 or min_train_seasons >= len(ordered):
        raise ValueError("min_train_seasons must leave at least one validation season.")
    allowed = set(map(int, validation_seasons)) if validation_seasons is not None else None
    folds = []
    for index in range(min_train_seasons, len(ordered)):
        validation = ordered[index]
        if allowed is not None and validation not in allowed:
            continue
        folds.append(
            SeasonFold(
                fold_id=f"expanding-{validation}",
                train_seasons=tuple(ordered[:index]),
                validation_season=validation,
            )
        )
    if not folds:
        raise ValueError("No expanding folds match the requested validation seasons.")
    return folds


def rolling_season_folds(
    seasons: Iterable[int],
    *,
    window: int,
    validation_seasons: Sequence[int] | None = None,
) -> list[SeasonFold]:
    ordered = _seasons(seasons)
    if window < 1 or window >= len(ordered):
        raise ValueError("window must leave at least one validation season.")
    allowed = set(map(int, validation_seasons)) if validation_seasons is not None else None
    folds = []
    for index in range(window, len(ordered)):
        validation = ordered[index]
        if allowed is not None and validation not in allowed:
            continue
        folds.append(
            SeasonFold(
                fold_id=f"rolling-{window}y-{validation}",
                train_seasons=tuple(ordered[index - window:index]),
                validation_season=validation,
            )
        )
    if not folds:
        raise ValueError("No rolling folds match the requested validation seasons.")
    return folds


def apply_season_fold(
    frame: pd.DataFrame, fold: SeasonFold, *, season_col: str = "season"
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if season_col not in frame:
        raise ValueError(f"Missing season column: {season_col}")
    seasons = pd.to_numeric(frame[season_col], errors="raise").astype(int)
    train = frame.loc[seasons.isin(fold.train_seasons)].copy()
    validation = frame.loc[seasons.eq(fold.validation_season)].copy()
    if train.empty or validation.empty:
        raise ValueError(f"Fold {fold.fold_id} has empty train or validation data.")
    if int(pd.to_numeric(train[season_col]).max()) >= int(pd.to_numeric(validation[season_col]).min()):
        raise ValueError("Temporal fold overlaps or is out of order.")
    return train, validation
