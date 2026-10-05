import { useCallback } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from '@xyflow/react'

import { ArchitectureNodeView } from '@/components/ArchitectureNode'
import { ArchitectureEdgeView } from '@/components/RelationshipEdge'
import { TYPE_VISUALS } from '@/lib/graph'
import type { ArchitectureEdge, ArchitectureNode } from '@/lib/graphElements'
import { Button } from '@/components/ui/button'
import { Maximize2, Plus, ZoomIn, ZoomOut } from 'lucide-react'

const nodeTypes = { architecture: ArchitectureNodeView }
const edgeTypes = { architecture: ArchitectureEdgeView }

export interface GraphCanvasProps {
  nodes: ArchitectureNode[]
  edges: ArchitectureEdge[]
  onNodesChange: (changes: NodeChange<ArchitectureNode>[]) => void
  onEdgesChange: (changes: EdgeChange<ArchitectureEdge>[]) => void
  onNodeDragStop: (nodeId: string, x: number, y: number) => void
  onSelectionChange: (params: OnSelectionChangeParams) => void
  onConnect: (connection: Connection) => void
  onAddComponent: () => void
  onPaneClick: () => void
}

export function GraphCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
  onSelectionChange,
  onConnect,
  onAddComponent,
  onPaneClick,
}: GraphCanvasProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const handleDragStop = useCallback<OnNodeDrag<ArchitectureNode>>(
    (_event, node) => {
      onNodeDragStop(node.id, node.position.x, node.position.y)
    },
    [onNodeDragStop],
  )

  const isEmpty = nodes.length === 0

  return (
    <div className="relative h-full w-full">
      {/* Arrow markers shared by every relationship edge. */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <marker
            id="archviz-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5b6472" />
          </marker>
          <marker
            id="archviz-arrow-active"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
          </marker>
        </defs>
      </svg>
      <ReactFlow<ArchitectureNode, ArchitectureEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        colorMode="dark"
        connectionMode={ConnectionMode.Strict}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: '#38bdf8', strokeWidth: 2, strokeDasharray: '4 4' }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2.2}
        proOptions={{ hideAttribution: false }}
        nodeDragThreshold={2}
        deleteKeyCode={null}
        className="h-full w-full"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#242a35" />
        <Controls
          showInteractive={false}
          position="bottom-right"
          className="m-3 overflow-hidden rounded-md border border-border bg-card [&>button]:h-8 [&>button]:w-8"
        />
        {nodes.length > 3 ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="!bottom-16 !right-3 hidden h-[110px] w-[170px] md:block"
            maskColor="rgba(8, 10, 15, 0.75)"
            nodeColor={(node) => {
              const type = (node.data as { component?: { type?: keyof typeof TYPE_VISUALS } }).component?.type
              return type ? TYPE_VISUALS[type].accent : '#64748b'
            }}
            nodeStrokeWidth={0}
          />
        ) : null}
      </ReactFlow>

      {/* View controls */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          title="Fit to view"
          aria-label="Fit to view"
          onClick={() => fitView({ padding: 0.25, duration: 300 })}
        >
          <Maximize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomIn({ duration: 200 })}
        >
          <ZoomIn />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomOut({ duration: 200 })}
        >
          <ZoomOut />
        </Button>
      </div>

      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto max-w-sm rounded-lg border border-dashed border-border bg-card/80 p-6 text-center shadow-xl backdrop-blur">
            <h2 className="text-sm font-semibold">No components yet</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first component to start mapping the architecture.
            </p>
            <Button size="sm" className="mt-4" onClick={onAddComponent}>
              <Plus /> Add component
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
