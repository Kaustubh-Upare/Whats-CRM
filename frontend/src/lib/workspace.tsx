import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'

/**
 * Workspace registry — mirrors the two top-level nav groups that the
 * sidebar exposes.
 *
 *   bulk  → "Bulk Messages" (upload, batches, retailers, messaging)
 *   ai    → "AI Workflows"  (AI agent, follow-ups, CRM, human review)
 *
 * Adding a new workspace = add an entry here + create a `navBulk` /
 * `navAI` style list in Layout.tsx + add the corresponding route prefix
 * in App.tsx. That's it — nothing else in the app cares.
 */
export type WorkspaceId = 'bulk' | 'ai'

export interface WorkspaceDef {
  id: WorkspaceId
  label: string
  shortLabel: string
  description: string
  /** Path inside /admin that this workspace mounts under. */
  basePath: `/${string}`
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  bulk: {
    id: 'bulk',
    label: 'Bulk Messages',
    shortLabel: 'Bulk',
    description: 'Upload billing files, approve batches, and send WhatsApp messages at scale.',
    basePath: '/admin/messages/bulk',
  },
  ai: {
    id: 'ai',
    label: 'AI Workflows',
    shortLabel: 'AI',
    description: 'Configure AI agents, review automated follow-ups, and manage your CRM pipelines.',
    basePath: '/admin/ai',
  },
}

export const WORKSPACE_ORDER: WorkspaceId[] = ['bulk', 'ai']

const STORAGE_KEY = 'whatsyitc.activeWorkspace'

export function explicitWorkspaceFromPath(pathname: string): WorkspaceId | null {
  const rest = pathname.replace(/^\/admin\/?/, '')
  if (rest === 'messages/bulk' || rest.startsWith('messages/bulk/')) return 'bulk'
  if (rest === 'ai' || rest.startsWith('ai/')) return 'ai'
  return null
}

/** Resolve which workspace a given pathname belongs to.
 *  Falls back to `bulk` for /admin root or anything unrecognised. */
export function workspaceFromPath(pathname: string): WorkspaceId {
  // Strip the /admin prefix so the checks below stay readable.
  const rest = pathname.replace(/^\/admin\/?/, '')
  // Anything under /messages/bulk/* → Bulk workspace.
  if (rest === 'messages/bulk' || rest.startsWith('messages/bulk/')) return 'bulk'
  // Anything else under /admin/* that's explicitly AI-shaped → AI.
  if (rest === 'ai' || rest.startsWith('ai/')) return 'ai'
  // Legacy paths that used to live at /admin/* without a prefix are
  // treated as Bulk — those routes now redirect to /messages/bulk/*.
  if (
    rest === '' ||
    rest === 'upload' ||
    rest.startsWith('upload/') ||
    rest === 'batches' || rest.startsWith('batches/') ||
    rest === 'retailers' || rest.startsWith('retailers/') ||
    rest === 'messages' || rest.startsWith('messages/') ||
    rest === 'chats' ||
    rest === 'webhook-logs' ||
    rest === 'audit-log' ||
    rest === 'templates' ||
    rest === 'reports' ||
    rest === 'credentials' || rest.startsWith('credentials/')
  ) {
    return 'bulk'
  }
  return 'bulk'
}

interface WorkspaceContextValue {
  active: WorkspaceId
  setActive: (id: WorkspaceId) => void
  toggle: () => void
  current: WorkspaceDef
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/** Provider — wrap once near the app root (see main.tsx).
 *  Persists the active workspace in localStorage so a page refresh
 *  doesn't bounce the user back to the default. */
export function WorkspaceProvider({
  children,
  /** Optional initial value (used by tests / Storybook). Defaults to 'bulk'. */
  initial,
}: {
  children: ReactNode
  initial?: WorkspaceId
}) {
  // Read once at mount — keep things synchronous so the very first render
  // already has the right sidebar (no flash of the wrong workspace).
  const [active, setActiveState] = useState<WorkspaceId>(() => {
    if (initial) return initial
    if (typeof window === 'undefined') return 'bulk'
    const fromPath = explicitWorkspaceFromPath(window.location.pathname)
    if (fromPath) return fromPath
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === 'bulk' || raw === 'ai') return raw
    } catch {
      // localStorage can throw in private modes / iframes — silently ignore.
    }
    return 'bulk'
  })

  // Persist on every change. Wrapped in try/catch because Safari private
  // mode and some embedded WebViews throw on setItem.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, active)
    } catch {
      // ignore
    }
  }, [active])

  const setActive = useCallback((id: WorkspaceId) => {
    setActiveState(id)
  }, [])

  const toggle = useCallback(() => {
    setActiveState((cur) => (cur === 'bulk' ? 'ai' : 'bulk'))
  }, [])

  const value = useMemo<WorkspaceContextValue>(() => ({
    active,
    setActive,
    toggle,
    current: WORKSPACES[active],
  }), [active, setActive, toggle])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

/** Hook — returns the current workspace + helpers. */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  }
  return ctx
}
