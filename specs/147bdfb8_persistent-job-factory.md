# Plan: Harden the persistent SSSF job factory

## Goal and boundaries

Bring the existing implementation into reliable agreement with the requested persistent factory contract. This repository is not starting from zero: it already has `adws/adw_factory.py`, factory tests, `just factory`, sample YAML jobs, SQLite tables, a visualizer board/API and documentation. Audit these in place, resolve implementation/test/documentation mismatches, and complete the missing reliability work rather than replacing the architecture.

Preserve every current just recipe and the behavior of `adws/adw_simple_sdlc.py`, existing SSSF tracing/observability and the visualizer's run views. Use the configured existing SSSF SQLite database. Keep one local filesystem JobSource and one worker, reusing the existing SDLC pipeline. Do not add GitHub, Jira, Linear, cloud, parallel worker, PR, merge or deployment integrations, and do not remove or mutate job definition files.

## 1. Inspect and establish contracts

- First reconcile actual implementation and tests in `adws/adw_factory.py` / `adws/tests/test_factory.py`. Existing tests import helpers (`parse_args`, `build_prompt`, `state_for_phase`, `get`) not visibly present in the current implementation; make code and tests agree with deliberate public/testable seams rather than weakening coverage.
- Define the canonical YAML contract and implement strict validation: required non-blank string `id`, `title`, `description`; non-empty list of criteria, each a mapping with non-blank string `id` and `description`; unique criterion IDs; priority constrained to documented vocabulary/default; validated optional workspace; mapping root; useful path-specific errors for malformed YAML, wrong types, missing fields, and invalid values. Discover `.yaml` and `.yml` in deterministic order and reject duplicate job IDs across files.
- Keep source kind and source identifier/path on the canonical job; filesystem discovery must not modify or relocate definitions. Retain `JobSource` as the adapter boundary.
- Define stable-ID synchronization semantics: initial definitions create database rows, repeated sync does not overwrite persisted history or silently alter an existing job when its YAML changes. Document how operators should handle edits and preserve auditability.

## 2. SQLite model, transitions, and recovery

- Extend the existing job and attempt schema additively in the configured SSSF observability DB. Ensure tracer schema initialization is safe and does not create/use a second factory database; retain existing data, WAL, busy timeout and tracer behavior. Exercise opening a pre-factory tracer DB and closing/reopening after factory activity.
- Persist canonical structured criteria, source metadata, state and previous state, attempt count, associated SSSF run ID, timestamps, and meaningful error/failure reason. Each attempt must have durable ordinal, run ID, state, error and start/end timestamps.
- Specify and enforce legal state transitions, including phase states and terminal `COMPLETED`, `FAILED`, `HUMAN_REQUIRED`. Keep transitions and matching attempt updates transactional and protect against invalid/stale updates. Ensure rapid/missed phase polling cannot make a valid workflow fail on state transitions.
- Claim atomically under `BEGIN IMMEDIATE`; choose eligible queued/rework jobs deterministically (priority then stable ordering); increment attempt and create attempt record in the same transaction. Never claim completed, human-required, failed, or attempt-exhausted jobs. Keep `FAILED` semantics explicit and distinct from retryable `REWORK` / escalated `HUMAN_REQUIRED`.
- At startup, recover abandoned active job and attempt rows exactly once. Set `REWORK` below the configured attempt ceiling or `HUMAN_REQUIRED` at the ceiling, record interruption reason and end time, and preserve the active attempt/run association. Make recovery idempotent and verify after DB reopen.

## 3. Worker and SDLC execution

- Keep a single worker loop in `adws/adw_factory.py`: sync source definitions, claim a single job, build a prompt including title, description and every structured criterion, launch `adws/adw_simple_sdlc.py` with the existing config and a unique `--adw-id` per attempt, monitor tracer phases, and persist the result.
- Do not duplicate planner, scout, builder, tests, reviewer or documenter. Derive phase mapping from actual workflow phase names and tolerate bookkeeping/unknown phases. Associate the run ID with the job and attempt as early as possible.
- Treat workflow acceptance/exit result as authoritative for success; persist `COMPLETED` only on success. On failure, select a useful traced failure reason or fallback to subprocess launch/exit details. Retry only below `SSSF_MAX_ATTEMPTS`; escalate exhausted jobs to `HUMAN_REQUIRED`. Make irrecoverable launch/configuration failures semantics explicit and observable.
- Validate CLI/environment config (`SSSF_JOBS_DIR`, max attempts, poll interval, SSSF config and DB selection) before entering the long-running loop. Preserve defaults and ensure `just factory` forwards existing arguments as documented without changing other just recipes.
- Install SIGINT/SIGTERM handlers. Shutdown stops discovery/claims, signals the child, waits boundedly, kills if necessary, records interrupted attempt as retry/escalation, then closes DB. Startup recovery remains fallback for uncatchable termination. Introduce injectable runner/process, time/sleep, ID and timeout seams as needed for deterministic tests.

