// Package domain holds the architecture visualiser's core types, the allowed
// vocabularies, and the validation rules shared by the HTTP layer and the
// persistence layer.
package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// ComponentType enumerates the kinds of things that can appear on the canvas.
type ComponentType string

const (
	TypeFrontend          ComponentType = "frontend"
	TypeBackendService    ComponentType = "backend_service"
	TypeMicroservice      ComponentType = "microservice"
	TypeDatabase          ComponentType = "database"
	TypeCache             ComponentType = "cache"
	TypeMessageBroker     ComponentType = "message_broker"
	TypeExternalAPI       ComponentType = "external_api"
	TypeThirdPartyService ComponentType = "third_party_service"
)

// ComponentTypes is the canonical ordering used by the UI legend and by
// validation. Keeping it here avoids the frontend inventing its own list.
var ComponentTypes = []ComponentType{
	TypeFrontend,
	TypeBackendService,
	TypeMicroservice,
	TypeDatabase,
	TypeCache,
	TypeMessageBroker,
	TypeExternalAPI,
	TypeThirdPartyService,
}

// Protocol enumerates the communication styles a relationship can carry.
type Protocol string

const (
	ProtocolHTTP  Protocol = "http_rest"
	ProtocolGRPC  Protocol = "grpc"
	ProtocolWS    Protocol = "websockets"
	ProtocolAsync Protocol = "async_messaging"
	ProtocolOther Protocol = "other"
)

// Protocols is the canonical ordering of allowed protocols.
var Protocols = []Protocol{
	ProtocolHTTP,
	ProtocolGRPC,
	ProtocolWS,
	ProtocolAsync,
	ProtocolOther,
}

func validComponentType(t ComponentType) bool {
	for _, c := range ComponentTypes {
		if c == t {
			return true
		}
	}
	return false
}

func validProtocol(p Protocol) bool {
	for _, c := range Protocols {
		if c == p {
			return true
		}
	}
	return false
}

// Position is the persisted canvas coordinate of a component.
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Component is a node in the architecture graph.
type Component struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Type        ComponentType     `json:"type"`
	Description string            `json:"description"`
	Metadata    map[string]string `json:"metadata"`
	Position    Position          `json:"position"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// Relationship is a directed edge between two components.
type Relationship struct {
	ID                string    `json:"id"`
	SourceComponentID string    `json:"source_component_id"`
	TargetComponentID string    `json:"target_component_id"`
	Label             string    `json:"label"`
	Protocol          Protocol  `json:"protocol"`
	Description       string    `json:"description"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// RequestFlow is a developer-authored ordered path through the graph.
