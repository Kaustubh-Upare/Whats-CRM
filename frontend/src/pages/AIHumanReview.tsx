import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowDownLeft, Bot, CheckCircle2, Clock3, ExternalLink,
  MessageSquare, Phone, RefreshCw, Search, Send, ShieldCheck, Sparkles,
  UserCheck,
} from 'lucide-react'
import { Card, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton, Spinner, TextArea } from '@/components/ui'
import {
  batchAIKeys, generateAIHumanReviewHelp, listAIHumanReview, resolveAIHumanReview,
  type ListHumanReviewParams,
} from '@/lib/batchAI'
import type { AIHumanReviewItem } from '@/lib/types'
import { fmtRelative } from '@/lib/format'

type ReasonFilter = 'all' | 'send_failed' | 'human_needed' | 'buyer_replied' | 'price_question' | 'hot_lead' | 'complaint' | 'first_touch_due'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

const reasonFilters: Array<{ key: ReasonFilter; label: string; icon: any }> = [
  { key: 'all', label: 'All urgent', icon: Sparkles },
  { key: 'send_failed', label: 'Failed sends', icon: AlertTriangle },
  { key: 'human_needed', label: 'Human needed', icon: UserCheck },
  { key: 'buyer_replied', label: 'Buyer replies', icon: ArrowDownLeft },
  { key: 'price_question', label: 'Price questions', icon: MessageSquare },
  { key: 'hot_lead', label: 'Hot leads', icon: Send },
  { key: 'complaint', label: 'Complaints', icon: ShieldCheck },
  { key: 'first_touch_due', label: 'First touch', icon: Clock3 },
]

export default function AIHumanReview() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState<ReasonFilter>('all')
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [helpPrompt, setHelpPrompt] = useState('')

  const params = useMemo<ListHumanReviewParams>(() => ({
    status: 'open',
    reason: reason === 'all' ? undefined : reason,
    severity: severity === 'all' ? undefined : severity,
    search: search.trim() || undefined,
    limit: 120,
  }), [reason, search, severity])

  const q = useQuery({
    queryKey: batchAIKeys.humanReview(params),
    queryFn: () => listAIHumanReview(params),
    refetchInterval: 10_000,
    staleTime: 4_000,
  })

  const rawItems = q.data?.items || []
  const items = useMemo(() => dedupeHumanReviewItems(rawItems), [rawItems])
  const stats = q.data?.stats
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  )

  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id)
    if (selectedId && items.length > 0 && !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  const resolveM = useMutation({
    mutationFn: (id: number) => resolveAIHumanReview(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'human-review'] })
    },
  })

  const helpM = useMutation({
    mutationFn: ({ id, prompt }: { id: number; prompt: string }) => generateAIHumanReviewHelp(id, {
      prompt,
      history_limit: 20,
    }),
    onSuccess: (item) => {
      qc.setQueriesData({ queryKey: ['ai', 'human-review'] }, (old: any) => {
        if (!old?.items) return old
        return { ...old, items: old.items.map((x: AIHumanReviewItem) => x.id === item.id ? item : x) }
      })
      setHelpPrompt('')
    },
  })

  const error = q.isError ? ((q.error as any)?.response?.data?.error || (q.error as any)?.message || 'Failed to load human review queue') : ''

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <PageHeader
        title="Human Review"
        subtitle="Phones where AI follow-ups need a person: buyer replies, handoffs, failed sends, price questions, complaints, and overdue first touches."
        right={
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={() => q.refetch()}>
              <RefreshCw className={`w-4 h-4 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
            </SecondaryButton>
          </div>
        }
      />

      {error && <div className="mb-4"><ErrorBox msg={error} /></div>}

      <div className="admin-review-metric-grid mb-4">
        <Metric label="Open" value={stats?.open || 0} sub="needs a human look" tone={(stats?.open || 0) > 0 ? 'rose' : 'slate'} />
        <Metric label="Critical" value={stats?.critical || 0} sub="failed, handoff, complaint" tone={(stats?.critical || 0) > 0 ? 'rose' : 'slate'} />
        <Metric label="Buyer replies" value={stats?.buyer_replies || 0} sub="warm conversations" tone="emerald" />
        <Metric label="Price questions" value={stats?.price_questions || 0} sub="answer with care" tone="blue" />
        <Metric label="Hot leads" value={stats?.hot_leads || 0} sub="purchase intent" tone="amber" />
      </div>

      <div className="admin-card p-3 mb-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)] gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone, retailer, batch, reason..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {reasonFilters.map((f) => (
              <FilterChip
                key={f.key}
                active={reason === f.key}
                label={f.label}
                icon={f.icon}
                onClick={() => setReason(f.key)}
                count={f.key === 'all' ? stats?.open : stats?.by_reason?.[f.key]}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto">
          {(['all', 'critical', 'high', 'medium', 'low'] as SeverityFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                severity === s
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300'
              }`}
            >
              {s === 'all' ? 'All severity' : labelize(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)] gap-4 items-start">
        <Card hover={false} className="!p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-900 dark:text-white">Urgency queue</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{items.length} phone number{items.length === 1 ? '' : 's'} shown</div>
            </div>
            {q.isFetching && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <div className="max-h-[calc(100vh-390px)] min-h-[440px] overflow-y-auto p-3 space-y-2">
            {q.isLoading ? (
              <div className="p-4"><Spinner /></div>
            ) : items.length === 0 ? (
              <div className="h-full min-h-[320px] grid place-items-center rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                No urgent phone needs review right now.
              </div>
            ) : (
              items.map((item, index) => (
                <ReviewListItem
                  key={item.id}
                  item={item}
                  selected={selected?.id === item.id}
                  index={index}
                  onClick={() => setSelectedId(item.id)}
                />
              ))
            )}
          </div>
        </Card>

        <ReviewDetail
          item={selected}
          helpPrompt={helpPrompt}
          setHelpPrompt={setHelpPrompt}
          onAIHelp={() => selected && helpM.mutate({ id: selected.id, prompt: helpPrompt })}
          aiLoading={helpM.isPending}
          aiError={(helpM.error as any)?.response?.data?.error || (helpM.error as any)?.message || ''}
          onResolve={() => selected && resolveM.mutate(selected.id)}
          resolving={resolveM.isPending}
        />
      </div>
    </div>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: 'rose' | 'emerald' | 'blue' | 'amber' | 'slate' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border px-3 py-2.5 ${metricTone(tone)}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[11px] opacity-75 line-clamp-1">{sub}</div>
    </motion.div>
  )
}

