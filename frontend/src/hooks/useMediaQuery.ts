import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query. Used to pick the layout variant in JS so the
 * graph and the inspector never fight over a narrow viewport.
 *
 * Falls back to `false` where `matchMedia` is unavailable (for example jsdom
 * without a stub).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mql = window.matchMedia(query)
    setMatches(mql.matches)

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

function readMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

/** True from Tailwind's `lg` breakpoint upwards (the two-column layout). */
export const DESKTOP_QUERY = '(min-width: 1024px)'
