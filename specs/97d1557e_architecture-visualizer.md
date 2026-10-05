# MVP plan: Architecture visualizer

## Product decision

Build a local-first, single-workspace architecture editor for developers. The home screen is a dark, developer-tool-style architecture canvas, not a generic multi-purpose diagramming suite. A user can create and maintain an architecture, inspect components and communication links, and save named request flows that highlight a route through that architecture. No accounts, remote hosting, telemetry ingestion, collaboration, auto-layout service, AI, or deployment integrations in this MVP.

### MVP behavior
- Represent components as typed nodes: frontend, backend service, microservice, database, cache, message broker, external API, and third-party service. Each has a name, optional description, and editable metadata (for example language, runtime, owner, or URL); type-specific fields remain flexible rather than over-modeling them.
- Represent directed relationships as edges with source/target components, label, protocol (HTTP/REST, gRPC, WebSockets, asynchronous messaging, or other), and optional description. Invalid/self links and links to missing components are rejected.
- Show a seeded example architecture on first run, but allow editing/deleting it and adding components/relationships through toolbar actions and forms. Persist graph positions and edits across refreshes.
- Use an interactive graph for pan, zoom, fit-to-view, selection, and relationship selection. Selecting a node/edge opens a details inspector; edit and delete actions are available there. A visible component-type legend and clear protocol labels help explain the diagram.
- Provide a request-flow picker and CRUD for named, manually defined flows. A flow contains an ordered sequence of relationship IDs (and therefore the implied ordered components). Validate that every edge exists and each edge's target is the next edge's source; permit a one-edge flow. Selecting a flow highlights its nodes and edges; non-flow graph elements are dimmed. Clear selection restores the graph. This is an explicit MVP representation, not runtime tracing.
- Keep the workspace local and single-user. No multi-workspace switching is required.

## Technical decisions
- Repository is currently an SSSF tooling repository with no product app at its root (`specs/` does not exist); leave existing `adws/` and `.claude/` tooling untouched. Put a standalone product in `backend/` and `frontend/`.
- Backend: Go HTTP JSON API, SQLite file at `data/architecture.db`, using a pure-Go SQLite driver to keep local setup straightforward. Keep API and persistence in one Go process. Bind to `127.0.0.1:8080` by default; configure via environment variables. Serve JSON only; Vite proxies `/api` in development. Do not add auth or CORS complexity.
- Frontend: React + TypeScript + Vite; React Flow (`@xyflow/react`) for the architecture graph; shadcn/ui primitives (Radix + Tailwind) for toolbar, forms, dialogs, select controls, and inspector; Lucide icons. Use a small typed fetch client and lightweight React state rather than adding a server-state framework unless implementation needs it.
- Share the API contract conceptually through typed TS interfaces and Go JSON structs; do not introduce code generation. Use stable UUIDs and timestamps. Persist node positions as x/y on components.
- Serve the frontend with Vite during development. Keep production packaging out of scope; optionally provide a Go health endpoint for local readiness.

## Data/API contract
- `components`: id, name, type, description, metadata object, position `{x,y}`, created_at, updated_at.
- `relationships`: id, source_component_id, target_component_id, label, protocol, description, created_at, updated_at.
- `request_flows`: id, name, description, ordered `relationship_ids`, created_at, updated_at. Return expanded component/relationship references as needed by the UI, or resolve them client-side from the graph response.
- `GET /api/architecture` returns `{components, relationships, request_flows}` as one consistent initial-load snapshot.
- CRUD endpoints: `/api/components`, `/api/relationships`, `/api/request-flows`; collection GET/POST and item PUT/DELETE. `PUT /api/components/{id}/position` may be used for drag persistence to avoid rewriting unrelated fields. `GET /api/health` returns a small readiness response.
- Use JSON request/response bodies, 400 for invalid fields or invalid flow paths, 404 for missing IDs, and consistent JSON error objects. Deleting a component removes or rejects dependent relationships/flows; choose cascading deletion transactionally and remove deleted edge IDs from flows, rejecting a result that would make a flow disconnected (or remove the invalid flow with a clear documented policy). Prefer cascade component -> its relationships -> affected flows, with a test and deterministic policy. Frontend confirms destructive deletes.
- Seed a small coherent example only when the database has no architecture rows (e.g. web app -> API -> service -> database, plus an external API); seed at least one valid example flow. Never re-seed after a user deletes all rows; track initialization explicitly or use a one-time seed marker.

## Implementation plan

