import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Trash2, X, Move, AlertTriangle } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '@/components/ui'
import type { CRMPipelineStage } from '@/lib/types'

/**
 * Floating bottom-center action bar that appears when the admin has
 * selected one or more leads on the kanban.
 *
 * Actions:
 *   - Move to stage    (loops moveDealStage per lead; auto-creates a deal
 *                      in the destination pipeline if missing).
 *   - Set status       (loops PUT /api/crm/leads/:id).
 *   - Delete           (loops DELETE /api/crm/leads/:id, after confirm).
 *
 * Phase 5 surface. Self-contained — parent passes the selected count
 * and the per-action callbacks; we own the popovers + confirm.
 */
export interface CRMBulkBarProps {
  count: number
  stages: CRMPipelineStage[]
  pipelineID: number
  /** Move selected leads into the given stage. Creates a deal if missing. */
  onMoveToStage: (stageID: number) => Promise<void>
  /** Update lead status (one of the 6 enum values). */
  onSetStatus: (status: string) => Promise<void>
  /** Delete selected leads. */
  onDelete: () => Promise<void>
  /** Clear the selection. */
  onClear: () => void
}

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'] as const

export function CRMBulkBar({
  count, stages, onMoveToStage, onSetStatus, onDelete, onClear,
}: CRMBulkBarProps) {
  const [showStages, setShowStages] = useState(false)
  const [showStatus, setShowStatus] = useState(false)
  const [busy, setBusy] = useState(false)

  if (count === 0) return null

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
      >
        <div className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-white/10
                        bg-white dark:bg-[#0a1124] shadow-xl shadow-slate-900/10 dark:shadow-black/40
                        px-3 py-2">
          {/* Count chip */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                          bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300
                          text-xs font-semibold">
            <Check className="w-3 h-3" /> {count} selected
          </div>

          {/* Move to stage */}
          <div className="relative">
            <SecondaryButton onClick={() => { setShowStages(!showStages); setShowStatus(false) }} disabled={busy}>
              <Move className="w-3.5 h-3.5" /> Move to <ChevronDown className="w-3 h-3" />
            </SecondaryButton>
            {showStages && (
              <Popover onClose={() => setShowStages(false)}>
                {stages.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setShowStages(false); run(() => onMoveToStage(s.id)) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-white/5
                               flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color || '#94a3b8' }} />
                    {s.name}
                  </button>
                ))}
              </Popover>
            )}
          </div>

          {/* Set status */}
          <div className="relative">
            <SecondaryButton onClick={() => { setShowStatus(!showStatus); setShowStages(false) }} disabled={busy}>
              <AlertTriangle className="w-3.5 h-3.5" /> Set status <ChevronDown className="w-3 h-3" />
            </SecondaryButton>
            {showStatus && (
              <Popover onClose={() => setShowStatus(false)}>
                {LEAD_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setShowStatus(false); run(() => onSetStatus(s)) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-white/5"
                  >
                    {s}
                  </button>
                ))}
              </Popover>
            )}
          </div>

          {/* Delete */}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${count} lead${count === 1 ? '' : 's'}? This cannot be undone.`)) {
                run(onDelete)
              }
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium
                       text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10
                       disabled:opacity-50"
            title="Delete selected"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>

          {/* Clear */}
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full
                       text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5
                       disabled:opacity-50"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      {/* Click-away catcher */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute bottom-full mb-2 left-0 z-40
                   min-w-[180px] rounded-md border border-slate-200 dark:border-white/10
                   bg-white dark:bg-[#0a1124] shadow-lg overflow-hidden"
      >
        {children}
      </motion.div>
    </>
  )
}