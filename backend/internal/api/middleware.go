package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
)

// jsonErrorWriter upgrades the standard library mux's plain-text 404 and 405
// responses into the same JSON error envelope the rest of the API uses. Bodies
// that a handler already produced as JSON pass straight through.
type jsonErrorWriter struct {
	http.ResponseWriter
	status    int
	buf       bytes.Buffer
	intercept bool
	wrote     bool
}

func (w *jsonErrorWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.status = code
	contentType := w.Header().Get("Content-Type")
	if (code == http.StatusNotFound || code == http.StatusMethodNotAllowed) &&
		!strings.Contains(contentType, "application/json") {
		w.intercept = true
		w.wrote = true
		return
	}
	w.wrote = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *jsonErrorWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if w.intercept {
		return w.buf.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// Flush lets streaming handlers keep working through the wrapper.
func (w *jsonErrorWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *jsonErrorWriter) finish() {
	if !w.intercept {
		return
	}
	code := "not_found"
	message := "That endpoint does not exist."
	if w.status == http.StatusMethodNotAllowed {
		code = "method_not_allowed"
		message = "That method is not supported for this endpoint."
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Del("X-Content-Type-Options")
	w.ResponseWriter.WriteHeader(w.status)
	_ = json.NewEncoder(w.ResponseWriter).Encode(errorEnvelope{
		Error: errorBody{Code: code, Message: message},
	})
}

// withJSONErrors wraps a handler so unmapped routes still answer with JSON.
func withJSONErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writer := &jsonErrorWriter{ResponseWriter: w}
		defer writer.finish()
		next.ServeHTTP(writer, r)
	})
}
