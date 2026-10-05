# Plan: Persistent Local Software Factory

## Goal and boundaries

Evolve the existing SSSF tooling into a persistent, local-first, single-worker job factory while preserving current recipes, tracing/SQLite, observability UI, and `adw_simple_sdlc.py`. The repository already contains a substantial initial implementation in `adws/adw_factory.py`, `adws/tests/test_factory.py`, the visualizer's factory board/API, two example YAML jobs, a `just factory` recipe, and a factory reference document. Treat these as the baseline: audit and harden them rather than replacing them or duplicating the SDLC phases.

Out of scope: GitHub/Jira/Linear/cloud JobSources, parallel workers, PR/merge/deployment automation, and automated evaluation of acceptance criteria.

## 1. Confirm architecture and define the job contract

- Keep the factory implementation in `adws/adw_factory.py` and the existing SSSF SQLite database configured by `observability.db`; factory initialization must ensure tracing schema exists before using factory tables.
- Define/document a canonical YAML definition with required non-empty `id`, `title`, `description`, and non-empty `acceptance_criteria` list of unique `{id, description}` mappings. Validate strings, criterion uniqueness, priority vocabulary/default, YAML root type, malformed YAML, and duplicate IDs across discovered files. Preserve filesystem path/source identifier for audit. Do not remove or mutate definition files.
- Ensure an existing persisted job is not silently overwritten when its source definition changes; document the stable-ID/update policy explicitly.
- Use the existing JobSource protocol and `FilesystemJobSource` for the filesystem adapter so another source can be added later without changing the worker.

## 2. Harden persistence and lifecycle semantics

- In `adws/adw_factory.py`, review/migrate the additive `jobs` and `job_attempts` schema against the tracer's existing SQLite file; preserve existing tables/data and WAL/busy timeout behavior.
- Make job and attempt state changes transaction-safe and validate all allowed transitions. Persist source metadata, structured criteria, previous/current state, attempt number, associated ADW/run ID, timestamps, and meaningful error/failure reason. Confirm the configured DB is used, not a second factory DB.
- Keep claims atomic (`BEGIN IMMEDIATE`) and ordered deterministically; only queued/rework jobs below the attempt bound can be claimed. Completed jobs and `HUMAN_REQUIRED` jobs must never be re-claimed by normal discovery.
- Define and test terminal semantics for `FAILED` versus `HUMAN_REQUIRED` and ensure retry exhaustion escalates rather than looping. Each attempt must have its own durable record and run ID.
- On startup, recover active states left by process death to retryable `REWORK`, or `HUMAN_REQUIRED` at the retry limit, recording interruption reason/end time on both job and attempt. Ensure recovery is repeatable/idempotent.
- Avoid invalid phase-state transitions from rapid phase polling; maintain a legal state mapping for the existing workflow and retain the current run association throughout an attempt.

## 3. Worker integration, retry and shutdown

- Keep a single worker loop in `Factory`: discover/sync, claim one job, launch `adw_simple_sdlc.py` as a subprocess with its prompt assembled from the job title/description and every structured criterion, poll trace state for the active phase, then persist success/failure.
- Continue using the existing SDLC script and pass a unique `--adw-id` per attempt; do not reimplement planner, scout, builder, tests, reviewer, or documenter.
- Retry failed workflows only up to configured `SSSF_MAX_ATTEMPTS`; record the most useful traced failure reason, otherwise subprocess exit status. Escalate exhausted jobs to `HUMAN_REQUIRED`.
- Install SIGINT/SIGTERM handlers in `main`. Shutdown should stop discovery, signal the running SDLC subprocess, wait with a bounded timeout then kill if required, persist interruption/retry/escalation, close DB resources, and return predictably. Startup recovery handles uncatchable termination.
- Validate CLI/env configuration (`SSSF_JOBS_DIR`, `SSSF_MAX_ATTEMPTS`, `SSSF_POLL_SECONDS`) and retain the default config/database paths. Update the existing `just factory` recipe only as needed; leave other recipes unchanged.

## 4. Visualizer integration

