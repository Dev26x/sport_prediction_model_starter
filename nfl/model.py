"""NFL opponent-adjusted margin model, explicit ties and chronological evaluation."""
from sports_models import fit_margin,margin_prediction,SETTINGS

def fit(games,before):return fit_margin(games,before,'nfl')
predict=margin_prediction