### 1. Backend foundation and domain
- Add `backend/go.mod`, `backend/cmd/server/main.go`, and `backend/internal/{domain,store,api}` packages (split across files as useful).
- Define allowed component types/protocols, validation, JSON shapes, and SQLite schema/migrations. Use transactions for multi-row mutations and seed-once behavior. Ensure SQLite foreign keys are enabled.
- Implement API routing, request decoding/size limits, status codes, JSON errors, graceful server shutdown, and env-configurable address/database path. Keep handlers thin and domain validation testable.
- Add tests for schema/seed, component/relationship/flow CRUD, missing references, invalid and disconnected flows, cascade policy, position updates, and HTTP response contracts (`backend/internal/.../*_test.go`). Include a server-level health test.

### 2. Frontend shell and graph
- Scaffold `frontend/` with Vite React TS, Tailwind and shadcn/ui conventions, `@xyflow/react`, and Lucide. Add `frontend/src/lib/types.ts`, `api.ts`, and `frontend/vite.config.ts` proxying `/api` to Go.
- Implement the app shell in `frontend/src/App.tsx` and global styling in `frontend/src/index.css`: compact product header, architecture name/status, graph toolbar, flow selector, graph canvas, inspector panel, loading/error/empty states. Use a restrained dark palette, readable node categories, semantic protocol badges, keyboard-accessible controls, and responsive layout.
- Implement typed custom component nodes and relationship edges, graph state mapping, pan/zoom/fit controls, selection behavior, and position persistence (debounce or save on drag end). Avoid writing the whole graph back on every drag event.
- Add forms/dialogs for create/edit component and relationship. Validate required labels/targets client-side and display backend validation errors. Include clear destructive confirmation. Node/edge inspector exposes all saved detail and edit/delete controls.

### 3. Request flows, polish, and documentation
- Add flow list/create/edit/delete UI and ordered relationship selection (or a practical path builder constrained to connected outgoing edges). Validate connectivity before save and explain invalid paths. Choosing a flow applies node/edge highlighting and dimming; clearing it resets styles.
- Add graph empty/loading/API failure recovery, no-flow and no-selection states, and preserve layout on refresh. Ensure edit/delete changes update graph and selection predictably.
- Add root `README.md` with prerequisites, first-run commands, database location/reset, API outline, MVP limitations, and verification instructions. Add root `justfile` recipes or a simple root `Makefile` for install/dev/test; prefer a single-command local experience that starts Go and Vite, plus separate backend/frontend checks. Do not alter the existing SSSF justfile workflows except to add non-conflicting recipes if appropriate.

## Files expected
- New `backend/` Go module with `cmd/server/`, `internal/domain/`, `internal/store/`, `internal/api/`, and focused tests.
- New `frontend/` Vite React TS app with `src/App.tsx`, `src/index.css`, `src/components/` (graph, inspector, forms, flow controls), `src/lib/{types,api}.ts`, and package/config files.
- New root `README.md`; update root `justfile` only if adding non-conflicting local app recipes is preferable to a Makefile.
- Add `.gitignore` entries for generated frontend dependencies/build output and local SQLite database; do not commit runtime database or `node_modules`.

## Verification and acceptance
1. Backend: `cd backend && go test ./...`; test invalid IDs, protocols/types, dangling references, flow continuity, database persistence, cascade policy, and health endpoint.
2. Frontend: `cd frontend && bun install` (or documented package manager), `bun run typecheck`, `bun run lint` if configured, and `bun run build`. Add focused tests for flow path validation/highlighting mapping if a test runner is introduced; keep the test setup proportional.
3. End-to-end manual smoke test from documented one-command dev startup: open the app, see seeded graph, pan/zoom, select and inspect node/edge, add/edit/delete each entity category, reload and confirm persistence and saved positions, create/select/clear a request flow and verify exact path highlighting, and confirm invalid/disconnected flow feedback and destructive-delete confirmation.
4. Confirm only loopback local service is needed and no auth/cloud/observability integration was introduced.

## Scope guardrails / assumptions
- Request flow means a developer-authored logical path, not a live request capture. Runtime traffic discovery and automatic topology import are future work.
- Graph layout is user-arranged and persisted; no sophisticated auto-layout is needed. Seed positions should make the sample immediately legible.
- One local architecture per SQLite database is sufficient; no authentication, cloud sync, import/export, version history, deployment, metrics, or multi-user support.
- Keep CRUD quality ahead of breadth: accessible controls, useful errors, and persistence are MVP requirements; advanced search, minimap customizations, undo/redo, and arbitrary diagram shapes are not.
