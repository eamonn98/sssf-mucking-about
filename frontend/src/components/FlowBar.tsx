import { Pencil, Plus, Workflow, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RequestFlow } from '@/lib/types'

export const NO_FLOW = '__none__'

interface FlowBarProps {
  flows: RequestFlow[]
  activeFlowId: string | null
  onSelect: (flowId: string | null) => void
  onNew: () => void
  onEdit: (flow: RequestFlow) => void
}

/** Request-flow picker: highlight a saved path, or start a new one. */
export function FlowBar({ flows, activeFlowId, onSelect, onNew, onEdit }: FlowBarProps) {
  const active = flows.find((f) => f.id === activeFlowId) ?? null

  return (
    <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-md border border-border bg-card/95 p-1.5 pl-2 shadow-lg backdrop-blur sm:gap-2">
      <Workflow className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
      <Select
        value={activeFlowId ?? NO_FLOW}
        onValueChange={(value) => onSelect(value === NO_FLOW ? null : value)}
      >
        <SelectTrigger
          className="h-7 w-[132px] border-none bg-transparent text-xs shadow-none sm:w-[204px]"
          aria-label="Request flow"
        >
          <SelectValue placeholder="Highlight a request flow" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FLOW}>No flow — show everything</SelectItem>
          {flows.map((flow) => (
            <SelectItem key={flow.id} value={flow.id}>
              {flow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            title="Edit this flow"
            aria-label="Edit this flow"
            onClick={() => onEdit(active)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Clear the highlight"
            aria-label="Clear the highlight"
            onClick={() => onSelect(null)}
          >
            <X />
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={onNew} title="Author a new request flow">
          <Plus /> New flow
        </Button>
      )}
    </div>
  )
}
