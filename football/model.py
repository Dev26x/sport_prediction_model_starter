"""Run the existing Poisson model separately within EPL, La Liga and Serie A."""
from model_v2 import predict_match,calculate_team_strengths,predict_from_strengths

def predict(games,league,home,away,date):
    if league not in ('epl','laliga','seriea'):raise ValueError('Unsupported league.')
    return predict_match(games.loc[games.league.eq(league)],home,away,date)
