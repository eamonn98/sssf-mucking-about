import { useEffect, useMemo, useState } from 'react'

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
import { TYPE_VISUALS } from '@/lib/graph'
import { COMPONENT_TYPES, type Component, type ComponentInput, type ComponentType, type Position } from '@/lib/types'

export interface ComponentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The component being edited, or null when creating. */
  component: Component | null
  /** Where a newly created component should land on the canvas. */
  defaultPosition: Position
  onSubmit: (input: ComponentInput) => Promise<void>
}

interface MetadataRow {
  key: string
  value: string
}

const EMPTY_METADATA: MetadataRow[] = [{ key: '', value: '' }]

export function ComponentDialog({
  open,
  onOpenChange,
  component,
  defaultPosition,
  onSubmit,
}: ComponentDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ComponentType>('microservice')
  const [description, setDescription] = useState('')
  const [metadata, setMetadata] = useState<MetadataRow[]>(EMPTY_METADATA)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setFieldErrors({})
    setSaving(false)
    if (component) {
      setName(component.name)
      setType(component.type)
      setDescription(component.description)
      const rows = Object.entries(component.metadata).map(([key, value]) => ({ key, value }))
      setMetadata(rows.length ? rows : EMPTY_METADATA)
    } else {
      setName('')
      setType('microservice')
      setDescription('')
      setMetadata(EMPTY_METADATA)
    }
  }, [open, component])

  const metadataObject = useMemo(() => {
    const out: Record<string, string> = {}
    for (const row of metadata) {
      const key = row.key.trim()
      if (key) out[key] = row.value.trim()
    }
    return out
  }, [metadata])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})

    if (!name.trim()) {
      setFieldErrors({ name: 'Name is required.' })
      setError('Component is invalid.')
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        type,
        description: description.trim(),
        metadata: metadataObject,
        ...(component ? {} : { position: defaultPosition }),
      })
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFieldErrors(err.fields)
      } else {
        setError('Could not save the component.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{component ? 'Edit component' : 'Add component'}</DialogTitle>
          <DialogDescription>
            Components are the boxes on the canvas: services, data stores, brokers and anything
            external your system talks to.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="component-name">Name</Label>
              <Input
                id="component-name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Orders Service"
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name ? (
                <p className="text-xs text-destructive">{fieldErrors.name}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ComponentType)}>
                <SelectTrigger id="component-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_VISUALS[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="component-description">Description</Label>
            <Textarea
              id="component-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this component is responsible for."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Metadata</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMetadata((rows) => [...rows, { key: '', value: '' }])}
              >
                Add field
              </Button>
            </div>
            <div className="space-y-2">
              {metadata.map((row, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    aria-label={`Metadata key ${index + 1}`}
                    className="w-2/5"
                    value={row.key}
                    placeholder="language"
                    onChange={(e) =>
                      setMetadata((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)),
                      )
                    }
                  />
                  <Input
                    aria-label={`Metadata value ${index + 1}`}
                    value={row.value}
                    placeholder="Go"
                    onChange={(e) =>
                      setMetadata((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove metadata field ${index + 1}`}
                    onClick={() => setMetadata((rows) => rows.filter((_, i) => i !== index))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              {metadata.length === 0 ? (
                <p className="text-xs text-muted-foreground">No metadata fields.</p>
              ) : null}
            </div>
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
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : component ? 'Save changes' : 'Add component'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
