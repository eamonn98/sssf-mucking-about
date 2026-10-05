import { Boxes, GitBranch, PanelRight, Plus, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface AppHeaderProps {
  componentCount: number
  relationshipCount: number
  flowCount: number
  status: 'loading' | 'ready' | 'error'
  onAddComponent: () => void
  onAddRelationship: () => void
  onReload: () => void
  onToggleInspector?: () => void
  canAddRelationship: boolean
}

export function AppHeader({
  componentCount,
  relationshipCount,
  flowCount,
  status,
  onAddComponent,
  onAddRelationship,
  onReload,
  onToggleInspector,
  canAddRelationship,
}: AppHeaderProps) {
  const statusLabel =
    status === 'ready' ? 'API connected' : status === 'loading' ? 'Connecting…' : 'API unavailable'

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card/60 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/40 bg-primary/15 text-primary">
          <Boxes className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">ArchViz</div>
          <div className="text-[11px] text-muted-foreground">Local architecture workspace</div>
        </div>
      </div>

      <div className="ml-2 hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
        <span className="font-mono">
          <span className="text-foreground">{componentCount}</span> components
        </span>
        <span className="font-mono">
          <span className="text-foreground">{relationshipCount}</span> relationships
        </span>
        <span className="font-mono">
          <span className="text-foreground">{flowCount}</span> flows
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] md:flex',
            status === 'ready'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : status === 'loading'
                ? 'border-border bg-secondary text-muted-foreground'
                : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
          title={statusLabel}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              status === 'ready' ? 'bg-emerald-400' : status === 'loading' ? 'bg-muted-foreground' : 'bg-destructive',
            )}
          />
          {statusLabel}
        </span>

        <Button variant="ghost" size="icon" title="Reload from the API" aria-label="Reload" onClick={onReload}>
          <RefreshCw />
        </Button>
        {onToggleInspector ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleInspector}
            title="Show the inspector"
            aria-label="Inspector"
          >
            <PanelRight /> Inspector
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={onAddRelationship}
          disabled={!canAddRelationship}
          title={canAddRelationship ? 'Add a relationship' : 'Add at least two components first'}
        >
          <GitBranch /> Relationship
        </Button>
        <Button size="sm" onClick={onAddComponent}>
          <Plus /> Component
        </Button>
      </div>
    </header>
  )
}
