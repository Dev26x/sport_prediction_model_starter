"""NHL full-game winner model, including overtime and shootout final results."""
from sports_models import fit_margin,margin_prediction,SETTINGS

def fit(games,before):return fit_margin(games,before,'nhl')
predict=margin_prediction