type RequestFlow struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	RelationshipIDs []string  `json:"relationship_ids"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// Architecture is the single consistent snapshot the UI loads on boot.
type Architecture struct {
	Components    []Component    `json:"components"`
	Relationships []Relationship `json:"relationships"`
	RequestFlows  []RequestFlow  `json:"request_flows"`
}

// ComponentInput is the writable subset of a component.
type ComponentInput struct {
	Name        string            `json:"name"`
	Type        ComponentType     `json:"type"`
	Description string            `json:"description"`
	Metadata    map[string]string `json:"metadata"`
	Position    *Position         `json:"position"`
}

// RelationshipInput is the writable subset of a relationship.
type RelationshipInput struct {
	SourceComponentID string   `json:"source_component_id"`
	TargetComponentID string   `json:"target_component_id"`
	Label             string   `json:"label"`
	Protocol          Protocol `json:"protocol"`
	Description       string   `json:"description"`
}

// RequestFlowInput is the writable subset of a request flow.
type RequestFlowInput struct {
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	RelationshipIDs []string `json:"relationship_ids"`
}

// ValidationError signals a 400: the request was understood but is not legal.
type ValidationError struct {
	Message string
	Fields  map[string]string
}

func (e *ValidationError) Error() string { return e.Message }

// NotFoundError signals a 404.
type NotFoundError struct{ Message string }

func (e *NotFoundError) Error() string { return e.Message }

// NewValidation builds a ValidationError with a single message.
func NewValidation(msg string) *ValidationError {
	return &ValidationError{Message: msg}
}

// NewFieldValidation records a per-field message for the UI.
func NewFieldValidation(msg string, fields map[string]string) *ValidationError {
	return &ValidationError{Message: msg, Fields: fields}
}

// IsNotFound reports whether err is a NotFoundError.
func IsNotFound(err error) bool {
	var nf *NotFoundError
	return errors.As(err, &nf)
}

// IsValidation reports whether err is a ValidationError.
func IsValidation(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

const maxNameLength = 120

// ValidateComponentInput checks a create/update payload for a component.
func ValidateComponentInput(in ComponentInput) error {
	fields := map[string]string{}
	if strings.TrimSpace(in.Name) == "" {
		fields["name"] = "Name is required."
	} else if len(in.Name) > maxNameLength {
		fields["name"] = fmt.Sprintf("Name must be %d characters or fewer.", maxNameLength)
	}
	if !validComponentType(in.Type) {
		fields["type"] = fmt.Sprintf("Unknown component type %q.", in.Type)
	}
	if len(fields) > 0 {
		return NewFieldValidation("Component is invalid.", fields)
	}
	return nil
}

// ValidateRelationshipInput checks a create/update payload for a relationship.
func ValidateRelationshipInput(in RelationshipInput) error {
	fields := map[string]string{}
	source := strings.TrimSpace(in.SourceComponentID)
	target := strings.TrimSpace(in.TargetComponentID)
	if source == "" {
		fields["source_component_id"] = "Source component is required."
	}
	if target == "" {
		fields["target_component_id"] = "Target component is required."
	}
	if source != "" && source == target {
		fields["target_component_id"] = "A component cannot communicate with itself."
	}
	if !validProtocol(in.Protocol) {
		fields["protocol"] = fmt.Sprintf("Unknown protocol %q.", in.Protocol)
	}
	if strings.TrimSpace(in.Label) == "" {
		fields["label"] = "Label is required."
	} else if len(in.Label) > maxNameLength {
		fields["label"] = fmt.Sprintf("Label must be %d characters or fewer.", maxNameLength)
	}
	if len(fields) > 0 {
		return NewFieldValidation("Relationship is invalid.", fields)
	}
	return nil
}

// ValidateFlowInput checks the shape of a flow, and - given the current graph -
// that every referenced edge exists and that the edges form one unbroken,
// head-to-tail path. A single-edge flow is a valid path.
func ValidateFlowInput(in RequestFlowInput, rels map[string]Relationship) error {
	fields := map[string]string{}
	if strings.TrimSpace(in.Name) == "" {
		fields["name"] = "Name is required."
	} else if len(in.Name) > maxNameLength {
		fields["name"] = fmt.Sprintf("Name must be %d characters or fewer.", maxNameLength)
	}
	if len(in.RelationshipIDs) == 0 {
		fields["relationship_ids"] = "A flow needs at least one relationship."
	}
	if len(fields) > 0 {
		return NewFieldValidation("Request flow is invalid.", fields)
	}

	for i, id := range in.RelationshipIDs {
		if _, ok := rels[id]; !ok {
			fields["relationship_ids"] = fmt.Sprintf("Relationship %q in step %d no longer exists.", id, i+1)
			return NewFieldValidation("Request flow references a missing relationship.", fields)
		}
	}

	for i := 1; i < len(in.RelationshipIDs); i++ {
		prev := rels[in.RelationshipIDs[i-1]]
		next := rels[in.RelationshipIDs[i]]
		if prev.TargetComponentID != next.SourceComponentID {
			fields["relationship_ids"] = fmt.Sprintf(
				"Step %d ends at a component that step %d does not start from.",
				i, i+1)
			return NewFieldValidation("Request flow is not a connected path.", fields)
		}
	}
	return nil
}

// IsConnectedPath reports whether an ordered list of relationship IDs forms a
// single unbroken path given the supplied relationship lookup. An empty list is
// not a path.
func IsConnectedPath(ids []string, rels map[string]Relationship) bool {
	if len(ids) == 0 {
		return false
	}
	for _, id := range ids {
		if _, ok := rels[id]; !ok {
			return false
		}
	}
	for i := 1; i < len(ids); i++ {
		if rels[ids[i-1]].TargetComponentID != rels[ids[i]].SourceComponentID {
			return false
		}
	}
	return true
}
