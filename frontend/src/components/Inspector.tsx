import { ArrowRight, Pencil, Trash2 } from 'lucide-react'

import { TYPE_ICONS } from '@/components/typeIcons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { PROTOCOL_VISUALS, TYPE_VISUALS, resolveFlow } from '@/lib/graph'
import type { Component, Relationship, RequestFlow } from '@/lib/types'
import { cn } from '@/lib/utils'

interface InspectorProps {
  selectedComponent: Component | null
  selectedRelationship: Relationship | null
  components: Component[]
  relationships: Relationship[]
  activeFlow: RequestFlow | null
  onEditComponent: (component: Component) => void
  onDeleteComponent: (component: Component) => void
  onEditRelationship: (relationship: Relationship) => void
  onDeleteRelationship: (relationship: Relationship) => void
  onSelectComponent: (id: string) => void
  onClearSelection: () => void
  onEditFlow: (flow: RequestFlow) => void
  onClearFlow: () => void
  /** Rendered as a close affordance by the narrow-screen overlay variant. */
  onClose?: () => void
}

export function Inspector(props: InspectorProps) {
  const {
    selectedComponent,
    selectedRelationship,
    components,
    relationships,
    activeFlow,
    onEditComponent,
    onDeleteComponent,
    onEditRelationship,
    onDeleteRelationship,
    onSelectComponent,
    onClearSelection,
    onEditFlow,
    onClearFlow,
    onClose,
  } = props

  const compById = new Map(components.map((c) => [c.id, c]))

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Inspector
        </h2>
        <div className="flex items-center gap-1">
          {selectedComponent || selectedRelationship ? (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear
            </Button>
          ) : null}
          {onClose ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 px-2 text-xs lg:hidden"
            >
              Close
            </Button>
          ) : null}
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {selectedComponent ? (
          <ComponentDetails
            component={selectedComponent}
            relationships={relationships}
            compById={compById}
            onEdit={() => onEditComponent(selectedComponent)}
            onDelete={() => onDeleteComponent(selectedComponent)}
            onSelectComponent={onSelectComponent}
            onEditRelationship={onEditRelationship}
          />
        ) : selectedRelationship ? (
          <RelationshipDetails
            relationship={selectedRelationship}
            compById={compById}
            onEdit={() => onEditRelationship(selectedRelationship)}
            onDelete={() => onDeleteRelationship(selectedRelationship)}
            onSelectComponent={onSelectComponent}
          />
        ) : activeFlow ? (
          <FlowDetails
            flow={activeFlow}
            components={components}
            relationships={relationships}
            onEdit={() => onEditFlow(activeFlow)}
            onClear={onClearFlow}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="space-y-3 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground/80">Nothing selected</p>
      <ul className="list-inside list-disc space-y-1 text-xs">
        <li>Click a component or relationship to inspect it.</li>
        <li>Drag from a node handle to another node to create a relationship.</li>
        <li>Use the toolbar to pan, zoom and fit the graph.</li>
      </ul>
    </div>
  )
}

