package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"archviz/internal/domain"
	"archviz/internal/store"
)

func newServer(t *testing.T) http.Handler {
	t.Helper()
	st, err := store.OpenWithOptions(":memory:", store.Options{Seed: false})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func newSeededServer(t *testing.T) http.Handler {
	t.Helper()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func do(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			reader = strings.NewReader(b)
		default:
			raw, err := json.Marshal(b)
			if err != nil {
				t.Fatalf("marshal body: %v", err)
			}
			reader = bytes.NewReader(raw)
		}
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return out
}

type errBody struct {
	Error struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Fields  map[string]string `json:"fields"`
	} `json:"error"`
}

func TestHealthEndpoint(t *testing.T) {
	rec := do(t, newServer(t), http.MethodGet, "/api/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	got := decodeJSON[map[string]any](t, rec)
	if got["status"] != "ok" {
		t.Fatalf("unexpected health payload: %v", got)
	}
}

func TestArchitectureSnapshotIsComplete(t *testing.T) {
	rec := do(t, newSeededServer(t), http.MethodGet, "/api/architecture", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	snap := decodeJSON[domain.Architecture](t, rec)
	if len(snap.Components) == 0 || len(snap.Relationships) == 0 || len(snap.RequestFlows) == 0 {
		t.Fatalf("expected seeded data, got %+v", snap)
	}
}

func TestEmptySnapshotReturnsEmptyArrays(t *testing.T) {
	rec := do(t, newServer(t), http.MethodGet, "/api/architecture", nil)
	body := rec.Body.String()
	for _, key := range []string{`"components":[]`, `"relationships":[]`, `"request_flows":[]`} {
		if !strings.Contains(body, key) {
			t.Fatalf("expected %s in %s", key, body)
		}
	}
}

func TestComponentLifecycle(t *testing.T) {
	h := newServer(t)

	rec := do(t, h, http.MethodPost, "/api/components", domain.ComponentInput{
		Name: "Gateway", Type: domain.TypeBackendService, Position: &domain.Position{X: 10, Y: 20},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	created := decodeJSON[domain.Component](t, rec)

	rec = do(t, h, http.MethodGet, "/api/components/"+created.ID, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}

	rec = do(t, h, http.MethodPut, "/api/components/"+created.ID+"/position", domain.Position{X: 99, Y: 100})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	moved := decodeJSON[domain.Component](t, rec)
	if moved.Position.X != 99 || moved.Position.Y != 100 {
		t.Fatalf("position not saved: %+v", moved.Position)
	}
	if moved.Name != "Gateway" {
		t.Fatalf("position update clobbered the name: %+v", moved)
	}

	rec = do(t, h, http.MethodDelete, "/api/components/"+created.ID, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	rec = do(t, h, http.MethodGet, "/api/components/"+created.ID, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 after delete, got %d", rec.Code)
	}
	if got := decodeJSON[errBody](t, rec); got.Error.Code != "not_found" {
		t.Fatalf("unexpected error code: %q", got.Error.Code)
	}
}

func TestComponentValidationErrors(t *testing.T) {
	h := newServer(t)

	rec := do(t, h, http.MethodPost, "/api/components", map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	got := decodeJSON[errBody](t, rec)
	if got.Error.Code != "invalid" || got.Error.Fields["name"] == "" {
		t.Fatalf("expected a name field error, got %+v", got.Error)
	}

	rec = do(t, h, http.MethodPost, "/api/components", `{"name":"X","type":"frontend","nope":1}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields should be rejected, got %d", rec.Code)
	}

	rec = do(t, h, http.MethodPost, "/api/components", `{not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed JSON should be 400, got %d", rec.Code)
	}

	rec = do(t, h, http.MethodPost, "/api/components", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty body should be 400, got %d", rec.Code)
	}
}

func TestOversizedBodyRejected(t *testing.T) {
	h := newServer(t)
	huge := `{"name":"` + strings.Repeat("a", maxBodyBytes+16) + `","type":"frontend"}`
	rec := do(t, h, http.MethodPost, "/api/components", huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d", rec.Code)
	}
}

func TestRelationshipValidationAndFlowCascadeOverHTTP(t *testing.T) {
	h := newServer(t)

	mkComponent := func(name string, typ domain.ComponentType) domain.Component {
		rec := do(t, h, http.MethodPost, "/api/components", domain.ComponentInput{Name: name, Type: typ})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create component: %d %s", rec.Code, rec.Body.String())
		}
		return decodeJSON[domain.Component](t, rec)
	}
	a := mkComponent("A", domain.TypeFrontend)
	b := mkComponent("B", domain.TypeBackendService)

	rec := do(t, h, http.MethodPost, "/api/relationships", domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: "ghost", Label: "call", Protocol: domain.ProtocolHTTP,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("dangling reference should be 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = do(t, h, http.MethodPost, "/api/relationships", domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "call", Protocol: domain.ProtocolGRPC,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	rel := decodeJSON[domain.Relationship](t, rec)

	rec = do(t, h, http.MethodPost, "/api/request-flows", domain.RequestFlowInput{
		Name: "Flow", RelationshipIDs: []string{rel.ID},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}
	flow := decodeJSON[domain.RequestFlow](t, rec)

	// Deleting a component the flow depends on removes the flow too.
	rec = do(t, h, http.MethodDelete, "/api/components/"+a.ID, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	rec = do(t, h, http.MethodGet, "/api/request-flows/"+flow.ID, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("dependent flow should be gone, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestFlowValidationOverHTTP(t *testing.T) {
	h := newServer(t)

	mk := func(name string, typ domain.ComponentType) domain.Component {
		rec := do(t, h, http.MethodPost, "/api/components", domain.ComponentInput{Name: name, Type: typ})
		return decodeJSON[domain.Component](t, rec)
	}
	mkRel := func(src, tgt string) domain.Relationship {
		rec := do(t, h, http.MethodPost, "/api/relationships", domain.RelationshipInput{
			SourceComponentID: src, TargetComponentID: tgt, Label: "hop", Protocol: domain.ProtocolHTTP,
		})
		return decodeJSON[domain.Relationship](t, rec)
	}
	a := mk("A", domain.TypeFrontend)
	b := mk("B", domain.TypeBackendService)
	c := mk("C", domain.TypeDatabase)
	e1 := mkRel(a.ID, b.ID)
	e2 := mkRel(b.ID, c.ID)

	rec := do(t, h, http.MethodPost, "/api/request-flows", domain.RequestFlowInput{
		Name: "Broken", RelationshipIDs: []string{e1.ID, e2.ID, e1.ID},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("disconnected flow should be 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := decodeJSON[errBody](t, rec); got.Error.Fields["relationship_ids"] == "" {
		t.Fatalf("expected a relationship_ids error, got %+v", got.Error)
	}

	rec = do(t, h, http.MethodPost, "/api/request-flows", domain.RequestFlowInput{
		Name: "Broken", RelationshipIDs: []string{"does-not-exist"},
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing relationship should be 400, got %d", rec.Code)
	}

	rec = do(t, h, http.MethodPost, "/api/request-flows", domain.RequestFlowInput{
		Name: "Good", RelationshipIDs: []string{e1.ID, e2.ID},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("valid flow should be 201, got %d: %s", rec.Code, rec.Body.String())
	}
	flow := decodeJSON[domain.RequestFlow](t, rec)

	rec = do(t, h, http.MethodPut, "/api/request-flows/"+flow.ID, domain.RequestFlowInput{
		Name: "Good v2", RelationshipIDs: []string{e1.ID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	updated := decodeJSON[domain.RequestFlow](t, rec)
	if updated.Name != "Good v2" || len(updated.RelationshipIDs) != 1 {
		t.Fatalf("update not applied: %+v", updated)
	}

	rec = do(t, h, http.MethodDelete, "/api/request-flows/"+flow.ID, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	rec = do(t, h, http.MethodDelete, "/api/request-flows/"+flow.ID, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	rec := do(t, newServer(t), http.MethodPatch, "/api/components", nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rec.Code)
	}
	got := decodeJSON[errBody](t, rec)
	if got.Error.Code != "method_not_allowed" {
		t.Fatalf("want a JSON error envelope, got %q", rec.Body.String())
	}
}

func TestUnknownRouteReturnsJSON(t *testing.T) {
	rec := do(t, newServer(t), http.MethodGet, "/api/nope", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("want a JSON content type, got %q", ct)
	}
	got := decodeJSON[errBody](t, rec)
	if got.Error.Code != "not_found" || got.Error.Message == "" {
		t.Fatalf("unexpected error envelope: %+v", got.Error)
	}
}
