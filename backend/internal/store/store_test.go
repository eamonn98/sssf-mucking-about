package store

import (
	"path/filepath"
	"testing"

	"archviz/internal/domain"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenWithOptions(":memory:", Options{Seed: false})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSeedRunsOnceAndIsCoherent(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer s.Close()

	snap, err := s.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Components) < 8 {
		t.Fatalf("expected a seeded example, got %d components", len(snap.Components))
	}
	if len(snap.Relationships) == 0 {
		t.Fatal("expected seeded relationships")
	}
	if len(snap.RequestFlows) == 0 {
		t.Fatal("expected at least one seeded flow")
	}

	rels := map[string]domain.Relationship{}
	for _, r := range snap.Relationships {
		rels[r.ID] = r
	}
	for _, f := range snap.RequestFlows {
		if !domain.IsConnectedPath(f.RelationshipIDs, rels) {
			t.Fatalf("seeded flow %q is not a connected path: %v", f.Name, f.RelationshipIDs)
		}
	}
}

func TestSeedDoesNotRepeatAfterRowsAreDeleted(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "arch.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	snap, _ := s.Snapshot()
	for _, c := range snap.Components {
		if err := s.DeleteComponent(c.ID); err != nil {
			t.Fatalf("delete component: %v", err)
		}
	}
	empty, _ := s.Snapshot()
	if len(empty.Components) != 0 || len(empty.RequestFlows) != 0 {
		t.Fatalf("expected an empty workspace, got %+v", empty)
	}
	s.Close()

	// Reopening the same file must not re-seed.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	again, _ := s.Snapshot()
	if len(again.Components) != 0 {
		t.Fatalf("re-seeded after user emptied the workspace: %d components", len(again.Components))
	}
}

func TestComponentCRUDAndPosition(t *testing.T) {
	s := newStore(t)

	c, err := s.CreateComponent(domain.ComponentInput{
		Name:     "Worker",
		Type:     domain.TypeMicroservice,
		Metadata: map[string]string{"language": "Go", "  ": "dropped"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if c.ID == "" || c.CreatedAt.IsZero() {
		t.Fatalf("expected generated id and timestamps, got %+v", c)
	}
	if _, ok := c.Metadata["  "]; ok {
		t.Fatal("blank metadata keys should be dropped")
	}

	if _, err := s.CreateComponent(domain.ComponentInput{Name: "", Type: domain.TypeCache}); err == nil {
		t.Fatal("invalid component should be rejected")
	}

	pos := domain.Position{X: 123, Y: 456}
	moved, err := s.UpdatePosition(c.ID, pos)
	if err != nil {
		t.Fatalf("update position: %v", err)
	}
	if moved.Position != pos {
		t.Fatalf("position not persisted: %+v", moved.Position)
	}

	// Position-only update must not clobber other fields.
	if moved.Name != "Worker" || moved.Type != domain.TypeMicroservice {
		t.Fatalf("position update clobbered fields: %+v", moved)
	}

	updated, err := s.UpdateComponent(c.ID, domain.ComponentInput{
		Name:        "Worker v2",
		Type:        domain.TypeMicroservice,
		Description: "resized",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Worker v2" || updated.Description != "resized" {
		t.Fatalf("update did not apply: %+v", updated)
	}
	if updated.Position != pos {
		t.Fatalf("update without position should keep stored position, got %+v", updated.Position)
	}

	if err := s.DeleteComponent(c.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetComponent(c.ID); !domain.IsNotFound(err) {
		t.Fatalf("want not found after delete, got %v", err)
	}
	if err := s.DeleteComponent(c.ID); !domain.IsNotFound(err) {
		t.Fatalf("want not found deleting twice, got %v", err)
	}
}

func TestRelationshipValidationAndReferences(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})

	if _, err := s.CreateRelationship(domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "call", Protocol: domain.ProtocolHTTP,
	}); err != nil {
		t.Fatalf("create relationship: %v", err)
	}

	if _, err := s.CreateRelationship(domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: a.ID, Label: "loop", Protocol: domain.ProtocolHTTP,
	}); err == nil {
		t.Fatal("self-link should be rejected")
	}

	_, err := s.CreateRelationship(domain.RelationshipInput{
		SourceComponentID: "ghost", TargetComponentID: b.ID, Label: "call", Protocol: domain.ProtocolGRPC,
	})
	if !domain.IsValidation(err) {
		t.Fatalf("dangling source should be a validation error, got %v", err)
	}

	_, err = s.CreateRelationship(domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "x", Protocol: "telepathy",
	})
	if !domain.IsValidation(err) {
		t.Fatalf("unknown protocol should be a validation error, got %v", err)
	}
}

