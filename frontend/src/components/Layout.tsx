import { NavLink, Link, useLocation, useOutlet } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, MoreVertical, ChevronUp } from 'lucide-react'
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { api, setToken } from '@/lib/api'
import {
  LayoutDashboard, UploadCloud, Layers, Users, MessageSquare, MessagesSquare,
  FileText, BarChart3, Settings, LogOut, Activity, ShieldCheck, KeyRound, Bot,
  BellRing, UserCheck,
} from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'
import { useAuth } from '@/lib/useAuth'
import { useMediaQuery } from '@/lib/useMediaQuery'

const nav = [
  { to: '/admin',              label: 'Dashboard',   icon: LayoutDashboard, title: 'Dashboard' },
  { to: '/admin/upload',       label: 'Upload',      icon: UploadCloud,     title: 'Upload' },
  { to: '/admin/batches',      label: 'Batches',     icon: Layers,          title: 'Batches' },
  { to: '/admin/retailers',    label: 'Retailers',   icon: Users,           title: 'Retailers' },
  { to: '/admin/messages',     label: 'Messages',    icon: MessageSquare,   title: 'Messages' },
  { to: '/admin/chats',        label: 'Chats',       icon: MessagesSquare,  title: 'Chats' },
  { to: '/admin/webhook-logs', label: 'Webhook log', icon: Activity,        title: 'Webhook log' },
  { to: '/admin/audit-log',    label: 'Audit log',   icon: ShieldCheck,     title: 'Audit log' },
  { to: '/admin/templates',    label: 'Templates',   icon: FileText,        title: 'Templates' },
  { to: '/admin/reports',      label: 'Reports',     icon: BarChart3,       title: 'Reports' },
  { to: '/admin/credentials',  label: 'Credentials', icon: KeyRound,        title: 'Credentials' },
  { to: '/admin/ai',           label: 'AI Assistant',icon: Bot,             title: 'AI Assistant' },
  { to: '/admin/ai/followups', label: 'AI Follow-ups',icon: BellRing,       title: 'AI Follow-ups' },
  { to: '/admin/ai/human-review', label: 'Human Review', icon: UserCheck,   title: 'Human Review' },
  { to: '/admin/ai-followup-crm', label: 'AI CRM',    icon: BarChart3,       title: 'AI CRM' },
  { to: '/admin/settings',     label: 'Settings',    icon: Settings,        title: 'Settings' },
]

// Routes that ONLY appear in the mobile overflow menu (not in the icon rail
// at all). The rail gets crowded on tiny phones, so we put the rarely-used
// destinations behind a "more" menu in the top bar.
const overflowRoutes = [
  { to: '/admin/settings',     label: 'Settings',     icon: Settings },
  { to: '/admin/audit-log',    label: 'Audit log',    icon: ShieldCheck },
  { to: '/admin/webhook-logs', label: 'Webhook log',  icon: Activity },
  { to: '/admin/credentials',  label: 'Credentials',  icon: KeyRound },
  { to: '/admin/reports',      label: 'Reports',      icon: BarChart3 },
]

/** Map the current pathname to a human-readable title for the mobile top bar. */
function pageTitle(pathname: string): string {
  // Find the longest matching nav entry — supports nested routes like
  // /admin/batches/:id falling back to /admin/batches' title.
  let best: { to: string; title: string } | null = null
  for (const n of nav) {
    if (pathname === n.to || pathname.startsWith(n.to + '/')) {
      if (!best || n.to.length > best.to.length) best = n
    }
  }
  if (best) return best.title
  if (pathname.startsWith('/admin')) return 'Admin'
  return ''
}

