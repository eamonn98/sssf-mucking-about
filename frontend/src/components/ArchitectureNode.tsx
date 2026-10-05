import { Handle, Position, type NodeProps } from '@xyflow/react'

import { TYPE_ICONS } from '@/components/typeIcons'
import { TYPE_VISUALS } from '@/lib/graph'
import type { ArchitectureNode } from '@/lib/graphElements'
import { cn } from '@/lib/utils'

export function ArchitectureNodeView({ data, selected }: NodeProps<ArchitectureNode>) {
  const { component, inFlow, dimmed } = data
  const visual = TYPE_VISUALS[component.type]
  const Icon = TYPE_ICONS[component.type]

  return (
    <div
      className={cn(
        'w-[212px] rounded-lg border bg-card/95 px-3 py-2.5 text-left shadow-lg backdrop-blur transition-all duration-150',
        selected ? 'border-primary ring-2 ring-primary/60' : 'border-border',
        inFlow && !selected && 'border-primary/70 ring-2 ring-primary/40',
        dimmed && 'opacity-30 saturate-50',
      )}
      style={inFlow || selected ? { boxShadow: `0 0 0 1px ${visual.accent}33, 0 8px 28px -12px ${visual.accent}88` } : undefined}
      data-testid={`node-${component.id}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', visual.chip)}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-5 text-foreground" title={component.name}>
            {component.name}
          </div>
          <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            {visual.label}
          </div>
        </div>
      </div>
      {component.description ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {component.description}
        </p>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
