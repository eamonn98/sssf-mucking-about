import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

import { PROTOCOL_VISUALS, protocolStroke } from '@/lib/graph'
import type { ArchitectureEdge } from '@/lib/graphElements'
import { cn } from '@/lib/utils'

export function ArchitectureEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<ArchitectureEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const relationship = data?.relationship
  const inFlow = data?.inFlow ?? false
  const dimmed = data?.dimmed ?? false
  const protocol = relationship ? PROTOCOL_VISUALS[relationship.protocol] : PROTOCOL_VISUALS.other

  const stroke = selected ? '#38bdf8' : inFlow ? protocolStroke(relationship?.protocol ?? 'other') : '#5b6472'

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: selected || inFlow ? 2.5 : 1.5,
          opacity: dimmed ? 0.2 : 1,
          transition: 'opacity 150ms ease, stroke 150ms ease',
        }}
        markerEnd={selected || inFlow ? 'url(#archviz-arrow-active)' : 'url(#archviz-arrow)'}
      />
      {relationship ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'pointer-events-none absolute flex max-w-[210px] items-center gap-1.5 rounded-full border border-border bg-card/95 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur transition-opacity',
              dimmed && 'opacity-20',
              (selected || inFlow) && 'border-primary/50',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span
              className={cn(
                'rounded-sm px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wider',
                protocol.badge,
                'border',
              )}
            >
              {protocol.short}
            </span>
            <span className="truncate text-foreground/90">{relationship.label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
