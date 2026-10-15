"""Dated team-margin baselines shared by NFL/NHL; no unvalidated player effects."""
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize_scalar

@dataclass
class MarginSettings:
    half_life_days: float = 365
    team_penalty: float = 6
    rest_penalty: float = 100
    rest_cap: float = 10
    sigma_floor: float = 7
    min_history: int = 200

SETTINGS = {'nfl': MarginSettings(), 'nhl': MarginSettings(180, 20, 100, 3, 1.5, 600)}

def dated_games(frame):
    data=frame.copy()
    data['day']=pd.to_datetime(data.start, utc=True).dt.tz_convert('America/Toronto').dt.tz_localize(None).dt.normalize()
    complete=data.completed.astype(str).str.lower().eq('true')
    data=data.loc[complete].copy()
    for key in ['hp','ap']:
        data[key]=pd.to_numeric(data[key],errors='raise')
        if (~np.isfinite(data[key])|data[key].lt(0)|data[key].mod(1).ne(0)).any():raise ValueError('Invalid completed score.')
    if data.id.duplicated().any() or data.home.eq(data.away).any():raise ValueError('Duplicated or invalid fixture.')
    data['neutral']=data.neutral.astype(str).str.lower().eq('true')
    return data.sort_values(['day','id']).reset_index(drop=True)

def rest(last,day,cap):return cap if last is None else min(cap,max(0,(day-last).days-1))

def fit_margin(games,before,sport,settings=None):
    config=settings or SETTINGS[sport]
    before=pd.Timestamp(before).normalize();history=games.loc[games.day<before].copy().reset_index(drop=True)
    if len(history)<config.min_history:raise ValueError(f'Need {config.min_history} earlier regular-season games.')
    ids=sorted(set(history.home)|set(history.away));ix={team:i for i,team in enumerate(ids)}
    x=np.zeros((len(history),len(ids)+2));seen={}
    for day,rows in history.groupby('day',sort=True):
        for row in rows.itertuples():
            x[row.Index,ix[row.home]]=1;x[row.Index,ix[row.away]]=-1
            x[row.Index,-2]=0 if row.neutral else 1
            x[row.Index,-1]=rest(seen.get(row.home),day,config.rest_cap)-rest(seen.get(row.away),day,config.rest_cap)
        for row in rows.itertuples():seen[row.home]=day;seen[row.away]=day
    weights=np.exp2(-(before-history.day).dt.days.to_numpy()/config.half_life_days)
    target=(history.hp-history.ap).to_numpy()
    penalty=np.diag([config.team_penalty]*len(ids)+[.01,config.rest_penalty])
    coef=np.linalg.solve(x.T@(weights[:,None]*x)+penalty,x.T@(weights*target))
    sigma=max(config.sigma_floor,float(np.sqrt(np.average((target-x@coef)**2,weights=weights))))
    # NFL final ties are an explicit third result. Moneyline settlement usually
    # voids tied games; quote comparison uses probability conditional on no tie.
    tie=float((weights[history.hp.eq(history.ap)].sum()+2)/(weights.sum()+500)) if sport=='nfl' else 0.
    return {'ids':ids,'coefficients':coef,'sigma':sigma,'last_seen':seen,'history':len(history),'last_result':history.day.max(),'tie':tie,'settings':config,'before':before}

def margin_prediction(model,home,away,day,scale=1.,neutral=False,schedule=None):
    day=pd.Timestamp(day).normalize()
    if day<model['before']:raise ValueError('Forecast predates the fitted model cutoff.')
    if home==away or home not in model['ids'] or away not in model['ids']:raise ValueError('Insufficient historical identity for this team.')
    seen=model['last_seen'].copy();cap=model['settings'].rest_cap
    if schedule is not None:
        for row in schedule.itertuples():
            scheduled=pd.Timestamp(row.start).tz_convert('America/Toronto').tz_localize(None).normalize()
            if scheduled<day:
                for team in [row.home,row.away]:
                    if scheduled>seen.get(team,pd.Timestamp('1900-01-01')):seen[team]=scheduled
    coef=model['coefficients'];margin=float(coef[model['ids'].index(home)]-coef[model['ids'].index(away)]+(0 if neutral else coef[-2])+coef[-1]*(rest(seen.get(home),day,cap)-rest(seen.get(away),day,cap)))
    decisive=float(norm.cdf(margin/(model['sigma']*scale)));tie=model['tie']
    return {'home_win':(1-tie)*decisive,'away_win':(1-tie)*(1-decisive),'draw':tie,'conditional_home_win':decisive,'conditional_away_win':1-decisive,'expected_home_margin':margin,'margin_sd':model['sigma'],'history_games':model['history'],'last_result':model['last_result'].date().isoformat()}

def walk_forward(games,sport,season,scale=1):
    rows=[]
    for day,group in games.loc[games.season.eq(season)].groupby('day',sort=True):
        model=fit_margin(games,day,sport)
        baseline_history=games.loc[games.day<day]
        baseline=float((baseline_history.hp.gt(baseline_history.ap).sum()+1)/(len(baseline_history)+2))
        for row in group.itertuples():
            try:p=margin_prediction(model,row.home,row.away,day,scale,row.neutral)
            except ValueError:continue
            result=0 if row.hp>row.ap else 1 if row.hp==row.ap else 2
            probs=np.array([p['home_win'],p['draw'],p['away_win']]);observed=max(1e-12,probs[result])
            winner=0 if p['home_win']>=p['away_win'] else 2
            rows.append({'id':row.id,'day':str(day.date()),'home':row.home,'away':row.away,'result':result,'margin':p['expected_home_margin'],'sigma':p['margin_sd'],'p_home':p['home_win'],'p_draw':p['draw'],'p_away':p['away_win'],'correct':int(winner==result),'log_loss':-np.log(observed),'baseline_correct':int(result==0),'baseline_home':baseline})
    return pd.DataFrame(rows)

def evaluate_margin(games,sport,calibration_season,test_season):
    calibration=walk_forward(games,sport,calibration_season)
    decisive=calibration.loc[calibration.result.ne(1)]
    def loss(scale):
        p=np.clip(norm.cdf(decisive.margin.to_numpy()/(decisive.sigma.to_numpy()*scale)),1e-8,1-1e-8)
        y=decisive.result.eq(0).to_numpy();return float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))
    chosen=float(minimize_scalar(loss,bounds=(.65,1.75),method='bounded').x)
    test=walk_forward(games,sport,test_season,chosen)
    artifact={'sport':sport,'sigma_scale':chosen,'calibration_season':int(calibration_season),'test_season':int(test_season),'calibration_last_result':calibration.day.max(),'fitted_before':test.day.min(),'settings':asdict(SETTINGS[sport]),'scope':'team-margin only; player effects not modeled','test_games':len(test),'test_accuracy':float(test.correct.mean()),'baseline_always_home_accuracy':float(test.baseline_correct.mean()),'test_log_loss':float(test.log_loss.mean()),'market_profitability_established':False}
    return artifact,test
