import type {
  Architecture,
  Component,
  ComponentInput,
  Position,
  Relationship,
  RelationshipInput,
  RequestFlow,
  RequestFlowInput,
} from './types'

/** An API failure carrying the backend's field-level validation messages. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>

  constructor(status: number, message: string, code = 'error', fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }

  /** Flattened, human-readable description including per-field detail. */
  get detail(): string {
    const parts = Object.values(this.fields).filter(Boolean)
    return parts.length ? `${this.message} ${parts.join(' ')}` : this.message
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; fields?: Record<string, string> }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the architecture API. Is the Go server running?', 'offline')
  }

  if (res.status === 204) {
    return undefined as T
  }

  const text = await res.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }

  if (!res.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope
    throw new ApiError(
      res.status,
      envelope.error?.message ?? `Request failed with status ${res.status}.`,
      envelope.error?.code ?? 'error',
      envelope.error?.fields ?? {},
    )
  }
  return body as T
}

export const api = {
  getArchitecture: () => request<Architecture>('/api/architecture'),

  createComponent: (input: ComponentInput) =>
    request<Component>('/api/components', { method: 'POST', body: JSON.stringify(input) }),

  updateComponent: (id: string, input: ComponentInput) =>
    request<Component>(`/api/components/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  updateComponentPosition: (id: string, position: Position) =>
    request<Component>(`/api/components/${id}/position`, {
      method: 'PUT',
      body: JSON.stringify(position),
    }),

  deleteComponent: (id: string) =>
    request<void>(`/api/components/${id}`, { method: 'DELETE' }),

  createRelationship: (input: RelationshipInput) =>
    request<Relationship>('/api/relationships', { method: 'POST', body: JSON.stringify(input) }),

  updateRelationship: (id: string, input: RelationshipInput) =>
    request<Relationship>(`/api/relationships/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteRelationship: (id: string) =>
    request<void>(`/api/relationships/${id}`, { method: 'DELETE' }),

  createFlow: (input: RequestFlowInput) =>
    request<RequestFlow>('/api/request-flows', { method: 'POST', body: JSON.stringify(input) }),

  updateFlow: (id: string, input: RequestFlowInput) =>
    request<RequestFlow>(`/api/request-flows/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteFlow: (id: string) =>
    request<void>(`/api/request-flows/${id}`, { method: 'DELETE' }),
}
