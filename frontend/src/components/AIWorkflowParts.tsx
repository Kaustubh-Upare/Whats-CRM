import { motion } from 'framer-motion'
import {
  Bot, CalendarClock, CheckCircle2, Clock3, MessageSquare,
  PauseCircle, Sparkles, UserCheck,
} from 'lucide-react'
import type { AIDecisionLog, AIWorkflowState, AIWorkflowStats } from '@/lib/types'
import { fmtRelative } from '@/lib/format'

export function workflowStateLabel(state?: string) {
  switch (state) {
    case 'new': return 'New'
    case 'ai_talking': return 'AI talking'
    case 'buyer_replied': return 'Buyer replied'
    case 'needs_human': return 'Needs human'
    case 'followup_scheduled': return 'Follow-up scheduled'
    case 'paused': return 'Paused'
    case 'closed': return 'Closed'
    default: return state ? state.replace(/_/g, ' ') : 'Unknown'
  }
}

export function workflowStateTone(state?: string) {
  switch (state) {
    case 'needs_human':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-200'
    case 'buyer_replied':
      return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-200'
    case 'ai_talking':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-200'
    case 'followup_scheduled':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-200'
    case 'paused':
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200'
    case 'closed':
      return 'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-400/20 dark:bg-lime-500/15 dark:text-lime-200'
    default:
      return 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200'
  }
}

export function AIWorkflowStateBadge({ state }: { state?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${workflowStateTone(state)}`}>
      {workflowStateIcon(state, 'w-3.5 h-3.5')}
      {workflowStateLabel(state)}
    </span>
  )
}

export function AIWorkflowSummaryCards({ stats }: { stats?: AIWorkflowStats }) {
  const cards = [
    { label: 'Needs human', value: stats?.needs_human || 0, sub: 'operator should inspect', state: 'needs_human' },
    { label: 'Buyer replied', value: stats?.buyer_replied || 0, sub: 'warm conversations', state: 'buyer_replied' },
    { label: 'AI talking', value: stats?.ai_talking || 0, sub: 'being handled by AI', state: 'ai_talking' },
    { label: 'Scheduled', value: stats?.followup_scheduled || 0, sub: 'waiting on cadence', state: 'followup_scheduled' },
    { label: 'Paused', value: stats?.paused || 0, sub: 'stopped or excluded', state: 'paused' },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.025 }}
          className={`rounded-lg border p-3 ${workflowStateTone(card.state)}`}
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider opacity-75">
            {workflowStateIcon(card.state, 'w-3.5 h-3.5')}
            {card.label}
          </div>
          <div className="mt-2 text-2xl font-semibold">{card.value.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] opacity-75">{card.sub}</div>
        </motion.div>
      ))}
    </div>
  )
}

export function AIWorkflowCard({
  workflow,
  onGenerateBrief,
  briefLoading,
  briefError,
}: {
  workflow?: AIWorkflowState | null
  onGenerateBrief?: () => void
  briefLoading?: boolean
  briefError?: string
}) {
  if (!workflow) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Sparkles className="w-4 h-4 text-slate-400" /> AI workflow
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Workflow state will appear after the next refresh or message.
        </p>
      </div>
    )
  }
  const aiBrief = workflow.source === 'llm_inline'
  return (
    <div className={`rounded-lg border p-4 ${
      aiBrief
        ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08]'
        : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <AIWorkflowStateBadge state={workflow.state} />
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${riskTone(workflow.risk_level)}`}>
              {workflow.risk_level} risk
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
              {workflow.confidence_score}% confidence
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
              aiBrief
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
            }`}>
              {aiBrief ? 'AI brief' : 'Rule signal'}
            </span>
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
            {workflow.state_label || workflowStateLabel(workflow.state)}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {workflow.state_reason}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <div>{fmtRelative(workflow.last_message_at || workflow.last_event_at || workflow.updated_at)}</div>
          <div className="mt-1 capitalize">{workflow.source.replace(/_/g, ' ')}</div>
          {onGenerateBrief && (
            <button
              type="button"
              onClick={onGenerateBrief}
              disabled={briefLoading}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-70 dark:border-emerald-400/20 dark:bg-slate-950/40 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
            >
              <Sparkles className={`h-3.5 w-3.5 ${briefLoading ? 'animate-spin' : ''}`} />
              {briefLoading ? 'Thinking...' : aiBrief ? 'Refresh AI brief' : 'Generate AI brief'}
            </button>
          )}
        </div>
      </div>
      {briefError && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
          {briefError}
        </div>
      )}
      <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-white/[0.06]">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Next best action</div>
        <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
          {workflow.next_action || 'No immediate action needed.'}
        </div>
      </div>
      {workflow.next_message_preview && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Planned message</div>
          <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{workflow.next_message_preview}</div>
        </div>
      )}
    </div>
  )
}

export function AIDecisionLogList({ logs }: { logs?: AIDecisionLog[] }) {
  const items = logs || []
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        No AI decisions logged yet. The next message or refresh will add explainability here.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((log, index) => (
        <motion.div
          key={log.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(index, 10) * 0.02 }}
          className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {log.title || humanize(log.decision_type)}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {log.reason}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">
              {fmtRelative(log.created_at)}
            </div>
          </div>
          {log.next_action && (
            <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
              {log.next_action}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  )
}

function workflowStateIcon(state?: string, className = 'w-4 h-4') {
  switch (state) {
    case 'needs_human': return <UserCheck className={className} />
    case 'buyer_replied': return <MessageSquare className={className} />
    case 'ai_talking': return <Bot className={className} />
    case 'followup_scheduled': return <CalendarClock className={className} />
    case 'paused': return <PauseCircle className={className} />
    case 'closed': return <CheckCircle2 className={className} />
    case 'new': return <Clock3 className={className} />
    default: return <Sparkles className={className} />
  }
}

function riskTone(risk?: string) {
  switch (risk) {
    case 'critical': return 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200'
    case 'high': return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
    case 'medium': return 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200'
    default: return 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  }
}

function humanize(value: string) {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}
