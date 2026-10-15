"""Run from the parent project: python -m nba --help."""

import argparse
import json

from .config import TARGET_YEAR, local_today
from .http_client import DataAccessError


def main():
    parser = argparse.ArgumentParser(description="NBA team/player forecasting and roster analysis")
    commands = parser.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync", help="Download public four-season data and current roster snapshots")
    sync.add_argument("--as-of", default=local_today())
    sync.add_argument("--target-year", type=int, default=TARGET_YEAR)
    sync.add_argument("--workers", type=int, default=4)
    sync.add_argument("--refresh", action="store_true")
    commands.add_parser("connection", help="Validate the locally configured direct TheRundown key")
    prices = commands.add_parser("rundown-events", help="Save a bounded current event/optional moneyline snapshot")
    prices.add_argument("--date", required=True)
    prices.add_argument("--books", type=int, nargs="+")
    build = commands.add_parser("build", help="Fit team/player models and create season preparation reports")
    build.add_argument("--as-of", default=local_today())
    build.add_argument("--target-year", type=int, default=TARGET_YEAR)
    commands.add_parser("backtest", help="Run the historical team-model calibration/test split")
    forecast = commands.add_parser("forecast", help="Forecast a home/away matchup")
    forecast.add_argument("home")
    forecast.add_argument("away")
    forecast.add_argument("--date", required=True)
    forecast.add_argument("--as-of", default=local_today())
    forecast.add_argument("--spread", type=float, help="Home handicap, e.g. -4.5")
    forecast.add_argument("--team-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "sync":
            from .ingest import sync_public
            sync_public(args.as_of, args.target_year, args.workers, args.refresh)
        elif args.command == "connection":
            from .rundown import RundownClient
            print(json.dumps(RundownClient(refresh=True).connection_status(), indent=2))
        elif args.command == "rundown-events":
            from .rundown import RundownClient
            print(json.dumps(RundownClient(refresh=True).snapshot_events(args.date, args.books), indent=2))
        elif args.command == "build":
            from .reporting import build_reports
            print(json.dumps(build_reports(args.as_of, args.target_year), indent=2))
        elif args.command == "backtest":
            from .backtest import run_backtest
            print(json.dumps(run_backtest(), indent=2))
        elif args.command == "forecast":
            from .reporting import forecast_fixture
            print(json.dumps(forecast_fixture(args.home, args.away, args.date, args.as_of, args.spread, args.team_only), indent=2))
    except (DataAccessError, ValueError, OSError, KeyError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
