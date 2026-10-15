"""Join timestamped, two-sided moneylines to current model forecasts."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .config import DATA, REPORTS


ALIASES = {"NYK": "NY", "GSW": "GS", "SAS": "SA", "NOP": "NO", "WAS": "WSH", "UTA": "UTAH", "PHO": "PHX"}


def american_to_decimal(price):
    price = float(price)
    if not np.isfinite(price) or abs(price) < 100:
        raise ValueError("Off-board, missing, or invalid American odds.")
    return 1 + price / 100 if price > 0 else 1 + 100 / abs(price)


def normalize_moneylines(snapshot, teams):
    observed = pd.Timestamp(snapshot["fetched_at"])
    if observed.tzinfo is None:
        raise ValueError("Odds observation timestamp must include a timezone.")
    identifiers = teams.set_index("team").team_id.to_dict()
    records, skipped = [], []
    for event in snapshot["data"].get("events", []):
        sides = {}
        for team in event.get("teams", []):
            side = "home" if team.get("is_home") else "away" if team.get("is_away") else None
            abbreviation = ALIASES.get(team.get("abbreviation"), team.get("abbreviation"))
            if side and abbreviation in identifiers:
                sides[side] = {"provider_id": str(team["team_id"]), "team_id": str(identifiers[abbreviation])}
        if set(sides) != {"home", "away"}:
            skipped.append({"event_id": event.get("event_id"), "reason": "team identity unavailable"})
            continue
        start = pd.Timestamp(event["event_date"])
        if start.tzinfo is None or start <= observed:
            skipped.append({"event_id": event.get("event_id"), "reason": "not a future event at observation time"})
            continue
        by_book = {}
        for market in event.get("markets", []):
            if market.get("market_id") != 1 or market.get("period_id") != 0:
                continue
            for participant in market.get("participants", []):
                if participant.get("type") != "TYPE_TEAM":
                    continue
                matches = [side for side, value in sides.items() if value["provider_id"] == str(participant.get("id"))]
                if len(matches) != 1:
                    continue
                side = matches[0]
                for line in participant.get("lines", []):
                    for affiliate, quote in line.get("prices", {}).items():
                        try:
                            odds = american_to_decimal(quote["price"])
                            updated = pd.Timestamp(quote["updated_at"])
                            if updated.tzinfo is None or pd.isna(updated) or updated > observed or quote.get("closed_at"):
                                continue
                        except (KeyError, ValueError, TypeError):
                            continue
                        entry = {"decimal_odds": odds, "american_odds": quote["price"], "price_updated_at": updated.isoformat()}
                        existing = by_book.setdefault(str(affiliate), {}).get(side)
                        if existing and existing != entry:
                            raise ValueError("Multiple different moneylines for one team and sportsbook; refusing an ambiguous selection.")
                        by_book[str(affiliate)][side] = entry
        for affiliate, pair in by_book.items():
            if set(pair) != {"home", "away"}:
                continue
            home_inverse = 1 / pair["home"]["decimal_odds"]
            away_inverse = 1 / pair["away"]["decimal_odds"]
            records.append({"provider_event_id": event["event_id"], "event_date": start.isoformat(),
                            "home_team_id": sides["home"]["team_id"], "away_team_id": sides["away"]["team_id"],
                            "affiliate_id": affiliate, "observed_at": observed.isoformat(),
                            "market_home_probability": home_inverse / (home_inverse + away_inverse),
                            "overround": home_inverse + away_inverse - 1,
                            **{f"{side}_{key}": value for side in ("home", "away") for key, value in pair[side].items()}})
    return pd.DataFrame(records), skipped


def compare_market(snapshot_path):
    snapshot_path = Path(snapshot_path)
    snapshot = json.loads(snapshot_path.read_text())
    teams = pd.read_csv(DATA / "teams.csv", dtype={"team_id": str})
    quotes, skipped = normalize_moneylines(snapshot, teams)
    if quotes.empty:
        raise ValueError("No complete, valid two-sided upcoming moneylines in this snapshot.")
    forecasts = pd.read_csv(REPORTS / "schedule_forecasts.csv", dtype={"home_team_id": str, "away_team_id": str})
    metadata = json.loads((REPORTS / "model_state.json").read_text())
    observation_day = pd.Timestamp(snapshot["fetched_at"]).tz_convert("America/Toronto").date()
    if pd.Timestamp(metadata["as_of"]).date() > observation_day:
        raise ValueError("The model snapshot postdates these odds; refusing a look-ahead comparison.")
    if pd.Timestamp(metadata["latest_feature_snapshot_at"]) > pd.Timestamp(snapshot["fetched_at"]):
        raise ValueError("Roster/depth-chart inputs postdate the odds observation; fetch a new bounded odds snapshot before comparing.")
    quotes["join_day"] = pd.to_datetime(quotes.event_date, utc=True).dt.tz_convert("America/Toronto").dt.date
    forecasts["join_day"] = pd.to_datetime(forecasts.date, utc=True).dt.tz_convert("America/Toronto").dt.date
    joined = quotes.merge(forecasts, on=["home_team_id", "away_team_id", "join_day"], how="left", validate="many_to_one", indicator=True)
    matched = joined.loc[joined._merge.eq("both")].copy()
    if matched.empty:
        raise ValueError("Provider events do not match any published NBA schedule fixtures.")
    starts = pd.to_datetime(matched.event_date, utc=True)
    schedule_starts = pd.to_datetime(matched.date, utc=True)
    if ((starts - schedule_starts).abs() > pd.Timedelta(hours=3)).any():
        raise ValueError("Provider and schedule start times disagree materially.")
    matched["team_only_probability_difference"] = matched.team_only_home_win - matched.market_home_probability
    matched["experimental_roster_probability_difference"] = matched.roster_adjusted_home_win - matched.market_home_probability
    private = DATA / "private"
    private.mkdir(parents=True, exist_ok=True)
    output = private / "market_comparison.csv"
    matched.drop(columns=["_merge", "join_day"]).to_csv(output, index=False)
    return {"output": str(output), "matched_event_books": len(matched), "matched_events": int(matched.provider_event_id.nunique()),
            "unmatched_event_books": int(joined._merge.eq("left_only").sum()), "skipped": skipped,
            "note": "Research probability comparison only. Quote timestamps describe the provider record; freshness and execution are not guaranteed. Roster adjustments are unvalidated."}
