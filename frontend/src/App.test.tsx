import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '@/App'
import { mockNarrowViewport } from '@/test/viewport'
import type { Architecture } from '@/lib/types'

function snapshot(): Architecture {
  const now = '2024-01-01T00:00:00Z'
  return {
    components: [
      {
        id: 'c-web',
        name: 'Web App',
        type: 'frontend',
        description: 'Browser client',
        metadata: { language: 'TypeScript' },
        position: { x: 0, y: 0 },
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c-gateway',
        name: 'API Gateway',
        type: 'backend_service',
        description: 'Public entry point',
        metadata: {},
        position: { x: 320, y: 0 },
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c-db',
        name: 'Orders DB',
        type: 'database',
        description: '',
        metadata: {},
        position: { x: 640, y: 0 },
        created_at: now,
        updated_at: now,
      },
    ],
    relationships: [
      {
        id: 'r1',
        source_component_id: 'c-web',
        target_component_id: 'c-gateway',
        label: 'REST /api',
        protocol: 'http_rest',
        description: '',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'r2',
        source_component_id: 'c-gateway',
        target_component_id: 'c-db',
        label: 'SQL',
        protocol: 'other',
        description: '',
        created_at: now,
        updated_at: now,
      },
    ],
    request_flows: [
      {
        id: 'f1',
        name: 'Checkout',
        description: '',
        relationship_ids: ['r1', 'r2'],
        created_at: now,
        updated_at: now,
      },
    ],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the seeded snapshot and the workspace chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(snapshot()), { status: 200 })),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('ArchViz')).toBeTruthy()
    })

    expect(await screen.findByText('Web App')).toBeTruthy()
    expect(screen.getByText('API Gateway')).toBeTruthy()
    expect(screen.getByText('Orders DB')).toBeTruthy()
    expect(screen.getByText('Legend')).toBeTruthy()
    expect(screen.getByText('Inspector')).toBeTruthy()
    expect(screen.getByText('Nothing selected')).toBeTruthy()
    // The flow picker is wired up to the snapshot's flows.
    expect(screen.getByRole('combobox', { name: /request flow/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /new flow/i })).toBeTruthy()
    expect(screen.getByText('API connected')).toBeTruthy()
  })

  it('shows a recovery screen when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    render(<App />)

    expect(
      await screen.findByText('Cannot reach the architecture API'),
    ).toBeTruthy()
    expect(screen.getByText(/go run \.\/cmd\/server/)).toBeTruthy()
  })

  it('shows the empty state when there is no architecture yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ components: [], relationships: [], request_flows: [] }),
            { status: 200 },
          ),
      ),
    )

    render(<App />)

    expect(await screen.findByText('No components yet')).toBeTruthy()
  })

  it('keeps the graph full-width on narrow viewports by moving the inspector into an overlay', async () => {
    mockNarrowViewport()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(snapshot()), { status: 200 })),
    )

    render(<App />)

    await screen.findByText('Web App')

    // No permanent sidebar: the canvas owns the width...
    expect(screen.queryByText('Nothing selected')).toBeNull()

    // ...and the inspector is reachable from the header instead.
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }))

    expect(await screen.findByText('Nothing selected')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeTruthy()
  })
})
