// Package store persists the architecture graph in a local SQLite database.
//
// Deletion policy (documented and tested): deleting a component cascades to its
// relationships, and any request flow that referenced a deleted relationship is
// removed with it. Rewiring an existing relationship to different endpoints is
// treated the same way. This keeps every stored flow a valid, connected path by
// construction rather than silently truncating a route.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"archviz/internal/domain"
)

// Store is the SQLite-backed repository for the architecture graph.
type Store struct {
	db *sql.DB
}

// queryer is the subset of *sql.DB and *sql.Tx the read helpers need, so the
// same code can run inside a transaction or directly on the pool.
type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// snapshotReadHook runs between the collection reads inside Snapshot. It is nil
// in production; tests install it to interleave a concurrent write and prove
// that the snapshot is transactionally consistent.
var snapshotReadHook = func(string) {}

// NewUUID returns a random RFC-4122 v4 identifier.
func NewUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("uuid: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]))
}

// Options tunes how a Store is opened.
type Options struct {
	// Seed inserts the example architecture when the database has never been
	// initialised. Tests that want a blank workspace set this to false.
	Seed bool
}

// Open opens (creating if needed) the database at path, applies migrations and
// seeds the example architecture on first run. Use ":memory:" for an ephemeral
// database.
func Open(path string) (*Store, error) {
	return OpenWithOptions(path, Options{Seed: true})
}

// OpenWithOptions is Open with explicit options.
func OpenWithOptions(path string, opts Options) (*Store, error) {
	if path != ":memory:" && !strings.HasPrefix(path, "file:") {
		if dir := filepath.Dir(path); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create database directory: %w", err)
			}
		}
	}
	dsn := path
	if path != ":memory:" {
		dsn = "file:" + path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Keep a single writer connection: pure-Go SQLite plus WAL is happy with
	// one writer, and this avoids "database is locked" surprises locally.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if opts.Seed {
		if err := s.seedOnce(); err != nil {
			db.Close()
			return nil, err
		}
	}
	return s, nil
}

// Close releases the database handle.
func (s *Store) Close() error { return s.db.Close() }

