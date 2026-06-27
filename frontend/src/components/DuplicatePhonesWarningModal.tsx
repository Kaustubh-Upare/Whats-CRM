import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Bot, CheckCircle2, FileText, Phone, ShieldAlert, X,
} from 'lucide-react'
import { PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { fmtRelative } from '@/lib/format'
import type { BatchAIFollowupDuplicate } from '@/lib/types'

type DupChoice = 'skip' | 'takeover'

const choiceCopy: Record<DupChoice, { title: string; body: string }> = {
  skip: {
    title: 'Skip number',
    body: 'Do not process this phone with the current batch. The existing batch agent keeps handling it.',
  },
  takeover: {
    title: 'Override to this batch',
    body: 'Pause the older follow-up and let this batch AI agent handle future scheduled messages.',
  },
}

export default function DuplicatePhonesWarningModal({
  batchId,
  duplicates,
  freshCount,
  onClose,
  onConfirm,
  isSubmitting,
  confirmActionLabel = 'Apply',
}: {
  batchId: number
  duplicates: BatchAIFollowupDuplicate[]
  freshCount: number
  onClose: () => void
  onConfirm: (excludes: string[], overrides: string[]) => void
  isSubmitting: boolean
  confirmActionLabel?: string
}) {
  const [choice, setChoice] = useState<Record<string, DupChoice>>(() =>
    Object.fromEntries(duplicates.map((d) => [d.phone, 'skip'])),
  )

  const counts = useMemo(() => {
    const next = { skip: 0, takeover: 0, conflicts: 0 }
    for (const d of duplicates) {
      if (d.agent_conflict) next.conflicts += 1
      next[choice[d.phone] ?? 'skip'] += 1
    }
    return next
  }, [choice, duplicates])

  function setAll(next: DupChoice) {
    setChoice(Object.fromEntries(duplicates.map((d) => [d.phone, next])))
  }

  const skipPhones = duplicates.filter((d) => (choice[d.phone] ?? 'skip') === 'skip').map((d) => d.phone)
  const takeoverPhones = duplicates.filter((d) => (choice[d.phone] ?? 'skip') === 'takeover').map((d) => d.phone)
  const confirmLabel = isSubmitting
    ? 'Applying...'
    : `${confirmActionLabel} - ${counts.skip} skipped, ${counts.takeover} overridden`

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={() => {
          if (!isSubmitting) onClose()
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-4xl admin-card rounded-2xl p-5 shadow-xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 shrink-0">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Same phones already have AI follow-up
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                These numbers are active in another batch. Skip a number here, or override it so the older follow-up is paused before this batch AI agent starts.
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                  {duplicates.length} duplicate{duplicates.length === 1 ? '' : 's'}
                </span>
                {counts.conflicts > 0 && (
                  <span className="px-2 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                    {counts.conflicts} different agent{counts.conflicts === 1 ? '' : 's'}
                  </span>
                )}
                <span className="px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                  {freshCount} fresh enrollment{freshCount === 1 ? '' : 's'}
                </span>
                <span className="text-slate-400 dark:text-slate-500">batch #{batchId}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setAll('skip')}
                className="px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-500/30 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 inline-flex items-center gap-1"
              >
                <CheckCircle2 className="w-3 h-3" /> Skip all duplicates
              </button>
              <button
                type="button"
                onClick={() => setAll('takeover')}
                className="px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-500/30 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 inline-flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" /> Override all with this batch
              </button>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Default is skip, so this batch will not touch duplicate phones unless you override them.
            </div>
          </div>

          <div className="mt-3 max-h-[56vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/10">
            {duplicates.map((d) => {
              const selected = choice[d.phone] ?? 'skip'
              const sourceBatch = d.source_batch_id ? `batch #${d.source_batch_id}` : 'existing follow-up'
              const sourceAgent = d.source_agent_name || 'No configured agent'
              const targetAgent = d.target_agent_name || 'No configured agent'
              const hasEnrollment = d.enrollment_id > 0
              return (
                <div key={`${d.phone}-${d.enrollment_id}`} className="p-3">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {d.phone}
                        </span>
                        {d.retailer_name && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {d.retailer_name}
                          </span>
                        )}
                        {d.agent_conflict && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                            different agent
                          </span>
                        )}
                      </div>

                      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_1fr] items-stretch">
                        <AgentBox
                          label="Existing"
                          batch={sourceBatch}
                          batchName={d.source_batch_name}
                          agent={sourceAgent}
                          source={d.source_agent_source}
                        />
                        <div className="hidden md:grid place-items-center text-slate-300 dark:text-slate-600">
                          <ArrowRight className="w-4 h-4" />
                        </div>
                        <AgentBox
                          label="Current"
                          batch={`batch #${batchId}`}
                          agent={targetAgent}
                          source={d.target_agent_source}
                          current
                        />
                      </div>

                      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {hasEnrollment
                            ? `${d.sequence_name} step ${d.current_step}`
                            : `Already in ${sourceBatch}`}
                        </span>
                        {hasEnrollment && <span>next {fmtRelative(d.next_run_at)}</span>}
                      </div>
                    </div>

                    <div className="w-full lg:w-[280px] shrink-0 grid gap-1.5">
                      {(['skip', 'takeover'] as DupChoice[]).map((opt) => {
                        const active = selected === opt
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setChoice((prev) => ({ ...prev, [d.phone]: opt }))}
                            title={opt === 'skip' ? 'Skip this phone number in the current batch' : 'Override this phone number with the current batch AI agent'}
                            className={`text-left p-2 rounded-lg border transition-colors ${
                              active
                                ? opt === 'skip'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/40'
                                  : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/40'
                                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
                            }`}
                          >
                            <div className="text-[12px] font-semibold">{choiceCopy[opt].title}</div>
                            <div className="mt-0.5 text-[10px] leading-snug opacity-80">{choiceCopy[opt].body}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 shrink-0">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {counts.skip} skipped here, {counts.takeover} overridden into this batch agent.
            </div>
            <div className="flex items-center gap-2">
              <SecondaryButton onClick={onClose} disabled={isSubmitting}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={() => onConfirm(skipPhones, takeoverPhones)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Spinner /> Applying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> {confirmLabel}
                  </>
                )}
              </PrimaryButton>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function AgentBox({
  label,
  batch,
  batchName,
  agent,
  source,
  current = false,
}: {
  label: string
  batch: string
  batchName?: string | null
  agent: string
  source: string
  current?: boolean
}) {
  return (
    <div className={`rounded-lg border p-2 min-w-0 ${
      current
        ? 'border-emerald-200 bg-emerald-50/70 dark:bg-emerald-500/10 dark:border-emerald-500/30'
        : 'border-slate-200 bg-slate-50/80 dark:bg-white/[0.03] dark:border-white/10'
    }`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1.5 min-w-0">
        <Bot className={`w-3.5 h-3.5 shrink-0 ${current ? 'text-emerald-500' : 'text-slate-400'}`} />
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate" title={agent}>
          {agent}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 truncate" title={batchName || batch}>
        {batchName ? `${batch} - ${batchName}` : batch}
      </div>
      <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
        {source === 'batch_override' ? 'batch agent' : source === 'global_default' ? 'default agent' : 'agent not configured'}
      </div>
    </div>
  )
}
