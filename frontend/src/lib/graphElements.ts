import type { Edge, Node } from '@xyflow/react'

import type { Component, Relationship } from './types'

export interface ArchitectureNodeData extends Record<string, unknown> {
  component: Component
  /** Part of the active request flow. */
  inFlow: boolean
  /** A flow is active and this node is not on it. */
  dimmed: boolean
}

export interface ArchitectureEdgeData extends Record<string, unknown> {
  relationship: Relationship
  inFlow: boolean
  dimmed: boolean
}

export type ArchitectureNode = Node<ArchitectureNodeData, 'architecture'>
export type ArchitectureEdge = Edge<ArchitectureEdgeData, 'architecture'>