export default function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const { user: me } = useAuth()

  // ≥1024 px = full sidebar; otherwise icon rail (72 px) + (below 640 px) top bar.
  const isWide = useMediaQuery('(min-width: 1024px)', true)
  const isTiny = useMediaQuery('(max-width: 639px)', false)

  // User popover (icon-rail mode only — full mode shows it inline).
  const [userOpen, setUserOpen] = useState(false)
  const userPopRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!userOpen) return
    const onDoc = (e: MouseEvent) => {
      if (userPopRef.current && !userPopRef.current.contains(e.target as Node)) {
        setUserOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [userOpen])

  // Overflow menu (top bar only).
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const [humanReviewCount, setHumanReviewCount] = useState(0)
  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  useEffect(() => {
    let alive = true
    const load = () => {
      api.get('/api/ai/human-review', { params: { status: 'open', limit: 1, refresh: false } })
        .then(({ data }) => {
          if (alive) setHumanReviewCount(Number(data?.stats?.open || data?.total || 0))
        })
        .catch(() => {
          if (alive) setHumanReviewCount(0)
        })
    }
    load()
    const t = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  function logout() {
    setToken(null)
    api.post('/auth/logout').finally(() => { window.location.href = '/login' })
  }

  const title = pageTitle(location.pathname)

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#020617] transition-colors relative">
      {/* Aurora + grid backdrop — vivid in dark, barely-there in light. */}
      <div aria-hidden className="admin-aurora dark:opacity-100 opacity-0 transition-opacity" />
      <div aria-hidden className="admin-aurora-light" />
      <div aria-hidden className="admin-grid" />

      {/* Sidebar / icon rail — always visible. Animates width between modes
          so the chrome doesn't jump when the user crosses the breakpoint. */}
      <motion.aside
        initial={false}
        animate={{ width: isWide ? 256 : 72 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        className="relative shrink-0
                   bg-gradient-to-b from-white to-slate-50/80
                   dark:from-[#0a1124] dark:to-[#0a1124]
                   border-r border-slate-200/80 dark:border-slate-800/80
                   text-slate-900 dark:text-slate-100
                   flex flex-col
                   shadow-[4px_0_24px_-12px_rgba(15,23,42,0.08)]
                   dark:shadow-[4px_0_24px_-12px_rgba(0,0,0,0.6)]"
      >
        {/* Brand header */}
        <div className="px-3 lg:px-5 py-5 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center gap-2 min-w-0">
          <Link to="/admin" className="flex items-center gap-2 min-w-0">
            <motion.div
              whileHover={{ rotate: 10, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center font-bold shadow-md shadow-emerald-500/30 dark:shadow-emerald-500/50"
            >
              W
            </motion.div>
            {isWide && (
              <div className="min-w-0">
                <div className="font-semibold leading-tight text-slate-900 dark:text-white truncate">
                  {me?.workspace_name?.trim()
                    || me?.name?.trim()
                    || 'WhatsyITC'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {me?.email || 'Signed out'}
                  {me?.oauth_provider === 'google' && (
                    <span className="ml-1 text-slate-400 dark:text-slate-500">· via Google</span>
                  )}
                </div>
              </div>
            )}
          </Link>
          {isWide && (
            <div className="ml-auto"><ThemeToggle /></div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              // `end` only true on the index route — otherwise every /admin/*
              // page would keep showing "Dashboard" as active because
              // prefix matching kicks in for non-end NavLinks.
              end={n.to === '/admin' || n.to === '/admin/ai'}
              title={!isWide ? n.label : undefined}
              aria-label={n.label}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'admin-nav-active text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
                } ${isWide ? '' : 'justify-center'}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && isWide && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-md pointer-events-none"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className={`relative flex items-center gap-3 ${isWide ? '' : 'justify-center'}`}>
                    <n.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
                    {isWide && <span className="truncate">{n.label}</span>}
                    {n.to === '/admin/ai/human-review' && humanReviewCount > 0 && (
                      <span
                        className={`${isWide ? 'ml-auto' : 'absolute -right-2 -top-2'} min-w-[18px] rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white shadow-sm`}
                      >
                        {humanReviewCount > 99 ? '99+' : humanReviewCount}
                      </span>
                    )}
                  </span>
                  {isActive && !isWide && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-emerald-500"
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer: signed-in + sign out */}
        <div className="px-2 py-3 border-t border-slate-200/80 dark:border-slate-800/80">
          {isWide ? (
            <>
              <div className="px-2 pb-2 text-xs text-slate-500 dark:text-slate-400">
                Signed in as<br />
                <span className="text-slate-800 dark:text-slate-200 font-medium">{me?.name || '...'}</span>
                <span className="ml-1 text-slate-500 dark:text-slate-400">({me?.role || '—'})</span>
                {me?.workspace_name?.trim() && (
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">
                    {me.workspace_name}
                  </div>
                )}
              </div>
              <motion.button
                onClick={logout}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm
                           text-slate-700 dark:text-slate-300
                           hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </motion.button>
            </>
          ) : (
            <div ref={userPopRef} className="relative">
              <button
                onClick={() => setUserOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={userOpen}
                className="w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-xs font-bold">
                  {(me?.name || me?.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <ChevronUp className={`w-3 h-3 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {userOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-0 mb-2 w-60 admin-card p-3 z-30"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      Signed in as<br />
                      <span className="text-slate-800 dark:text-slate-200 font-medium">{me?.name || '...'}</span>
                      <span className="ml-1 text-slate-500 dark:text-slate-400">({me?.role || '—'})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mb-3">
                      {me?.email}
                    </div>
                    <button
                      onClick={logout}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm
                                 text-white bg-gradient-to-r from-emerald-600 to-teal-600
                                 hover:from-emerald-500 hover:to-teal-500 transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.aside>

      <main className="relative flex-1 min-w-0 dark-on">
        {/* Mobile-only top bar — shows page title, theme toggle, overflow menu.
            Hidden from md upward; the full sidebar already exposes those. */}
        {!isWide && (
          <div className="sm:hidden sticky top-0 z-20 flex items-center gap-2 px-3 py-2 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-[#0a1124]/85 backdrop-blur supports-[backdrop-filter]:bg-white/65 supports-[backdrop-filter]:dark:bg-[#0a1124]/65">
            <div className="font-semibold text-sm text-slate-900 dark:text-white truncate flex-1">
              {title || 'Admin'}
            </div>
            <ThemeToggle />
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="More destinations"
                aria-expanded={moreOpen}
                className="w-9 h-9 inline-flex items-center justify-center rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {moreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 admin-card p-2 z-30"
                  >
                    {overflowRoutes.map((r) => (
                      <NavLink
                        key={r.to}
                        to={r.to}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                            isActive
                              ? 'admin-nav-active text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                          }`
                        }
                      >
                        <r.icon className="w-4 h-4" /> {r.label}
                      </NavLink>
                    ))}
                    <div className="border-t border-slate-200 dark:border-white/10 my-1" />
                    <button
                      onClick={() => { setMoreOpen(false); logout() }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
        {/* Tiny extra breathing room on tiny phones — main content padding. */}
        {me && me.whatsapp_configured === false && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="bg-amber-50 dark:bg-amber-500/15
                       border-b border-amber-200 dark:border-amber-500/30
                       px-4 sm:px-6 py-2.5 text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate">
              You haven't connected your WhatsApp Business account yet — messages can't be sent until you do.
            </span>
            <Link
              to="/admin/credentials"
              className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
            >
              Configure now →
            </Link>
          </motion.div>
        )}
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px]">
          {/* AnimatePresence gives every route a soft crossfade on change. */}
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <RouteErrorBoundary resetKey={location.pathname}>
                {outlet}
              </RouteErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}

class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null; resetKey: string }
> {
  state = { error: null as Error | null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; resetKey: string },
  ) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin route crashed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-[420px] rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-950 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-100">
        <div className="flex max-w-2xl gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" />
          <div>
            <div className="text-lg font-semibold">This section could not render</div>
            <p className="mt-1 text-sm text-rose-800 dark:text-rose-200">
              The app caught the page error instead of leaving the workspace blank. Try opening another section or refresh after saving your work.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-white/80 p-3 text-xs text-rose-900 dark:bg-slate-950/40 dark:text-rose-100">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