- Preserve `.claude/skills/sssf/apps/visualizer` server/UI and its read-only job data path. Keep `/api/jobs` tolerant of databases where the factory tables have not yet been created.
- Expand typed job fields as necessary in `shared/types.ts` and consume them in `src/components/FactoryBoard.vue`; show queued, in-progress, completed, and attention/escalation states, attempt count, failure reason, and a link via `current_adw_id` to the associated trace. Ensure links navigate in the existing router.
- Verify server query ordering/state fields, empty state, polling updates, and older database behavior. Do not write job state from the UI.

## 5. Example jobs and documentation

- Retain/add exactly two safe, local examples under `examples/jobs/`, each with valid structured criteria and modest documentation-only changes. They should be safe to execute end to end and should not trigger external services or destructive changes.
- Update `README.md` with prerequisites/configuration, default jobs directory and database, `just factory`, `SSSF_JOBS_DIR`, retry/poll settings, graceful stop/recovery, example invocation, and audit/stable-ID behavior.
- Update `.claude/skills/sssf/references/factory.md` with schema example, state/retry semantics and limitations. Explain the recommended future GitHub JobSource boundary: implement the existing protocol/adapter, map stable upstream IDs to canonical jobs, preserve source metadata, then test against the same store/worker contract; no integration in this phase.

## 6. Automated tests

Extend `adws/tests/test_factory.py` or split focused modules while keeping simple unittest/pytest invocation consistent with the repository:
- valid YAML parsing, defaults, malformed/root-invalid YAML, missing/blank fields, malformed/empty/duplicate criteria, invalid priority, and duplicate IDs;
- legal and illegal state transitions, durable state/attempt/run IDs/timestamps/reasons, and persistence after closing/reopening SQLite;
- atomic claim semantics, order/limit, retry eligibility, bounded exhaustion/escalation, completed-job deduplication, and unchanged source files;
- filesystem discovery of `.yaml` and `.yml`, no directory/no jobs behavior, and newly-added definitions being discovered by polling;
- recovery from every active workflow state, recovery at attempt ceiling, idempotent recovery;
- worker successful completion and workflow nonzero/failure-reason handling using a controllable fake subprocess/runner seam (no live agents/API cost);
- phase mapping/polling, graceful SIGINT/SIGTERM shutdown and timeout escalation, with process behavior deterministically mocked;
- `/api/jobs` empty/old-db and populated behavior plus board rendering/run links where existing visualizer test infrastructure permits.

Provide a separate explicit smoke/e2e check for the two safe examples using the real `just factory` → existing SDLC route only when credentials/agent configuration are available; make the automated suite deterministic and avoid needing live model access. Confirm both sample definitions validate and can be exercised individually without modifying/removing the YAML files.

## 7. Verification and completion

- Python: run factory unit tests and the complete `adws/tests` suite.
- Visualizer: from `.claude/skills/sssf/apps/visualizer`, run `bun run typecheck`, `bun run build`, and relevant tests (add scripts/tests if needed).
- Run existing application checks (`just app-test`, covering Go and React architecture app) to demonstrate unrelated workflows remain intact.
- Check `just --list`, existing recipe invocations/help, and `just factory -- --help` or equivalent argument validation without launching the worker.
- Review DB migration/reopen behavior against a pre-factory tracer DB, verify `GET /api/jobs` after initialization, and perform manual UI smoke: queued/active/completed/escalated status plus run link.
- Confirm no external integration, parallel worker, PR, merge, or deployment behavior was introduced; all requested criteria are addressed and document any environment-dependent e2e limitation.

## Likely files

- Modify: `adws/adw_factory.py`, `adws/tests/test_factory.py`, `justfile`, `README.md`, `.claude/skills/sssf/references/factory.md`, `.claude/skills/sssf/apps/visualizer/server/db.ts`, `.claude/skills/sssf/apps/visualizer/shared/types.ts`, `.claude/skills/sssf/apps/visualizer/src/components/FactoryBoard.vue`.
- Add/adjust visualizer tests near its server/UI test layout if present.
- Keep and validate `examples/jobs/EXAMPLE-001.yaml` and `examples/jobs/EXAMPLE-002.yaml`; add no destructive or remote examples.
- Preserve `adws/adw_simple_sdlc.py` behavior and the existing just recipes; adapt only the integration seam if tests reveal the factory currently cannot reliably detect workflow success/failure.