## 4. Visualizer job view

- Audit the existing visualizer at `.claude/skills/sssf/apps/visualizer`; keep its existing sessions/traces and read-only stance. Preserve `/api/jobs` compatibility with a database that has no factory table (return an empty collection rather than fail).
- Align DB queries and shared/client types to the persisted schema, including IDs, state, source, structured criteria as appropriate, attempts, errors, timestamps and current run ID.
- Make the existing factory board clearly display queued/rework, active, completed, failed and human-escalation states, attempt count and failure reason. Link available associated SSSF runs through the visualizer's existing route. Handle loading, empty and polling updates; do not add UI job mutation.
- Add or adjust focused API/UI tests using existing visualizer test conventions where feasible; verify old-database and populated-database behavior and route links.

## 5. Examples, docs and future extension

- Keep exactly two safe local example jobs under `examples/jobs/`, with structured criteria and low-risk, bounded documentation-only work. Validate both through the canonical parser and ensure end-to-end examples cannot delete files, invoke remote services, or trigger deployments. Leave source files in place after processing.
- Update `README.md` and the SSSF factory reference (currently `.claude/skills/sssf/references/factory.md`, verify actual path) with prerequisites, YAML contract, commands, default jobs/config/database paths, configurable env vars, retry/poll settings, states and escalation, graceful stop/restart recovery, source audit/stable-ID policy, current limitations, and no live integrations.
- Describe a recommended future GitHub JobSource as a new adapter that maps stable upstream IDs to canonical jobs and retains source metadata while reusing the store/worker contract. Do not implement it.

## 6. Test coverage

Use deterministic offline tests, extending the existing `adws/tests/test_factory.py` or splitting test modules consistently. Cover:

- valid parse/defaults; malformed YAML, root/type/blank/missing fields, invalid priority/workspace, empty or malformed/duplicate criteria, duplicate job IDs; `.yaml`/`.yml`, empty/missing dir, deterministic discovery and source-file immutability;
- stable-ID sync/dedup; canonical DB persistence, legal and illegal transitions, state/previous state/run IDs/reasons/timestamps and attempt rows; migration from tracer-only schema; close/reopen;
- atomic claim/order, attempt limits, completed dedup, terminal states and no repeat processing;
- phase mapping, prompt composition, successful workflow, nonzero/workflow failure, failure reason selection, bounded retries and escalation;
- recovery from every active state, at retry ceiling and idempotently;
- discovery of newly added definitions during polling;
- graceful SIGINT and SIGTERM, active child termination/timeout kill, and persistence of shutdown outcome;
- `/api/jobs` on old/empty and populated DB, and visualizer run links/state display where infrastructure supports it;
- validate both included examples; add an opt-in real SDLC end-to-end smoke only when credentials/agent configuration exist, while standard tests remain offline.

## 7. Likely files and verification

Likely files to update (confirm the actual tree before changing):

- `adws/adw_factory.py`, `adws/tests/test_factory.py`, `justfile` only if needed;
- `.claude/skills/sssf/apps/visualizer/server/db.ts`, `shared/types.ts`, client types/API and `src/components/FactoryBoard.vue`, with focused tests;
- `README.md`, `.claude/skills/sssf/references/factory.md`;
- retain and validate `examples/jobs/EXAMPLE-001.yaml` and `EXAMPLE-002.yaml`.

Verification:

1. Run factory tests and the full existing Python/SSSF test suite (repository's established `uv`/unittest command), ensuring no live API dependency.
2. In the visualizer app run available tests, `bun run typecheck` and `bun run build`.
3. Run `just app-test` and inspect `just --list`; verify existing recipes remain untouched/compatible and factory CLI help/invalid config paths do not start a worker.
4. Test both fresh configured DB and tracer-only existing DB; verify persistence/recovery after reopen and `/api/jobs` on old and initialized databases.
5. Exercise worker success/failure/retry/shutdown with fake process; opt-in real `just factory` sample-job smoke only with available credentials. Confirm completed dedup, no source YAML mutation, visible status and run link.
6. Review final scope against AC1–AC10: single worker, filesystem-only source, reused workflow, no external integrations or PR/merge/deployment behavior, and document any environment-dependent E2E limit.
