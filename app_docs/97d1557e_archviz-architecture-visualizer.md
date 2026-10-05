# ArchViz — MVP architecture visualiser

## What was built

A local-first web app for drawing, editing and reading software architecture.
Components are typed nodes on an interactive canvas; directed relationships
between them carry a protocol; saved **request flows** highlight the exact route
a request takes through the graph.

The original prompt asked for a Go backend, a React + TypeScript + shadcn/ui
frontend, pan/zoom/select/inspect, full CRUD, and a request-flow concept — with
no auth, cloud, deployment, AI or telemetry, and a deliberately small local dev
experience. All of that is present. Nothing outside `backend/`, `frontend/`, and
non-conflicting additions to the root `justfile` / `README.md` / `.gitignore` /
`.env.sample` was touched; the SSSF agent tooling under `adws/` and `.claude/`
is unrelated and unchanged.

Why it matters: the product is a *developer tool*, not a generic diagramming
suite — dark developer-tool chrome, a legend that explains the node categories
and protocol colours, an inspector rather than a modal-everything flow, and one
command to run it. The request-flow feature is the differentiator: a developer
authors an ordered path once and can then highlight exactly how a request
crosses the system.

## Where the code lives

| Path | Role |
| --- | --- |
| `backend/cmd/server/main.go` | config from env, listener, signal-aware graceful shutdown |
| `backend/internal/domain/domain.go` | component/relationship/flow types, allowed vocabularies, validation rules, `ValidationError` / `NotFoundError` |
| `backend/internal/store/store.go` | SQLite schema + migrations, seed-once, CRUD, cascade + flow-reconciliation policy, transactional snapshot |
| `backend/internal/store/seed.go` | the example e-commerce architecture |
| `backend/internal/api/api.go` | routing, JSON decoding, status codes, error envelopes |
| `backend/internal/api/middleware.go` | JSON 404/405 for unmapped routes |
| `backend/go.mod` | module `archviz`, single dependency `modernc.org/sqlite` (pure Go, no cgo) |
| `frontend/src/App.tsx` | workspace state, all mutations, dialogs, responsive layout |
| `frontend/src/lib/types.ts` | hand-written mirror of the Go JSON contract |
| `frontend/src/lib/api.ts` | typed fetch client + `ApiError` carrying field-level messages |
| `frontend/src/lib/graph.ts` | flow resolution, path checking, type/protocol presentation maps |
| `frontend/src/lib/graphElements.ts` | typed React Flow node/edge data contracts |
| `frontend/src/components/` | canvas, custom node/edge, inspector, dialogs, flow bar, legend, header |
| `frontend/src/components/ui/` | shadcn/ui primitives (Radix + Tailwind + cva) |
| `frontend/src/hooks/useMediaQuery.ts` | desktop/overlay layout switch at Tailwind's `lg` |
| `frontend/vite.config.ts` | `/api` proxy to `http://127.0.0.1:8080`, vitest jsdom config |
| `scripts/dev.sh` | one-command dev: builds and runs the Go binary and Vite together |
| `justfile` (bottom block) | `app-setup`, `app-dev`, `app-backend`, `app-frontend`, `app-test`, `app-reset` |
| `specs/97d1557e_architecture-visualizer.md` | the MVP specification this implements |
| `README.md` | full product/API/limitations documentation |

## The domain model

- **Component types** (canonical list in `domain.go`): `frontend`,
  `backend_service`, `microservice`, `database`, `cache`, `message_broker`,
  `external_api`, `third_party_service`. Each has name, description, a free-form
  `metadata` map (language, runtime, owner, URL…) and a persisted `{x, y}`
  position.
- **Protocols**: `http_rest`, `grpc`, `websockets`, `async_messaging`, `other`.
- **RequestFlow**: a name, description and an ordered list of relationship IDs.
  The implied component order is the source of each edge followed by each
  target.

A flow is *authored*, not captured — nothing observes live traffic. That is
stated in the spec, the README and the code comments.

## Decisions worth knowing

