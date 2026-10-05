# Local software factory

`just factory` runs the single-worker local factory. It reads YAML job
definitions from `jobs/` (or `SSSF_JOBS_DIR`), records every job and attempt in
the configured SSSF observability database, and runs the existing
`adws/adw_simple_sdlc.py` pipeline once per attempt. The factory never
reimplements the planner, scout, builder, tests, reviewer or documenter — it
adds only the durable job ledger, retries, escalation and shutdown around them.

Job definition files are never moved, edited or deleted; they remain the
auditable source of record.

## Commands and configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `--config` / `SSSF_CONFIG` | `adws/adw_sssf_config/sssf.config.yaml` | SSSF config; its `observability.db` is the database used |
| `--jobs` / `SSSF_JOBS_DIR` | `jobs` | directory of `*.yaml` / `*.yml` job definitions |
| `--max-attempts` / `SSSF_MAX_ATTEMPTS` | `3` | attempts before a failed job escalates to `HUMAN_REQUIRED` |
| `--poll-seconds` / `SSSF_POLL_SECONDS` | `2` | idle and phase poll interval |
| `--once` | off | process at most one job, then exit (smoke tests) |

```bash
just factory                                  # process jobs/ continuously
SSSF_JOBS_DIR=examples/jobs just factory      # process the two examples
just factory -- --jobs examples/jobs --once   # one job, then exit
```

Ctrl-C or SIGTERM stops the worker cleanly: it stops claiming, signals the
running SDLC subprocess, waits a bounded time (then kills it), records the
interruption, and closes the database. An interrupted job is retried on the
next factory start, subject to its attempt limit.

## Canonical job definition

A job is a YAML mapping. `id`, `title`, `description` and a non-empty
`acceptance_criteria` list are required; each criterion is a unique
`{id, description}` mapping. `priority` is optional and one of `urgent`,
`high`, `normal` (default), `low`. `workspace` is optional.

```yaml
id: EXAMPLE-001
title: Document the factory command
description: Add a section to README.md describing the local factory.
priority: low
acceptance_criteria:
  - id: AC1
    description: README explains the just factory command.
  - id: AC2
    description: README identifies the default jobs directory and retry setting.
```

Definitions are validated strictly: malformed YAML, a non-mapping root, a
missing or blank field, an empty criterion list, a criterion missing its id or
description, duplicate criterion ids, an unknown priority, or a duplicate job
id across two files all fail loudly. A bad file is reported to stderr and the
worker skips discovery for that poll rather than crashing.

## Persistence and states

The factory opens the same SQLite file the tracer writes (`observability.db`,
default `adws/adw_data/sssf.db`), keeps WAL and `busy_timeout`, and adds only
two tables — `jobs` and `job_attempts`. It never creates a second database, and
an older tracer database opens unchanged.

Job states and their meaning:

- `QUEUED`, `REWORK` — claimable.
- `CLAIMED`, `PLANNING`, `SCOUTING`, `BUILDING`, `TESTING`, `REVIEWING`,
  `DOCUMENTING` — in-flight. The worker mirrors the newest running trace phase
  onto the job. Because polling can miss fast phases, any in-flight state may
  move to any other in-flight state; the worker never crashes on a jump.
- `COMPLETED` — the workflow exited 0. Terminal.
- `REWORK` — a failed attempt with budget remaining; retried.
- `HUMAN_REQUIRED` — retries exhausted (`attempt_count >= max_attempts`); a
  human must intervene. Terminal, never re-claimed.
- `FAILED` — an unrecoverable error before the workflow could run (for example
  the subprocess could not be launched). Terminal, never re-claimed.

Every transition is transaction-safe and validates the edge. Each attempt gets
its own `job_attempts` row with its own `adw_id`, so the ledger records exactly
which run produced which result. On startup the worker reconciles any in-flight
state left by a dead process: it returns the job to `REWORK`, or to
`HUMAN_REQUIRED` at the attempt ceiling, and records the interruption reason and
end time on both the job and its attempt. Recovery is idempotent.

Claiming is atomic (`BEGIN IMMEDIATE`) and ordered by priority, then creation
time, then id. Completed, failed and human-required jobs are never re-claimed.

Job ids are stable: the first discovery of an id creates its row, and later
edits to the source YAML do not rewrite history. Use a new id to create a new
job.

## Visualizer

The visualizer's **factory** view reads `GET /api/jobs` from the same database.
It groups jobs into queued, in-progress, completed and needs-attention columns,
shows the attempt count, priority, source file, structured criteria and failure
reason, and links each job to its current SSSF run via `current_adw_id`. The
route is read-only; jobs are only ever written by the worker. Against a database
that predates the factory, the query returns an empty list rather than erroring.

## Limitations (this phase)

- One worker process at a time; there is no parallelism or locking across hosts.
- The filesystem is the only `JobSource`.
- Acceptance criteria are carried into the SDLC prompt and preserved for audit;
  they are not automatically evaluated.
- No PR, merge, deployment, GitHub, Jira, Linear or cloud integrations.
- The UI reads state; it does not re-queue, edit or delete jobs.

## Adding GitHub as a future JobSource

The worker depends only on the `JobSource` protocol's `discover() -> list[Job]`,
so a new tracker is an adapter, not a rewrite:

1. Implement the protocol — e.g. `GitHubJobSource` using an issues query — and
   map each issue to a canonical `Job`, translating the issue body/checklist
   into structured `acceptance_criteria`.
2. Map the upstream stable identifier (for example `owner/repo#123`) onto the
   canonical job `id`, and preserve the source in `source` / `source_identifier`
   so the ledger stays auditable. Keep the id stable across syncs.
3. Pass the adapter to `Factory(...)` in place of `FilesystemJobSource`; the
   store, retry/escalation logic, worker loop and visualizer contract are
   unchanged.
4. Test the adapter against the same store/worker contract used here — the
   existing `adws/tests/test_factory.py` is the template — before wiring up any
   write-back (comments, labels, PRs), which is explicitly out of scope now.
