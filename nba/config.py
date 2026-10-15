"""Reproducible settings for the NBA project."""

from dataclasses import asdict, dataclass
from datetime import datetime
from math import isfinite
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
TARGET_YEAR = 2027  # ESPN uses the year in which a season ends.
HISTORY_YEARS = (2023, 2024, 2025, 2026)


def season_label(year):
    return f"{year - 1}-{str(year)[-2:]}"


def local_today():
    return datetime.now(ZoneInfo("America/Toronto")).date().isoformat()


@dataclass(frozen=True)
class ModelConfig:
    half_life_days: float = 365.0
    team_penalty: float = 35.0
    rest_penalty: float = 100.0
    min_history_games: int = 300
    roster_blend: float = 0.5
    max_roster_adjustment: float = 8.0
    player_shrinkage_minutes: float = 750.0
    preseason_weight: float = 0.0

    def __post_init__(self):
        positive = (self.half_life_days, self.team_penalty, self.rest_penalty,
                    self.min_history_games, self.max_roster_adjustment, self.player_shrinkage_minutes)
        if any(not isfinite(value) or value <= 0 for value in positive):
            raise ValueError("Model history, half-life, penalties, and prior strengths must be finite and positive.")
        if not isfinite(self.roster_blend) or not 0 <= self.roster_blend <= 1:
            raise ValueError("Roster blend must be within [0, 1].")
        if self.preseason_weight != 0:
            raise ValueError("Preseason results are currently context-only; the core weight is zero.")

    def to_dict(self):
        return asdict(self)
