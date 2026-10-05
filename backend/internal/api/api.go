// Package api exposes the architecture graph over a small JSON HTTP API.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"archviz/internal/domain"
	"archviz/internal/store"
)

const maxBodyBytes = 1 << 20 // 1 MiB is plenty for a diagram payload.

// Server wires the HTTP routes onto the store.
type Server struct {
	store  *store.Store
	logger *slog.Logger
	mux    *http.ServeMux
}

// New builds the HTTP handler for the API.
func New(s *store.Store, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	srv := &Server{store: s, logger: logger, mux: http.NewServeMux()}
	srv.routes()
	return srv
}

// ServeHTTP makes Server an http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	withJSONErrors(s.mux).ServeHTTP(w, r)
}

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /api/health", s.handleHealth)
	m.HandleFunc("GET /api/architecture", s.handleArchitecture)

	m.HandleFunc("GET /api/components", s.handleListComponents)
	m.HandleFunc("POST /api/components", s.handleCreateComponent)
	m.HandleFunc("GET /api/components/{id}", s.handleGetComponent)
	m.HandleFunc("PUT /api/components/{id}", s.handleUpdateComponent)
	m.HandleFunc("DELETE /api/components/{id}", s.handleDeleteComponent)
	m.HandleFunc("PUT /api/components/{id}/position", s.handleUpdatePosition)

	m.HandleFunc("GET /api/relationships", s.handleListRelationships)
	m.HandleFunc("POST /api/relationships", s.handleCreateRelationship)
	m.HandleFunc("GET /api/relationships/{id}", s.handleGetRelationship)
	m.HandleFunc("PUT /api/relationships/{id}", s.handleUpdateRelationship)
	m.HandleFunc("DELETE /api/relationships/{id}", s.handleDeleteRelationship)

	m.HandleFunc("GET /api/request-flows", s.handleListFlows)
	m.HandleFunc("POST /api/request-flows", s.handleCreateFlow)
	m.HandleFunc("GET /api/request-flows/{id}", s.handleGetFlow)
	m.HandleFunc("PUT /api/request-flows/{id}", s.handleUpdateFlow)
	m.HandleFunc("DELETE /api/request-flows/{id}", s.handleDeleteFlow)
}

// ── responses ───────────────────────────────────────────────────────────────

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	var ve *domain.ValidationError
	var nf *domain.NotFoundError
	switch {
	case errors.As(err, &ve):
		writeJSON(w, http.StatusBadRequest, errorEnvelope{errorBody{Code: "invalid", Message: ve.Message, Fields: ve.Fields}})
	case errors.As(err, &nf):
		writeJSON(w, http.StatusNotFound, errorEnvelope{errorBody{Code: "not_found", Message: nf.Message}})
	default:
		slog.Error("request failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorEnvelope{errorBody{Code: "internal", Message: "Something went wrong on the server."}})
	}
}

// decode reads a JSON body into v, rejecting unknown fields and oversized bodies.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, errorEnvelope{errorBody{Code: "too_large", Message: "Request body is too large."}})
			return false
		}
		msg := "Request body is not valid JSON."
		if !errors.Is(err, io.EOF) {
			msg = fmt.Sprintf("Request body is not valid JSON: %s", err.Error())
		}
		if errors.Is(err, io.EOF) {
			msg = "Request body is empty."
		}
		writeJSON(w, http.StatusBadRequest, errorEnvelope{errorBody{Code: "invalid", Message: msg}})
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, errorEnvelope{errorBody{Code: "invalid", Message: "Request body must contain a single JSON object."}})
		return false
	}
	return true
}

// ── health / snapshot ───────────────────────────────────────────────────────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DB().PingContext(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "time": time.Now().UTC()})
}

func (s *Server) handleArchitecture(w http.ResponseWriter, r *http.Request) {
	snap, err := s.store.Snapshot()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// ── components ──────────────────────────────────────────────────────────────

func (s *Server) handleListComponents(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListComponents()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"components": items})
}

func (s *Server) handleGetComponent(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetComponent(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleCreateComponent(w http.ResponseWriter, r *http.Request) {
	var in domain.ComponentInput
	if !decode(w, r, &in) {
		return
	}
	c, err := s.store.CreateComponent(in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleUpdateComponent(w http.ResponseWriter, r *http.Request) {
	var in domain.ComponentInput
	if !decode(w, r, &in) {
		return
	}
	c, err := s.store.UpdateComponent(r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteComponent(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteComponent(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdatePosition(w http.ResponseWriter, r *http.Request) {
	var pos domain.Position
	if !decode(w, r, &pos) {
		return
	}
	c, err := s.store.UpdatePosition(r.PathValue("id"), pos)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// ── relationships ───────────────────────────────────────────────────────────

func (s *Server) handleListRelationships(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListRelationships()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"relationships": items})
}

func (s *Server) handleGetRelationship(w http.ResponseWriter, r *http.Request) {
	rel, err := s.store.GetRelationship(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rel)
}

func (s *Server) handleCreateRelationship(w http.ResponseWriter, r *http.Request) {
	var in domain.RelationshipInput
	if !decode(w, r, &in) {
		return
	}
	rel, err := s.store.CreateRelationship(in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

func (s *Server) handleUpdateRelationship(w http.ResponseWriter, r *http.Request) {
	var in domain.RelationshipInput
	if !decode(w, r, &in) {
		return
	}
	rel, err := s.store.UpdateRelationship(r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rel)
}

func (s *Server) handleDeleteRelationship(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteRelationship(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── request flows ───────────────────────────────────────────────────────────

func (s *Server) handleListFlows(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListRequestFlows()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request_flows": items})
}

func (s *Server) handleGetFlow(w http.ResponseWriter, r *http.Request) {
	f, err := s.store.GetRequestFlow(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) handleCreateFlow(w http.ResponseWriter, r *http.Request) {
	var in domain.RequestFlowInput
	if !decode(w, r, &in) {
		return
	}
	f, err := s.store.CreateRequestFlow(in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (s *Server) handleUpdateFlow(w http.ResponseWriter, r *http.Request) {
	var in domain.RequestFlowInput
	if !decode(w, r, &in) {
		return
	}
	f, err := s.store.UpdateRequestFlow(r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) handleDeleteFlow(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteRequestFlow(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
