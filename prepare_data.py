"""Merge the existing season files into a validated master dataset."""

import argparse
from pathlib import Path

import pandas as pd

from data_utils import ROOT, today, validate_matches


SEASONS = {
    "2024-25": "E0_2425.csv",
    "2025-26": "E0_2526.csv",
    "2026-27": "E0_2627.csv",
}


def prepare_data(data_dir=ROOT / "data", as_of=None):
    datasets = []
    for season, filename in SEASONS.items():
        frame = pd.read_csv(Path(data_dir) / filename)
        frame["Season"] = season
        datasets.append(frame)
    return validate_matches(pd.concat(datasets, ignore_index=True), as_of=as_of)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--as-of", default=today().date().isoformat())
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        matches = prepare_data(args.data_dir, as_of=args.as_of)
        if matches.empty:
            raise ValueError("No completed matches on or before the as-of date.")
    except (ValueError, OSError) as error:
        parser.error(str(error))
    output = args.output or args.data_dir / "premier_league_master.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    matches.to_csv(output, index=False)
    print(matches.groupby("Season").size().to_string())
    print(f"\nTotal: {len(matches)} matches | {matches.Date.min().date()} to {matches.Date.max().date()}")
    print(f"As of: {args.as_of} | Saved to: {output}")


if __name__ == "__main__":
    main()
