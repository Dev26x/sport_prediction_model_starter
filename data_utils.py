"""Shared validation for completed, date-level match data."""

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "premier_league_master.csv"
REQUIRED_COLUMNS = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]


def today():
    return pd.Timestamp(datetime.now(ZoneInfo("America/Toronto")).date())


def match_dates(values):
    """Read ISO master dates and day-first source dates without ambiguity."""
    strings = values.astype("string").str.strip()
    iso = strings.str.match(r"^\d{4}-\d{2}-\d{2}", na=False)
    parsed = pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns]")
    parsed.loc[iso] = pd.to_datetime(
        strings.loc[iso], format="ISO8601", errors="coerce"
    )
    parsed.loc[~iso] = pd.to_datetime(
        strings.loc[~iso], format="mixed", dayfirst=True, errors="coerce"
    )
    return parsed.dt.normalize()


def validate_matches(matches, as_of=None):
    """Reject malformed completed records; ignore unfinished/future fixtures."""
    missing = set(REQUIRED_COLUMNS) - set(matches.columns)
    if missing:
        raise ValueError(f"Missing columns: {', '.join(sorted(missing))}")
    frame = matches.dropna(subset=["FTHG", "FTAG"]).copy()
    frame["Date"] = match_dates(frame["Date"])
    if frame["Date"].isna().any():
        raise ValueError("Completed matches contain invalid or missing dates.")
    cutoff = today() if as_of is None else pd.Timestamp(as_of).normalize()
    if pd.isna(cutoff):
        raise ValueError("The as-of date must be valid.")
    frame = frame.loc[frame["Date"] <= cutoff].copy()
    for column in ("HomeTeam", "AwayTeam"):
        frame[column] = frame[column].astype("string").str.strip()
        if (frame[column].isna() | frame[column].eq("")).any():
            raise ValueError(f"Completed matches contain a missing {column}.")
    if frame["HomeTeam"].eq(frame["AwayTeam"]).any():
        raise ValueError("A team cannot play itself.")
    for column in ("FTHG", "FTAG"):
        values = pd.to_numeric(frame[column], errors="coerce")
        if (~np.isfinite(values) | values.lt(0) | values.mod(1).ne(0)).any():
            raise ValueError(f"{column} must contain nonnegative integer goals.")
        frame[column] = values.astype(int)
    keys = ["Date", "HomeTeam", "AwayTeam"]
    duplicate_rows = frame.loc[frame.duplicated(keys, keep=False)]
    if not duplicate_rows.empty:
        conflicts = duplicate_rows.groupby(keys)[["FTHG", "FTAG"]].nunique()
        if conflicts.gt(1).any().any():
            raise ValueError("Duplicate fixtures contain conflicting scores.")
        conflicts = duplicate_rows.groupby(keys).nunique(dropna=False)
        if conflicts.gt(1).any().any():
            raise ValueError("Duplicate fixtures contain conflicting source data.")
        frame = frame.drop_duplicates(keys)
    return frame.sort_values(keys, kind="stable").reset_index(drop=True)


def load_matches(csv_path=DATA_PATH, as_of=None):
    return validate_matches(pd.read_csv(csv_path), as_of=as_of)
