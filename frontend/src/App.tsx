import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'

import { AppHeader } from '@/components/AppHeader'
import { ComponentDialog } from '@/components/ComponentDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FlowBar } from '@/components/FlowBar'
import { FlowDialog } from '@/components/FlowDialog'
import { GraphCanvas } from '@/components/GraphCanvas'
import { Inspector } from '@/components/Inspector'
import { Legend } from '@/components/Legend'
import { RelationshipDialog } from '@/components/RelationshipDialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ApiError, api } from '@/lib/api'
import { resolveFlow } from '@/lib/graph'
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'
import type { ArchitectureEdge, ArchitectureNode } from '@/lib/graphElements'
import type {
  Architecture,
  Component,
  ComponentInput,
  Relationship,
  RelationshipInput,
  RequestFlow,
  RequestFlowInput,
} from '@/lib/types'

const EMPTY_ARCHITECTURE: Architecture = { components: [], relationships: [], request_flows: [] }

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  )
}

function Workspace() {
  const [architecture, setArchitecture] = useState<Architecture>(EMPTY_ARCHITECTURE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [nodes, setNodes] = useState<ArchitectureNode[]>([])
  const [edges, setEdges] = useState<ArchitectureEdge[]>([])

  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null)
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)

  // Below Tailwind's `lg` breakpoint the inspector becomes an overlay so the
  // graph keeps the full viewport width.
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const [componentDialog, setComponentDialog] = useState<{ open: boolean; component: Component | null }>({
    open: false,
    component: null,
  })
  const [relationshipDialog, setRelationshipDialog] = useState<{
    open: boolean
    relationship: Relationship | null
    sourceId?: string
    targetId?: string
  }>({ open: false, relationship: null })
  const [flowDialog, setFlowDialog] = useState<{ open: boolean; flow: RequestFlow | null }>({
    open: false,
    flow: null,
  })
  const [confirm, setConfirm] = useState<{
    open: boolean
    title: string
    description: string
    confirmLabel?: string
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 5000)
  }, [])

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setStatus('loading')
      try {
        const snapshot = await api.getArchitecture()
        setArchitecture(snapshot)
        setStatus('ready')
        setLoadError(null)
      } catch (err) {
        setStatus('error')
        setLoadError(err instanceof ApiError ? err.detail : 'Could not load the architecture.')
      }
    },
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const activeFlow = useMemo(
    () => architecture.request_flows.find((f) => f.id === activeFlowId) ?? null,
    [architecture.request_flows, activeFlowId],
  )

  const flowResolution = useMemo(
    () =>
      activeFlow
        ? resolveFlow(activeFlow, architecture.relationships, architecture.components)
        : null,
    [activeFlow, architecture.relationships, architecture.components],
  )

  // Derive graph elements from the snapshot, preserving React Flow's own
  // per-node selection so editing does not clear what the user had selected.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      return architecture.components.map<ArchitectureNode>((component) => {
        const inFlow = flowResolution ? flowResolution.nodeIds.has(component.id) : false
        return {
          id: component.id,
          type: 'architecture',
          position: { x: component.position.x, y: component.position.y },
          selected: byId.get(component.id)?.selected ?? false,
          data: { component, inFlow, dimmed: Boolean(flowResolution) && !inFlow },
        }
      })
    })

    setEdges((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]))
      return architecture.relationships.map<ArchitectureEdge>((relationship) => {
        const inFlow = flowResolution ? flowResolution.edgeIds.has(relationship.id) : false
        return {
          id: relationship.id,
          type: 'architecture',
          source: relationship.source_component_id,
          target: relationship.target_component_id,
          selected: byId.get(relationship.id)?.selected ?? false,
          data: { relationship, inFlow, dimmed: Boolean(flowResolution) && !inFlow },
        }
      })
    })
  }, [architecture, flowResolution])

  // Mirror the inspector's selection back onto the canvas.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => (n.selected === (n.id === selectedComponentId) ? n : { ...n, selected: n.id === selectedComponentId })),
    )
    setEdges((prev) =>
      prev.map((e) =>
        e.selected === (e.id === selectedRelationshipId) ? e : { ...e, selected: e.id === selectedRelationshipId },
      ),
    )
  }, [selectedComponentId, selectedRelationshipId])

  const selectedComponent = useMemo(
    () => architecture.components.find((c) => c.id === selectedComponentId) ?? null,
    [architecture.components, selectedComponentId],
  )
  const selectedRelationship = useMemo(
    () => architecture.relationships.find((r) => r.id === selectedRelationshipId) ?? null,
    [architecture.relationships, selectedRelationshipId],
  )

  // ── canvas wiring ────────────────────────────────────────────────────────

  const handleNodesChange = useCallback((changes: NodeChange<ArchitectureNode>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
  }, [])

  const handleEdgesChange = useCallback((changes: EdgeChange<ArchitectureEdge>[]) => {
    setEdges((prev) => applyEdgeChanges(changes, prev))
  }, [])

  const persistPosition = useCallback(
    async (nodeId: string, x: number, y: number) => {
      const component = architecture.components.find((c) => c.id === nodeId)
      if (!component) return
      if (component.position.x === x && component.position.y === y) return
      try {
        const saved = await api.updateComponentPosition(nodeId, { x, y })
        setArchitecture((prev) => ({
          ...prev,
          components: prev.components.map((c) => (c.id === nodeId ? saved : c)),
        }))
      } catch (err) {
        notify(err instanceof ApiError ? err.detail : 'Could not save the new position.')
      }
    },
    [architecture.components, notify],
  )

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const node = params.nodes[0]
    const edge = params.edges[0]
    if (node) {
      setSelectedComponentId(node.id)
      setSelectedRelationshipId(null)
    } else if (edge) {
      setSelectedRelationshipId(edge.id)
      setSelectedComponentId(null)
    } else {
      setSelectedComponentId(null)
      setSelectedRelationshipId(null)
    }
  }, [])

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    setRelationshipDialog({ open: true, relationship: null, sourceId: connection.source, targetId: connection.target })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedComponentId(null)
    setSelectedRelationshipId(null)
  }, [])

  // On a narrow viewport, selecting something brings the overlay inspector up.
  useEffect(() => {
    if (!isDesktop && (selectedComponentId || selectedRelationshipId)) {
      setInspectorOpen(true)
    }
  }, [isDesktop, selectedComponentId, selectedRelationshipId])

  useEffect(() => {
    if (isDesktop) setInspectorOpen(false)
  }, [isDesktop])

  // ── mutations ────────────────────────────────────────────────────────────

  const nextComponentPosition = useCallback(() => {
    const index = architecture.components.length
    return { x: 80 + (index % 5) * 60, y: 120 + (index % 5) * 70 }
  }, [architecture.components.length])

  const saveComponent = useCallback(
    async (input: ComponentInput) => {
      if (componentDialog.component) {
        const saved = await api.updateComponent(componentDialog.component.id, input)
        setArchitecture((prev) => ({
          ...prev,
          components: prev.components.map((c) => (c.id === saved.id ? saved : c)),
        }))
        setSelectedComponentId(saved.id)
        notify(`Saved “${saved.name}”.`)
      } else {
        const created = await api.createComponent(input)
        setArchitecture((prev) => ({ ...prev, components: [...prev.components, created] }))
        setSelectedComponentId(created.id)
        setSelectedRelationshipId(null)
        notify(`Added “${created.name}”.`)
      }
    },
    [componentDialog.component, notify],
  )

  const saveRelationship = useCallback(
    async (input: RelationshipInput) => {
      const editing = relationshipDialog.relationship
      if (editing) {
        await api.updateRelationship(editing.id, input)
      } else {
        await api.createRelationship(input)
      }
      // Rewiring or removing edges can cascade into saved flows, so re-read the
      // snapshot rather than patching it locally.
      await load({ quiet: true })
      notify(editing ? 'Relationship updated.' : 'Relationship added.')
    },
    [relationshipDialog.relationship, load, notify],
  )

  const saveFlow = useCallback(
    async (input: RequestFlowInput) => {
      const editing = flowDialog.flow
      if (editing) {
        const saved = await api.updateFlow(editing.id, input)
        setArchitecture((prev) => ({
          ...prev,
          request_flows: prev.request_flows.map((f) => (f.id === saved.id ? saved : f)),
        }))
        setActiveFlowId(saved.id)
        notify(`Saved flow “${saved.name}”.`)
      } else {
        const created = await api.createFlow(input)
        setArchitecture((prev) => ({ ...prev, request_flows: [...prev.request_flows, created] }))
        setActiveFlowId(created.id)
        notify(`Created flow “${created.name}”.`)
      }
    },
    [flowDialog.flow, notify],
  )

  const requestDeleteComponent = useCallback(
    (component: Component) => {
      const dependent = architecture.relationships.filter(
        (r) => r.source_component_id === component.id || r.target_component_id === component.id,
      ).length
      setConfirm({
        open: true,
        title: `Delete “${component.name}”?`,
        description:
          dependent > 0
            ? `This also removes ${dependent} relationship${dependent === 1 ? '' : 's'} and any request flow that used them. This cannot be undone.`
            : 'This cannot be undone.',
        onConfirm: async () => {
          try {
            await api.deleteComponent(component.id)
            if (selectedComponentId === component.id) clearSelection()
            await load({ quiet: true })
            notify(`Deleted “${component.name}”.`)
          } catch (err) {
            notify(err instanceof ApiError ? err.detail : 'Could not delete the component.')
          }
        },
      })
    },
    [architecture.relationships, clearSelection, load, notify, selectedComponentId],
  )

  const requestDeleteRelationship = useCallback(
    (relationship: Relationship) => {
      setConfirm({
        open: true,
        title: 'Delete this relationship?',
        description:
          'Any request flow that uses this link is removed with it. This cannot be undone.',
        onConfirm: async () => {
          try {
            await api.deleteRelationship(relationship.id)
            if (selectedRelationshipId === relationship.id) clearSelection()
            await load({ quiet: true })
            notify('Relationship deleted.')
          } catch (err) {
            notify(err instanceof ApiError ? err.detail : 'Could not delete the relationship.')
          }
        },
      })
    },
    [clearSelection, load, notify, selectedRelationshipId],
  )

  const requestDeleteFlow = useCallback(
    (flow: RequestFlow) => {
      setConfirm({
        open: true,
        title: `Delete flow “${flow.name}”?`,
        description: 'The path definition is removed. Components and relationships are untouched.',
        onConfirm: async () => {
          try {
            await api.deleteFlow(flow.id)
            setArchitecture((prev) => ({
              ...prev,
              request_flows: prev.request_flows.filter((f) => f.id !== flow.id),
            }))
            if (activeFlowId === flow.id) setActiveFlowId(null)
            notify('Request flow deleted.')
          } catch (err) {
            notify(err instanceof ApiError ? err.detail : 'Could not delete the request flow.')
          }
        },
      })
    },
    [activeFlowId, notify],
  )

  // ── render ───────────────────────────────────────────────────────────────

  const inspectorProps = {
    selectedComponent,
    selectedRelationship,
    components: architecture.components,
    relationships: architecture.relationships,
    activeFlow,
    onEditComponent: (component: Component) => setComponentDialog({ open: true, component }),
    onDeleteComponent: requestDeleteComponent,
    onEditRelationship: (relationship: Relationship) =>
      setRelationshipDialog({ open: true, relationship }),
    onDeleteRelationship: requestDeleteRelationship,
    onSelectComponent: (id: string) => {
      setSelectedComponentId(id)
      setSelectedRelationshipId(null)
    },
    onClearSelection: clearSelection,
    onEditFlow: (flow: RequestFlow) => setFlowDialog({ open: true, flow }),
    onClearFlow: () => setActiveFlowId(null),
  }

  if (status === 'loading' && architecture.components.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
          Loading architecture…
        </div>
      </div>
    )
  }

  if (status === 'error' && architecture.components.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-3 rounded-lg border border-destructive/40 bg-card p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <h1 className="text-sm font-semibold">Cannot reach the architecture API</h1>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <p className="rounded-md border border-border bg-secondary/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            cd backend &amp;&amp; go run ./cmd/server
          </p>
          <Button size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        componentCount={architecture.components.length}
        relationshipCount={architecture.relationships.length}
        flowCount={architecture.request_flows.length}
        status={status}
        canAddRelationship={architecture.components.length >= 2}
        onAddComponent={() => setComponentDialog({ open: true, component: null })}
        onAddRelationship={() => setRelationshipDialog({ open: true, relationship: null })}
        onReload={() => void load()}
        onToggleInspector={isDesktop ? undefined : () => setInspectorOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 bg-background">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodeDragStop={(id, x, y) => void persistPosition(id, x, y)}
            onSelectionChange={handleSelectionChange}
            onConnect={handleConnect}
            onPaneClick={clearSelection}
            onAddComponent={() => setComponentDialog({ open: true, component: null })}
          />

          <FlowBar
            flows={architecture.request_flows}
            activeFlowId={activeFlowId}
            onSelect={setActiveFlowId}
            onNew={() => setFlowDialog({ open: true, flow: null })}
            onEdit={(flow) => setFlowDialog({ open: true, flow })}
          />

          <Legend />

          {toast ? (
            <div
              role="status"
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 animate-fade-in rounded-md border border-border bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
            >
              {toast}
            </div>
          ) : null}
        </main>

        {isDesktop ? (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-border">
            <Inspector {...inspectorProps} />
          </aside>
        ) : (
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetContent
              side="right"
              className="w-[330px] max-w-[86vw] gap-0 p-0"
              aria-label="Inspector"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Inspector</SheetTitle>
                <SheetDescription>
                  Details and actions for the selected component, relationship or request flow.
                </SheetDescription>
              </SheetHeader>
              <Inspector {...inspectorProps} onClose={() => setInspectorOpen(false)} />
            </SheetContent>
          </Sheet>
        )}
      </div>

      <ComponentDialog
        open={componentDialog.open}
        onOpenChange={(open) => setComponentDialog((prev) => ({ ...prev, open }))}
        component={componentDialog.component}
        defaultPosition={nextComponentPosition()}
        onSubmit={saveComponent}
      />

      <RelationshipDialog
        open={relationshipDialog.open}
        onOpenChange={(open) => setRelationshipDialog((prev) => ({ ...prev, open }))}
        relationship={relationshipDialog.relationship}
        components={architecture.components}
        initialSourceId={relationshipDialog.sourceId}
        initialTargetId={relationshipDialog.targetId}
        onSubmit={saveRelationship}
      />

      <FlowDialog
        open={flowDialog.open}
        onOpenChange={(open) => setFlowDialog((prev) => ({ ...prev, open }))}
        flow={flowDialog.flow}
        components={architecture.components}
        relationships={architecture.relationships}
        onSubmit={saveFlow}
        onDelete={requestDeleteFlow}
      />

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        onOpenChange={(open) => setConfirm((prev) => ({ ...prev, open }))}
        onConfirm={confirm.onConfirm}
      />
    </div>
  )
}