function FilterChip({ active, label, icon: Icon, onClick, count }: { active: boolean; label: string; icon: any; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        active
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className="ml-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-white dark:text-slate-950">
          {count}
        </span>
      )}
    </button>
  )
}

function ReviewListItem({ item, selected, index, onClick }: { item: AIHumanReviewItem; selected: boolean; index: number; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.02 }}
      className={`w-full rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-emerald-300 bg-emerald-50/75 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/10'
          : item.severity === 'critical'
            ? 'border-rose-200 bg-rose-50/50 hover:bg-rose-50 dark:border-rose-400/20 dark:bg-rose-500/[0.08]'
            : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white truncate">
            {item.retailer_name || 'Unknown retailer'}
          </div>
          <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Phone className="w-3 h-3" /> {item.phone}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${severityTone(item.severity)}`}>
          {item.severity}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
          {item.reason_label}
        </span>
        <span className="text-[11px] text-slate-400">{fmtRelative(item.last_message_at || item.last_event_at || item.updated_at)}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
        {item.last_message_preview || item.reason_detail}
      </div>
    </motion.button>
  )
}

function ReviewDetail({
  item,
  helpPrompt,
  setHelpPrompt,
  onAIHelp,
  aiLoading,
  aiError,
  onResolve,
  resolving,
}: {
  item: AIHumanReviewItem | null
  helpPrompt: string
  setHelpPrompt: (value: string) => void
  onAIHelp: () => void
  aiLoading: boolean
  aiError: string
  onResolve: () => void
  resolving: boolean
}) {
  if (!item) {
    return (
      <Card hover={false} className="min-h-[520px] grid place-items-center p-8 text-center">
        <div>
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">All clear</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">Urgent phones will appear here as soon as the backend sees a signal.</div>
        </div>
      </Card>
    )
  }
  const hasAIHelp = Boolean(item.ai_summary || item.ai_next_action || item.ai_suggested_reply)
  const reviewReason = item.ai_summary || item.reason_detail || 'This phone has a signal that may need operator attention.'
  const nextAction = item.ai_next_action || item.suggested_action || 'Open the timeline and decide whether AI should continue.'

  return (
    <Card hover={false} className="!p-0 overflow-hidden">
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${severityTone(item.severity)}`}>
                {item.severity} priority {item.priority_score}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
                {item.reason_label}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {item.retailer_name || item.phone}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1"><Phone className="w-4 h-4" /> {item.phone}</span>
              <span>{item.batch_name || 'Batch'}</span>
              <span>{fmtRelative(item.last_message_at || item.last_event_at || item.updated_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/admin/ai/followups/recipients/${item.batch_ai_recipient_id}`}>
              <SecondaryButton>
                <ExternalLink className="w-4 h-4" /> Open timeline
              </SecondaryButton>
            </Link>
            {item.batch_id && (
              <Link to={`/admin/ai/followups/${item.batch_id}`}>
                <SecondaryButton>
                  <Sparkles className="w-4 h-4" /> Batch setup
                </SecondaryButton>
              </Link>
            )}
            <PrimaryButton onClick={onResolve} disabled={resolving}>
              <CheckCircle2 className="w-4 h-4" /> {resolving ? 'Resolving...' : 'Mark done'}
            </PrimaryButton>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-4 p-5">
        <div className="space-y-4">
          <section className={`rounded-lg border p-4 ${
            hasAIHelp
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08]'
              : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Why this needs review</div>
                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{reviewReason}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                hasAIHelp
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                  : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
              }`}>
                {hasAIHelp ? 'AI brief' : 'Rule signal'}
              </span>
            </div>
            {hasAIHelp && item.reason_detail && (
              <div className="mt-3 rounded-md border border-emerald-200/70 bg-white/70 p-3 text-xs leading-5 text-emerald-900/80 dark:border-emerald-400/15 dark:bg-slate-950/20 dark:text-emerald-100/80">
                Backend signal: {item.reason_detail}
              </div>
            )}
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recommended action</div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-900 dark:text-white">{nextAction}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.labels.map((label) => (
                <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
                  {labelize(label)}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Latest message</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.last_message_role || 'signal'} · {fmtRelative(item.last_message_at || item.last_event_at || item.updated_at)}</div>
              </div>
              <MessageSquare className="h-5 w-5 text-slate-300" />
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
              {item.last_message_preview || 'No message preview is available. Open the timeline for the full thread.'}
            </div>
          </section>

        </div>

        <aside className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                <Bot className="h-4 w-4" /> AI help
              </div>
              <p className="mt-1 text-xs leading-5 text-emerald-800/75 dark:text-emerald-200/75">
                OpenAI/Bedrock reads the recent thread, assigned agent, and matching knowledge once, then caches the summary, reply draft, and next action here.
              </p>
            </div>
            <Sparkles className="h-5 w-5 shrink-0 text-emerald-500" />
          </div>

          <TextArea
            value={helpPrompt}
            onChange={(e) => setHelpPrompt(e.target.value)}
            rows={4}
            placeholder="Optional: tell AI what to focus on before generating help."
            className="mt-4 bg-white/90 dark:bg-slate-950/40"
          />

          <SecondaryButton onClick={onAIHelp} disabled={aiLoading} className="mt-3 w-full justify-center">
            <Sparkles className={`w-4 h-4 ${aiLoading ? 'animate-spin' : ''}`} />
            {aiLoading ? 'Generating...' : hasAIHelp ? 'Refresh AI brief' : 'Generate AI brief'}
          </SecondaryButton>

          {aiError && <div className="mt-3"><ErrorBox msg={aiError} /></div>}

          <div className="mt-4 space-y-3">
            <AdviceBox title="AI read" value={item.ai_summary || item.ai_error || 'Generate AI brief to get buyer intent, urgency, evidence, risk, and knowledge-grounded next steps in one cached call.'} />
            <AdviceBox title="Suggested reply" value={item.ai_suggested_reply || 'A reply draft will appear here after generation.'} />
            <AdviceBox title="Next action" value={nextAction} />
          </div>
        </aside>
      </div>
    </Card>
  )
}

function AdviceBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-200/70 bg-white p-3 dark:border-emerald-400/15 dark:bg-slate-950/35">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">{title}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  )
}

function metricTone(tone: string): string {
  switch (tone) {
    case 'rose':
      return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-100'
    case 'emerald':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/[0.08] dark:text-emerald-100'
    case 'blue':
      return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-400/20 dark:bg-blue-500/[0.08] dark:text-blue-100'
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/[0.10] dark:text-amber-100'
    default:
      return 'border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white'
  }
}

function severityTone(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-100 text-rose-800 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/20'
    case 'high':
      return 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/20'
    case 'medium':
      return 'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-400/20'
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-200 dark:border-white/10'
  }
}

function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function dedupeHumanReviewItems(items: AIHumanReviewItem[]): AIHumanReviewItem[] {
  const seen = new Set<string>()
  const unique: AIHumanReviewItem[] = []
  for (const item of items) {
    const key = humanReviewPhoneKey(item.phone)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

function humanReviewPhoneKey(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  return digits || (phone || '').trim().toLowerCase()
}
