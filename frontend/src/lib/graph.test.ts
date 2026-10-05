import { describe, expect, it } from 'vitest'

import { checkPath, outgoingFrom, resolveFlow } from '@/lib/graph'
import type { Component, Relationship } from '@/lib/types'

function component(id: string, name: string): Component {
  return {
    id,
    name,
    type: 'microservice',
    description: '',
    metadata: {},
    position: { x: 0, y: 0 },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function relationship(id: string, source: string, target: string): Relationship {
  return {
    id,
    source_component_id: source,
    target_component_id: target,
    label: id,
    protocol: 'http_rest',
    description: '',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

const components = [component('a', 'Web'), component('b', 'Gateway'), component('c', 'DB')]
const relationships = [
  relationship('e1', 'a', 'b'),
  relationship('e2', 'b', 'c'),
  relationship('e3', 'a', 'c'),
]

describe('checkPath', () => {
  it('rejects an empty path', () => {
    expect(checkPath([])).toBeTruthy()
  })

  it('accepts a single edge', () => {
    expect(checkPath([relationships[0]])).toBeNull()
  })

  it('accepts a head-to-tail path', () => {
    expect(checkPath([relationships[0], relationships[1]])).toBeNull()
  })

  it('rejects a path that jumps', () => {
    expect(checkPath([relationships[0], relationships[2]])).toContain('Step 1')
  })

  it('rejects a path that doubles back', () => {
    expect(checkPath([relationships[1], relationships[0]])).toBeTruthy()
  })
})

describe('outgoingFrom', () => {
  it('offers everything when no component is chosen yet', () => {
    expect(outgoingFrom(relationships, null)).toHaveLength(3)
  })

  it('only offers edges leaving the given component', () => {
    expect(outgoingFrom(relationships, 'b').map((r) => r.id)).toEqual(['e2'])
  })
})

describe('resolveFlow', () => {
  it('marks exactly the nodes, edges and traversal order on the path', () => {
    const resolved = resolveFlow({ relationship_ids: ['e1', 'e2'] }, relationships, components)

    expect(resolved.valid).toBe(true)
    expect([...resolved.edgeIds].sort()).toEqual(['e1', 'e2'])
    expect([...resolved.nodeIds].sort()).toEqual(['a', 'b', 'c'])
    expect(resolved.orderedComponents.map((c) => c.name)).toEqual(['Web', 'Gateway', 'DB'])
  })

  it('handles a one-edge flow', () => {
    const resolved = resolveFlow({ relationship_ids: ['e3'] }, relationships, components)
    expect(resolved.valid).toBe(true)
    expect([...resolved.nodeIds].sort()).toEqual(['a', 'c'])
  })

  it('flags a path that does not join up', () => {
    const resolved = resolveFlow({ relationship_ids: ['e1', 'e3'] }, relationships, components)
    expect(resolved.valid).toBe(false)
  })

  it('flags an unknown edge', () => {
    const resolved = resolveFlow({ relationship_ids: ['ghost'] }, relationships, components)
    expect(resolved.valid).toBe(false)
    expect(resolved.edgeIds.size).toBe(0)
  })

  it('treats an empty flow as invalid', () => {
    expect(resolveFlow({ relationship_ids: [] }, relationships, components).valid).toBe(false)
  })
})
