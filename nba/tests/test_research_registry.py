from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Barrier
import tempfile
import unittest

from nba.research.registry import ExperimentRecord, ExperimentRegistry


class ExperimentRegistryTests(unittest.TestCase):
    def test_concurrent_duplicate_ids_cannot_both_append(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = ExperimentRegistry(Path(directory) / "registry.csv")
            start = Barrier(2)
            def append():
                start.wait(timeout=5)
                try:
                    registry.append(self.record())
                    return True
                except (ValueError, FileExistsError):
                    return False
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: append(), range(2)))
            self.assertEqual(sum(results), 1)
            self.assertEqual(len(registry.rows()), 1)

    def test_invalid_config_does_not_create_or_change_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.csv"
            registry = ExperimentRegistry(path)
            invalid = replace(self.record(), hyperparameters={"bad": float("nan")})
            with self.assertRaises(ValueError):
                registry.append(invalid)
            self.assertFalse(path.exists())
            registry.append(self.record("EXP-OTHER"))
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                registry.append(invalid)
            self.assertEqual(path.read_bytes(), before)

    def test_invalid_registry_schema_is_not_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.csv"
            path.write_text("unexpected,columns\n1,2\n")
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "schema"):
                ExperimentRegistry(path).append(self.record())
            self.assertEqual(path.read_bytes(), before)

    def record(self, experiment_id="EXP-WIN-001", status="completed"):
        return ExperimentRecord(
            experiment_id=experiment_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            git_commit="bc3920828f300acff48e3741b1bce411de623315",
            dataset_version="wyatt-placeholder",
            training_window_id="WIN-2014-EXPANDING",
            feature_set_id="FS00_B0",
            model_id="B0-RIDGE-MARGIN",
            model_version="1",
            hyperparameters={"half_life_days": 365},
            calibration_method="none",
            train_start="2014-10-01",
            train_end="2024-06-30",
            validation_start="2024-10-01",
            validation_end="2025-06-30",
            games=1230,
            accuracy=0.63,
            brier=0.22,
            log_loss=0.64,
            margin_mae=12.0,
            margin_rmse=15.0,
            calibration_error=0.02,
            notes="test",
            artifact_path="nba/data/research/experiment_runs/EXP-WIN-001",
            status=status,
        )

    def test_registry_is_append_only_by_experiment_id(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = ExperimentRegistry(Path(directory) / "registry.csv")
            registry.append(self.record())
            with self.assertRaisesRegex(ValueError, "already exists"):
                registry.append(self.record())
            self.assertEqual(len(registry.rows()), 1)

    def test_different_experiment_ids_append(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = ExperimentRegistry(Path(directory) / "registry.csv")
            registry.append(self.record("EXP-001"))
            registry.append(self.record("EXP-002"))
            self.assertEqual([r["experiment_id"] for r in registry.rows()], ["EXP-001", "EXP-002"])

    def test_bad_status_and_commit_fail_closed(self):
        with self.assertRaises(ValueError):
            self.record(status="done")
        base = self.record()
        values = base.__dict__.copy()
        values["git_commit"] = "not-a-sha"
        with self.assertRaisesRegex(ValueError, "Git SHA"):
            ExperimentRecord(**values)


if __name__ == "__main__":
    unittest.main()
