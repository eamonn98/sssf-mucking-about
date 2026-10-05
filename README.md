# ArchViz — architecture visualiser (MVP)

A local-first developer tool for drawing, editing and reading software
architecture. Components are typed nodes (frontend, backend service,
microservice, database, cache, message broker, external API, third-party
service); directed relationships carry a protocol (HTTP/REST, gRPC, WebSockets,
async messaging, other). Saved **request flows** highlight the exact route a
request takes through the graph.

The app is deliberately small: one local workspace, no authentication, no cloud,
no tracing. It runs entirely on loopback.

> This repository also contains unrelated SSSF agent tooling under `adws/` and
> `.claude/`. The product lives in `backend/` and `frontend/` and the new
> `just app-*` recipes; nothing else was touched. The SSSF tooling includes a
> local, single-worker **software factory** driven by YAML jobs — see
> [Local software factory](#local-software-factory-sssf) at the end of this file.

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Go | 1.22+ (`toolchain go1.25.0` in `backend/go.mod`) | the Go command downloads the pinned toolchain automatically |
| Bun | 1.3+ | `npm`/`pnpm` work too, adjust the commands |
| `just` | optional | recipes for the common tasks |

SQLite is **not** required: the backend uses the pure-Go `modernc.org/sqlite`
driver, so there is no cgo and no system database to install.

> Why a pinned toolchain? Go 1.22.2 on recent macOS produces Mach-O binaries
> that dyld rejects (`missing LC_UUID`) once the `net` package is linked.
> `toolchain go1.25.0` fixes this transparently. If you must stay on an older
> toolchain, build and test with `-tags netgo`.

---

## First run

```bash
just app-setup      # go mod download + bun install
just app-dev        # Go API on http://127.0.0.1:8080, Vite on http://localhost:5173
```

Then open **http://localhost:5173**. Vite proxies everything under `/api` to the
Go server, so the browser only ever talks to one origin.

Prefer separate terminals? `just app-backend` and `just app-frontend` do the
same thing independently.

### Database

A SQLite file is created at `backend/data/architecture.db` on first start and is
seeded **once** with an example e-commerce architecture (11 components, 11
relationships, 2 request flows). Deleting rows never triggers a re-seed — the
one-time seed is recorded in a `meta` marker row.

```bash
just app-reset      # delete the database and start fresh (re-seeds next run)
```

Override the defaults with environment variables:

```bash
ARCHVIZ_ADDR=127.0.0.1:9000 ARCHVIZ_DB=/tmp/arch.db just app-backend
```

---

## Using it

- **Pan / zoom** — drag the canvas, scroll to zoom, use the controls at the top
  left for fit-to-view, zoom in and zoom out. A minimap appears once there are
  more than three components.
- **Select** — click a node or a relationship. The inspector on the right shows
  everything saved, plus edit and delete actions.
- **Create a relationship by drawing** — drag from the right edge of one node to
  the left edge of another; the relationship form opens pre-filled. Shift-click
  to multi-select.
- **Add / edit / remove** — `Component` and `Relationship` buttons in the header.
  Deleting always asks for confirmation and explains what else goes with it.
- **Layout persistence** — drag a node and its position is saved on drop, so a
  refresh restores the arrangement.
- **Request flows** — the picker at the top right highlights a saved path and
  dims everything else. `New flow` opens a path builder constrained to edges
  that actually continue the route, so an unconnected path cannot be saved.
- **Narrow viewports** — from Tailwind's `lg` breakpoint (1024px) the inspector
  becomes a right-hand overlay instead of a permanent 340px sidebar, so the
  graph keeps the full width. It opens from the `Inspector` button in the header
  or automatically when you select something, and closes with Escape, the
  backdrop or the close button. The legend starts collapsed below `lg`.

### Deletion policy (documented, and covered by tests)

Deleting a component cascades to its relationships; deleting a relationship (or
rewiring it to different endpoints) removes any request flow that used it. That
keeps every stored flow a valid, connected path by construction instead of
silently truncating a route. The save/edit dialogs warn before you confirm.

---

## Architecture

```
backend/                     Go 1.22+ HTTP JSON API + SQLite (one process)
  cmd/server/main.go         config, listener, graceful shutdown
  internal/domain/           types, allowed vocabularies, validation rules
  internal/store/            schema/migrations, seed-once, CRUD, cascade policy
  internal/api/              routing, JSON envelopes, status codes, middleware
frontend/                    React 18 + TypeScript + Vite
  src/App.tsx                workspace state, dialogs, mutations
  src/components/            graph canvas, custom node/edge, inspector, forms
  src/components/ui/         shadcn/ui primitives (Radix + Tailwind + cva)
  src/lib/{types,api,graph}.ts   typed contract, fetch client, graph mapping
```

**State:** the frontend holds one `Architecture` snapshot and a small amount of
UI state. No server-state framework; React Flow owns node/edge interaction and
positions are written back on drag end only.

**Request flow semantics:** a flow is a *developer-authored* ordered list of
relationship IDs. It is not runtime tracing, and nothing here observes live
traffic — that is explicitly future work.

**Snapshot consistency:** `GET /api/architecture` reads components,
relationships and flows inside one deferred read transaction, so the three
collections always describe the same database state even while another
connection commits a write. `store_test.go` proves this: a mutation injected
between the collection reads is absent from the snapshot (and the same test
fails if the transaction is removed).

---

## API

All responses are JSON. Errors use one envelope:

```json
{ "error": { "code": "invalid", "message": "Component is invalid.", "fields": { "name": "Name is required." } } }
```

`400` invalid fields / invalid flow path, `404` unknown id or route, `405`
unsupported method (also JSON), `413` body over 1 MiB.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | readiness probe |
| `GET` | `/api/architecture` | one consistent snapshot of the whole graph, read inside a single SQLite read transaction |
| `GET` `POST` | `/api/components` | list / create |
| `GET` `PUT` `DELETE` | `/api/components/{id}` | read / replace / delete (cascades) |
| `PUT` | `/api/components/{id}/position` | persist a drag without rewriting other fields |
| `GET` `POST` | `/api/relationships` | list / create |
| `GET` `PUT` `DELETE` | `/api/relationships/{id}` | read / replace / delete |
| `GET` `POST` | `/api/request-flows` | list / create |
| `GET` `PUT` `DELETE` | `/api/request-flows/{id}` | read / replace / delete |

Component types: `frontend`, `backend_service`, `microservice`, `database`,
`cache`, `message_broker`, `external_api`, `third_party_service`.
Protocols: `http_rest`, `grpc`, `websockets`, `async_messaging`, `other`.

Unknown JSON fields are rejected, so a stale client fails loudly rather than
silently dropping data.

---

## Checks

```bash
just app-test           # everything below, in order
```

or individually:

```bash
cd backend  && go test ./...
cd frontend && bun run test        # vitest: flow path logic + app render smoke tests
cd frontend && bun run typecheck   # tsc --noEmit
cd frontend && bun run build       # production bundle
```

The backend tests cover schema/seed-once behaviour, component/relationship/flow
CRUD, missing references, self-links, invalid and disconnected flows, the
cascade policy, position-only updates, persistence across reopen, and the HTTP
contract (status codes, error envelope, health, 404/405).

The frontend tests cover the flow path builder's connectivity rules, the
flow-to-highlight mapping (nodes, edges, traversal order, invalid paths), and a
jsdom render of the whole app against a mocked API including the loading, empty,
unreachable-API and narrow-viewport overlay states.

### Manual smoke test

1. `just app-dev`, open http://localhost:5173.
2. The seeded architecture is visible; pan, zoom and fit.
3. Click a node, then an edge — the inspector shows full detail and edit/delete.
4. Add a component, add a relationship (or drag handle → handle), edit and delete
   each; confirm the destructive question appears first.
5. Reload the page: edits and node positions survive.
6. Pick a request flow: its path highlights and everything else dims. Clear it
   and the graph returns to normal.
7. Create a flow and try to build an unconnected path — the builder refuses and
   explains why; the API rejects it too.
8. Stop the Go process and reload — the app shows a recovery screen with the
   command to start the backend.
9. Narrow the window below 1024px — the sidebar disappears, the graph fills the
   width, and the header's `Inspector` button opens the panel as an overlay.

---

## MVP limitations (intentional)

- One local workspace per database file; no accounts, sharing or sync.
- Request flows are authored, not captured. No tracing, ingestion, import/export
  or auto-discovery of topology.
- Graph layout is user-arranged and persisted; there is no auto-layout engine.
- No undo/redo, search, filtering, version history or production packaging.
- The component type/protocol vocabularies are duplicated in
  `backend/internal/domain/domain.go` and `frontend/src/lib/types.ts` by design;
  there is no code generation while the schema is still settling.

## Where to extend next

- A `GET /api/meta` endpoint (or code generation) to make the vocabulary
  single-sourced.
- Multi-select editing, undo/redo, and auto-layout as an explicit user action.
- Import/export of the architecture as JSON or as an OpenAPI/Terraform source.
- Flow branching (fan-out and fan-in) rather than a strictly linear path.

---

## Local software factory (SSSF)

The `adws/` tooling runs a persistent, local-first, **single-worker software
factory**. It reads YAML job definitions from a directory, records each job and
attempt in the SSSF SQLite database, and executes every attempt through the
existing `adws/adw_simple_sdlc.py` pipeline. It does not reimplement the SDLC
phases — it wraps them in a durable job ledger with bounded retries, human
escalation, graceful shutdown and restart recovery.

This phase is deliberately local: filesystem is the only job source, there is
exactly one worker, and there are no GitHub/Jira/Linear/cloud, PR, merge or
deployment integrations.

### Commands

```bash
just factory                                  # process jobs/ continuously (Ctrl-C stops)
SSSF_JOBS_DIR=examples/jobs just factory      # process the two bundled examples
just factory -- --jobs examples/jobs --once   # drain the queue, then exit

just obs                                      # existing visualizer incl. the factory board
```

### Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `--jobs` / `SSSF_JOBS_DIR` | `jobs` | directory of `*.yaml` / `*.yml` job definitions |
| `--config` / `SSSF_CONFIG` | `adws/adw_sssf_config/sssf.config.yaml` | SSSF config; `observability.db` selects the database |
| `--max-attempts` / `SSSF_MAX_ATTEMPTS` | `3` | attempts before a failed job escalates to `HUMAN_REQUIRED` |
| `--poll-seconds` / `SSSF_POLL_SECONDS` | `2` | idle and phase poll interval |

The default database is `adws/adw_data/sssf.db` — the same file the tracer and
visualizer use. The factory adds only two tables (`jobs`, `job_attempts`) and
never creates a second database.

### Job definition

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

`id`, `title`, `description` and a non-empty `acceptance_criteria` list of
unique `{id, description}` mappings are required. Definitions are validated
strictly; a malformed file is reported and skipped rather than silently dropped.
Job ids are stable — the first discovery creates the record, later edits to the
file never rewrite history, and the definition files are kept on disk for audit.

### Lifecycle

Each job has explicit persisted states and one durable attempt per try, keyed by
the SSSF run id (`current_adw_id`). A failed attempt with budget left returns to
`REWORK` and is retried; exhausted attempts escalate to `HUMAN_REQUIRED` and are
never re-claimed. `COMPLETED`, `FAILED` and `HUMAN_REQUIRED` are terminal.
Ctrl-C/SIGTERM stops the worker cleanly and records the interruption; the next
startup recovers in-flight jobs (bounded, idempotent). The visualizer's factory
view shows these states and links each job to its run.

### Tests

```bash
uv run python -m unittest discover -s adws/tests -t . -v
```

The factory suite is offline and deterministic (a fake subprocess replaces the
SDLC). To run the real two-example end-to-end smoke — which needs agent
credentials — set `SSSF_FACTORY_E2E=1` (and have `just` on `PATH`).

See `.claude/skills/sssf/references/factory.md` for the full state/retry
semantics, limitations, and the recommended path to add GitHub as a future
`JobSource`.