**Snapshot consistency.** `GET /api/architecture` reads all three collections
inside one read transaction (`store.go` `Snapshot`). `store_test.go`'s
`TestSnapshotIsTransactionallyConsistent` injects a concurrent write between the
collection reads via a test-only hook and asserts the write is *absent* — so the
test fails if the transaction is removed.

**Deletion policy.** Deleting a component cascades to its relationships
(foreign keys). Deleting a relationship — *or rewiring an existing one to
different endpoints* — removes any flow that used it (`reconcileFlows`). That
keeps every stored flow a valid connected path by construction instead of
silently truncating a route. The policy is documented at the top of `store.go`,
in the README, and in the delete confirmations.

**Seed once.** The example architecture (11 components, 11 relationships, 2
flows) is written by `seedOnce` under a `meta` marker row. Deleting every row
never re-seeds. `store.OpenWithOptions(path, Options{Seed: false})` gives tests
a blank workspace.

**Strict decoding.** The API caps bodies at 1 MiB and rejects unknown JSON
fields, so a stale client fails loudly instead of silently dropping data.
Errors always use one envelope: `{"error":{"code","message","fields"}}` — 400
invalid, 404 not found, 405, 413 too large. `middleware.go` upgrades the Go
mux's plain-text 404/405 into that envelope.

**Client-side flow rules mirror the server's.** `frontend/src/lib/graph.ts`
(`checkPath`, `outgoingFrom`, `resolveFlow`) applies the same head-to-tail rule
as `domain.ValidateFlowInput`, so the UI can explain a broken path before the
user hits save. The builder constrains each step to edges leaving the component
the previous step arrived at.

**Responsive inspector.** Above Tailwind's `lg` (1024px) the inspector is a
340px sidebar; below it, it becomes a right-hand `Sheet` overlay so the graph
keeps the full width, opened by the header `Inspector` button or automatically
on selection. `useMediaQuery` falls back to `false` where `matchMedia` is
missing.

## How to use it

```bash
just app-setup      # go mod download + bun install
just app-dev        # Go API on http://127.0.0.1:8080, Vite on http://localhost:5173
```

Open http://localhost:5173 — Vite proxies `/api` to Go, so the browser talks to
one origin. `just app-backend` / `just app-frontend` run them separately.
`just app-reset` deletes the SQLite file; the seed returns on next start.
`ARCHVIZ_ADDR` and `ARCHVIZ_DB` override the defaults.

## How to verify it

```bash
just app-test
# or:
cd backend  && go test ./...
cd frontend && bun run test && bun run typecheck && bun run build
```

Backend tests (`domain_test.go`, `store_test.go`, `api_test.go`) cover
seed-once, component/relationship/flow CRUD, missing references, self-links,
invalid and disconnected flows, the cascade and rewire policies, position-only
updates, transactional snapshot consistency, persistence across reopen, and the
HTTP contract (status codes, error envelope, health, 404/405, oversized body).

Frontend tests cover the path builder's connectivity rules, the flow→highlight
mapping (nodes, edges, traversal order, invalid paths), and a jsdom render of
the whole app against a mocked API including the loading, empty,
unreachable-API and narrow-viewport states. `src/test/setup.ts` stubs
`ResizeObserver` and `DOMMatrixReadOnly` (jsdom lacks both, React Flow needs
them); `src/test/viewport.ts` stubs `matchMedia`.

A manual smoke test is written out in `README.md` under *Manual smoke test* —
seeded graph, pan/zoom, node and edge inspection, CRUD for all three entity
types, reload persistence, flow highlight and clear, disconnected-path
rejection, API-down recovery, and the narrow-viewport overlay.

## Intentional MVP limits

One workspace per database file; no accounts, sharing or sync. No undo/redo,
search, filtering, version history or production packaging. Layout is
user-arranged with no auto-layout engine. The component-type and protocol
vocabularies are duplicated in `domain.go` and `frontend/src/lib/types.ts` on
purpose — no code generation while the schema is still settling. `README.md`
lists where to extend next.
