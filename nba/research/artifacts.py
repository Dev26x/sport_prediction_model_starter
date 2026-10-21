"""Small immutable-artifact helpers for NBA research runs."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any, Iterable


def sha256_file(path: str | Path) -> str:
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def atomic_write_text(path: str | Path, text: str, *, overwrite: bool = False) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        raise FileExistsError(f"Refusing to overwrite existing artifact: {path}")

    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        if overwrite:
            os.replace(temp_name, path)
        else:
            # Publish only if the destination is still absent. A preflight
            # exists() check followed by replace() can overwrite another run.
            os.link(temp_name, path)
            os.unlink(temp_name)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    return path


def atomic_write_json(path: str | Path, value: Any, *, overwrite: bool = False) -> Path:
    text = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    return atomic_write_text(path, text, overwrite=overwrite)


def create_experiment_directory(root: str | Path, experiment_id: str) -> Path:
    if not isinstance(experiment_id, str) or not experiment_id.strip():
        raise ValueError("experiment_id must be a non-empty string.")
    if experiment_id in {".", ".."} or any(char in experiment_id for char in ("/", "\\", "\x00")):
        raise ValueError("experiment_id must be a single directory name.")
    path = Path(root) / experiment_id
    path.mkdir(parents=True, exist_ok=False)
    return path


def file_manifest(paths: Iterable[str | Path], *, relative_to: str | Path | None = None) -> dict:
    base = Path(relative_to).resolve() if relative_to is not None else None
    records = []
    for item in paths:
        path = Path(item).resolve()
        label = str(path.relative_to(base)) if base is not None else str(path)
        records.append(
            {"path": label, "bytes": path.stat().st_size, "sha256": sha256_file(path)}
        )
    return {"files": sorted(records, key=lambda row: row["path"])}
