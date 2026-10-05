package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

// seed writes the example architecture into an empty database. It runs inside
// the seedOnce transaction, so it either lands completely or not at all.
func seed(tx *sql.Tx) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)

	// id -> position; ids are human-readable here purely for seed legibility.
	type seeded struct {
		id, name, typ, desc string
		meta                map[string]string
		x, y                float64
	}
	components := []seeded{
		{"c-web", "Web App", "frontend", "React single-page app used by customers and support.", map[string]string{"language": "TypeScript", "runtime": "Browser", "owner": "Web Platform"}, 40, 240},
		{"c-mobile", "Mobile App", "frontend", "iOS and Android clients hitting the same public API.", map[string]string{"language": "Swift / Kotlin", "owner": "Mobile"}, 40, 460},
		{"c-gateway", "API Gateway", "backend_service", "Public entry point: TLS, routing, rate limiting, auth fan-out.", map[string]string{"language": "Go", "runtime": "Kubernetes", "owner": "Platform"}, 340, 320},
		{"c-auth", "Auth Service", "microservice", "Issues and verifies session tokens, owns the identity store.", map[string]string{"language": "Go", "owner": "Identity"}, 660, 80},
		{"c-orders", "Orders Service", "microservice", "Owns the order lifecycle and checkout orchestration.", map[string]string{"language": "Go", "owner": "Commerce"}, 660, 320},
		{"c-ordersdb", "Orders DB", "database", "Primary transactional store for orders and line items.", map[string]string{"engine": "PostgreSQL 16", "owner": "Commerce"}, 1020, 240},
		{"c-cache", "Session Cache", "cache", "Short-lived session and rate-limit counters.", map[string]string{"engine": "Redis 7", "owner": "Platform"}, 1020, 440},
		{"c-bus", "Event Bus", "message_broker", "Durable fan-out for domain events such as order.created.", map[string]string{"engine": "NATS JetStream", "owner": "Platform"}, 340, 620},
		{"c-notify", "Notification Service", "microservice", "Consumes order events and emails customers.", map[string]string{"language": "Go", "owner": "Growth"}, 660, 620},
		{"c-payments", "Payments API", "external_api", "Third-party card processor called during checkout.", map[string]string{"url": "https://api.payments.example.com", "owner": "External"}, 660, 460},
		{"c-analytics", "Analytics SaaS", "third_party_service", "Product analytics receiving a copy of order events.", map[string]string{"url": "https://analytics.example.com", "owner": "Data"}, 1020, 620},
	}
	for _, c := range components {
		meta, err := json.Marshal(c.meta)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO components(id, name, type, description, metadata, pos_x, pos_y, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?,?,?)`, c.id, c.name, c.typ, c.desc, string(meta), c.x, c.y, now, now); err != nil {
			return err
		}
	}

	type seededRel struct {
		id, source, target, label, protocol, desc string
	}
	relationships := []seededRel{
		{"r-web-gateway", "c-web", "c-gateway", "REST /api/*", "http_rest", "Browser calls the public JSON API."},
		{"r-web-gateway-ws", "c-web", "c-gateway", "Live order updates", "websockets", "Persistent socket for order status pushes."},
		{"r-mobile-gateway", "c-mobile", "c-gateway", "REST /api/*", "http_rest", "Mobile clients use the same public API."},
		{"r-gateway-auth", "c-gateway", "c-auth", "Verify token", "grpc", "Per-request token introspection."},
		{"r-gateway-orders", "c-gateway", "c-orders", "Orders RPC", "grpc", "Routed checkout and order queries."},
		{"r-orders-db", "c-orders", "c-ordersdb", "Read/write", "other", "PostgreSQL wire protocol over the private network."},
		{"r-orders-cache", "c-orders", "c-cache", "Rate limits", "other", "Redis RESP for counters and idempotency keys."},
		{"r-orders-payments", "c-orders", "c-payments", "Charge card", "http_rest", "Synchronous capture during checkout."},
		{"r-orders-bus", "c-orders", "c-bus", "order.created", "async_messaging", "Domain event published after commit."},
		{"r-bus-notify", "c-bus", "c-notify", "order.created", "async_messaging", "Consumer group for customer email."},
		{"r-bus-analytics", "c-bus", "c-analytics", "order.created", "http_rest", "Firehose of events to the analytics vendor."},
	}
	for _, r := range relationships {
		if _, err := tx.Exec(`INSERT INTO relationships(id, source_component_id, target_component_id, label, protocol, description, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?,?)`, r.id, r.source, r.target, r.label, r.protocol, r.desc, now, now); err != nil {
			return err
		}
	}

	flows := []struct {
		id, name, desc string
		steps          []string
	}{
		{
			"f-checkout",
			"Checkout (synchronous)",
			"A customer submits an order: the browser reaches the gateway, which calls Orders, which commits to the database.",
			[]string{"r-web-gateway", "r-gateway-orders", "r-orders-db"},
		},
		{
			"f-order-events",
			"Order created event fan-out",
			"After the order commits an event is published and the notification consumer picks it up.",
			[]string{"r-web-gateway", "r-gateway-orders", "r-orders-bus", "r-bus-notify"},
		},
	}
	for _, f := range flows {
		if _, err := tx.Exec(`INSERT INTO request_flows(id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)`,
			f.id, f.name, f.desc, now, now); err != nil {
			return err
		}
		if err := insertSteps(tx, f.id, f.steps); err != nil {
			return err
		}
	}
	return nil
}