// DB exposes the underlying handle (used by tests).
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS meta (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS components (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			type        TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			metadata    TEXT NOT NULL DEFAULT '{}',
			pos_x       REAL NOT NULL DEFAULT 0,
			pos_y       REAL NOT NULL DEFAULT 0,
			created_at  TEXT NOT NULL,
			updated_at  TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS relationships (
			id                  TEXT PRIMARY KEY,
			source_component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
			target_component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
			label               TEXT NOT NULL DEFAULT '',
			protocol            TEXT NOT NULL,
			description         TEXT NOT NULL DEFAULT '',
			created_at          TEXT NOT NULL,
			updated_at          TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS request_flows (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			created_at  TEXT NOT NULL,
			updated_at  TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS request_flow_steps (
			flow_id         TEXT NOT NULL REFERENCES request_flows(id) ON DELETE CASCADE,
			step_index      INTEGER NOT NULL,
			relationship_id TEXT NOT NULL,
			PRIMARY KEY (flow_id, step_index)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_component_id);`,
		`CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_component_id);`,
		`CREATE INDEX IF NOT EXISTS idx_steps_rel ON request_flow_steps(relationship_id);`,
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return tx.Commit()
}

// seedOnce inserts the example architecture exactly once, tracked by a marker
// row in `meta`. Deleting every row afterwards never triggers a re-seed.
func (s *Store) seedOnce() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var marker string
	err = tx.QueryRow(`SELECT value FROM meta WHERE key = 'seeded'`).Scan(&marker)
	if err == nil {
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err := seed(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO meta(key, value) VALUES('seeded', ?)`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return err
	}
	return tx.Commit()
}

// Snapshot returns the whole architecture from a single read transaction, so
// the three collections always describe the same database state even while
// another connection is writing.
func (s *Store) Snapshot() (domain.Architecture, error) {
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return domain.Architecture{}, err
	}
	defer tx.Rollback()

	comps, err := listComponents(tx)
	if err != nil {
		return domain.Architecture{}, fmt.Errorf("read components: %w", err)
	}
	snapshotReadHook("components")

	rels, err := listRelationships(tx)
	if err != nil {
		return domain.Architecture{}, fmt.Errorf("read relationships: %w", err)
	}
	snapshotReadHook("relationships")

	flows, err := listRequestFlows(tx)
	if err != nil {
		return domain.Architecture{}, fmt.Errorf("read request flows: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return domain.Architecture{}, err
	}
	return domain.Architecture{Components: comps, Relationships: rels, RequestFlows: flows}, nil
}

// ── components ──────────────────────────────────────────────────────────────

const componentCols = `id, name, type, description, metadata, pos_x, pos_y, created_at, updated_at`

// ListComponents returns every component ordered by creation time.
func (s *Store) ListComponents() ([]domain.Component, error) { return listComponents(s.db) }

func listComponents(q queryer) ([]domain.Component, error) {
	rows, err := q.Query(`SELECT ` + componentCols + ` FROM components ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Component{}
	for rows.Next() {
		c, err := scanComponent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetComponent loads one component by ID.
func (s *Store) GetComponent(id string) (domain.Component, error) {
	row := s.db.QueryRow(`SELECT `+componentCols+` FROM components WHERE id = ?`, id)
	c, err := scanComponent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Component{}, &domain.NotFoundError{Message: "Component not found."}
	}
	return c, err
}

// CreateComponent validates and inserts a component.
func (s *Store) CreateComponent(in domain.ComponentInput) (domain.Component, error) {
	if err := domain.ValidateComponentInput(in); err != nil {
		return domain.Component{}, err
	}
	now := time.Now().UTC()
	pos := domain.Position{}
	if in.Position != nil {
		pos = *in.Position
	}
	c := domain.Component{
		ID:          NewUUID(),
		Name:        strings.TrimSpace(in.Name),
		Type:        in.Type,
		Description: in.Description,
		Metadata:    normaliseMetadata(in.Metadata),
		Position:    pos,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	meta, err := json.Marshal(c.Metadata)
	if err != nil {
		return domain.Component{}, err
	}
	_, err = s.db.Exec(`INSERT INTO components (`+componentCols+`) VALUES (?,?,?,?,?,?,?,?,?)`,
		c.ID, c.Name, string(c.Type), c.Description, string(meta), c.Position.X, c.Position.Y,
		c.CreatedAt.Format(time.RFC3339Nano), c.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return domain.Component{}, err
	}
	return c, nil
}

// UpdateComponent replaces the writable fields of a component. A nil position
// in the input keeps the stored position.
func (s *Store) UpdateComponent(id string, in domain.ComponentInput) (domain.Component, error) {
	if err := domain.ValidateComponentInput(in); err != nil {
		return domain.Component{}, err
	}
	current, err := s.GetComponent(id)
	if err != nil {
		return domain.Component{}, err
	}
	pos := current.Position
	if in.Position != nil {
		pos = *in.Position
	}
	c := current
	c.Name = strings.TrimSpace(in.Name)
	c.Type = in.Type
	c.Description = in.Description
	c.Metadata = normaliseMetadata(in.Metadata)
	c.Position = pos
	c.UpdatedAt = time.Now().UTC()
	meta, err := json.Marshal(c.Metadata)
	if err != nil {
		return domain.Component{}, err
	}
	_, err = s.db.Exec(`UPDATE components SET name=?, type=?, description=?, metadata=?, pos_x=?, pos_y=?, updated_at=? WHERE id=?`,
		c.Name, string(c.Type), c.Description, string(meta), c.Position.X, c.Position.Y,
		c.UpdatedAt.Format(time.RFC3339Nano), c.ID)
	if err != nil {
		return domain.Component{}, err
	}
	return c, nil
}

// UpdatePosition persists a drag result without touching other fields.
func (s *Store) UpdatePosition(id string, pos domain.Position) (domain.Component, error) {
	res, err := s.db.Exec(`UPDATE components SET pos_x=?, pos_y=?, updated_at=? WHERE id=?`,
		pos.X, pos.Y, time.Now().UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return domain.Component{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.Component{}, &domain.NotFoundError{Message: "Component not found."}
	}
	return s.GetComponent(id)
}

// DeleteComponent removes a component, cascades to its relationships, and
// reconciles affected request flows. It is transactional.
func (s *Store) DeleteComponent(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM components WHERE id = ?`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return &domain.NotFoundError{Message: "Component not found."}
	} else if err != nil {
		return err
	}

	relIDs, err := relationshipIDsForComponent(tx, id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM components WHERE id = ?`, id); err != nil {
		return err
	}
	if err := reconcileFlows(tx, relIDs); err != nil {
		return err
	}
	return tx.Commit()
}

// ── relationships ───────────────────────────────────────────────────────────

const relationshipCols = `id, source_component_id, target_component_id, label, protocol, description, created_at, updated_at`

// ListRelationships returns every relationship ordered by creation time.
func (s *Store) ListRelationships() ([]domain.Relationship, error) {
	return listRelationships(s.db)
}

func listRelationships(q queryer) ([]domain.Relationship, error) {
	rows, err := q.Query(`SELECT ` + relationshipCols + ` FROM relationships ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Relationship{}
	for rows.Next() {
		r, err := scanRelationship(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRelationship loads one relationship by ID.
func (s *Store) GetRelationship(id string) (domain.Relationship, error) {
	row := s.db.QueryRow(`SELECT `+relationshipCols+` FROM relationships WHERE id = ?`, id)
	r, err := scanRelationship(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Relationship{}, &domain.NotFoundError{Message: "Relationship not found."}
	}
	return r, err
}

// RelationshipMap loads all relationships keyed by ID (used for flow checks).
func (s *Store) RelationshipMap() (map[string]domain.Relationship, error) {
	rels, err := s.ListRelationships()
	if err != nil {
		return nil, err
	}
	out := make(map[string]domain.Relationship, len(rels))
	for _, r := range rels {
		out[r.ID] = r
	}
	return out, nil
}

// CreateRelationship validates references and inserts a relationship.
func (s *Store) CreateRelationship(in domain.RelationshipInput) (domain.Relationship, error) {
	if err := domain.ValidateRelationshipInput(in); err != nil {
		return domain.Relationship{}, err
	}
	if err := s.assertComponentsExist(in.SourceComponentID, in.TargetComponentID); err != nil {
		return domain.Relationship{}, err
	}
	now := time.Now().UTC()
	r := domain.Relationship{
		ID:                NewUUID(),
		SourceComponentID: in.SourceComponentID,
		TargetComponentID: in.TargetComponentID,
		Label:             strings.TrimSpace(in.Label),
		Protocol:          in.Protocol,
		Description:       in.Description,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	_, err := s.db.Exec(`INSERT INTO relationships (`+relationshipCols+`) VALUES (?,?,?,?,?,?,?,?)`,
		r.ID, r.SourceComponentID, r.TargetComponentID, r.Label, string(r.Protocol), r.Description,
		r.CreatedAt.Format(time.RFC3339Nano), r.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return domain.Relationship{}, err
	}
	return r, nil
}

// UpdateRelationship replaces the writable fields of a relationship.
func (s *Store) UpdateRelationship(id string, in domain.RelationshipInput) (domain.Relationship, error) {
	if err := domain.ValidateRelationshipInput(in); err != nil {
		return domain.Relationship{}, err
	}
	if err := s.assertComponentsExist(in.SourceComponentID, in.TargetComponentID); err != nil {
		return domain.Relationship{}, err
	}
	current, err := s.GetRelationship(id)
	if err != nil {
		return domain.Relationship{}, err
	}
	// Rewiring an edge can disconnect flows that used it: reconcile after.
	tx, err := s.db.Begin()
	if err != nil {
		return domain.Relationship{}, err
	}
	defer tx.Rollback()

	changedEndpoints := current.SourceComponentID != in.SourceComponentID ||
		current.TargetComponentID != in.TargetComponentID

	j := current
	j.SourceComponentID = in.SourceComponentID
	j.TargetComponentID = in.TargetComponentID
	j.Label = strings.TrimSpace(in.Label)
	j.Protocol = in.Protocol
	j.Description = in.Description
	j.UpdatedAt = time.Now().UTC()

	if _, err := tx.Exec(`UPDATE relationships SET source_component_id=?, target_component_id=?, label=?, protocol=?, description=?, updated_at=? WHERE id=?`,
		j.SourceComponentID, j.TargetComponentID, j.Label, string(j.Protocol), j.Description,
		j.UpdatedAt.Format(time.RFC3339Nano), j.ID); err != nil {
		return domain.Relationship{}, err
	}
	if changedEndpoints {
		if err := reconcileFlows(tx, []string{j.ID}); err != nil {
			return domain.Relationship{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.Relationship{}, err
	}
	return j, nil
}

// DeleteRelationship removes a relationship and reconciles affected flows.
func (s *Store) DeleteRelationship(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM relationships WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return &domain.NotFoundError{Message: "Relationship not found."}
	}
	if err := reconcileFlows(tx, []string{id}); err != nil {
		return err
	}
	return tx.Commit()
}

// ── request flows ───────────────────────────────────────────────────────────

// ListRequestFlows returns every flow with its ordered steps.
func (s *Store) ListRequestFlows() ([]domain.RequestFlow, error) {
	return listRequestFlows(s.db)
}

func listRequestFlows(q queryer) ([]domain.RequestFlow, error) {
	rows, err := q.Query(`SELECT id, name, description, created_at, updated_at FROM request_flows ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.RequestFlow{}
	for rows.Next() {
		f, err := scanFlow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		steps, err := flowSteps(q, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].RelationshipIDs = steps
	}
	return out, nil
}

// GetRequestFlow loads one flow by ID.
func (s *Store) GetRequestFlow(id string) (domain.RequestFlow, error) {
	row := s.db.QueryRow(`SELECT id, name, description, created_at, updated_at FROM request_flows WHERE id = ?`, id)
	f, err := scanFlow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.RequestFlow{}, &domain.NotFoundError{Message: "Request flow not found."}
	}
	if err != nil {
		return domain.RequestFlow{}, err
	}
	f.RelationshipIDs, err = flowSteps(s.db, f.ID)
	if err != nil {
		return domain.RequestFlow{}, err
	}
	return f, nil
}

func flowSteps(q queryer, flowID string) ([]string, error) {
	rows, err := q.Query(`SELECT relationship_id FROM request_flow_steps WHERE flow_id = ? ORDER BY step_index`, flowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// CreateRequestFlow validates the path and inserts a flow.
func (s *Store) CreateRequestFlow(in domain.RequestFlowInput) (domain.RequestFlow, error) {
	rels, err := s.RelationshipMap()
	if err != nil {
		return domain.RequestFlow{}, err
	}
	if err := domain.ValidateFlowInput(in, rels); err != nil {
		return domain.RequestFlow{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return domain.RequestFlow{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	f := domain.RequestFlow{
		ID:              NewUUID(),
		Name:            strings.TrimSpace(in.Name),
		Description:     in.Description,
		RelationshipIDs: append([]string{}, in.RelationshipIDs...),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if _, err := tx.Exec(`INSERT INTO request_flows(id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)`,
		f.ID, f.Name, f.Description, f.CreatedAt.Format(time.RFC3339Nano), f.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return domain.RequestFlow{}, err
	}
	if err := insertSteps(tx, f.ID, f.RelationshipIDs); err != nil {
		return domain.RequestFlow{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.RequestFlow{}, err
	}
	return f, nil
}

// UpdateRequestFlow validates and replaces a flow's fields and steps.
func (s *Store) UpdateRequestFlow(id string, in domain.RequestFlowInput) (domain.RequestFlow, error) {
	if _, err := s.GetRequestFlow(id); err != nil {
		return domain.RequestFlow{}, err
	}
	rels, err := s.RelationshipMap()
	if err != nil {
		return domain.RequestFlow{}, err
	}
	if err := domain.ValidateFlowInput(in, rels); err != nil {
		return domain.RequestFlow{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return domain.RequestFlow{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	if _, err := tx.Exec(`UPDATE request_flows SET name=?, description=?, updated_at=? WHERE id=?`,
		strings.TrimSpace(in.Name), in.Description, now.Format(time.RFC3339Nano), id); err != nil {
		return domain.RequestFlow{}, err
	}
	if _, err := tx.Exec(`DELETE FROM request_flow_steps WHERE flow_id = ?`, id); err != nil {
		return domain.RequestFlow{}, err
	}
	if err := insertSteps(tx, id, in.RelationshipIDs); err != nil {
		return domain.RequestFlow{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.RequestFlow{}, err
	}
	return s.GetRequestFlow(id)
}

// DeleteRequestFlow removes a flow and its steps.
func (s *Store) DeleteRequestFlow(id string) error {
	res, err := s.db.Exec(`DELETE FROM request_flows WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return &domain.NotFoundError{Message: "Request flow not found."}
	}
	return nil
}

// ── helpers ─────────────────────────────────────────────────────────────────

type scanner interface {
	Scan(dest ...any) error
}

func scanComponent(sc scanner) (domain.Component, error) {
	var c domain.Component
	var typ, meta, created, updated string
	if err := sc.Scan(&c.ID, &c.Name, &typ, &c.Description, &meta, &c.Position.X, &c.Position.Y, &created, &updated); err != nil {
		return domain.Component{}, err
	}
	c.Type = domain.ComponentType(typ)
	c.Metadata = decodeMetadata(meta)
	c.CreatedAt = parseTime(created)
	c.UpdatedAt = parseTime(updated)
	return c, nil
}

func scanRelationship(sc scanner) (domain.Relationship, error) {
	var r domain.Relationship
	var proto, created, updated string
	if err := sc.Scan(&r.ID, &r.SourceComponentID, &r.TargetComponentID, &r.Label, &proto, &r.Description, &created, &updated); err != nil {
		return domain.Relationship{}, err
	}
	r.Protocol = domain.Protocol(proto)
	r.CreatedAt = parseTime(created)
	r.UpdatedAt = parseTime(updated)
	return r, nil
}

func scanFlow(sc scanner) (domain.RequestFlow, error) {
	var f domain.RequestFlow
	var created, updated string
	if err := sc.Scan(&f.ID, &f.Name, &f.Description, &created, &updated); err != nil {
		return domain.RequestFlow{}, err
	}
	f.CreatedAt = parseTime(created)
	f.UpdatedAt = parseTime(updated)
	f.RelationshipIDs = []string{}
	return f, nil
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

func decodeMetadata(raw string) map[string]string {
	out := map[string]string{}
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]string{}
	}
	return out
}

func normaliseMetadata(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out[key] = strings.TrimSpace(v)
	}
	return out
}

func (s *Store) assertComponentsExist(ids ...string) error {
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		var one int
		err := s.db.QueryRow(`SELECT 1 FROM components WHERE id = ?`, id).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return &domain.ValidationError{
				Message: "Relationship references a component that does not exist.",
				Fields:  map[string]string{"source_component_id": fmt.Sprintf("Component %q was not found.", id)},
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func relationshipIDsForComponent(tx *sql.Tx, componentID string) ([]string, error) {
	rows, err := tx.Query(`SELECT id FROM relationships WHERE source_component_id = ? OR target_component_id = ?`, componentID, componentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func insertSteps(tx *sql.Tx, flowID string, ids []string) error {
	for i, relID := range ids {
		if _, err := tx.Exec(`INSERT INTO request_flow_steps(flow_id, step_index, relationship_id) VALUES (?,?,?)`, flowID, i, relID); err != nil {
			return err
		}
	}
	return nil
}

// reconcileFlows enforces the deletion policy: any request flow that referenced
// one of the removed relationships is deleted along with it, so every stored
// flow is always a valid, connected path.
func reconcileFlows(tx *sql.Tx, removedRelIDs []string) error {
	if len(removedRelIDs) == 0 {
		return nil
	}
	args := make([]any, len(removedRelIDs))
	for i, id := range removedRelIDs {
		args[i] = id
	}
	_, err := tx.Exec(`DELETE FROM request_flows WHERE id IN (
		SELECT flow_id FROM request_flow_steps WHERE relationship_id IN (`+placeholders(len(removedRelIDs))+`))`, args...)
	return err
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ",")
}