func TestDeleteComponentCascadesRelationshipsAndReconcilesFlows(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})
	c, _ := s.CreateComponent(domain.ComponentInput{Name: "C", Type: domain.TypeDatabase})
	d, _ := s.CreateComponent(domain.ComponentInput{Name: "D", Type: domain.TypeCache})

	e1, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "1", Protocol: domain.ProtocolHTTP})
	e2, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "2", Protocol: domain.ProtocolHTTP})
	e3, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: c.ID, TargetComponentID: d.ID, Label: "3", Protocol: domain.ProtocolHTTP})

	// Flow over e1,e2 and a second flow over e3 only.
	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Path", RelationshipIDs: []string{e1.ID, e2.ID}}); err != nil {
		t.Fatalf("create flow: %v", err)
	}
	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Tail", RelationshipIDs: []string{e3.ID}}); err != nil {
		t.Fatalf("create flow: %v", err)
	}

	// Deleting B removes e1 and e2; any flow that used them is deleted with
	// them, while "Tail" (e3) survives untouched.
	if err := s.DeleteComponent(b.ID); err != nil {
		t.Fatalf("delete component: %v", err)
	}

	rels, _ := s.ListRelationships()
	if len(rels) != 1 || rels[0].ID != e3.ID {
		t.Fatalf("expected only e3 to survive, got %+v", rels)
	}
	flows, _ := s.ListRequestFlows()
	if len(flows) != 1 || flows[0].Name != "Tail" {
		t.Fatalf("expected only the Tail flow to survive, got %+v", flows)
	}
}

func TestDeleteComponentKeepsStillConnectedFlow(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})
	c, _ := s.CreateComponent(domain.ComponentInput{Name: "C", Type: domain.TypeDatabase})

	e1, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "1", Protocol: domain.ProtocolHTTP})
	e2, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "2", Protocol: domain.ProtocolHTTP})
	unused, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: c.ID, Label: "3", Protocol: domain.ProtocolHTTP})

	flow, _ := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Direct", RelationshipIDs: []string{e1.ID, e2.ID}})

	// Removing an unrelated edge must leave the flow intact.
	if err := s.DeleteRelationship(unused.ID); err != nil {
		t.Fatalf("delete relationship: %v", err)
	}
	got, err := s.GetRequestFlow(flow.ID)
	if err != nil {
		t.Fatalf("flow should survive: %v", err)
	}
	if len(got.RelationshipIDs) != 2 {
		t.Fatalf("unexpected steps %v", got.RelationshipIDs)
	}
}

func TestDeleteRelationshipRemovesDependentFlows(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})
	c, _ := s.CreateComponent(domain.ComponentInput{Name: "C", Type: domain.TypeDatabase})

	e1, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "1", Protocol: domain.ProtocolHTTP})
	e2, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "2", Protocol: domain.ProtocolHTTP})

	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Chain", RelationshipIDs: []string{e1.ID, e2.ID}}); err != nil {
		t.Fatalf("create flow: %v", err)
	}
	if err := s.DeleteRelationship(e1.ID); err != nil {
		t.Fatalf("delete relationship: %v", err)
	}
	flows, _ := s.ListRequestFlows()
	if len(flows) != 0 {
		t.Fatalf("expected the dependent flow to be removed, got %+v", flows)
	}
}

