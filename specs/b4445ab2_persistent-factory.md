# Plan: Evolve SSSF into a persistent job-driven factory

## Goal and boundaries

Harden the existing persistent-factory implementation in place; do not replace the SSSF tools or duplicate the SDLC workflow. Preserve all existing `just` recipes, `adws/adw_simple_sdlc.py`, tracer/SQLite data, and the SSSF visualizer. Add only local YAML job intake and a single worker. No GitHub/Jira/Linear/cloud integrations, parallelism, PR/merge/deployment automation, or destructive job-source behavior.

The repository already has a `just factory` recipe, `adws/adw_factory.py`, job examples, factory tests, a visualizer job board/API, and a factory reference/spec. Start by reconciling the current implementation with the tests and existing spec: existing pieces are a baseline to audit, not presumed complete. In particular, close mismatches among code, tests, README/reference, and database/UI contracts before expanding features.

## 1. Audit and canonical job source

- Keep the implementation in `adws/adw_factory.py` and retain the `JobSource` protocol / `FilesystemJobSource` boundary.
- Define and consistently validate the YAML contract: non-empty string `id`, `title`, and `description`; non-empty `acceptance_criteria` list of unique mappings with non-empty string `id` and `description`; priority in `urgent|high|normal|low` (default `normal`); optional validated workspace. Reject malformed YAML, wrong root types, unknown/invalid values, and duplicate IDs across discovered files with path-specific errors. Discover `.yaml` and `.yml` deterministically, preserve source path, and never move/edit/delete definition files.
- Ensure synchronization is idempotent and source edits do not silently rewrite an existing job’s persisted history; document stable-ID behavior. Fix the source metadata contract so filesystem identity/path is retained, and make sync support future adapters without baking filesystem assumptions into the store.

## 2. Durable state, attempts, recovery

- Use only the database configured by SSSF `observability.db`; initialize tracer tables compatibly and add factory tables additively. Preserve WAL/busy-timeout behavior and existing observability data. Verify migrations against a pre-factory tracer DB and reopen.
- Make schema and persistence methods consistently store canonical criteria, priority, source/source identifier, current and previous state, attempt count, current run ID, failure reason, and timestamps. Each attempt is a durable row containing ordinal, run ID, state, reason and start/end timestamps.
- Define an explicit transition graph for queued/rework, claim, active SDLC phases, completed, failed, and human-required states. Guard transitions and job+attempt writes transactionally; do not use a terminal state as retryable. Atomic claim with `BEGIN IMMEDIATE`, deterministic priority/time/id ordering, and attempt ceiling; only queued/rework jobs can be claimed. Completed jobs must not be repeated.
- On startup recover each abandoned active job/attempt exactly once: retry as `REWORK` under the bound or escalate to `HUMAN_REQUIRED` at the bound; record end timestamp and clear/retain active fields coherently. Preserve every run/attempt association through transitions.

## 3. Single worker, workflow integration and shutdown

- Keep one worker loop in `adws/adw_factory.py`: discover/sync, atomically claim one job, build a prompt from title, description, and every structured criterion, and invoke existing `adws/adw_simple_sdlc.py` through a unique `--adw-id` for each attempt. Do not reproduce planner/scout/builder/test/reviewer/documenter behavior.
- Poll the existing tracer phase table and map meaningful SDLC phases to job state while allowing missed/fast phases safely. Determine success from workflow exit/result rather than merely launch; persist the best traced failure reason or a useful subprocess/exit reason. Retry workflow failures only up to configured maximum, then set `HUMAN_REQUIRED`. Define launch/config errors consistently (terminal `FAILED` where irrecoverable).
- Validate CLI/env settings including `SSSF_JOBS_DIR`, `SSSF_MAX_ATTEMPTS`, and `SSSF_POLL_SECONDS`; keep defaults documented. Ensure `just factory` remains compatible and does not disturb other recipes.
- Install SIGINT/SIGTERM handling. Stop new claims, signal active SDLC child, wait a bounded interval then kill if necessary, persist interruption as retry or escalation, and close SQLite. Startup recovery covers uncatchable shutdown. Add deterministic injection seams for runner, clock/IDs, and shutdown timeout as needed by tests.

