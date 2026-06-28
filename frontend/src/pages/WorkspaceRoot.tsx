import { Link, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react'
import { useWorkspace, WORKSPACES, type WorkspaceId } from '@/lib/workspace'

/**
 * WorkspaceRoot — renders when the user hits the bare /admin URL.
 *
 * Two behaviours:
 *   - If the WorkspaceProvider has a hydrated active workspace (i.e. the
 *     user has visited before and localStorage has a value, OR they just
 *     landed on a deep link that flipped the workspace), we redirect
 *     straight to that workspace's dashboard. Zero clicks.
 *   - On a brand-new browser with no localStorage value we render two
 *     large entry tiles ("Open Bulk Messages" / "Open AI Workflows") so
 *     the user can pick consciously the first time.
 *
 * The tile page is intentionally cheap — no API calls, no charts.
 */
export default function WorkspaceRoot() {
  const { active, setActive } = useWorkspace()

  // Heuristic: if the user has never picked a workspace, localStorage
  // won't have a value. We treat that as the "first visit" branch.
  // Reading directly here (instead of via state) keeps the render cheap
  // and matches the synchronous read in WorkspaceProvider.
  let firstVisit = false
  if (typeof window !== 'undefined') {
    try {
      firstVisit = !window.localStorage.getItem('whatsyitc.activeWorkspace')
    } catch {
      // localStorage unavailable — fall through to redirect branch.
    }
  }

  if (!firstVisit) {
    return <Navigate to={WORKSPACES[active].basePath} replace />
  }

  function pick(id: WorkspaceId) {
    setActive(id)
    // Navigation is implicit — the next render of <Dashboard /> at
    // /admin will redirect to the chosen workspace's basePath. We push
    // explicitly so the URL updates immediately.
    window.location.assign(WORKSPACES[id].basePath)
  }

  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12">
      <div className="text-center mb-8 sm:mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium mb-4">
          <Sparkles className="w-3.5 h-3.5" /> Welcome back
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
          Where would you like to start?
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
          Pick a workspace. You can switch any time from the sidebar — your
          choice is remembered for next time.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Tile
          id="bulk"
          title={WORKSPACES.bulk.label}
          description={WORKSPACES.bulk.description}
          icon={<MessagesSquare className="w-6 h-6" />}
          gradient="from-emerald-500 to-teal-500"
          onPick={pick}
        />
        <Tile
          id="ai"
          title={WORKSPACES.ai.label}
          description={WORKSPACES.ai.description}
          icon={<Sparkles className="w-6 h-6" />}
          gradient="from-violet-500 to-fuchsia-500"
          onPick={pick}
        />
      </div>
    </div>
  )
}

interface TileProps {
  id: WorkspaceId
  title: string
  description: string
  icon: React.ReactNode
  gradient: string
  onPick: (id: WorkspaceId) => void
}

function Tile({ id, title, description, icon, gradient, onPick }: TileProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onPick(id)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      className="group relative text-left p-5 sm:p-6 rounded-xl
                 bg-white dark:bg-[#0a1124]
                 border border-slate-200 dark:border-white/10
                 shadow-sm hover:shadow-md
                 transition-shadow"
    >
      <div className="flex items-start gap-4">
        <div className={`shrink-0 w-12 h-12 rounded-lg grid place-items-center
                         bg-gradient-to-br ${gradient} text-white shadow-md`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        Open workspace
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </div>
      {/* Subtle accent strip on hover — purely decorative. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-xl bg-gradient-to-r from-transparent via-emerald-500/0 to-transparent group-hover:via-emerald-500/60 transition-[background-image]" />
      {/* Faux href so this renders like a link for screen readers / middle-click. */}
      <Link to={WORKSPACES[id].basePath} className="absolute inset-0" aria-label={`Open ${title}`}>
        <span className="sr-only">Open {title}</span>
      </Link>
    </motion.button>
  )
}