function ComponentDetails({
  component,
  relationships,
  compById,
  onEdit,
  onDelete,
  onSelectComponent,
  onEditRelationship,
}: {
  component: Component
  relationships: Relationship[]
  compById: Map<string, Component>
  onEdit: () => void
  onDelete: () => void
  onSelectComponent: (id: string) => void
  onEditRelationship: (relationship: Relationship) => void
}) {
  const visual = TYPE_VISUALS[component.type]
  const Icon = TYPE_ICONS[component.type]
  const outgoing = relationships.filter((r) => r.source_component_id === component.id)
  const incoming = relationships.filter((r) => r.target_component_id === component.id)

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-md border', visual.chip)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{component.name}</h3>
          <Badge className={cn('mt-1 border', visual.chip)}>{visual.label}</Badge>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>

      <Separator />

      {component.description ? <Field label="Description">{component.description}</Field> : null}

      <Field label="Position">
        <span className="font-mono text-xs text-muted-foreground">
          x {Math.round(component.position.x)} · y {Math.round(component.position.y)}
        </span>
      </Field>

      {Object.keys(component.metadata).length ? (
        <div className="space-y-1">
          <SectionLabel>Metadata</SectionLabel>
          <dl className="space-y-1">
            {Object.entries(component.metadata).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate text-right font-mono text-foreground/90">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <Separator />

      <div className="space-y-2">
        <SectionLabel>Outgoing ({outgoing.length})</SectionLabel>
        {outgoing.length ? (
          <ul className="space-y-1.5">
            {outgoing.map((rel) => (
              <RelationshipRow
                key={rel.id}
                relationship={rel}
                direction="out"
                otherName={compById.get(rel.target_component_id)?.name ?? 'Unknown'}
                onClick={() => onEditRelationship(rel)}
                onSelectOther={() => onSelectComponent(rel.target_component_id)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No outgoing relationships.</p>
        )}
      </div>

      <div className="space-y-2">
        <SectionLabel>Incoming ({incoming.length})</SectionLabel>
        {incoming.length ? (
          <ul className="space-y-1.5">
            {incoming.map((rel) => (
              <RelationshipRow
                key={rel.id}
                relationship={rel}
                direction="in"
                otherName={compById.get(rel.source_component_id)?.name ?? 'Unknown'}
                onClick={() => onEditRelationship(rel)}
                onSelectOther={() => onSelectComponent(rel.source_component_id)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No incoming relationships.</p>
        )}
      </div>
    </div>
  )
}

function RelationshipRow({
  relationship,
  direction,
  otherName,
  onClick,
  onSelectOther,
}: {
  relationship: Relationship
  direction: 'in' | 'out'
  otherName: string
  onClick: () => void
  onSelectOther: () => void
}) {
  const protocol = PROTOCOL_VISUALS[relationship.protocol]
  return (
    <li className="rounded-md border border-border bg-secondary/30 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
            protocol.badge,
          )}
        >
          {protocol.short}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{relationship.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <ArrowRight className={cn('h-3 w-3', direction === 'in' && 'rotate-180')} />
        <button
          type="button"
          className="truncate underline-offset-2 hover:text-foreground hover:underline"
          onClick={onSelectOther}
        >
          {otherName}
        </button>
        <button
          type="button"
          className="ml-auto shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={onClick}
        >
          Edit
        </button>
      </div>
    </li>
  )
}

function RelationshipDetails({
  relationship,
  compById,
  onEdit,
  onDelete,
  onSelectComponent,
}: {
  relationship: Relationship
  compById: Map<string, Component>
  onEdit: () => void
  onDelete: () => void
  onSelectComponent: (id: string) => void
}) {
  const protocol = PROTOCOL_VISUALS[relationship.protocol]
  const source = compById.get(relationship.source_component_id)
  const target = compById.get(relationship.target_component_id)

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <SectionLabel>Relationship</SectionLabel>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => source && onSelectComponent(source.id)}
          >
            {source?.name ?? 'Unknown'}
          </button>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => target && onSelectComponent(target.id)}
          >
            {target?.name ?? 'Unknown'}
          </button>
        </div>
        <Badge className={cn('border', protocol.badge)}>{protocol.label}</Badge>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>

      <Separator />

      <Field label="Label">{relationship.label}</Field>
      {relationship.description ? (
        <Field label="Description">{relationship.description}</Field>
      ) : null}
      <Field label="Direction">
        <span className="font-mono text-xs text-muted-foreground">directed →</span>
      </Field>
    </div>
  )
}

function FlowDetails({
  flow,
  components,
  relationships,
  onEdit,
  onClear,
}: {
  flow: RequestFlow
  components: Component[]
  relationships: Relationship[]
  onEdit: () => void
  onClear: () => void
}) {
  const resolved = resolveFlow(flow, relationships, components)

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <SectionLabel>Active request flow</SectionLabel>
        <h3 className="text-base font-semibold">{flow.name}</h3>
        {flow.description ? (
          <p className="text-xs text-muted-foreground">{flow.description}</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <Pencil /> Edit flow
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear highlight
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionLabel>Route ({resolved.orderedComponents.length} components)</SectionLabel>
        <ol className="space-y-1.5">
          {resolved.orderedRelationships.map((rel, index) => (
            <li key={`${rel.id}-${index}`} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground/90">
                  {resolved.orderedComponents[index]?.name ?? 'Unknown'}
                  <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                  {resolved.orderedComponents[index + 1]?.name ?? 'Unknown'}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                      PROTOCOL_VISUALS[rel.protocol].badge,
                    )}
                  >
                    {PROTOCOL_VISUALS[rel.protocol].short}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{rel.label}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
