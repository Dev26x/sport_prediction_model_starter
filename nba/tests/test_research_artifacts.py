import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from nba.research.artifacts import (
    atomic_write_json, atomic_write_text, canonical_json_sha256,
    create_experiment_directory, file_manifest,
)


class ResearchArtifactTests(unittest.TestCase):
    def test_artifacts_require_explicit_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metrics.json"
            atomic_write_json(path, {"value": 1})
            before = path.read_bytes()
            with self.assertRaises(FileExistsError):
                atomic_write_json(path, {"value": 2})
            self.assertEqual(path.read_bytes(), before)
            atomic_write_json(path, {"value": 2}, overwrite=True)
            self.assertNotEqual(path.read_bytes(), before)

    def test_competing_writer_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.txt"
            link = os.link
            def competing_write(source, destination):
                Path(destination).write_text("other run")
                return link(source, destination)
            with patch("nba.research.artifacts.os.link", side_effect=competing_write):
                with self.assertRaises(FileExistsError):
                    atomic_write_text(path, "this run")
            self.assertEqual(path.read_text(), "other run")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_invalid_json_leaves_existing_artifact_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            atomic_write_json(path, {"value": 1})
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                atomic_write_json(path, {"value": float("nan")}, overwrite=True)
            self.assertEqual(path.read_bytes(), before)

    def test_experiment_directories_are_unique_and_contained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "runs"
            path = create_experiment_directory(root, "EXP-001")
            self.assertEqual(path.parent, root)
            with self.assertRaises(FileExistsError):
                create_experiment_directory(root, "EXP-001")
            for experiment_id in ("", ".", "..", "../escape", "/absolute", "nested/run", "nested\\run"):
                with self.subTest(experiment_id=experiment_id), self.assertRaises(ValueError):
                    create_experiment_directory(root, experiment_id)

    def test_hashes_and_manifest_are_deterministic(self):
        self.assertEqual(canonical_json_sha256({"a": 1, "b": 2}),
                         canonical_json_sha256({"b": 2, "a": 1}))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / "a.txt", root / "b.txt"
            first.write_bytes(b"a")
            second.write_bytes(b"bb")
            manifest = file_manifest([second, first], relative_to=root)
            self.assertEqual(manifest["files"][0], {
                "path": "a.txt", "bytes": 1, "sha256": hashlib.sha256(b"a").hexdigest(),
            })
            self.assertEqual(manifest, file_manifest([first, second], relative_to=root))


if __name__ == "__main__":
    unittest.main()
