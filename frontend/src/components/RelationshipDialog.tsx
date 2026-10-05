import { useEffect, useState } from 'react'

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
import { PROTOCOL_VISUALS } from '@/lib/graph'
import {
  PROTOCOLS,
  type Component,
  type Protocol,
  type Relationship,
  type RelationshipInput,
} from '@/lib/types'

export interface RelationshipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  relationship: Relationship | null
  components: Component[]
  /** Pre-filled endpoints when the user draws a connection on the canvas. */
  initialSourceId?: string
  initialTargetId?: string
  onSubmit: (input: RelationshipInput) => Promise<void>
}

export function RelationshipDialog({
  open,
  onOpenChange,
  relationship,
  components,
  initialSourceId,
  initialTargetId,
  onSubmit,
}: RelationshipDialogProps) {
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [label, setLabel] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('http_rest')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setFieldErrors({})
    setSaving(false)
    if (relationship) {
      setSourceId(relationship.source_component_id)
      setTargetId(relationship.target_component_id)
      setLabel(relationship.label)
      setProtocol(relationship.protocol)
      setDescription(relationship.description)
    } else {
      setSourceId(initialSourceId ?? '')
      setTargetId(initialTargetId ?? '')
      setLabel('')
      setProtocol('http_rest')
      setDescription('')
    }
  }, [open, relationship, initialSourceId, initialTargetId])

  const componentName = (id: string) => components.find((c) => c.id === id)?.name ?? 'Unknown'

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    if (!sourceId) local.source_component_id = 'Choose a source component.'
    if (!targetId) local.target_component_id = 'Choose a target component.'
    if (sourceId && targetId && sourceId === targetId) {
      local.target_component_id = 'A component cannot communicate with itself.'
    }
    if (!label.trim()) local.label = 'Label is required.'
    if (Object.keys(local).length) {
      setFieldErrors(local)
      setError('Relationship is invalid.')
      return
    }

    setSaving(true)
    setFieldErrors({})
    try {
      await onSubmit({
        source_component_id: sourceId,
        target_component_id: targetId,
        label: label.trim(),
        protocol,
        description: description.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFieldErrors(err.fields)
      } else {
        setError('Could not save the relationship.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{relationship ? 'Edit relationship' : 'Add relationship'}</DialogTitle>
          <DialogDescription>
            Relationships are directed: they describe how one component talks to another, and over
            which protocol.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rel-source">Source</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger id="rel-source">
                <SelectValue placeholder="Choose a component" />
              </SelectTrigger>
              <SelectContent>
                {components.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.source_component_id ? (
              <p className="text-xs text-destructive">{fieldErrors.source_component_id}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rel-target">Target</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger id="rel-target">
                <SelectValue placeholder="Choose a component" />
              </SelectTrigger>
              <SelectContent>
                {components.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.target_component_id ? (
              <p className="text-xs text-destructive">{fieldErrors.target_component_id}</p>
            ) : null}
          </div>

          {sourceId && targetId && sourceId !== targetId ? (
            <p className="rounded-md border border-border bg-secondary/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {componentName(sourceId)} → {componentName(targetId)}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rel-label">Label</Label>
              <Input
                id="rel-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Create order"
                aria-invalid={Boolean(fieldErrors.label)}
              />
              {fieldErrors.label ? <p className="text-xs text-destructive">{fieldErrors.label}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-protocol">Protocol</Label>
              <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
                <SelectTrigger id="rel-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROTOCOL_VISUALS[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rel-description">Description</Label>
            <Textarea
              id="rel-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What flows over this link."
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || components.length < 2}>
              {saving ? 'Saving…' : relationship ? 'Save changes' : 'Add relationship'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
