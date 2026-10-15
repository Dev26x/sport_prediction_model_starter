"""Package the additional public model inputs without keys or paid market data."""
import json,sys
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from sports_models import dated_games,fit_margin,margin_prediction
from model_v2 import predict_match
seed={'margin':{},'football':{},'evaluations':{}};parity={'margin':[],'football':[]}
for sport in ['nfl','nhl']:
    folder=ROOT/sport
    data=pd.read_csv(folder/'data/games.csv',dtype={'id':str,'home':str,'away':str})
    rows=json.loads(data.to_json(orient='records'));teams=pd.read_csv(folder/'data/teams.csv',dtype=str).to_dict(orient='records')
    quality=json.loads((folder/'data/quality.json').read_text());cal=json.loads((folder/'reports/calibration.json').read_text())
    seed['margin'][sport]={'games':rows,'teams':teams,'snapshot':quality['fetched_at'],'scale':cal['sigma_scale'],'fittedBefore':cal['fitted_before']}
    seed['evaluations'][sport]={'test_games':cal['test_games'],'accuracy':cal['test_accuracy'],'log_loss':cal['test_log_loss'],'baseline_accuracy':cal['baseline_always_home_accuracy'],'test_season':str(cal['test_season'])if sport=='nfl'else '2025–26'}
    games=dated_games(data)
    example=games.loc[games.season.eq(2026 if sport=='nfl'else 2027)].iloc[0]
    day=example.day.strftime('%Y-%m-%d');scale=cal['sigma_scale']if day>=cal['fitted_before']else 1
    p=margin_prediction(fit_margin(games,day,sport),example.home,example.away,day,scale,bool(example.neutral))
    parity['margin'].append({'sport':sport,'day':day,'home':example.home,'away':example.away,'neutral':bool(example.neutral),'scale':scale,'p':p['home_win'],'draw':p['draw'],'margin':p['expected_home_margin'],'sigma':p['margin_sd']})
football=pd.read_csv(ROOT/'football/data/games.csv');football.Date=pd.to_datetime(football.Date)
quality=json.loads((ROOT/'football/data/quality.json').read_text());evals=json.loads((ROOT/'football/reports/evaluation.json').read_text());seed['evaluations'].update(evals)
for league,frame in football.groupby('league'):
    seed['football'][league]={'games':[{'day':r.Date.strftime('%Y-%m-%d'),'home':r.HomeTeam,'away':r.AwayTeam,'hp':int(r.FTHG),'ap':int(r.FTAG)}for r in frame.itertuples()],'snapshot':quality['fetched_at']}
    row=frame.loc[frame.season.eq(2027)].iloc[0];day=row.Date.strftime('%Y-%m-%d');p=predict_match(frame,row.HomeTeam,row.AwayTeam,day)
    parity['football'].append({'sport':league,'day':day,'home':row.HomeTeam,'away':row.AwayTeam,'p':p['home_win'],'draw':p['draw'],'over':p['over_2_5']})
(ROOT/'webapp/lib/expanded-seed.json').write_text(json.dumps(seed,separators=(',',':'),allow_nan=False))
(ROOT/'webapp/lib/expanded-parity.json').write_text(json.dumps(parity,allow_nan=False))
print('Expanded server seed exported: NFL, NHL, EPL, La Liga, Serie A. No keys or paid odds.')
