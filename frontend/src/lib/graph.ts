import {
  type Component,
  type ComponentType,
  type Protocol,
  type Relationship,
  type RequestFlow,
} from './types'

export interface FlowResolution {
  edgeIds: Set<string>
  nodeIds: Set<string>
  /** Components in traversal order: source of the first hop, then every target. */
  orderedComponents: Component[]
  orderedRelationships: Relationship[]
  /** True when every step exists and each one ends where the next begins. */
  valid: boolean
}

/**
 * Resolve a flow into the graph elements it touches. Mirrors the backend's
 * connectivity rule so the UI can explain an invalid path before saving one.
 */
export function resolveFlow(
  flow: Pick<RequestFlow, 'relationship_ids'>,
  relationships: Relationship[],
  components: Component[],
): FlowResolution {
  const relById = new Map(relationships.map((r) => [r.id, r]))
  const compById = new Map(components.map((c) => [c.id, c]))

  const orderedRelationships: Relationship[] = []
  const edgeIds = new Set<string>()
  const nodeIds = new Set<string>()
  let valid = flow.relationship_ids.length > 0

  for (const id of flow.relationship_ids) {
    const rel = relById.get(id)
    if (!rel) {
      valid = false
      continue
    }
    edgeIds.add(rel.id)
    nodeIds.add(rel.source_component_id)
    nodeIds.add(rel.target_component_id)
    orderedRelationships.push(rel)
  }

  for (let i = 1; i < orderedRelationships.length; i += 1) {
    if (orderedRelationships[i - 1].target_component_id !== orderedRelationships[i].source_component_id) {
      valid = false
    }
  }
  if (orderedRelationships.length === 0) {
    valid = false
  }

  const orderedComponents: Component[] = []
  if (orderedRelationships.length > 0) {
    const first = compById.get(orderedRelationships[0].source_component_id)
    if (first) orderedComponents.push(first)
    for (const rel of orderedRelationships) {
      const target = compById.get(rel.target_component_id)
      if (target) orderedComponents.push(target)
    }
  }

  return { edgeIds, nodeIds, orderedComponents, orderedRelationships, valid }
}

/** Check a candidate ordered edge list for a single unbroken path. */
export function checkPath(edges: Relationship[]): string | null {
  if (edges.length === 0) return 'Add at least one relationship to build a path.'
  for (let i = 1; i < edges.length; i += 1) {
    if (edges[i - 1].target_component_id !== edges[i].source_component_id) {
      return `Step ${i} ends at a different component than step ${i + 1} starts from.`
    }
  }
  return null
}

/** Edges that can legally follow the current tail of a path. */
export function outgoingFrom(
  relationships: Relationship[],
  componentId: string | null,
): Relationship[] {
  if (!componentId) return relationships
  return relationships.filter((r) => r.source_component_id === componentId)
}

// ── presentation metadata ──────────────────────────────────────────────────

export interface TypeVisual {
  label: string
  /** Tailwind classes for the node's type chip. */
  chip: string
  /** Raw accent colour reused for the minimap and glow effects. */
  accent: string
}

export const TYPE_VISUALS: Record<ComponentType, TypeVisual> = {
  frontend: { label: 'Frontend', chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30', accent: '#38bdf8' },
  backend_service: {
    label: 'Backend service',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    accent: '#34d399',
  },
  microservice: {
    label: 'Microservice',
    chip: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    accent: '#2dd4bf',
  },
  database: { label: 'Database', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30', accent: '#fb7185' },
  cache: { label: 'Cache', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30', accent: '#fbbf24' },
  message_broker: {
    label: 'Message broker',
    chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    accent: '#fb923c',
  },
  external_api: {
    label: 'External API',
    chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    accent: '#a78bfa',
  },
  third_party_service: {
    label: 'Third-party service',
    chip: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    accent: '#e879f9',
  },
}

export interface ProtocolVisual {
  label: string
  short: string
  /** Tailwind classes for the protocol badge. */
  badge: string
}

export const PROTOCOL_VISUALS: Record<Protocol, ProtocolVisual> = {
  http_rest: {
    label: 'HTTP / REST',
    short: 'HTTP',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  grpc: { label: 'gRPC', short: 'gRPC', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  websockets: {
    label: 'WebSockets',
    short: 'WS',
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  async_messaging: {
    label: 'Async messaging',
    short: 'ASYNC',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  other: { label: 'Other', short: 'OTHER', badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
}

/** Stroke colour used to draw an edge for a given protocol. */
export function protocolStroke(protocol: Protocol): string {
  switch (protocol) {
    case 'http_rest':
      return '#34d399'
    case 'grpc':
      return '#38bdf8'
    case 'websockets':
      return '#a78bfa'
    case 'async_messaging':
      return '#fbbf24'
    default:
      return '#a1a1aa'
  }
}
