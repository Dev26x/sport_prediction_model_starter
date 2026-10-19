"""Build the football corner/goal snapshot from public league result CSVs.

Run from webapp/. Raw downloads stay in ignored work/; only compact match
statistics and source timestamps enter the server-side snapshot.
"""
import csv, io, json, subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

SOURCES = {'epl': 'E0', 'laliga': 'SP1', 'seriea': 'I1'}
raw = Path('work/football-markets'); raw.mkdir(parents=True, exist_ok=True)

def fetch(task):
    sport, code, year = task
    season = f'{year % 100:02}{(year + 1) % 100:02}'
    url = f'https://www.football-data.co.uk/mmz4281/{season}/{code}.csv'
    # Use the host's verified TLS trust store; never disable certificate checks.
    text = subprocess.check_output(['curl','--fail','--silent','--show-error','--location','--max-time','40',url]).decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(text)))
    games = []
    for r in rows:
        if r.get('FTHG', '') == '' or r.get('FTAG', '') == '': continue
        if r.get('Div') != code: raise ValueError(f'Wrong league in {url}')
        day = datetime.strptime(r['Date'], '%d/%m/%Y' if len(r['Date'].split('/')[-1]) == 4 else '%d/%m/%y').date().isoformat()
        hg, ag = int(r['FTHG']), int(r['FTAG'])
        hc = int(r['HC']) if r.get('HC', '') != '' else None
        ac = int(r['AC']) if r.get('AC', '') != '' else None
        if not (0 <= hg <= 30 and 0 <= ag <= 30): raise ValueError('Invalid goals')
        if any(v is not None and not 0 <= v <= 100 for v in [hc, ac]): raise ValueError('Invalid corners')
        games.append(dict(day=day, home=r['HomeTeam'], away=r['AwayTeam'], hp=hg, ap=ag, hc=hc, ac=ac, season=year+1))
    if year < 2026 and len(games) != 380: raise ValueError(f'Incomplete completed season: {url}: {len(games)}')
    (raw / f'{sport}-{season}.csv').write_text(text)
    return sport, games, dict(url=url, season=year+1, matches=len(games), corners=sum(g['hc'] is not None and g['ac'] is not None for g in games))

tasks = [(s, c, y) for s, c in SOURCES.items() for y in range(2022, 2027)]
payload = dict(snapshot=datetime.now(timezone.utc).isoformat(), source='Football-Data.co.uk', leagues={s: dict(games=[], sources=[]) for s in SOURCES})
with ThreadPoolExecutor(max_workers=4) as executor:
    for sport, games, source in executor.map(fetch, tasks):
        payload['leagues'][sport]['games'].extend(games)
        payload['leagues'][sport]['sources'].append(source)
for sport, value in payload['leagues'].items():
    value['games'].sort(key=lambda g: (g['day'], g['home'], g['away']))
    assert len({(g['day'], g['home'], g['away']) for g in value['games']}) == len(value['games'])
    print(sport, len(value['games']), 'matches;', sum(g['hc'] is not None and g['ac'] is not None for g in value['games']), 'with corners')
Path('lib/football-markets-seed.json').write_text(json.dumps(payload, separators=(',', ':')) + '\n')
