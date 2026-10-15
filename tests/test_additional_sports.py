import unittest
import numpy as np
import pandas as pd
from sports_models import dated_games,fit_margin,margin_prediction
from football.model import predict as football_predict

class AdditionalSportsTests(unittest.TestCase):
    def data(self,n=650,sport='nfl'):
        rows=[]
        for i in range(n):
            home=['A','B','C','D'][i%4];away=['C','D','A','B'][i%4]
            tied=sport=='nfl' and i%37==0
            rows.append({'id':str(i),'start':(pd.Timestamp('2022-01-01',tz='UTC')+pd.Timedelta(days=i)).isoformat(),'season':2022+i//250,'home':home,'away':away,'hp':14 if tied else 21+i%11,'ap':14 if tied else 10+i%8,'completed':True,'neutral':i%19==0})
        return dated_games(pd.DataFrame(rows))
    def test_strict_cutoff_excludes_same_day_and_future(self):
        data=self.data();before='2023-06-01';fit=fit_margin(data,before,'nfl');changed=data.copy();changed.loc[changed.day>=pd.Timestamp(before),'hp']=999
        other=fit_margin(changed,before,'nfl');np.testing.assert_allclose(fit['coefficients'],other['coefficients']);self.assertLess(fit['last_result'],pd.Timestamp(before))
    def test_nfl_probabilities_include_explicit_tie(self):
        p=margin_prediction(fit_margin(self.data(),'2023-10-01','nfl'),'A','C','2023-10-01')
        self.assertGreater(p['draw'],0);self.assertAlmostEqual(p['home_win']+p['away_win']+p['draw'],1);self.assertAlmostEqual(p['home_win']/(1-p['draw']),p['conditional_home_win'])
    def test_nhl_final_winner_has_no_draw(self):
        p=margin_prediction(fit_margin(self.data(sport='nhl'),'2023-11-01','nhl'),'A','C','2023-11-01')
        self.assertEqual(p['draw'],0);self.assertAlmostEqual(p['home_win']+p['away_win'],1)
    def test_nhl_rejects_tied_final_scores(self):
        with self.assertRaises(ValueError):fit_margin(self.data(),'2023-11-01','nhl')
    def test_forecast_cannot_predate_fit_or_use_invalid_scale(self):
        model=fit_margin(self.data(),'2023-10-01','nfl')
        for date,scale in [('2023-09-01',1),('2023-10-01',0),('2023-10-01',float('nan'))]:
            with self.assertRaises(ValueError):margin_prediction(model,'A','C',date,scale)
    def test_duplicate_results_rejected(self):
        data=self.data();data.loc[1,'id']=data.loc[0,'id']
        with self.assertRaises(ValueError):dated_games(data)
    def test_football_leagues_cannot_contaminate_each_other(self):
        rows=[]
        for league,goals in [('epl',1),('laliga',9)]:
            for i in range(20):rows.append({'Date':pd.Timestamp('2025-01-01')+pd.Timedelta(days=i),'HomeTeam':'A','AwayTeam':'B','FTHG':goals,'FTAG':1,'league':league})
        frame=pd.DataFrame(rows);p=football_predict(frame,'epl','A','B','2025-02-01');changed=frame.copy();changed.loc[changed.league.eq('laliga'),'FTHG']=100
        self.assertEqual(p,football_predict(changed,'epl','A','B','2025-02-01'))
    def test_negative_scores_rejected(self):
        frame=self.data();frame.loc[0,'hp']=-1
        with self.assertRaises(ValueError):dated_games(frame)

if __name__=='__main__':unittest.main()
