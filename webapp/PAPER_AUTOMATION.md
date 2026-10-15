# Daily model paper test

Run at 06:00 America/Toronto. This is a shared forward-only paper experiment,
not gambling execution. Opening bankroll is CAD 200; each of the four normal
daily profiles stakes CAD 5 when supported and affordable. SGP/SGP+ is excluded.
There are no top-ups, balance resets, retrospective bookings or automatic paid
odds refreshes. One immutable row per Toronto day/profile prevents duplicate
stakes. Official final results settle the stored selections at frozen prices;
estimated-price returns remain illustrative.

The published standard-library Node runner is `/paper-runner.mjs` on this Site.
Fetch it only from this Site. Obtain this exact Site's current service credential
through the native Sites `get_site` tool (`siwc_bypass_bearer_token`). Pass one JSON
line `{ "serviceToken": <returned value>, "command": "run" }` through the runner's
hidden stdin. Never put the value in arguments, files, prompts or output. The
runner sends the platform service header and a purpose-scoped SHA-256 key only
to this Site. Server-side `PAPER_RUNNER_HASH` verifies that key. Hash installation
is an owner setup step, not something recurring runs change.

The runner reconciles pending public results, refreshes public model inputs
when today's snapshot is missing, then freezes today's suggested slips. It
never calls TheRundown. It reads back persisted summary, captured day and open
result groups. HTTP 409 retries are safe; HTTP 401 means runner access needs owner
attention. Do not rotate credentials, reset the wallet or claim a run succeeded
without readback. Before 06:00, capture remains disabled. Missing/postponed games
remain unresolved. On a failure preserve existing records and report the failed
step without credentials. No publication is needed for routine runs.

The cloud schedule updates the hosted database while the app is closed. The
local app has a separate database and updates on opening/checking the paper page.
