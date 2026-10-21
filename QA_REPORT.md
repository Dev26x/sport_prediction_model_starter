# PR1 validation report

Validated against main commit `bc3920828f300acff48e3741b1bce411de623315`.
The supplied ZIP references this same commit; no repository-version adaptation
was necessary. All 16 supplied files were included, with corrections limited to
new research code, tests, and package documentation. One artifact test file was added.

## Full repository validation

A fresh checkout had no virtual environment. An isolated virtual environment
outside the repository was installed from the unchanged `nba/requirements.txt`.
It uses Python 3.13, pandas 3.0.6, NumPy 2.5.4, and SciPy 1.18.1.
No dependency or requirement file was added or changed.

Acceptance command, with that environment active:

```bash
python -m unittest discover -s nba/tests -v
```

Executed as `../venv/bin/python -m unittest discover -s nba/tests -v`:

```text
Ran 55 tests in 0.132s

OK
```

The original 24 NBA tests passed before applying PR1 and all passed afterward.
The complete suite now includes 31 research tests. The supplied package's earlier
18-test compatibility-harness result is superseded by this real repository run.

## Verified

- Stored B0 metrics, season, game count, data hash metadata, and invariant fingerprint match the frozen reference.
- All 598 pre-existing tracked files have identical SHA256 hashes before and after the change, including all seven protected B0 files, existing tests, CLI, and reports.
- The B0 adapter matches direct B0 probabilities and margins on synthetic fixtures, including neutral court; same-day/future score changes cannot affect its forecasts.
- Raw probability scale `1.0` is the adapter default; historical scale `0.73724261462587` remains explicit reference metadata.
- Split utilities exclude same-day/future Toronto dates, including the actual B0 loader's naive date column, mixed timestamps, and window boundaries; missing/invalid dates fail closed.
- Probability contracts reject out-of-range and nonfinite values; timestamp contracts reject post-cutoff observations, including equivalent instants expressed with different UTC offsets.
- Registry rows reject duplicate IDs, concurrent duplicate writers, invalid schemas, and unserializable configuration without replacing existing entries.
- Artifacts reject implicit overwrite even when another writer publishes between the initial check and final publication. Experiment directories reject path traversal.
- Only research source, synthetic tests, reference metadata, and documentation are included. No credentials, paid-provider payloads, caches, virtual environment files, or generated B0 reports are added.

## Corrections to the supplied implementation

1. `strict_history` incorrectly interpreted B0's naive Toronto dates as UTC, shifting midnight to the previous day and admitting same-day rows. Normalize each value using the same Toronto-day helper as the cutoff; this also handles mixed offsets and rejects missing dates.
2. Artifact publication used a check followed by `os.replace`, allowing a concurrent artifact to be overwritten. Publish with an exclusive hard link unless overwrite was explicitly requested; keep temporary-file cleanup.
3. Experiment directory IDs could escape the requested root. Require a single directory name.
4. Registry duplicate checking was outside any write lock. Use an exclusive sibling lock directory around check/append and serialize configuration before touching the registry.
5. The B0 adapter constructor admitted NaN/infinite scales. Reject nonfinite scales immediately.

Regression tests cover these changes. No pre-existing repository file was modified.

## Limitations

- This verifies the stored historical reference; it does not rerun or regenerate the full historical backtest.
- No PR2 ingestion, challenger models, new production features, betting labels, props, parlays, or stake sizing are implemented. The supplied V1 specification describes future work, not delivered PR1 functionality.
- Registry writes fail immediately when another writer holds the lock. A crashed writer can leave a stale `.lock` directory; inspect the CSV and confirm no writer is active before removing it. The CSV is not a transactional database.
- Exclusive artifact publication requires a filesystem supporting hard links; unsupported filesystems fail rather than silently overwrite.
