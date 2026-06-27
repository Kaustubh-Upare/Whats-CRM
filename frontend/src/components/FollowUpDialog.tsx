// FollowUpDialog — the "Set up follow-up" modal that lives on every
// surface that can show one. Pure controlled form; the parent owns
// the open/close state.
//
// Cadence presets + custom, max messages, tone, optional "still
// interested?" check-in, optional goal. Submits to
// POST /api/crm/leads/:id/followup via the parent's onSetup callback.
//
// The dialog itself does NOT call the API; it just lifts the chosen
// payload up. The parent (FollowUpMenuItem) handles the mutation so
// we can share the same `useMutation` invalidation logic across
// surfaces.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { LeadFollowupStatus } from '@/lib/types'

export interface FollowUpDialogPayload {
  cadence_days: number
  max_messages: number
  tone: 'friendly' | 'professional' | 'urgent'
  goal: string
  checkin_enabled: boolean
}

export interface FollowUpDialogProps {
  open: boolean
  lead: { id: number; name: string; phone: string } | null
  // When an existing enrollment exists, the dialog pre-fills with
  // its cadence/max/tone. The parent passes the latest status so
  // we can swap the submit label between "Start" / "Restart" /
  // "Update".
  status: LeadFollowupStatus | null
  submitting?: boolean
  onClose: () => void
  onSubmit: (payload: FollowUpDialogPayload) => void
}

const CADENCE_PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Every 2 days', days: 2 },
  { label: 'Every 3 days', days: 3 },
  { label: 'Every week', days: 7 },
  { label: 'Daily for 7 days', days: 1 },
]

const MAX_PRESETS = [1, 3, 5, 10]

export function FollowUpDialog({
  open,
  lead,
  status,
  submitting,
  onClose,
  onSubmit,
}: FollowUpDialogProps) {
  const existing = status?.enrollment
  const [cadenceDays, setCadenceDays] = useState<number>(existing?.cadence_days || 3)
  const [customCadence, setCustomCadence] = useState<string>('')
  const [maxMessages, setMaxMessages] = useState<number>(existing?.max_messages || 3)
  const [tone, setTone] = useState<'friendly' | 'professional' | 'urgent'>(
    (existing?.tone as 'friendly' | 'professional' | 'urgent') || 'friendly',
  )
  const [goal, setGoal] = useState<string>(existing?.goal || '')
  const [checkinEnabled, setCheckinEnabled] = useState<boolean>(
    existing?.checkin_enabled || false,
  )

  // Reset state when the dialog re-opens against a different lead.
  useEffect(() => {
    if (!open) return
    setCadenceDays(existing?.cadence_days || 3)
    setCustomCadence('')
    setMaxMessages(existing?.max_messages || 3)
    setTone(
      (existing?.tone as 'friendly' | 'professional' | 'urgent') || 'friendly',
    )
    setGoal(existing?.goal || '')
    setCheckinEnabled(existing?.checkin_enabled || false)
  }, [open, existing?.cadence_days, existing?.max_messages, existing?.tone, existing?.goal, existing?.checkin_enabled])

  if (!lead) return null

  // Submit label adapts to the state: "Start" for no enrollment,
  // "Restart" for paused, "Update" for active.
  const submitLabel = !existing
    ? 'Start follow-up'
    : existing.status === 'paused'
    ? 'Restart follow-up'
    : 'Update follow-up'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm
                     flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900
                       border border-slate-200 dark:border-slate-700
                       shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-4
                            border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Smart follow-up
              </h2>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200
                           transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {lead.name || '(no name)'}
                </span>
                {' · '}
                <span className="font-mono text-xs">{lead.phone}</span>
              </div>

              {/* Cadence */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Cadence
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {CADENCE_PRESETS.map((p) => {
                    const active = cadenceDays === p.days && customCadence === ''
                    return (
                      <button
                        key={p.days}
                        type="button"
                        onClick={() => { setCadenceDays(p.days); setCustomCadence('') }}
                        className={`px-3 py-2 rounded-md text-sm border transition-colors
                          ${active
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'}`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <label className="text-slate-500 dark:text-slate-400">Custom:</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    placeholder="days"
                    value={customCadence}
                    onChange={(e) => {
                      const v = e.target.value
                      setCustomCadence(v)
                      const n = parseInt(v, 10)
                      if (n >= 1 && n <= 30) setCadenceDays(n)
                    }}
                    className="w-20 px-2 py-1 rounded-md text-sm
                               bg-white dark:bg-slate-800
                               border border-slate-200 dark:border-slate-700
                               text-slate-700 dark:text-slate-200"
                  />
                </div>
              </div>

              {/* Max messages */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Maximum messages
                </label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {MAX_PRESETS.map((n) => {
                    const active = maxMessages === n
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMaxMessages(n)}
                        className={`px-3 py-2 rounded-md text-sm border transition-colors
                          ${active
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'}`}
                      >
                        {n} message{n > 1 ? 's' : ''}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Tone */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Tone
                </label>
                <div className="mt-2 flex gap-2">
                  {(['friendly', 'professional', 'urgent'] as const).map((t) => {
                    const active = tone === t
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTone(t)}
                        className={`px-3 py-2 rounded-md text-sm border transition-colors capitalize
                          ${active
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'}`}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Check-in */}
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkinEnabled}
                  onChange={(e) => setCheckinEnabled(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <span>
                  Send a final "still interested?" message if the customer replies
                </span>
              </label>

              {/* Goal (optional) */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Goal (optional)
                </label>
                <textarea
                  rows={2}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Re-engage a warm lead who hasn't replied"
                  className="mt-2 w-full px-3 py-2 rounded-md text-sm
                             bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700
                             text-slate-700 dark:text-slate-200
                             placeholder:text-slate-400
                             focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3
                            border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-sm
                           text-slate-700 dark:text-slate-200
                           hover:bg-slate-100 dark:hover:bg-slate-800
                           transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onSubmit({ cadence_days: cadenceDays, max_messages: maxMessages, tone, goal, checkin_enabled: checkinEnabled })}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md text-sm font-medium
                           text-white
                           bg-gradient-to-r from-emerald-600 to-teal-600
                           hover:from-emerald-500 hover:to-teal-500
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
              >
                {submitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}