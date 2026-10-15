"""Direct TheRundown integration. Keys stay local; provider IDs stay separate."""

import json
import os
import re

from .config import DATA, ROOT
from .http_client import DataAccessError, JsonClient


BASE_URL = "https://therundown.io/api/v2"


def api_key():
    key = os.environ.get("THERUNDOWN_API_KEY", "").strip()
    if not key:
        path = ROOT / ".env"
        if path.exists():
            for line in path.read_text().splitlines():
                if line.strip().startswith("THERUNDOWN_API_KEY="):
                    key = line.strip().split("=", 1)[1].strip().strip("\"'")
                    break
    if not key or key in ("YOUR_API_KEY", "your_key_here"):
        raise DataAccessError("Set THERUNDOWN_API_KEY in nba/.env or the private environment.")
    if any(character.isspace() for character in key):
        raise DataAccessError("The API key contains whitespace; check the local credential file.")
    return key


class RundownClient:
    def __init__(self, refresh=False):
        self.client = JsonClient(DATA / "private/rundown", {"X-TheRundown-Key": api_key()}, refresh=refresh)

    def get(self, path, params=None):
        if not path.startswith("/") or ".." in path or "?" in path:
            raise ValueError("Invalid API route.")
        return self.client.get(BASE_URL + path, params)

    def discover_sports(self):
        sports = self.get("/sports")["data"]["sports"]
        return {row["sport_name"]: row["sport_id"] for row in sports}

    def connection_status(self):
        # This marked, complete-game sample requires authentication and costs
        # zero data points. Never use its box score as a real training game.
        sample = self.get("/stats/sample")
        status = {"connected": True, "authenticated_at": sample["fetched_at"],
                  "base_url": BASE_URL, "test_route": "/stats/sample",
                  "sample_not_training_data": True, "access_headers": sample["response_headers"],
                  "sports": self.discover_sports()}
        (DATA / "rundown_connection.json").write_text(json.dumps(status, indent=2) + "\n")
        return status

    def events(self, sport_id, date, affiliate_ids=None, market_ids=None):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise ValueError("Event date must use YYYY-MM-DD.")
        params = {"affiliate_ids": ",".join(map(str, affiliate_ids)) if affiliate_ids else "0"}
        if market_ids:
            params.update({"market_ids": ",".join(map(str, market_ids)), "main_line": "true", "hide_closed": "true"})
        return self.get(f"/sports/{int(sport_id)}/events/{date}", params)

    def teams(self, sport_id):
        return self.get(f"/sports/{int(sport_id)}/teams")

    def roster(self, team_id):
        return self.get(f"/teams/{int(team_id)}/players")

    def player_season_stats(self, team_id, year, season_type=2):
        return self.get(f"/teams/{int(team_id)}/players/stats", {"year": int(year), "season_type": season_type})

    def snapshot_events(self, date, affiliate_ids=None):
        sports = self.discover_sports()
        if "NBA" not in sports:
            raise DataAccessError("NBA was not returned by the provider's sport catalog.")
        response = self.events(sports["NBA"], date, affiliate_ids, [1] if affiliate_ids else None)
        path = DATA / "private" / f"rundown_events_{date}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(response, indent=2) + "\n")
        return {"path": str(path), "fetched_at": response["fetched_at"],
                "events": len(response["data"].get("events", [])), "usage": response["response_headers"]}
