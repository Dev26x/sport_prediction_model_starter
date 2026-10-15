# Football prediction model — phase 1
A research baseline, **not a validated betting system**.

## Data
Download CSV seasons from https://www.football-data.co.uk/data.php and place them in `data/`.
Required columns: Date, HomeTeam, AwayTeam, FTHG, FTAG. Optional: B365H, B365D, B365A.
Use only completed matches; never train on future matches.

## Run
`pip install -r requirements.txt`
`python model.py data/E0.csv Arsenal Chelsea`

The model estimates independent Poisson goals from each team's prior home/away scoring and conceding rates with shrinkage toward league averages. It is a simple baseline, not calibrated. Compare predictions against **timestamped** bookmaker prices and test chronologically before any betting.

## Next steps
1. Merge multiple seasons, standardize team names and parse dates.
2. Implement rolling chronological backtests (no future information).
3. Add recency weights, home advantage, opponent strength, xG and lineup availability.
4. Calibrate outcome probabilities and log Brier/log loss.
5. Add timestamped FanDuel prices, overround removal and correlation-aware slip selection.
6. Do not recommend a bet unless a statistically supported edge survives out-of-sample testing.