func TestRewiringRelationshipReconcilesFlows(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})
	c, _ := s.CreateComponent(domain.ComponentInput{Name: "C", Type: domain.TypeDatabase})
	orphan, _ := s.CreateComponent(domain.ComponentInput{Name: "Orphan", Type: domain.TypeCache})

	e1, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "1", Protocol: domain.ProtocolHTTP})
	e2, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "2", Protocol: domain.ProtocolHTTP})
	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Chain", RelationshipIDs: []string{e1.ID, e2.ID}}); err != nil {
		t.Fatalf("create flow: %v", err)
	}

	// Move e1's target to an unconnected node: the flow that used e1 is removed.
	if _, err := s.UpdateRelationship(e1.ID, domain.RelationshipInput{
		SourceComponentID: a.ID, TargetComponentID: orphan.ID, Label: "1", Protocol: domain.ProtocolHTTP,
	}); err != nil {
		t.Fatalf("update relationship: %v", err)
	}
	flows, _ := s.ListRequestFlows()
	if len(flows) != 0 {
		t.Fatalf("expected the now-invalid flow to be removed, got %+v", flows)
	}

	// Rewiring without changing endpoints must not disturb the flow.
	e3, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "3", Protocol: domain.ProtocolGRPC})
	flow, _ := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Keep", RelationshipIDs: []string{e3.ID}})
	if _, err := s.UpdateRelationship(e3.ID, domain.RelationshipInput{
		SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "3 (renamed)", Protocol: domain.ProtocolGRPC,
	}); err != nil {
		t.Fatalf("update relationship: %v", err)
	}
	if _, err := s.GetRequestFlow(flow.ID); err != nil {
		t.Fatalf("flow should survive a label change: %v", err)
	}
}

func TestFlowCRUDAndValidation(t *testing.T) {
	s := newStore(t)
	a, _ := s.CreateComponent(domain.ComponentInput{Name: "A", Type: domain.TypeFrontend})
	b, _ := s.CreateComponent(domain.ComponentInput{Name: "B", Type: domain.TypeBackendService})
	c, _ := s.CreateComponent(domain.ComponentInput{Name: "C", Type: domain.TypeDatabase})
	e1, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: a.ID, TargetComponentID: b.ID, Label: "1", Protocol: domain.ProtocolHTTP})
	e2, _ := s.CreateRelationship(domain.RelationshipInput{SourceComponentID: b.ID, TargetComponentID: c.ID, Label: "2", Protocol: domain.ProtocolHTTP})

	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Broken", RelationshipIDs: []string{e1.ID, e2.ID, e1.ID}}); err == nil {
		t.Fatal("non-contiguous flow should be rejected")
	}
	if _, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Ghost", RelationshipIDs: []string{"nope"}}); err == nil {
		t.Fatal("missing relationship should be rejected")
	}

	f, err := s.CreateRequestFlow(domain.RequestFlowInput{Name: "Happy", RelationshipIDs: []string{e1.ID}})
	if err != nil {
		t.Fatalf("create flow: %v", err)
	}

	updated, err := s.UpdateRequestFlow(f.ID, domain.RequestFlowInput{Name: "Happy v2", Description: "longer", RelationshipIDs: []string{e1.ID, e2.ID}})
	if err != nil {
		t.Fatalf("update flow: %v", err)
	}
	if updated.Name != "Happy v2" || len(updated.RelationshipIDs) != 2 {
		t.Fatalf("update did not apply: %+v", updated)
	}

	if _, err := s.UpdateRequestFlow("ghost", domain.RequestFlowInput{Name: "x", RelationshipIDs: []string{e1.ID}}); !domain.IsNotFound(err) {
		t.Fatalf("want not found, got %v", err)
	}
	if err := s.DeleteRequestFlow(f.ID); err != nil {
		t.Fatalf("delete flow: %v", err)
	}
	if err := s.DeleteRequestFlow(f.ID); !domain.IsNotFound(err) {
		t.Fatalf("want not found deleting twice, got %v", err)
	}
}

