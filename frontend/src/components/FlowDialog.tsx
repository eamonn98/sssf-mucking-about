import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { PROTOCOL_VISUALS, checkPath, outgoingFrom } from '@/lib/graph'
import type { Component, Relationship, RequestFlow, RequestFlowInput } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface FlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: RequestFlow | null
  components: Component[]
  relationships: Relationship[]
  onSubmit: (input: RequestFlowInput) => Promise<void>
  onDelete?: (flow: RequestFlow) => void
}

/**
 * Authoring a request flow: pick relationships in order so the resulting path
 * is always connected. Each new step is restricted to edges that leave the
 * component the previous step arrived at.
 */
export function FlowDialog({
  open,
  onOpenChange,
  flow,
  components,
  relationships,
  onSubmit,
  onDelete,
}: FlowDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setFieldErrors({})
    setSaving(false)
    setName(flow?.name ?? '')
    setDescription(flow?.description ?? '')
    setSteps(flow?.relationship_ids ?? [])
  }, [open, flow])

  const relById = useMemo(() => new Map(relationships.map((r) => [r.id, r])), [relationships])
  const compById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])

  const selectedEdges = useMemo(
    () => steps.map((id) => relById.get(id)).filter((r): r is Relationship => Boolean(r)),
    [steps, relById],
  )

  const tailComponentId = selectedEdges.length
    ? selectedEdges[selectedEdges.length - 1].target_component_id
    : null

  const availableEdges = useMemo(() => outgoingFrom(relationships, tailComponentId), [relationships, tailComponentId])

  const pathMessage = checkPath(selectedEdges)

  const componentPath = useMemo(() => {
    if (!selectedEdges.length) return []
    const ids = [selectedEdges[0].source_component_id, ...selectedEdges.map((e) => e.target_component_id)]
    return ids.map((id) => compById.get(id)?.name ?? 'Unknown')
  }, [selectedEdges, compById])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    if (!name.trim()) local.name = 'Name is required.'
    const pathProblem = checkPath(selectedEdges)
    if (pathProblem) local.relationship_ids = pathProblem
    if (Object.keys(local).length) {
      setFieldErrors(local)
      setError(pathProblem ?? 'Request flow is invalid.')
      return
    }

    setSaving(true)
    setFieldErrors({})
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), relationship_ids: steps })
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFieldErrors(err.fields)
      } else {
        setError('Could not save the request flow.')
      }
    } finally {
      setSaving(false)
    }
  }

  const hasComponents = components.length >= 2 && relationships.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{flow ? 'Edit request flow' : 'New request flow'}</DialogTitle>
          <DialogDescription>
            A request flow is a developer-authored path. Selecting it highlights the exact route
            through the architecture.
          </DialogDescription>
        </DialogHeader>

        {!hasComponents ? (
          <p className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            Add at least two components and one relationship before authoring a flow.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="flow-name">Name</Label>
            <Input
              id="flow-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkout (synchronous)"
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name ? <p className="text-xs text-destructive">{fieldErrors.name}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flow-description">Description</Label>
            <Textarea
              id="flow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this path represents."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Path</Label>
              {componentPath.length ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {componentPath.join(' → ')}
                </span>
              ) : null}
            </div>

            <ol className="space-y-1.5" data-testid="flow-steps">
              {selectedEdges.map((edge, index) => (
                <li
                  key={`${edge.id}-${index}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1.5"
                >
                  <span className="w-5 text-center font-mono text-[11px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate text-xs">
                    <span className="text-foreground">
                      {compById.get(edge.source_component_id)?.name ?? 'Unknown'}
                    </span>
                    <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                    <span className="text-foreground">
                      {compById.get(edge.target_component_id)?.name ?? 'Unknown'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                      PROTOCOL_VISUALS[edge.protocol].badge,
                    )}
                  >
                    {PROTOCOL_VISUALS[edge.protocol].short}
                  </span>
                  <span className="max-w-[110px] truncate text-[11px] text-muted-foreground">
                    {edge.label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove step ${index + 1} and everything after it`}
                    title="Remove this step and everything after it"
                    onClick={() => setSteps((prev) => prev.slice(0, index))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {selectedEdges.length === 0 ? (
                <li className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                  No steps yet — pick the first relationship below.
                </li>
              ) : null}
            </ol>

            <div className="flex items-center gap-2">
              <Select
                value=""
                onValueChange={(value) => {
                  setSteps((prev) => [...prev, value])
                  setFieldErrors({})
                  setError(null)
                }}
                disabled={availableEdges.length === 0}
              >
                <SelectTrigger className="flex-1" aria-label="Add a step to the path">
                  <SelectValue
                    placeholder={
                      availableEdges.length
                        ? tailComponentId
                          ? `Add a link leaving ${compById.get(tailComponentId)?.name ?? '…'}`
                          : 'Choose the first relationship'
                        : 'No relationship can continue this path'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableEdges.map((edge) => (
                    <SelectItem key={edge.id} value={edge.id}>
                      {compById.get(edge.source_component_id)?.name} →{' '}
                      {compById.get(edge.target_component_id)?.name} ({edge.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEdges.length ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSteps([])}>
                  Clear path
                </Button>
              ) : null}
            </div>

            {pathMessage && selectedEdges.length ? (
              <p className="text-xs text-destructive">{pathMessage}</p>
            ) : null}
            {fieldErrors.relationship_ids ? (
              <p className="text-xs text-destructive">{fieldErrors.relationship_ids}</p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="justify-between sm:justify-between">
            <div>
              {flow && onDelete ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onDelete(flow)
                    onOpenChange(false)
                  }}
                >
                  Delete flow
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : flow ? 'Save flow' : 'Create flow'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
