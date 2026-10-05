import { afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { mockDesktopViewport } from '@/test/viewport'

// jsdom has no ResizeObserver, which React Flow needs to measure nodes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, writable: true })
  }
  if (!('DOMMatrixReadOnly' in globalThis)) {
    class DOMMatrixReadOnlyStub {
      m22 = 1
      constructor(_transform?: string) {}
    }
    Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
      value: DOMMatrixReadOnlyStub,
      writable: true,
    })
  }
  // React Flow warns loudly about zero-size containers in jsdom; silence it.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// Default every test to the two-column desktop layout; tests that care about
// narrow viewports switch via mockNarrowViewport().
beforeEach(() => {
  mockDesktopViewport()
})

afterEach(() => {
  cleanup()
})
