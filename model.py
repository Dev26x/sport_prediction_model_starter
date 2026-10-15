import sys
import pandas as pd
from scipy.stats import poisson

def predict(csv_path, home, away):
    df = pd.read_csv(csv_path)
    required = {"HomeTeam","AwayTeam","FTHG","FTAG"}
    if not required.issubset(df.columns):
        raise ValueError(f"Missing columns: {required-set(df.columns)}")
    df = df.dropna(subset=list(required)).copy()
    for col in ("FTHG","FTAG"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["FTHG","FTAG"])
    if len(df) < 100:
        raise ValueError("Need at least 100 completed matches for baseline.")
    h = df[df.HomeTeam == home]
    a = df[df.AwayTeam == away]
    if len(h) < 5 or len(a) < 5:
        raise ValueError("Insufficient home/away history for these teams.")
    league_h, league_a = df.FTHG.mean(), df.FTAG.mean()
    def smooth(total, n, prior, strength=10):
        return (total + strength*prior)/(n+strength)
    home_for = smooth(h.FTHG.sum(),len(h),league_h)
    home_against = smooth(h.FTAG.sum(),len(h),league_a)
    away_for = smooth(a.FTAG.sum(),len(a),league_a)
    away_against = smooth(a.FTHG.sum(),len(a),league_h)
    lam_h = home_for*away_against/league_h
    lam_a = away_for*home_against/league_a
    scores = [(i,j,poisson.pmf(i,lam_h)*poisson.pmf(j,lam_a))
              for i in range(16) for j in range(16)]
    probs = {
        "home":sum(p for i,j,p in scores if i>j),
        "draw":sum(p for i,j,p in scores if i==j),
        "away":sum(p for i,j,p in scores if i<j),
        "over_2_5":sum(p for i,j,p in scores if i+j>=3),
        "btts":sum(p for i,j,p in scores if i>0 and j>0)
    }
    print(f"{home} vs {away} | expected goals {lam_h:.2f}-{lam_a:.2f}")
    for k,v in probs.items():
        print(f"{k:12s} {v:.2%} | fair decimal odds {1/v:.2f}")
    print("UNVALIDATED baseline probabilities; do not use as betting recommendations.")

if __name__ == "__main__":
    if len(sys.argv)!=4:
        raise SystemExit("Usage: python model.py path/to/results.csv HomeTeam AwayTeam")
    predict(*sys.argv[1:])
