"""Leakage-safe NBA research infrastructure.

This namespace is intentionally separate from the existing production/reference
NBA model. Experimental models and features should enter here first.
"""

from .contracts import FeatureRow, PredictionRecord
from .registry import ExperimentRecord, ExperimentRegistry
from .splits import SeasonFold, expanding_season_folds, rolling_season_folds, strict_history

__all__ = [
    "ExperimentRecord",
    "ExperimentRegistry",
    "FeatureRow",
    "PredictionRecord",
    "SeasonFold",
    "expanding_season_folds",
    "rolling_season_folds",
    "strict_history",
]
