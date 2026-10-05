package domain

import "testing"

func rels(pairs map[string][2]string) map[string]Relationship {
	out := map[string]Relationship{}
	for id, p := range pairs {
		out[id] = Relationship{ID: id, SourceComponentID: p[0], TargetComponentID: p[1]}
	}
	return out
}

func TestValidateComponentInput(t *testing.T) {
	tests := []struct {
		name    string
		in      ComponentInput
		wantErr bool
		field   string
	}{
		{"valid", ComponentInput{Name: "Gateway", Type: TypeBackendService}, false, ""},
		{"missing name", ComponentInput{Name: "  ", Type: TypeFrontend}, true, "name"},
		{"bad type", ComponentInput{Name: "X", Type: "sausage"}, true, "type"},
		{"empty type", ComponentInput{Name: "X"}, true, "type"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateComponentInput(tc.in)
			if tc.wantErr != (err != nil) {
				t.Fatalf("wantErr=%v got %v", tc.wantErr, err)
			}
			if tc.wantErr {
				ve, ok := err.(*ValidationError)
				if !ok {
					t.Fatalf("want ValidationError, got %T", err)
				}
				if _, ok := ve.Fields[tc.field]; !ok {
					t.Fatalf("expected field %q in %v", tc.field, ve.Fields)
				}
			}
		})
	}
}

func TestValidateRelationshipInput(t *testing.T) {
	base := RelationshipInput{SourceComponentID: "a", TargetComponentID: "b", Label: "call", Protocol: ProtocolHTTP}

	if err := ValidateRelationshipInput(base); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}

	self := base
	self.TargetComponentID = "a"
	if err := ValidateRelationshipInput(self); err == nil {
		t.Fatal("self-link should be rejected")
	}

	badProto := base
	badProto.Protocol = "carrier-pigeon"
	if err := ValidateRelationshipInput(badProto); err == nil {
		t.Fatal("unknown protocol should be rejected")
	}

	noLabel := base
	noLabel.Label = ""
	if err := ValidateRelationshipInput(noLabel); err == nil {
		t.Fatal("empty label should be rejected")
	}

	noTarget := base
	noTarget.TargetComponentID = ""
	if err := ValidateRelationshipInput(noTarget); err == nil {
		t.Fatal("missing target should be rejected")
	}
}

func TestValidateFlowInput(t *testing.T) {
	graph := rels(map[string][2]string{
		"e1": {"web", "gateway"},
		"e2": {"gateway", "orders"},
		"e3": {"orders", "db"},
		"e4": {"db", "cache"},
	})

	ok := RequestFlowInput{Name: "Checkout", RelationshipIDs: []string{"e1", "e2", "e3"}}
	if err := ValidateFlowInput(ok, graph); err != nil {
		t.Fatalf("valid flow rejected: %v", err)
	}

	single := RequestFlowInput{Name: "One hop", RelationshipIDs: []string{"e1"}}
	if err := ValidateFlowInput(single, graph); err != nil {
		t.Fatalf("single-edge flow rejected: %v", err)
	}

	noName := RequestFlowInput{RelationshipIDs: []string{"e1"}}
	if err := ValidateFlowInput(noName, graph); err == nil {
		t.Fatal("missing name should be rejected")
	}

	noSteps := RequestFlowInput{Name: "Empty"}
	if err := ValidateFlowInput(noSteps, graph); err == nil {
		t.Fatal("empty step list should be rejected")
	}

	missing := RequestFlowInput{Name: "Ghost", RelationshipIDs: []string{"e1", "nope"}}
	if err := ValidateFlowInput(missing, graph); err == nil {
		t.Fatal("missing relationship should be rejected")
	}

	disconnected := RequestFlowInput{Name: "Jump", RelationshipIDs: []string{"e1", "e3"}}
	if err := ValidateFlowInput(disconnected, graph); err == nil {
		t.Fatal("disconnected path should be rejected")
	}

	outOfOrder := RequestFlowInput{Name: "Backwards", RelationshipIDs: []string{"e2", "e1"}}
	if err := ValidateFlowInput(outOfOrder, graph); err == nil {
		t.Fatal("out-of-order path should be rejected")
	}
}

func TestIsConnectedPath(t *testing.T) {
	graph := rels(map[string][2]string{
		"e1": {"a", "b"},
		"e2": {"b", "c"},
	})
	if !IsConnectedPath([]string{"e1", "e2"}, graph) {
		t.Fatal("e1,e2 is a connected path")
	}
	if !IsConnectedPath([]string{"e1"}, graph) {
		t.Fatal("a single edge is a connected path")
	}
	if IsConnectedPath(nil, graph) {
		t.Fatal("an empty path is not connected")
	}
	if IsConnectedPath([]string{"e2", "e1"}, graph) {
		t.Fatal("reversed order is not connected")
	}
	if IsConnectedPath([]string{"e1", "missing"}, graph) {
		t.Fatal("unknown edge is not connected")
	}
}