## 4. Visualizer integration

- Keep `.claude/skills/sssf/apps/visualizer` read-only for job records. Preserve existing session/trace functionality and make `/api/jobs` return an empty array when older DBs have no factory table.
- Align the DB query and shared `FactoryJob` contract with the actual persisted schema and expose the fields needed for state, attempt count, error, source, criteria, timestamps, and `current_adw_id`.
- Update the factory board to display queued/rework, active, completed, and attention states; show criteria, attempt/error information, and link each known run to the existing session/trace route. Handle empty/loading/error data and keep polling consistent with the existing app/router.
- Add/update lightweight server/type/UI tests where infrastructure allows, and check existing visualizer behavior is not regressed.

## 5. Examples and documentation

- Keep exactly two safe local jobs in `examples/jobs/`; validate both and ensure they are modest, end-to-end-safe requests with structured acceptance criteria. Do not remove or mutate their YAML source during execution.
- Update `README.md` and `.claude/skills/sssf/references/factory.md` to accurately describe canonical YAML, configuration/defaults, commands (`just factory`, one-shot/smoke options if supported), state and retry semantics, restart/shutdown behavior, database path, stable IDs/audit trail, limitations, and a recommended GitHub future path via a new `JobSource` adapter and stable upstream IDs. Do not imply integrations exist.
- Reconcile all docs with implemented behavior instead of preserving unsupported claims.

## 6. Tests

Extend `adws/tests/test_factory.py` or split focused tests following the current test style. Cover:

- valid YAML/defaults and `.yaml`/`.yml` discovery; missing/empty directory; malformed YAML/root; required field type/blank checks; invalid/empty/duplicate acceptance criteria; invalid priority; duplicate job IDs; source files remain unchanged;
- legal/illegal transitions; persistence of timestamps, previous state, reasons, run IDs and attempt rows; atomic claim/order/attempt limit; sync dedup/stable-ID behavior; completed and escalation deduplication;
- workflow prompt, trace phase mapping, success, traced/untraced failure, bounded retry/escalation and launch failure;
- restart recovery across all active states and attempt ceiling, idempotence/reopen persistence;
- graceful SIGINT/SIGTERM, active-child termination and kill timeout through fake process/runner; filesystem discovery of newly-added jobs;
- old DB / empty and populated `/api/jobs`, and board links/rendering to the degree supported by frontend test tooling;
- both examples parse and are eligible for safe end-to-end exercise.

Keep tests offline/deterministic; gate real-agent end-to-end smoke behind explicit opt-in and available credentials. Ensure the full existing SSSF and application test suites pass.

## 7. Verification and likely files

Likely change set:

- `adws/adw_factory.py`, `adws/tests/test_factory.py`, `justfile` (only if needed), `README.md`, `.claude/skills/sssf/references/factory.md`;
- `.claude/skills/sssf/apps/visualizer/server/db.ts`, `server/index.ts` only if routing behavior needs adjustment, `shared/types.ts`, `src/lib/types.ts`, `src/components/FactoryBoard.vue`, and focused tests;
- retain/validate `examples/jobs/EXAMPLE-001.yaml` and `EXAMPLE-002.yaml`.

Verification sequence:

1. `uv run python -m unittest discover -s adws/tests` (or repository's equivalent complete SSSF suite), including factory tests.
2. From `.claude/skills/sssf/apps/visualizer`, run `bun run typecheck`, `bun run build`, and available tests.
3. Run `just app-test` for unrelated Go/React app compatibility and inspect `just --list` / existing recipe compatibility.
4. Verify factory CLI help and invalid configuration without starting a live worker; inspect configured database migration/reopen and `/api/jobs` against an old DB and initialized DB.
5. Run deterministic end-to-end worker tests; run the optional live `just factory` example smoke only with explicit credentials/configuration. Manually confirm board state/run links where possible.
6. Review scope to confirm one worker, local filesystem only, job file auditability, no duplicated SDLC workflow, and no external/PR/merge/deployment features.
