"""Public result ingestion and command-line workflows for the additional sports."""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
from pathlib import Path
import hashlib,json,subprocess
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from nba.http_client import JsonClient
from sports_models import dated_games,fit_margin,margin_prediction,evaluate_margin
ROOT=Path(__file__).resolve().parent
NFL_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
NHL_CODES='ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR VAN VGK WPG WSH'.split()
LEAGUES={'epl':('E0','Premier League'),'laliga':('SP1','La Liga'),'seriea':('I1','Serie A')}

def text_download(url,path,refresh=False):
    if path.exists() and not refresh:return path.read_text()
    path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp')
    result=subprocess.run(['curl','--fail','--silent','--show-error','--compressed','--max-time','40','--url',url],capture_output=True,timeout=45)
    if result.returncode:raise RuntimeError(f'Public download failed ({result.returncode}) at {url.split("/")[2]}')
    text=result.stdout.decode('utf-8-sig');temp.write_text(text);temp.replace(path);return text

def write_json(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def now():return datetime.now(timezone.utc).isoformat()
def alias_nfl(value):return {'LA':'LAR','JAC':'JAX','WSH':'WAS'}.get(value,value)

def sync_nfl(refresh=False):
    folder=ROOT/'nfl/data';text_download(NFL_URL,folder/'raw/games.csv',refresh)
    source=pd.read_csv(folder/'raw/games.csv');source=source.loc[source.season.between(2022,2026)&source.game_type.eq('REG')].copy()
    teams_payload=JsonClient(folder/'raw/catalog').get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',{'limit':100})['data']
    teams=[{'id':alias_nfl(t['team']['abbreviation']),'abbr':alias_nfl(t['team']['abbreviation']),'name':t['team']['displayName'],'espn_id':str(t['team']['id'])}for t in teams_payload['sports'][0]['leagues'][0]['teams']]
    rows=[]
    for r in source.itertuples():
        complete=pd.notna(r.home_score) and pd.notna(r.away_score)
        stamp=datetime.fromisoformat(f'{r.gameday}T{r.gametime if pd.notna(r.gametime) else "13:00"}:00').replace(tzinfo=ZoneInfo('America/New_York')).astimezone(timezone.utc).isoformat()
        rows.append({'id':str(int(r.espn)) if pd.notna(r.espn) else r.game_id,'start':stamp,'season':int(r.season),'home':alias_nfl(r.home_team),'away':alias_nfl(r.away_team),'hp':int(r.home_score)if complete else None,'ap':int(r.away_score)if complete else None,'completed':complete,'neutral':str(r.location).lower()=='neutral'})
    frame=pd.DataFrame(rows);past=frame.loc[frame.season.lt(2026)&frame.completed];counts=past.groupby('season').size().to_dict()
    if counts!={2022:271,2023:272,2024:272,2025:272}:raise ValueError(f'Incomplete NFL archive: {counts}')
    frame.to_csv(folder/'games.csv',index=False);pd.DataFrame(teams).to_csv(folder/'teams.csv',index=False)
    write_json(folder/'quality.json',{'sport':'nfl','fetched_at':now(),'source':NFL_URL,'historical_counts':counts,'historical_seasons':[2022,2023,2024,2025],'current_season':2026,'excluded_cancelled_game':'2022 Buffalo-Cincinnati was not completed; no fabricated result.','player_effects':'Not numerically modeled; team baseline only.','input_sha256':hashlib.sha256((folder/'raw/games.csv').read_bytes()).hexdigest()})
    return {'sport':'nfl','historical_games':len(past),'current_results':int(frame.loc[frame.season.eq(2026),'completed'].sum())}

def sync_nhl(refresh=False):
    folder=ROOT/'nhl/data';client=JsonClient(folder/'raw/schedules',retries=1)
    tasks=[(code,year)for year in range(2023,2028)for code in NHL_CODES+(['ARI']if year<=2024 else['UTA'])]
    games={};teams={};failures=[]
    def read(task):
        code,year=task;season=f'{year-1}{year}';url=f'https://api-web.nhle.com/v1/club-schedule-season/{code}/{season}'
        local=JsonClient(folder/'raw/schedules',refresh=refresh and year==2027,max_cache_age_seconds=3600 if year==2027 else None)
        return year,local.get(url)['data']
    with ThreadPoolExecutor(max_workers=5)as executor:
        futures={executor.submit(read,t):t for t in tasks}
        for f in as_completed(futures):
            try:year,payload=f.result()
            except Exception as error:failures.append({'task':futures[f],'error':str(error)});continue
            for g in payload.get('games',[]):
                if g.get('gameType')!=2 or int(g.get('season',0))!=int(f'{year-1}{year}'):continue
                for side in ['home','away']:
                    team=g[side+'Team'];teams[str(team['id'])]={'id':str(team['id']),'abbr':team['abbrev'],'name':team.get('placeName',{}).get('default','')+' '+team.get('commonName',{}).get('default','')}
                complete=g.get('gameState')in('FINAL','OFF');h=g['homeTeam'];a=g['awayTeam']
                if complete and (h.get('score')is None or a.get('score')is None or h['score']==a['score']):raise ValueError('Invalid final NHL score.')
                games[str(g['id'])]={'id':str(g['id']),'start':g['startTimeUTC'],'season':year,'home':str(h['id']),'away':str(a['id']),'hp':h.get('score')if complete else None,'ap':a.get('score')if complete else None,'completed':complete,'neutral':g.get('neutralSite',False)}
    frame=pd.DataFrame(games.values());past=frame.loc[frame.season.lt(2027)&frame.completed];counts=past.groupby('season').size().to_dict()
    if failures or counts!={2023:1312,2024:1312,2025:1312,2026:1312}:
        write_json(folder/'sync_failures.json',{'failures':failures,'counts':counts});raise ValueError(f'NHL archive incomplete: {counts}; {len(failures)} source failures. See nhl/data/sync_failures.json.')
    frame.sort_values(['start','id']).to_csv(folder/'games.csv',index=False);pd.DataFrame(teams.values()).to_csv(folder/'teams.csv',index=False)
    write_json(folder/'quality.json',{'sport':'nhl','fetched_at':now(),'source':'https://api-web.nhle.com/v1/club-schedule-season/{club}/{season}','historical_counts':counts,'historical_seasons':[2023,2024,2025,2026],'current_season':2027,'score_scope':'Final result including overtime/shootout; binary full-game winner model only.','franchise_policy':'Arizona and Utah retain separate official team IDs; no invented historical continuity.','player_effects':'Starting-goalie and skater effects are not numerically modeled.'})
    return {'sport':'nhl','historical_games':len(past),'current_results':int(frame.loc[frame.season.eq(2027),'completed'].sum())}

def sync_football(refresh=False):
    folder=ROOT/'football/data';frames=[];sources=[]
    for league,(code,name)in LEAGUES.items():
        for start in range(2022,2027):
            year=f'{str(start)[2:]}{str(start+1)[2:]}';url=f'https://football-data.co.uk/mmz4281/{year}/{code}.csv';path=folder/'raw'/f'{league}_{year}.csv'
            text_download(url,path,refresh and start==2026);raw=pd.read_csv(path)
            required={'Date','HomeTeam','AwayTeam','FTHG','FTAG'}
            if not required.issubset(raw):raise ValueError(f'Invalid {league} source schema.')
            data=raw.dropna(subset=list(required)).copy();data['Date']=pd.to_datetime(data.Date,dayfirst=True,errors='raise');data['league']=league;data['season']=start+1
            for field in ['FTHG','FTAG']:
                data[field]=pd.to_numeric(data[field],errors='raise')
                if data[field].lt(0).any()or data[field].mod(1).ne(0).any():raise ValueError('Invalid football score.')
            if start<2026 and len(data)!=380:raise ValueError(f'{league} {year} has {len(data)} results; expected 380.')
            frames.append(data[['Date','HomeTeam','AwayTeam','FTHG','FTAG','league','season']]);sources.append({'league':league,'season':start+1,'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'results':len(data)})
    combined=pd.concat(frames,ignore_index=True).sort_values(['Date','league','HomeTeam']);combined.to_csv(folder/'games.csv',index=False,date_format='%Y-%m-%d')
    write_json(folder/'quality.json',{'fetched_at':now(),'historical_seasons':[2023,2024,2025,2026],'current_season':2027,'sources':sources,'player_effects':'Scoring-rate baseline; confirmed lineups and transfers are not numerically modeled.'})
    return {'sport':'football','results_by_league':combined.groupby('league').size().to_dict()}

def build(sport):
    folder=ROOT/sport;frame=pd.read_csv(folder/'data/games.csv',dtype={'id':str,'home':str,'away':str})
    if sport=='football':
        from model_v2 import predict_match
        reports={}
        for league,group in frame.groupby('league'):
            group=group.copy();group.Date=pd.to_datetime(group.Date);test=group.loc[group.season.eq(2026)];records=[]
            for r in test.itertuples():
                p=predict_match(group,r.HomeTeam,r.AwayTeam,r.Date);probs=[p['home_win'],p['draw'],p['away_win']];outcome=0 if r.FTHG>r.FTAG else 1 if r.FTHG==r.FTAG else 2
                history=group.loc[group.Date<r.Date];counts=np.array([history.FTHG.gt(history.FTAG).sum(),history.FTHG.eq(history.FTAG).sum(),history.FTHG.lt(history.FTAG).sum()])+1;baseline=counts/counts.sum()
                records.append({'date':str(r.Date.date()),'home':r.HomeTeam,'away':r.AwayTeam,'correct':int(np.argmax(probs)==outcome),'log_loss':-np.log(max(probs[outcome],1e-12)),'baseline_correct':int(np.argmax(baseline)==outcome),'baseline_log_loss':-np.log(baseline[outcome])})
            results=pd.DataFrame(records);results.to_csv(folder/'reports'/f'{league}_backtest.csv',index=False)
            reports[league]={'test_games':len(results),'test_season':'2025–26','accuracy':float(results.correct.mean()),'log_loss':float(results.log_loss.mean()),'baseline_accuracy':float(results.baseline_correct.mean()),'baseline_log_loss':float(results.baseline_log_loss.mean()),'market_profitability_established':False,'method':'Existing V2 Poisson model, same configuration, four prior/current seasons per league. Chronological full-season test; no market or player inputs.'}
        write_json(folder/'reports/evaluation.json',reports);return reports
    games=dated_games(frame);calibration,test=(2024,2025)if sport=='nfl'else(2025,2026);artifact,predictions=evaluate_margin(games,sport,calibration,test)
    write_json(folder/'reports/calibration.json',artifact);predictions.to_csv(folder/'reports/backtest.csv',index=False)
    write_json(folder/'reports/model_state.json',{'sport':sport,'as_of':now(),'team_model_only':True,'calibration':artifact,'inputs_sha256':hashlib.sha256((folder/'data/games.csv').read_bytes()).hexdigest()});return artifact

def main(sport):
    parser=argparse.ArgumentParser(description=f'{sport.upper()} research model. Public sync never calls TheRundown.')
    sub=parser.add_subparsers(dest='command',required=True);sync=sub.add_parser('sync');sync.add_argument('--refresh',action='store_true');sub.add_parser('build')
    forecast=sub.add_parser('forecast');forecast.add_argument('--home',required=True);forecast.add_argument('--away',required=True);forecast.add_argument('--date',required=True);forecast.add_argument('--league',choices=list(LEAGUES),default='epl')
    args=parser.parse_args()
    if args.command=='sync':result={'nfl':sync_nfl,'nhl':sync_nhl,'football':sync_football}[sport](args.refresh)
    elif args.command=='build':result=build(sport)
    else:
        frame=pd.read_csv(ROOT/sport/'data/games.csv',dtype={'id':str,'home':str,'away':str})
        if sport=='football':
            from model_v2 import predict_match
            frame=frame.loc[frame.league.eq(args.league)].copy();frame.Date=pd.to_datetime(frame.Date);result=predict_match(frame,args.home,args.away,args.date)
        else:
            games=dated_games(frame);artifact=json.loads((ROOT/sport/'reports/calibration.json').read_text());scale=artifact['sigma_scale']if args.date>=artifact['fitted_before']else 1.
            today=pd.Timestamp.now(tz='America/Toronto').tz_localize(None).normalize();cutoff=min(pd.Timestamp(args.date),today)
            result=margin_prediction(fit_margin(games,cutoff,sport),args.home,args.away,args.date,scale,schedule=frame)
    print(json.dumps(result,indent=2,default=lambda x:float(x)if isinstance(x,np.generic)else str(x)))
