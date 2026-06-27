// Shared, presentational parts of the AI follow-up UI used by both
// the per-batch panel on /admin/upload and the cross-batch queue on
// /admin/ai/followups. Pure functions / pure components — no hooks,
// no per-page state. If you find yourself needing useState here,
// it's the wrong place; lift it to the consumer.
//
// Originally file-local in pages/Upload.tsx; lifted in the AI
// Follow-ups queue change so both pages render the same status
// badges, status counts, and last-message previews.
import { ArrowDownLeft, ArrowUpRight, MessageSquare } from 'lucide-react'
import type { BatchAIRecipient } from '@/lib/types'

// humanizeAIFollowupStatus maps the backend's snake_case status key
// to a presentable label. Kept in sync with the CHECK constraint in
// migration 015_batch_ai_followup.sql (plus 'excluded' from
// migration 017_batch_ai_excluded_status.sql).
export function humanizeAIFollowupStatus(s: string): string {
  switch (s) {
    case 'pending':    return 'Pending'
    case 'active':     return 'Active'
    case 'handed_off': return 'Handed off'
    case 'opted_out':  return 'Opted out'
    case 'failed':     return 'Failed'
    case 'excluded':   return 'Excluded'
    case 'disabled':   return 'Disabled'
    default:           return s
  }
}

// AIFollowupStatusBadge — color-coded pill for any ai_status value.
// Renders the same look across the per-batch panel and the queue.
export function AIFollowupStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:    'bg-amber-100 text-amber-800 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/20',
    active:     'bg-emerald-100 text-emerald-800 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    handed_off: 'bg-violet-100 text-violet-800 border-violet-200/70 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/20',
    opted_out:  'bg-slate-100 text-slate-700 border-slate-200/70 dark:bg-white/10 dark:text-slate-200 dark:border-white/20',
    failed:     'bg-rose-100 text-rose-800 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/20',
    excluded:   'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/20',
    disabled:   'bg-slate-100 text-slate-500 border-slate-200/70 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',
  }
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wider
                      px-2 py-0.5 rounded-full border ${map[status] || map.disabled}`}>
      {humanizeAIFollowupStatus(status)}
    </span>
  )
}

// AIFollowupStatusCounts — small inline chips for each non-zero
// ai_status count, in the canonical display order.
export function AIFollowupStatusCounts({ counts }: { counts: Record<string, number> }) {
  const order = ['pending', 'active', 'handed_off', 'opted_out', 'failed', 'excluded', 'disabled']
  const items = order
    .filter((k) => (counts[k] || 0) > 0)
    .map((k) => ({ key: k, n: counts[k] }))
  if (items.length === 0) return null
  return (
    <div className="hidden md:flex items-center gap-1.5">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full
                                      bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
          {humanizeAIFollowupStatus(it.key)} <span className="text-slate-500 dark:text-slate-400">{it.n}</span>
        </span>
      ))}
    </div>
  )
}

// AIFollowupLastMessage — preview + direction icon + timestamp for
// the last AI-conversation message. Returns the muted "No messages
// yet" placeholder when the recipient has no thread yet.
export function AIFollowupLastMessage({ r, maxWidth = 260 }: { r: BatchAIRecipient; maxWidth?: number }) {
  if (!r.last_message_preview) {
    return <span className="text-[12px] text-slate-400 dark:text-slate-500">No messages yet</span>
  }
  const dirIcon = r.last_message_direction === 'in'
    ? <ArrowDownLeft className="w-3 h-3 text-blue-600 dark:text-blue-400" />
    : r.last_message_direction === 'out'
      ? <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
      : <MessageSquare className="w-3 h-3 text-slate-400" />
  const at = r.last_message_at ? new Date(r.last_message_at).toLocaleString() : ''
  return (
    <div style={{ maxWidth }}>
      <div className="flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-200">
        {dirIcon}
        <span className="truncate" title={r.last_message_preview}>{r.last_message_preview}</span>
      </div>
      {at && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{at}</div>}
    </div>
  )
}
