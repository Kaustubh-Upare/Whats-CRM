import { useEffect, useState } from 'react'

/**
 * useMediaQuery — small SSR-safe wrapper around window.matchMedia.
 *
 * Returns `defaultValue` during SSR / first render, then upgrades to the
 * live media-query result after mount. Subscribes to changes so the value
 * updates if the user resizes the window or rotates their phone.
 *
 * Usage:
 *   const isWide = useMediaQuery('(min-width: 1024px)', true)
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return defaultValue
    }
    try {
      return window.matchMedia(query).matches
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    // Sync once on mount in case it changed between initial render and effect.
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    // Older Safari uses addListener; modern browsers use addEventListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [query])

  return matches
}
