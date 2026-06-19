import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api, setToken } from '@/lib/api'
import {
  LayoutDashboard, UploadCloud, Layers, Users, MessageSquare, MessagesSquare,
  FileText, BarChart3, Settings, LogOut, Activity, ShieldCheck,
} from 'lucide-react'

const nav = [
  { to: '/',              label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/upload',        label: 'Upload',      icon: UploadCloud },
  { to: '/batches',       label: 'Batches',     icon: Layers },
  { to: '/retailers',     label: 'Retailers',   icon: Users },
  { to: '/messages',      label: 'Messages',    icon: MessageSquare },
  { to: '/chats',         label: 'Chats',       icon: MessagesSquare },
  { to: '/webhook-logs',  label: 'Webhook log', icon: Activity },
  { to: '/audit-log',     label: 'Audit log',   icon: ShieldCheck },
  { to: '/templates',     label: 'Templates',   icon: FileText },
  { to: '/reports',       label: 'Reports',     icon: BarChart3 },
  { to: '/settings',      label: 'Settings',    icon: Settings },
]

export default function Layout() {
  const nav2 = useNavigate()
  const location = useLocation()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
    retry: false,
  })

  function logout() {
    setToken(null)
    api.post('/auth/logout').finally(() => { window.location.href = '/login' })
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              whileHover={{ rotate: 10, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className="w-9 h-9 rounded-full bg-brand-500 grid place-items-center font-bold"
            >
              W
            </motion.div>
            <div>
              <div className="font-semibold leading-tight">WhatsyITC</div>
              <div className="text-xs text-slate-400">Billing &amp; CRM</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  isActive ? 'text-white' : 'text-slate-300 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 bg-slate-800 rounded-md"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative flex items-center gap-3">
                    <n.icon className="w-4 h-4" />
                    {n.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-slate-800">
          <div className="px-2 pb-2 text-xs text-slate-400">
            Signed in as<br />
            <span className="text-slate-200 font-medium">{me.data?.name || '...'}</span>
            <span className="ml-1 text-slate-400">({me.data?.role || '—'})</span>
          </div>
          <motion.button
            onClick={logout}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-200 hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </motion.button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="p-6 lg:p-8 max-w-[1500px]">
          {/* AnimatePresence gives every route a soft crossfade on change. */}
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
