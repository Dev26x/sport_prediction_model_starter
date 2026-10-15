"""Export public, regular-season player boxes; never odds or credentials.

Run from webapp: python3 scripts/export-sgp-data.py [--download]
NFL download uses the upstream nflreadr stats_player release and ESPN rosters.
NBA uses the project's already reconciled four-season game-box CSVs.
"""
import csv,json,sys,subprocess,re
from pathlib import Path
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'webapp/lib'
stamp=datetime.now(timezone.utc).isoformat()
def rows(p):return list(csv.DictReader(p.open()))
def number(r,k):return float(r.get(k) or 0)
def canon(t):return {'LA':'LAR','JAC':'JAX','WSH':'WAS'}.get(t,t)
def namekey(s):return re.sub(r'[^a-z0-9]','',s.lower())
def download(url,path):
    subprocess.run(['curl','-fLsS','--retry','2','--max-time','90',url,'-o',str(path)],check=True)
def write(sport,data):
    p=OUT/f'sgp-{sport}-seed.json';p.write_text(json.dumps(data,separators=(',',':')))
    print(sport,len(data['games']),'games',len(data['players']),'players',sum(len(p['logs']) for p in data['players'].values()),'boxes',p.stat().st_size,'bytes')

base=json.loads((OUT/'seed.json').read_text())
games=[];index={}
for r in rows(ROOT/'nba/data/games.csv'):
    if r['completed']!='True' or r['season_type']!='2' or r['cup_final']=='True':continue
    index[r['game_id']]=len(games)
    # Toronto day (historical offsets matter at the midnight boundary).
    from zoneinfo import ZoneInfo
    day=datetime.fromisoformat(r['date'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Toronto')).date().isoformat()
    games.append([r['game_id'],day,int(r['season']),r['home_team_id'],r['away_team_id']])
players={}
for r in rows(ROOT/'nba/data/player_games.csv'):
    if r['game_id'] not in index or number(r,'minutes')<=0:continue
    p=players.setdefault(r['player_id'],{'name':r['player_name'],'position':'','logs':[]})
    p['logs'].append([index[r['game_id']],r['team_id'],round(number(r,'minutes'),2),int(number(r,'points')),int(number(r,'oreb')+number(r,'dreb')),int(number(r,'ast')),int(number(r,'fg3m'))])
write('nba',{'snapshot':base['snapshot'],'source':'ESPN reconciled regular-season boxes','games':games,'players':players,'rosters':base['rosters'],'metrics':['points','rebounds','assists','threes']})

directory=ROOT/'nfl/data/sgp';directory.mkdir(exist_ok=True)
teams=json.loads((OUT/'expanded-seed.json').read_text())['margin']['nfl']['teams']
if '--download' in sys.argv:
    def getyear(y):download(f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv',directory/f'player_stats_{y}.csv')
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(getyear,range(2022,2027)))
    def getroster(t):download(f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{t["espn_id"]}/roster',directory/f'roster-{t["id"]}.json')
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(getroster,teams))
games=[];index={}
for r in rows(ROOT/'nfl/data/raw/games.csv'):
    if r['game_type']!='REG' or not 2022<=int(r['season'])<=2026:continue
    index[r['game_id']]=len(games)
    games.append([r['game_id'],r['gameday'],int(r['season']),canon(r['home_team']),canon(r['away_team'])])
players={}
for y in range(2022,2027):
    for r in rows(directory/f'player_stats_{y}.csv'):
        if r['game_id'] not in index or r['season_type']!='REG' or r['position'] not in ['QB','RB','WR','TE','FB']:continue
        p=players.setdefault(r['player_id'],{'name':r['player_display_name'],'position':r['position'],'logs':[]})
        p['logs'].append([index[r['game_id']],canon(r['team']),0,*[int(number(r,k)) for k in ['passing_yards','rushing_yards','receiving_yards','receptions','passing_tds','attempts','carries','targets']]])
names={}
for id,p in players.items():names.setdefault(namekey(p['name']),[]).append(id)
rosters={}
def flatten(a):
    return [p for item in a for p in (flatten(item['items']) if 'items' in item else [item])]
for t in teams:
    path=directory/f'roster-{t["id"]}.json'
    if not path.exists():raise RuntimeError('Run with --download once to obtain current NFL rosters.')
    rosters[t['id']]=[]
    for a in flatten(json.loads(path.read_text()).get('athletes',[])):
        matches=names.get(namekey(a['displayName']),[])
        if len(matches)!=1:continue # Never join ambiguous names or ESPN/GSIS numeric IDs.
        injury=(a.get('injuries') or [{}])[0]
        rosters[t['id']].append({'id':matches[0],'espnId':str(a['id']),'name':a['displayName'],'position':a.get('position',{}).get('abbreviation',''),'injury':injury.get('status',''),'injuryAt':injury.get('date'),'depth':99})
write('nfl',{'snapshot':stamp,'source':'nflverse stats_player regular-season weekly boxes; ESPN current roster membership','games':games,'players':players,'rosters':rosters,'metrics':['passing yards','rushing yards','receiving yards','receptions','passing touchdowns']})
