import { vi } from 'vitest'

import { DESKTOP_QUERY } from '@/hooks/useMediaQuery'

type Listener = (event: { matches: boolean; media: string }) => void

/** Minimal MediaQueryList good enough for `useMediaQuery` under jsdom. */
function matchMediaFor(isDesktop: boolean) {
  return (query: string): MediaQueryList => {
    const listeners = new Set<Listener>()
    const matches = query.includes(DESKTOP_QUERY) ? isDesktop : false
    const mql = {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
      dispatchEvent: () => false,
    }
    return mql as unknown as MediaQueryList
  }
}

/** Pretend the viewport is at or above Tailwind's `lg` breakpoint. */
export function mockDesktopViewport() {
  vi.stubGlobal('matchMedia', vi.fn(matchMediaFor(true)))
}

/** Pretend the viewport is narrower than Tailwind's `lg` breakpoint. */
export function mockNarrowViewport() {
  vi.stubGlobal('matchMedia', vi.fn(matchMediaFor(false)))
}