func TestSnapshotIsTransactionallyConsistent(t *testing.T) {
	// A file-backed database lets a second handle write while the snapshot's read
	// transaction is still open. Without the transaction, the relationship and
	// flow reads would observe the writer's committed rows while the component
	// read would not, producing a snapshot that does not describe one state.
	dir := t.TempDir()
	path := filepath.Join(dir, "snapshot.db")

	reader, err := Open(path)
	if err != nil {
		t.Fatalf("open reader: %v", err)
	}
	defer reader.Close()

	writer, err := Open(path)
	if err != nil {
		t.Fatalf("open writer: %v", err)
	}
	defer writer.Close()

	base := domain.ComponentInput{Name: "Anchor", Type: domain.TypeFrontend}
	anchor, err := writer.CreateComponent(base)
	if err != nil {
		t.Fatalf("create anchor: %v", err)
	}

	var injectedComponentID, injectedRelationshipID string
	injected := false
	// Fires after the components read; the read transaction's snapshot is
	// already established at that point.
	snapshotReadHook = func(stage string) {
		if stage != "components" || injected {
			return
		}
		injected = true

		target, err := writer.CreateComponent(domain.ComponentInput{Name: "Injected", Type: domain.TypeDatabase})
		if err != nil {
			t.Fatalf("inject component: %v", err)
		}
		rel, err := writer.CreateRelationship(domain.RelationshipInput{
			SourceComponentID: anchor.ID,
			TargetComponentID: target.ID,
			Label:             "injected",
			Protocol:          domain.ProtocolHTTP,
		})
		if err != nil {
			t.Fatalf("inject relationship: %v", err)
		}
		if _, err := writer.CreateRequestFlow(domain.RequestFlowInput{
			Name: "Injected flow", RelationshipIDs: []string{rel.ID},
		}); err != nil {
			t.Fatalf("inject flow: %v", err)
		}
		injectedComponentID, injectedRelationshipID = target.ID, rel.ID
	}
	defer func() { snapshotReadHook = func(string) {} }()

	snap, err := reader.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	if !injected {
		t.Fatal("the mid-read mutation never ran; the test proves nothing")
	}

	// The whole snapshot must predate the concurrent write.
	for _, c := range snap.Components {
		if c.ID == injectedComponentID {
			t.Fatalf("snapshot mixed states: component written mid-read leaked in")
		}
	}
	for _, r := range snap.Relationships {
		if r.ID == injectedRelationshipID {
			t.Fatalf("snapshot mixed states: relationship written mid-read leaked in")
		}
	}
	for _, f := range snap.RequestFlows {
		if f.Name == "Injected flow" {
			t.Fatalf("snapshot mixed states: flow written mid-read leaked in")
		}
	}

	// ...and it must still be internally coherent.
	components := map[string]bool{}
	for _, c := range snap.Components {
		components[c.ID] = true
	}
	relationships := map[string]domain.Relationship{}
	for _, r := range snap.Relationships {
		if !components[r.SourceComponentID] || !components[r.TargetComponentID] {
			t.Fatalf("relationship %s references a component outside the snapshot", r.ID)
		}
		relationships[r.ID] = r
	}
	for _, f := range snap.RequestFlows {
		if !domain.IsConnectedPath(f.RelationshipIDs, relationships) {
			t.Fatalf("flow %q is not a connected path inside the snapshot", f.Name)
		}
	}

	// A later read does see the write, proving the mutation committed.
	after, err := reader.Snapshot()
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}
	found := false
	for _, r := range after.Relationships {
		if r.ID == injectedRelationshipID {
			found = true
		}
	}
	if !found {
		t.Fatal("the concurrent write never committed; the test proves nothing")
	}
}

func TestPersistenceAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "arch.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	c, err := s.CreateComponent(domain.ComponentInput{Name: "Persisted", Type: domain.TypeCache})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.UpdatePosition(c.ID, domain.Position{X: 42, Y: 99}); err != nil {
		t.Fatalf("position: %v", err)
	}
	s.Close()

	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	got, err := s2.GetComponent(c.ID)
	if err != nil {
		t.Fatalf("get after reopen: %v", err)
	}
	if got.Position.X != 42 || got.Position.Y != 99 || got.Name != "Persisted" {
		t.Fatalf("not persisted: %+v", got)
	}
}
