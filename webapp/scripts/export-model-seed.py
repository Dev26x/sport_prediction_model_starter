"""Rebuild the portable, non-secret model inputs from the existing project."""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from data_utils import load_matches
from model_v2 import predict_match
from nba.model import load_games, fit_team_model
from nba.reporting import prepare_state

def rows(path):
    with open(path) as handle:
        return list(csv.DictReader(handle))

def game(row):
    return {"id": row["game_id"], "start": row["date"], "season": int(row["season"]),
            "home": row["home_team_id"], "away": row["away_team_id"],
            "hp": float(row["home_points"]) if row["home_points"] else None,
            "ap": float(row["away_points"]) if row["away_points"] else None,
            "completed": row["completed"].lower() == "true", "neutral": row["neutral"].lower() == "true"}

state = json.loads((ROOT / 'nba/reports/model_state.json').read_text())
games, rosters, model, ratings, players, moves, translation, quality = prepare_state(state['as_of'], 2027)
pl = load_matches()
seed = {
    "snapshot": state['latest_feature_snapshot_at'],
    "nbaGames": [game(r) for r in rows(ROOT / 'nba/data/games.csv')],
    "nbaSchedule": [game(r) for r in rows(ROOT / 'nba/data/schedule.csv')],
    "teams": [{"id": r['team_id'], "abbr": r['team'], "name": r['team_name']} for r in rows(ROOT / 'nba/data/teams.csv')],
    "plGames": [{"day": r.Date.strftime('%Y-%m-%d'), "home": r.HomeTeam, "away": r.AwayTeam, "hp": int(r.FTHG), "ap": int(r.FTAG)} for r in pl.itertuples()],
    "scale": state['probability_sigma_scale'],
    "translation": state['player_translation_coefficients'],
    "previousRoster": {str(r.team_id): float(r.previous_roster_proxy) for r in ratings.itertuples()},
    "players": {}, "rosters": {}, "fixtures": {},
}
for r in players.drop_duplicates('player_id').itertuples():
    if r.has_history:
        seed['players'][str(r.player_id)] = {"name": r.player_name, "minutes": r.effective_minutes, "mpg": r.latest_mpg,
            "features": {key: float(getattr(r, key)) for key in state['player_translation_coefficients']}, "impact": r.box_impact_proxy}
for team, group in players.groupby('team_id'):
    seed['rosters'][str(team)] = [{"id": str(r.player_id), "name": r.player_name, "position": r.position,
        "injury": str(r.injury_status) if isinstance(r.injury_status, str) else '',
        "depth": int(r.depth_rank) if r.depth_rank == r.depth_rank else 99} for r in group.itertuples()]
# Public fixture snapshots for a useful first visit; live refresh replaces these.
for sport, date in [('epl', '2026-10-17'), ('nba', '2026-10-20')]:
    path = Path('/private/tmp/matchday-' + sport + '.json')
    if path.exists():
        seed['fixtures'][sport + ':' + date] = json.loads(path.read_text())
out = ROOT / 'webapp/lib/seed.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(seed, separators=(',', ':'), allow_nan=False))
checks = {"nba": [], "pl": []}
for date, home, away in [('2026-10-20','8','2'), ('2025-11-01','18','20'), ('2024-04-01','13','1')]:
    fitted = fit_team_model(games, date)
    scale = seed['scale'] if date >= '2025-10-01' else 1
    result = fitted.forecast(home, away, date, sigma_scale=scale)
    checks['nba'].append({"day": date,"home": home,"away": away,"p":result['home_win'],"margin":result['expected_home_margin'],"sigma":fitted.sigma})
for date, home, away in [('2026-10-17','Arsenal','Fulham'),('2025-12-01','Liverpool','Chelsea')]:
    result = predict_match(pl, home, away, date)
    checks['pl'].append({"day":date,"home":home,"away":away,"p":result['home_win'],"draw":result['draw'],"over":result['over_2_5']})
(ROOT/'webapp/lib/parity.json').write_text(json.dumps(checks))
print(f'Exported {len(seed["nbaGames"])} NBA games and {len(seed["plGames"])} PL matches; {out.stat().st_size:,} bytes. No credentials or private odds included.')
