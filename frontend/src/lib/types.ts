// Mirrors the Go JSON contract in backend/internal/domain. Kept hand-written on
// purpose: no code generation for an MVP whose schema is still settling.

export const COMPONENT_TYPES = [
  'frontend',
  'backend_service',
  'microservice',
  'database',
  'cache',
  'message_broker',
  'external_api',
  'third_party_service',
] as const

export type ComponentType = (typeof COMPONENT_TYPES)[number]

export const PROTOCOLS = ['http_rest', 'grpc', 'websockets', 'async_messaging', 'other'] as const

export type Protocol = (typeof PROTOCOLS)[number]

export interface Position {
  x: number
  y: number
}

export interface Component {
  id: string
  name: string
  type: ComponentType
  description: string
  metadata: Record<string, string>
  position: Position
  created_at: string
  updated_at: string
}

export interface Relationship {
  id: string
  source_component_id: string
  target_component_id: string
  label: string
  protocol: Protocol
  description: string
  created_at: string
  updated_at: string
}

export interface RequestFlow {
  id: string
  name: string
  description: string
  relationship_ids: string[]
  created_at: string
  updated_at: string
}

export interface Architecture {
  components: Component[]
  relationships: Relationship[]
  request_flows: RequestFlow[]
}

export interface ComponentInput {
  name: string
  type: ComponentType
  description: string
  metadata: Record<string, string>
  position?: Position
}

export interface RelationshipInput {
  source_component_id: string
  target_component_id: string
  label: string
  protocol: Protocol
  description: string
}

export interface RequestFlowInput {
  name: string
  description: string
  relationship_ids: string[]
}
