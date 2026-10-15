"""Download four seasons of results, career box totals, and dated rosters."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import re

import numpy as np
import pandas as pd

from .config import DATA, HISTORY_YEARS, TARGET_YEAR, local_today, season_label
from .http_client import DataAccessError, JsonClient


SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
CAREER = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes"


def parallel_map(function, values, workers=4):
    results, failures = [], []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        tasks = {executor.submit(function, value): value for value in values}
        for index, task in enumerate(as_completed(tasks), 1):
            try:
                results.append((tasks[task], task.result()))
            except (DataAccessError, ValueError, KeyError) as error:
                failures.append({"item": str(tasks[task]), "error": str(error)})
            if index % 50 == 0 or index == len(tasks):
                print(f"  {index}/{len(tasks)} requests processed; {len(failures)} failures", flush=True)
    return results, failures


def parse_event(event, season_year, season_type):
    competition = event["competitions"][0]
    competitors = {row["homeAway"]: row for row in competition["competitors"]}
    home, away = competitors["home"], competitors["away"]
    actual_year = event.get("season", {}).get("year", season_year)
    actual_type = event.get("seasonType", {}).get("type", event.get("season", {}).get("type", season_type))
    if int(actual_year) != season_year or int(actual_type) != season_type:
        raise ValueError("The source returned a different event season or season type.")
    status = competition.get("status", event.get("status", {})).get("type", {})
    completed = bool(status.get("completed", False))

    def score(row):
        value = row.get("score")
        return float(value.get("value")) if isinstance(value, dict) else float(value) if value is not None else np.nan

    return {
        "game_id": str(event["id"]),
        "date": event["date"],
        "season": season_year,
        "season_type": season_type,
        "home_team_id": str(home["id"]),
        "away_team_id": str(away["id"]),
        "home_team": home["team"]["abbreviation"],
        "away_team": away["team"]["abbreviation"],
        "home_points": score(home) if completed else np.nan,
        "away_points": score(away) if completed else np.nan,
        "completed": completed,
        "neutral": bool(competition.get("neutralSite", False)),
    }


def parse_career(player_id, payload, names, years=HISTORY_YEARS):
    averages, totals = {}, {}
    for category in payload.get("categories", []):
        if category.get("name") not in ("averages", "totals"):
            continue
        target = averages if category["name"] == "averages" else totals
        for row in category.get("statistics", []):
            year = row.get("season", {}).get("year")
            if year not in years:
                continue
            key = (year, str(row.get("teamId", "0")))
            if key in target:
                raise ValueError(f"Duplicate career season/team row for player {player_id}.")
            target[key] = dict(zip(category["names"], row["stats"]))
    records = []
    stat_map = {
        "points": "points", "offensiveRebounds": "oreb", "defensiveRebounds": "dreb",
        "assists": "ast", "steals": "stl", "blocks": "blk", "turnovers": "tov",
    }
    pairs = {"fieldGoalsMade-fieldGoalsAttempted": ("fgm", "fga"),
             "freeThrowsMade-freeThrowsAttempted": ("ftm", "fta"),
             "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("fg3m", "fg3a")}
    for key, average in averages.items():
        values = totals.get(key)
        if values is None:
            raise ValueError(f"Missing totals for player {player_id}, {key}.")
        gp = float(average.get("gamesPlayed", 0))
        minutes = float(average.get("avgMinutes", 0)) * gp
        if not gp or not minutes:
            continue
        record = {"player_id": str(player_id), "player_name": names.get(str(player_id), f"Player {player_id}"),
                  "season": key[0], "team_id": key[1], "games": gp, "minutes": minutes,
                  "minutes_precision": "season MPG rounded to 0.1 multiplied by GP"}
        for source, destination in stat_map.items():
            record[destination] = float(values[source])
        for source, destinations in pairs.items():
            made, attempted = str(values[source]).split("-")
            record[destinations[0]], record[destinations[1]] = float(made), float(attempted)
        records.append(record)
    # Traded players can have a combined row in addition to individual stints.
    # Keep actual team stints; the aggregate would double-count their production.
    result = pd.DataFrame(records)
    if result.empty:
        return []
    specific = result.loc[~result.team_id.isin(["0", "-1", ""])]
    combined = result.loc[result.team_id.isin(["0", "-1", ""]) & ~result.season.isin(specific.season)]
    return pd.concat([specific, combined], ignore_index=True).to_dict("records")


def sync_public(as_of=None, target_year=TARGET_YEAR, workers=4, refresh=False):
    as_of = as_of or local_today()
    cutoff = pd.Timestamp(as_of, tz="America/Toronto") + pd.Timedelta(days=1)
    years = tuple(range(target_year - 4, target_year))
    client = JsonClient(DATA / "raw/espn", refresh=refresh)
    DATA.mkdir(parents=True, exist_ok=True)
    teams_payload = client.get(f"{SITE}/teams", {"limit": 1000})
    team_rows = teams_payload["data"]["sports"][0]["leagues"][0]["teams"]
    teams = pd.DataFrame([{"team_id": str(row["team"]["id"]), "team": row["team"]["abbreviation"],
                           "team_name": row["team"]["displayName"]} for row in team_rows])
    if len(teams) != 30:
        raise ValueError(f"Expected 30 NBA teams; source returned {len(teams)}.")
    teams.to_csv(DATA / "teams.csv", index=False)
    print("Downloading historical schedules and current preseason/schedule...", flush=True)
    jobs = [(str(team_id), year, 2) for year in years for team_id in teams.team_id]
    jobs += [(str(team_id), target_year, kind) for kind in (1, 2) for team_id in teams.team_id]

    def schedule(job):
        team_id, year, kind = job
        return client.get(f"{SITE}/teams/{team_id}/schedule", {"season": year, "seasontype": kind})

    schedules, failures = parallel_map(schedule, jobs, workers)
    games, names = [], {}
    for (_, year, kind), snapshot in schedules:
        for event in snapshot["data"].get("events", []):
            games.append(parse_event(event, year, kind))
            for team in event["competitions"][0]["competitors"]:
                for leader in team.get("leaders", []):
                    for entry in leader.get("leaders", []):
                        athlete = entry.get("athlete", {})
                        if athlete.get("id"):
                            names[str(athlete["id"])] = athlete.get("displayName", "")
    if not games:
        raise ValueError("No games were downloaded.")
    games = pd.DataFrame(games)
    duplicates = games.groupby("game_id")[["home_points", "away_points", "home_team_id", "away_team_id"]].nunique()
    if duplicates.gt(1).any().any():
        raise ValueError("Two team schedules disagree on a fixture or its score.")
    games = games.drop_duplicates("game_id").sort_values(["date", "game_id"])
    dates = pd.to_datetime(games.date, utc=True)
    historical = games.loc[games.season.isin(years) & games.season_type.eq(2) & games.completed & dates.lt(cutoff)]
    if historical.empty or (historical.home_points == historical.away_points).any():
        raise ValueError("Historical results are empty or contain final tied NBA scores.")
    historical.to_csv(DATA / "games.csv", index=False)
    games.loc[games.season.eq(target_year) & games.season_type.eq(2)].to_csv(DATA / "schedule.csv", index=False)
    games.loc[games.season.eq(target_year) & games.season_type.eq(1) & games.completed & dates.lt(cutoff)].to_csv(DATA / "preseason.csv", index=False)
    print("Downloading current roster snapshots...", flush=True)
    rosters, roster_failures = parallel_map(lambda team: client.get(f"{SITE}/teams/{team}/roster"), teams.team_id.tolist(), workers)
    failures.extend(roster_failures)
    roster_rows = []
    for team_id, snapshot in rosters:
        payload = snapshot["data"]
        if int(payload.get("season", {}).get("year", 0)) != target_year:
            failures.append({"item": f"roster/{team_id}", "error": "Roster season does not match target."})
            continue
        if not payload.get("athletes"):
            failures.append({"item": f"roster/{team_id}", "error": "Empty roster."})
        for player in payload.get("athletes", []):
            player_id = str(player["id"])
            names[player_id] = player["displayName"]
            injury = player.get("injuries", [])
            roster_rows.append({"snapshot_at": snapshot["fetched_at"], "season": target_year,
                                "team_id": str(team_id), "player_id": player_id, "player_name": player["displayName"],
                                "position": player.get("position", {}).get("abbreviation", ""),
                                "age": player.get("age"), "injury_status": injury[0].get("status", "") if injury else "",
                                "projected_minutes": np.nan, "availability": 1.0,
                                "source_url": snapshot["source_url"]})
    roster = pd.DataFrame(roster_rows)
    if roster.empty:
        raise ValueError("No current rosters available.")
    if roster.duplicated(["player_id"]).any():
        raise ValueError("A player is listed on multiple current NBA rosters.")
    roster.to_csv(DATA / "rosters.csv", index=False)
    archive = DATA / "snapshots" / f"rosters_{as_of}.csv"
    archive.parent.mkdir(parents=True, exist_ok=True)
    roster.to_csv(archive, index=False)
    print("Discovering all athletes in the four historical seasons...", flush=True)
    player_ids = set(roster.player_id)
    for year in years:
        first = client.get(f"{CORE}/seasons/{year}/athletes", {"limit": 1000})["data"]
        pages = [first]
        pages.extend(client.get(f"{CORE}/seasons/{year}/athletes", {"limit": 1000, "page": page})["data"]
                     for page in range(2, int(first.get("pageCount", 1)) + 1))
        for page in pages:
            for player in page.get("items", []):
                match = re.search(r"/athletes/(\d+)", player["$ref"])
                if match:
                    player_ids.add(match.group(1))
    print(f"Downloading career totals for {len(player_ids)} players...", flush=True)
    careers, career_failures = parallel_map(lambda player: client.get(f"{CAREER}/{player}/stats"), sorted(player_ids), workers)
    failures.extend(career_failures)
    player_rows, no_history = [], []
    for player_id, snapshot in careers:
        rows = parse_career(player_id, snapshot["data"], names, years)
        if rows:
            player_rows.extend(rows)
        else:
            no_history.append(player_id)
    players = pd.DataFrame(player_rows)
    if players.empty:
        raise ValueError("No historical player performance data available.")
    players.to_csv(DATA / "player_seasons.csv", index=False)
    game_counts = historical.groupby("season").size().to_dict()
    team_counts = pd.concat([historical[["season", "home_team_id"]].rename(columns={"home_team_id": "team_id"}),
                            historical[["season", "away_team_id"]].rename(columns={"away_team_id": "team_id"})]).groupby(["season", "team_id"]).size()
    quality = {
        "as_of": as_of, "target_season": season_label(target_year), "history_seasons": [season_label(y) for y in years],
        "source": "ESPN public JSON feeds (undocumented; cached with URLs and retrieval timestamps)",
        "created_at": datetime.now(timezone.utc).isoformat(), "games_by_season": {str(k): int(v) for k, v in game_counts.items()},
        "regular_season_complete": all(game_counts.get(year) == 1230 for year in years) and len(team_counts) == 120 and team_counts.eq(82).all(),
        "roster_teams": int(roster.team_id.nunique()), "roster_players": len(roster), "player_season_stints": len(players),
        "historical_players": int(players.player_id.nunique()), "requested_players": len(player_ids),
        "players_without_history": no_history, "failures": failures,
        "preseason_games": int((games.season.eq(target_year) & games.season_type.eq(1) & games.completed & dates.lt(cutoff)).sum()),
        "future_schedule_games": int((games.season.eq(target_year) & games.season_type.eq(2)).sum()),
        "roster_note": "Current training-camp roster snapshot, not a confirmed opening-night active lineup. Availability is an editable scenario assumption.",
    }
    (DATA / "data_quality.json").write_text(json.dumps(quality, indent=2, default=lambda value: bool(value)) + "\n")
    print(json.dumps({k: v for k, v in quality.items() if k not in ("players_without_history", "failures")}, indent=2), flush=True)
    if failures:
        print(f"Recorded {len(failures)} download failures in data_quality.json; do not treat coverage as complete.")
    return quality
