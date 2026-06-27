import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'whatsyitc_theme'

/**
 * Synchronous reader — safe to call from the inline init script in index.html
 * or during the first React render.
 *
 * Priority: localStorage → prefers-color-scheme → light.
 */
export function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* localStorage may throw in private mode — fall through */
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

/**
 * Apply the theme to <html> + persist. Idempotent.
 * Exposed so the inline init script (in index.html) can call it before React
 * mounts, eliminating the flash-of-wrong-theme.
 */
export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', t === 'dark')
  // also tag the body for any code that wants to read it cheaply
  root.style.colorScheme = t
  try { window.localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readInitialTheme()
    applyTheme(t)
    return t
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)
  const toggle   = () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // outside provider → return a noop shim so call sites don't crash
    return {
      theme: 'light',
      setTheme: () => { /* noop */ },
      toggle:   () => { /* noop */ },
    }
  }
  return ctx
}
