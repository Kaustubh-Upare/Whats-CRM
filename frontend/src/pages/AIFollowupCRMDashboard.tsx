import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BellRing, Bot, Briefcase,
  CheckCircle2, Clock3, Filter, Inbox, MessageSquare, Phone, RefreshCw, Search,
  Send, Settings, ShieldCheck, Sparkles, Star, UserCheck, Users,
} from 'lucide-react'
import { Card, CardHeader, ErrorBox, Input, PageHeader, SecondaryButton, Spinner } from '@/components/ui'
import { AIFollowupStatusBadge } from '@/components/AIFollowupParts'
import { batchDisplayName, fmtRelative } from '@/lib/format'
import { api } from '@/lib/api'
import {
  batchAIKeys, generateBatchAICRMSummary, getBatchAgent, listBatchAICRMInsights, listBatchAIFollowups,
  type BatchAICRMSummary,
} from '@/lib/batchAI'
import type { BatchAIRecipient, EffectiveAIAgent, UploadBatch } from '@/lib/types'

type BatchSummary = {
  id: number
  batch?: UploadBatch
  enabled: boolean
  fileName: string
  status: string
  createdAt?: string | null
  enabledAt?: string | null
  validRows: number
  totalRows: number
  recipients: BatchAIRecipient[]
  counts: Record<string, number>
  latestActivity?: string | null
  latestMessage?: BatchAIRecipient
  effectiveAgent?: EffectiveAIAgent | null
  insight?: BatchAICRMSummary
  refreshingInsight?: boolean
}

type LeadStats = {
  totalBatches: number
  enabledBatches: number
  trackedRecipients: number
  totalRecipients: number
  important: number
  replied: number
  waitingFirstTouch: number
  aiWorking: number
  failed: number
  handedOff: number
  closed: number
}

type BatchLeadCounts = {
  total: number
  tracked: number
  important: number
  replied: number
  waitingFirstTouch: number
  aiWorking: number
  failed: number
  handedOff: number
  closed: number
  contacted: number
}

type ViewFilter = 'important' | 'replied' | 'waiting' | 'all'
type Tone = 'emerald' | 'blue' | 'amber' | 'rose' | 'slate' | 'violet'

type LeadReason = {
  label: string
  detail: string
  tone: Tone
  priority: number
  icon: ComponentType<{ className?: string }>
}

type ChatSummary = {
  recipient: BatchAIRecipient
  title: string
  summary: string
  nextAction: string
  tone: Tone
  icon: ComponentType<{ className?: string }>
}

type BatchIntelligence = {
  title: string
  brief: string
  completed: string[]
  watch: string[]
  next: string[]
}

const viewFilters: Array<{ key: ViewFilter; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'all', label: 'All phones', icon: Phone },
  { key: 'important', label: 'Needs action', icon: Sparkles },
  { key: 'replied', label: 'Buyer replies', icon: ArrowDownLeft },
  { key: 'waiting', label: 'First touch due', icon: Clock3 },
]

export default function AIFollowupCRMDashboard() {
  const navigate = useNavigate()
  const { batchId } = useParams<{ batchId?: string }>()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewFilter>('all')
  const routeBatchId = Number(batchId || 0)
  const isBatchPage = Number.isFinite(routeBatchId) && routeBatchId > 0

  const list = useQuery({
    queryKey: batchAIKeys.followups({ limit: 200 }),
    queryFn: () => listBatchAIFollowups({ limit: 200 }),
    refetchInterval: 5_000,
  })

  const batchesQ = useQuery({
    queryKey: ['batches', 'ai-followup-crm-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/api/batches', { params: { limit: 200 } })
      const rows = Array.isArray(data) ? data : (data?.items || [])
      return rows as UploadBatch[]
    },
    refetchInterval: 15_000,
  })

  const recipients = list.data?.items || []
  const total = list.data?.total ?? recipients.length
  const summaries = useMemo(
    () => buildBatchSummaries(batchesQ.data || [], recipients),
    [batchesQ.data, recipients],
  )

  const batchIds = useMemo(() => summaries.map((s) => s.id), [summaries])
  const agentsQ = useQuery({
    queryKey: ['batches', 'effective-agents', batchIds.slice().sort((a, b) => a - b).join(',')],
    enabled: batchIds.length > 0 && batchIds.length <= 60,
    queryFn: async () => {
      const results = await Promise.all(
        batchIds.map(async (id) => {
          try {
            return [id, await getBatchAgent(id)] as const
          } catch {
            return [id, null] as const
          }
        }),
      )
      return Object.fromEntries(results) as Record<number, EffectiveAIAgent | null>
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const insightsQ = useQuery({
    queryKey: batchAIKeys.crmInsights(200),
    queryFn: () => listBatchAICRMInsights(200),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const savedInsightsByBatch = useMemo(() => {
    const map = new Map<number, BatchAICRMSummary>()
    for (const insight of insightsQ.data?.items || []) {
      if (insight.batch_id) map.set(Number(insight.batch_id), insight)
    }
    return map
  }, [insightsQ.data])

  const summariesWithAgents = useMemo(() => {
    return summaries.map((s) => ({
      ...s,
      effectiveAgent: agentsQ.data?.[s.id] ?? null,
      insight: savedInsightsByBatch.get(s.id),
    }))
  }, [summaries, agentsQ.data, savedInsightsByBatch])

  const autoRefreshTargets = useMemo(
    () => summariesWithAgents
      .filter((s) => s.enabled && shouldRefreshBatchInsight(s))
      .sort((a, b) => batchPriority(b) - batchPriority(a))
      .slice(0, 4),
    [summariesWithAgents],
  )

  const autoSummaryQs = useQueries({
    queries: autoRefreshTargets.map((batch) => ({
      queryKey: batchAIKeys.crmSummary(batch.id, 20),
      queryFn: () => generateBatchAICRMSummary(batch.id, 20),
      enabled: !isBatchPage,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })

  const liveInsightByBatch = useMemo(() => {
    const map = new Map<number, { insight?: BatchAICRMSummary; fetching: boolean }>()
    autoRefreshTargets.forEach((batch, index) => {
      const q = autoSummaryQs[index]
      map.set(batch.id, { insight: q?.data, fetching: !!q?.isFetching })
    })
    return map
  }, [autoRefreshTargets, autoSummaryQs])

  const summariesWithInsights = useMemo(() => {
    return summariesWithAgents.map((s) => {
      const live = liveInsightByBatch.get(s.id)
      return {
        ...s,
        insight: live?.insight || s.insight,
        refreshingInsight: !!live?.fetching,
      }
    })
  }, [summariesWithAgents, liveInsightByBatch])

  const filteredSummaries = useMemo(
    () => filterBatchSummaries(summariesWithInsights, search),
    [summariesWithInsights, search],
  )

  const selectedBatch = useMemo(
    () => {
      if (isBatchPage) {
        return summariesWithInsights.find((s) => s.id === routeBatchId) || null
      }
      return null
    },
    [isBatchPage, routeBatchId, summariesWithInsights],
  )

  const stats = useMemo(
    () => buildLeadStats(summariesWithInsights, recipients, total),
    [summariesWithInsights, recipients, total],
  )

  const loading = list.isLoading || batchesQ.isLoading || insightsQ.isLoading
  const error = batchesQ.isError
    ? ((batchesQ.error as any)?.response?.data?.error || 'Failed to load batches')
    : list.isError
      ? ((list.error as any)?.response?.data?.error || 'Failed to load AI follow-ups')
      : insightsQ.isError
        ? ((insightsQ.error as any)?.response?.data?.error || 'Failed to load AI CRM insights')
      : ''

  const now = useTickNow(1000)
  const lastRefreshMs = useMemo(
    () => Math.max(list.dataUpdatedAt ?? 0, batchesQ.dataUpdatedAt ?? 0, insightsQ.dataUpdatedAt ?? 0),
    [list.dataUpdatedAt, batchesQ.dataUpdatedAt, insightsQ.dataUpdatedAt],
  )
  const lastRefreshAgeSec = lastRefreshMs ? Math.max(0, Math.round((now - lastRefreshMs) / 1000)) : null
  const handleBatchSelect = (id: number) => {
    navigate(`/admin/ai-followup-crm/${id}`)
  }

  useEffect(() => {
    if (isBatchPage) setView('all')
  }, [isBatchPage, routeBatchId])

  return (
    <>
      <PageHeader
        title={isBatchPage && selectedBatch ? `Batch #${selectedBatch.id} AI CRM` : 'AI Follow-up CRM'}
        subtitle={isBatchPage && selectedBatch
          ? `${selectedBatch.fileName} - complete AI follow-up dashboard for this batch.`
          : 'Batch-wise lead summary for the phone numbers that need attention, replies, and next AI touches.'}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {isBatchPage && (
              <Link to="/admin/ai-followup-crm">
                <SecondaryButton>
                  <Briefcase className="w-4 h-4" /> All batches
                </SecondaryButton>
              </Link>
            )}
            <Link to="/admin/ai/followups">
              <SecondaryButton>
                <BellRing className="w-4 h-4" /> Follow-ups
              </SecondaryButton>
            </Link>
            {lastRefreshAgeSec !== null && (
              <span
                className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500"
                title="Polled every few seconds"
              >
                <RefreshCw className={`w-3 h-3 ${list.isFetching || batchesQ.isFetching ? 'animate-spin' : ''}`} />
                Updated {lastRefreshAgeSec}s ago
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                list.refetch()
                batchesQ.refetch()
                agentsQ.refetch()
                insightsQ.refetch()
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              title="Refresh now"
            >
              <RefreshCw className={`w-4 h-4 ${list.isFetching || batchesQ.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />

      {error && <div className="mb-5"><ErrorBox msg={error} /></div>}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryMetric
            icon={Phone}
            label="Lead phones"
            value={stats.totalRecipients}
            sub={`${stats.trackedRecipients} tracked by AI follow-ups`}
            tone="blue"
            loading={loading}
          />
          <SummaryMetric
            icon={Sparkles}
            label="Action required"
            value={stats.important}
            sub={`${stats.failed} failed, ${stats.handedOff} human handoffs`}
            tone={stats.important > 0 ? 'rose' : 'slate'}
            loading={loading}
          />
          <SummaryMetric
            icon={ArrowDownLeft}
            label="Buyer replies"
            value={stats.replied}
            sub="Latest visible message came from the retailer"
            tone="emerald"
            loading={loading}
          />
          <SummaryMetric
            icon={Clock3}
            label="Waiting first touch"
            value={stats.waitingFirstTouch}
            sub={`${stats.enabledBatches}/${stats.totalBatches} batches have AI enabled`}
            tone="amber"
            loading={loading}
          />
        </div>

        <div className="admin-card p-3">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)] gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isBatchPage ? 'Search phone, retailer, message, status...' : 'Search batch, file, phone, retailer, agent...'}
                className="pl-9"
              />
            </div>
            {isBatchPage ? (
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <Filter className="w-3.5 h-3.5" /> Phones
                </span>
                {viewFilters.map((item) => (
                  <FilterPill
                    key={item.key}
                    active={view === item.key}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => setView(item.key)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-start xl:justify-end rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                Action-required batches appear first. Open a batch to see its phone-level dashboard.
              </div>
            )}
          </div>
        </div>

        {isBatchPage ? (
          <SelectedBatchLeadPanel
            batch={selectedBatch}
            view={view}
            loading={loading}
            search={search}
            detailPage
            requestedBatchId={routeBatchId}
          />
        ) : (
          <BatchLeadList
            batches={filteredSummaries}
            loading={loading}
            selectedBatchId={null}
            onSelect={handleBatchSelect}
          />
        )}
      </div>
    </>
  )
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  loading,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub: string
  tone: Tone
  loading: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="admin-card p-4 min-h-[132px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-xl border grid place-items-center ${softToneClass(tone)}`}>
          <Icon className="w-5 h-5" />
        </div>
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-slate-300 dark:text-slate-600" />}
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
        {sub}
      </div>
    </motion.div>
  )
}

function FilterPill({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        active
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.07]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function BatchLeadList({
  batches,
  loading,
  selectedBatchId,
  onSelect,
}: {
  batches: BatchSummary[]
  loading: boolean
  selectedBatchId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <Card hover={false} className="!p-0 overflow-hidden">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Briefcase className="w-4 h-4 text-blue-500" /> Batch lead summary</span>}
        subtitle="Action-required batches rise to the top. Click a batch to open its complete dashboard."
        right={<span className="text-[11px] text-slate-500 dark:text-slate-400">{batches.length} shown</span>}
      />
      <div className="max-h-[calc(100vh-330px)] min-h-[420px] overflow-y-auto p-3 space-y-2">
        {loading && batches.length === 0 ? (
          <div className="p-4"><Spinner /></div>
        ) : batches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
            No matching batches found.
          </div>
        ) : (
          batches.map((batch, index) => (
            <BatchLeadButton
              key={batch.id}
              batch={batch}
              index={index}
              selected={batch.id === selectedBatchId}
              onClick={() => onSelect(batch.id)}
            />
          ))
        )}
      </div>
    </Card>
  )
}

function BatchLeadButton({
  batch,
  selected,
  index,
  onClick,
}: {
  batch: BatchSummary
  selected: boolean
  index: number
  onClick: () => void
}) {
  const latest = batch.latestActivity || batch.enabledAt || batch.createdAt || null
  const insight = batch.insight
  const counts = getBatchLeadCounts(batch, insight)
  const actionRequired = isBatchActionRequired(batch, counts, insight)
  const priority = getBatchPriorityScore(batch, counts, insight)
  const actionLabel = actionRequired ? 'Action required' : batch.refreshingInsight ? 'Refreshing AI' : 'Monitoring'
  const summary = insight?.summary || localBatchInsightLine(batch, counts)
  const nextAction = insight?.recommended_action || insight?.next_actions?.[0] || getBatchActions(batch, counts)[0]
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.025, duration: 0.18 }}
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected
          ? 'border-emerald-300 bg-emerald-50/75 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/10'
          : actionRequired
            ? 'border-rose-200 bg-rose-50/40 hover:border-rose-300 hover:bg-rose-50/70 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:hover:bg-rose-500/[0.12]'
            : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/25 dark:hover:bg-emerald-500/[0.06]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-white">{batch.fileName}</span>
            {batch.enabled ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-300">
                AI on
              </span>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
                AI off
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={`Batch #${batch.id}`}>
            Batch #{batch.id}
          </div>
        </div>
        <div className={`shrink-0 rounded-lg border px-2.5 py-1 text-center ${actionRequired ? softToneClass('rose') : softToneClass('slate')}`}>
          <div className="text-sm font-semibold">{priority.toLocaleString()}</div>
          <div className="text-[9px] font-semibold uppercase tracking-wider opacity-70">Priority</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${actionRequired ? softToneClass('rose') : softToneClass('emerald')}`}>
          {batch.refreshingInsight ? <RefreshCw className="h-3 w-3 animate-spin" /> : actionRequired ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {actionLabel}
        </span>
        {insight?.buyer_intent && (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
            {insight.buyer_intent}
          </span>
        )}
        {insight?.labels?.slice(0, 2).map((label) => (
          <span
            key={label}
            className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-300"
          >
            {label.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <BatchMiniStat label="Phones" value={counts.total} />
        <BatchMiniStat label="Replies" value={counts.replied} tone={counts.replied > 0 ? 'emerald' : 'slate'} />
        <BatchMiniStat label="Waiting" value={counts.waitingFirstTouch} tone={counts.waitingFirstTouch > 0 ? 'amber' : 'slate'} />
        <BatchMiniStat label="Closed" value={counts.closed} />
      </div>

      <div className="mt-3 rounded-lg border border-white/80 bg-white/80 p-3 text-xs leading-relaxed text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">
        <div className="line-clamp-2">{summary}</div>
        <div className="mt-2 flex items-start gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-1">{nextAction}</span>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
        <AgentPill agent={batch.effectiveAgent} />
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          Open dashboard <ArrowRight className="h-3 w-3" />
        </span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {latest ? `Last activity ${fmtRelative(latest)}` : 'No activity yet'}
      </div>
    </motion.button>
  )
}

function BatchMiniStat({ label, value, tone = 'slate' }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${softToneClass(tone)}`}>
      <div className="text-sm font-semibold">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
    </div>
  )
}

function SelectedBatchLeadPanel({
  batch,
  view,
  loading,
  search,
  detailPage = false,
  requestedBatchId,
}: {
  batch: BatchSummary | null
  view: ViewFilter
  loading: boolean
  search: string
  detailPage?: boolean
  requestedBatchId?: number
}) {
  const [summaryHistoryLimit, setSummaryHistoryLimit] = useState<10 | 20>(20)
  const liveSummaryQ = useQuery({
    queryKey: batch ? batchAIKeys.crmSummary(batch.id, summaryHistoryLimit) : ['batches', 'no-batch', 'ai-followup', 'crm-summary', summaryHistoryLimit],
    queryFn: () => generateBatchAICRMSummary(batch!.id, summaryHistoryLimit),
    enabled: detailPage && !!batch,
    staleTime: 60_000,
    retry: false,
  })

  if (loading && !batch) {
    return (
      <Card hover={false} className="!p-0 overflow-hidden">
        <div className="p-5"><Spinner /></div>
      </Card>
    )
  }
  if (!batch) {
    return (
      <Card hover={false} className="!p-0 overflow-hidden">
        <div className="p-8 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <div className="mt-3 font-medium text-slate-900 dark:text-white">
            {detailPage && requestedBatchId ? `Batch #${requestedBatchId} was not found` : 'No batch selected'}
          </div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {detailPage
              ? 'Go back to the AI CRM overview and choose another batch.'
              : 'Search or enable AI on a batch to see its lead phone numbers here.'}
          </div>
          {detailPage && (
            <Link
              to="/admin/ai-followup-crm"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:text-emerald-300"
            >
              <Briefcase className="h-3.5 w-3.5" />
              All batches
            </Link>
          )}
        </div>
      </Card>
    )
  }

  const activeInsight = detailPage ? (liveSummaryQ.data || batch.insight) : batch.insight
  const counts = getBatchLeadCounts(batch, activeInsight)
  const phones = getVisibleRecipients(batch.recipients, view, search, activeInsight)
  const rankedPhones = phones
    .slice()
    .sort((a, b) => leadPriority(b, activeInsight, batch.recipients) - leadPriority(a, activeInsight, batch.recipients) || timeValue(latestRecipientActivity(b)) - timeValue(latestRecipientActivity(a)))
  const allRankedPhones = batch.recipients
    .slice()
    .sort((a, b) => leadPriority(b, activeInsight, batch.recipients) - leadPriority(a, activeInsight, batch.recipients) || timeValue(latestRecipientActivity(b)) - timeValue(latestRecipientActivity(a)))
  const chatSummaries = allRankedPhones.map((recipient) => buildChatSummary(recipient, activeInsight, batch.recipients))
  const intelligence = buildBatchIntelligence(batch, counts, chatSummaries)
  const latest = batch.latestActivity || batch.enabledAt || batch.createdAt || null
  const hasPriorityLeads = getActionableRecipients(batch.recipients, activeInsight).length > 0

  return (
    <Card hover={false} className="!p-0 overflow-hidden">
      <CardHeader
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <UserCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="truncate">{batch.fileName} dashboard</span>
          </span>
        }
        subtitle={batch.fileName}
        right={
          <Link
            to={`/admin/ai/followups/${batch.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200"
          >
            Setup <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />

      <div className="p-4 space-y-4">
        {/* Top setup CTA — primary button the user asked for. Goes to
            the per-batch control room where they can tweak cadence,
            tone, agent assignment, enable/disable, etc. */}
        <BatchControlHero batch={batch} counts={counts} latest={latest} />

        <BatchDecisionStrip
          batch={batch}
          counts={counts}
          insight={activeInsight}
          refreshing={detailPage && liveSummaryQ.isFetching}
        />

        <BatchAISummary
          batch={batch}
          counts={counts}
          intelligence={intelligence}
          liveSummary={detailPage ? activeInsight : undefined}
          liveSummaryLoading={detailPage && liveSummaryQ.isFetching}
          liveSummaryError={detailPage && liveSummaryQ.isError ? apiError(liveSummaryQ.error, 'Failed to generate Bedrock summary') : ''}
          historyLimit={summaryHistoryLimit}
          onHistoryLimitChange={setSummaryHistoryLimit}
          onRefreshSummary={() => liveSummaryQ.refetch()}
          detailPage={detailPage}
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <LeadDeskStat label="Phones" value={counts.total} icon={Phone} tone="blue" />
          <LeadDeskStat label="Needs action" value={counts.important} icon={Sparkles} tone={counts.important > 0 ? 'rose' : 'slate'} />
          <LeadDeskStat label="Replies" value={counts.replied} icon={ArrowDownLeft} tone="emerald" />
          <LeadDeskStat label="Waiting" value={counts.waitingFirstTouch} icon={Clock3} tone="amber" />
          <LeadDeskStat label="In cadence" value={counts.aiWorking} icon={Send} tone="violet" />
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,0.95fr)_minmax(300px,0.65fr)] gap-3">
          <BatchActionBox batch={batch} counts={counts} insight={activeInsight} />
          <BatchRunSnapshot batch={batch} counts={counts} latest={latest} />
        </div>

        <BatchLeadLanes counts={counts} />

        {hasPriorityLeads ? (
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)] gap-3">
            <BatchPriorityQueue recipients={allRankedPhones} insight={activeInsight} />
            <BatchChatSummaryPanel summaries={chatSummaries} insight={activeInsight} />
          </div>
        ) : (
          <BatchChatSummaryPanel summaries={chatSummaries} insight={activeInsight} />
        )}

        <BatchWorkDoneBoard intelligence={intelligence} />

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900 dark:text-white">{viewTitle(view)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {rankedPhones.length.toLocaleString()} phone{rankedPhones.length === 1 ? '' : 's'} in this view
              </div>
            </div>
            <Link
              to="/admin/ai/conversations"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
            >
              Inbox <MessageSquare className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="max-h-[430px] overflow-y-auto pr-1 space-y-2">
            {rankedPhones.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                {emptyViewMessage(view)}
              </div>
            ) : (
              rankedPhones.map((recipient, index) => (
                <LeadPhoneRow
                  key={recipient.id}
                  recipient={recipient}
                  index={index}
                  insight={activeInsight}
                  allRecipients={batch.recipients}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function BatchControlHero({
  batch,
  counts,
  latest,
}: {
  batch: BatchSummary
  counts: BatchLeadCounts
  latest: string | null
}) {
  const untouched = Math.max(0, counts.total - counts.contacted)
  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-blue-50 p-4 dark:border-emerald-400/25 dark:from-emerald-500/10 dark:via-white/[0.03] dark:to-blue-500/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${batch.enabled ? softToneClass('emerald') : softToneClass('slate')}`}>
              <Bot className="h-3.5 w-3.5" />
              {batch.enabled ? 'AI enabled' : 'AI not enabled'}
            </span>
            <AgentPill agent={batch.effectiveAgent} />
          </div>
          <div className="mt-3 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {batch.enabled ? 'Live batch follow-up desk' : 'Batch is ready for AI setup'}
          </div>
          <div className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {batch.enabled
              ? `${counts.tracked.toLocaleString()} tracked phone${counts.tracked === 1 ? '' : 's'}, ${counts.replied.toLocaleString()} buyer repl${counts.replied === 1 ? 'y' : 'ies'}, ${untouched.toLocaleString()} still untouched.`
              : 'Open setup to choose the agent, cadence, tone, duplicate handling, and which phones this batch should own.'}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-white">{latest ? fmtRelative(latest) : 'No activity yet'}</div>
            <div>Last movement</div>
          </div>
          <Link
            to={`/admin/ai/followups/${batch.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            <Settings className="h-4 w-4" />
            Setup batch
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function BatchDecisionStrip({
  batch,
  counts,
  insight,
  refreshing,
}: {
  batch: BatchSummary
  counts: BatchLeadCounts
  insight?: BatchAICRMSummary
  refreshing?: boolean
}) {
  const actionRequired = isBatchActionRequired(batch, counts, insight)
  const priority = getBatchPriorityScore(batch, counts, insight)
  const tone: Tone = actionRequired ? 'rose' : refreshing ? 'violet' : batch.enabled ? 'emerald' : 'slate'
  const statusLabel = refreshing && !insight
    ? 'Reading latest chats'
    : actionRequired
      ? 'Action required'
      : batch.enabled
        ? 'No urgent action'
        : 'AI not enabled'
  const reason = insight?.action_reason || localBatchInsightLine(batch, counts)
  const recommendedAction = insight?.recommended_action || insight?.next_actions?.[0] || getBatchActions(batch, counts)[0]
  const buyerIntent = insight?.buyer_intent || fallbackBuyerIntent(batch, counts)
  const analyzedAt = insight?.last_analyzed_at || insight?.generated_at || insight?.updated_at || ''
  const labels = (insight?.labels || []).slice(0, 4)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl border p-3 ${softToneClass(tone)}`}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${softToneClass(tone)}`}>
              {refreshing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : actionRequired ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {statusLabel}
            </span>
            {labels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-200"
              >
                {label.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <div className="mt-2 text-base font-semibold text-slate-950 dark:text-white">
            {actionRequired ? 'This batch needs attention now' : 'This batch is in a healthy follow-up state'}
          </div>
          <p className="mt-1 text-sm leading-relaxed opacity-90">{reason}</p>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/70 bg-white/75 p-2.5 text-sm text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.07] dark:text-slate-100">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">Recommended action</div>
              <div className="mt-0.5 font-medium leading-relaxed">{recommendedAction}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          <DecisionFact
            icon={Star}
            label="Priority"
            value={priority > 0 ? priority.toLocaleString() : 'Clear'}
            sub={actionRequired ? 'Act first' : 'Watch'}
          />
          <DecisionFact
            icon={Sparkles}
            label="Buyer intent"
            value={buyerIntent}
            sub={insight ? 'From AI summary' : 'Local signal'}
          />
          <DecisionFact
            icon={Clock3}
            label="Summary age"
            value={analyzedAt ? fmtRelative(analyzedAt) : refreshing ? 'Updating' : 'Not generated'}
            sub={insight?.history_used ? `${insight.history_used} messages used` : 'Batch detail'}
          />
        </div>
      </div>
    </motion.div>
  )
}

function DecisionFact({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/75 p-2.5 shadow-sm dark:border-white/10 dark:bg-white/[0.07]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white" title={value}>{value}</div>
        </div>
        <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  )
}

function LeadDeskStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: ComponentType<{ className?: string }>
  tone: Tone
}) {
  return (
    <div className={`rounded-xl border p-3 ${softToneClass(tone)}`}>
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-lg font-semibold">{value.toLocaleString()}</span>
      </div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
    </div>
  )
}

function BatchActionBox({ batch, counts, insight }: { batch: BatchSummary; counts: BatchLeadCounts; insight?: BatchAICRMSummary }) {
  const insightActions = [
    insight?.recommended_action,
    ...(insight?.next_actions || []),
  ].filter(Boolean) as string[]
  const actions = Array.from(new Set([...insightActions, ...getBatchActions(batch, counts)])).slice(0, 3)
  const actionRequired = isBatchActionRequired(batch, counts, insight)
  return (
    <div className={`rounded-xl border p-3 ${softToneClass(actionRequired ? 'rose' : 'emerald')}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/70 bg-white/75 shadow-sm dark:border-white/10 dark:bg-white/[0.08]">
          {actionRequired ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white">
            {insight ? 'AI recommended next actions' : 'Best next actions'}
          </div>
          <div className="mt-1 space-y-1.5">
            {actions.map((action) => (
              <div key={action} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function BatchRunSnapshot({
  batch,
  counts,
  latest,
}: {
  batch: BatchSummary
  counts: BatchLeadCounts
  latest: string | null
}) {
  const source = batch.effectiveAgent?.source === 'batch_override'
    ? 'Batch override'
    : batch.effectiveAgent?.source === 'global_default'
      ? 'Global default'
      : 'No agent'
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Run snapshot
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${batch.enabled ? softToneClass('emerald') : softToneClass('slate')}`}>
          {batch.enabled ? 'Live' : 'Off'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <SnapshotFact label="Agent" value={batch.effectiveAgent?.agent?.name || 'Not set'} />
        <SnapshotFact label="Agent source" value={source} />
        <SnapshotFact label="Last activity" value={latest ? fmtRelative(latest) : 'No activity'} />
        <SnapshotFact label="Uploaded rows" value={`${batch.validRows.toLocaleString()} / ${batch.totalRows.toLocaleString()}`} />
        <SnapshotFact label="Contacted" value={`${counts.contacted.toLocaleString()} phones`} />
        <SnapshotFact label="Closed or skipped" value={`${counts.closed.toLocaleString()} phones`} />
      </div>
    </div>
  )
}

function SnapshotFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={value}>{value}</div>
    </div>
  )
}

function BatchPriorityQueue({ recipients, insight }: { recipients: BatchAIRecipient[]; insight?: BatchAICRMSummary }) {
  const priority = recipients.filter((r) => isActionableLead(r, recipients, insight)).slice(0, 8)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900 dark:text-white">Needs attention now</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Buyer replies, failed sends, and human handoffs appear here.</div>
        </div>
        <Sparkles className="h-4 w-4 text-rose-500" />
      </div>
      <div className="mt-3 max-h-[300px] overflow-y-auto pr-1 space-y-2">
        {priority.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
            No urgent lead needs action right now.
          </div>
        ) : (
          priority.map((recipient, index) => {
            const reason = getLeadReason(recipient, insight, recipients)
            const Icon = reason.icon
            return (
              <Link
                key={recipient.id}
                to={`/admin/ai/followups/recipients/${recipient.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-emerald-300 hover:bg-emerald-50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[11px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {recipient.retailer_name || recipient.whatsapp_number}
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {recipient.whatsapp_number}
                    </div>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${softToneClass(reason.tone)}`}>
                  <Icon className="h-3 w-3" />
                  {reason.label}
                </span>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}

function BatchChatSummaryPanel({ summaries, insight }: { summaries: ChatSummary[]; insight?: BatchAICRMSummary }) {
  const recipients = summaries.map((s) => s.recipient)
  const activeSummaries = summaries.filter((s) => s.recipient.last_message_preview || s.recipient.last_event || isActionableLead(s.recipient, recipients, insight))
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-400/20 dark:bg-blue-500/10">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900 dark:text-white">Phone summaries</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">One readable line per phone using the latest message, status, and timeline signal.</div>
        </div>
        <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-300" />
      </div>
      <div className="mt-3 max-h-[360px] overflow-y-auto pr-1 space-y-2">
        {activeSummaries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-blue-200 bg-white/70 p-4 text-sm text-slate-500 dark:border-blue-400/20 dark:bg-white/[0.04] dark:text-slate-400">
            No chat movement yet. Once messages arrive, every phone gets a concise summary here.
          </div>
        ) : (
          activeSummaries.map((summary, index) => (
            <ChatSummaryRow key={summary.recipient.id} summary={summary} index={index} />
          ))
        )}
      </div>
    </div>
  )
}

function ChatSummaryRow({ summary, index }: { summary: ChatSummary; index: number }) {
  const Icon = summary.icon
  const activity = latestRecipientActivity(summary.recipient)
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.018, duration: 0.18 }}
      className="rounded-lg border border-white/80 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{summary.title}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${softToneClass(summary.tone)}`}>
              <Icon className="h-3 w-3" />
              Status summary
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">{summary.recipient.whatsapp_number}</div>
        </div>
        <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{activity ? fmtRelative(activity) : 'No activity'}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{summary.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {summary.nextAction}
        </span>
        <Link
          to={`/admin/ai/followups/recipients/${summary.recipient.id}`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300"
        >
          Open timeline <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  )
}

function BatchWorkDoneBoard({ intelligence }: { intelligence: BatchIntelligence }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <WorkColumn title="Current state" items={intelligence.completed} tone="emerald" icon={CheckCircle2} />
      <WorkColumn title="Watch points" items={intelligence.watch} tone="amber" icon={AlertTriangle} />
      <WorkColumn title="Next move" items={intelligence.next} tone="violet" icon={ArrowRight} />
    </div>
  )
}

function WorkColumn({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string
  items: string[]
  tone: Tone
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <div className={`rounded-xl border p-3 ${softToneClass(tone)}`}>
      <div className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * BatchAISummary — a deterministic, data-grounded "AI" summary of
 * what's happening with a batch. We don't ship an LLM endpoint for
 * per-batch prose (cost + latency), so this generator mirrors what an
 * AI would say IF it had the same numbers in front of it. The
 * phrasing varies so the card doesn't feel templated, but every
 * claim is backed by a number from `counts` / `batch` — never
 * hallucinated.
 *
 * Output shape:
 *   - status line:  "AI is on for N of M phones" / "AI is off"
 *   - narrative:    "moving nicely" / "needs attention" / "quiet"
 *   - narrative:    1-2 sentences weaving the strongest signals
 *   - next move:    one concrete action the operator can take
 *
 * The card uses a "sparkle" icon so it reads as AI-generated copy,
 * not a static stats dump. We rotate 2-3 phrasing variants per
 * branch so the operator never sees the same sentence twice in a
 * row across batches.
 */
function BatchAISummary({
  batch,
  counts,
  intelligence,
  liveSummary,
  liveSummaryLoading,
  liveSummaryError,
  historyLimit,
  onHistoryLimitChange,
  onRefreshSummary,
  detailPage,
}: {
  batch: BatchSummary
  counts: BatchLeadCounts
  intelligence: BatchIntelligence
  liveSummary?: BatchAICRMSummary
  liveSummaryLoading?: boolean
  liveSummaryError?: string
  historyLimit?: 10 | 20
  onHistoryLimitChange?: (limit: 10 | 20) => void
  onRefreshSummary?: () => void
  detailPage?: boolean
}) {
  const summary = useMemo(() => buildBatchSummary(batch, counts), [batch.id, counts])
  const isLive = !!liveSummary
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-xl border border-violet-200/70 bg-gradient-to-br from-violet-50/60 to-fuchsia-50/40 p-4 dark:border-violet-400/20 dark:from-violet-500/10 dark:to-fuchsia-500/10"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-violet-700 shadow-sm dark:bg-white/10 dark:text-violet-300">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-white">AI generated summary</span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-300">
                {isLive ? liveSummary.provider || 'bedrock' : 'local'}
              </span>
              {isLive && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-300">
                  {liveSummary.history_used}/{liveSummary.history_limit} messages
                </span>
              )}
            </div>
            {detailPage && (
              <div className="flex shrink-0 items-center gap-1">
                {[10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onHistoryLimitChange?.(n as 10 | 20)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                      historyLimit === n
                        ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-400/30 dark:bg-violet-500/20 dark:text-violet-200'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-violet-300'
                    }`}
                  >
                    Last {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onRefreshSummary}
                  className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-violet-300"
                  title="Regenerate summary"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${liveSummaryLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            {liveSummaryLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-violet-200/70 bg-white/70 p-3 text-sm text-violet-700 dark:border-violet-400/20 dark:bg-white/[0.04] dark:text-violet-200">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Generating summary from the latest batch messages...
              </div>
            ) : liveSummaryError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                {liveSummaryError}. Showing the local batch summary below.
              </div>
            ) : null}
            {isLive ? (
              <LiveSummaryContent summary={liveSummary} />
            ) : (
              <>
                <p className="leading-relaxed">{summary.headline}</p>
                <p className="leading-relaxed font-medium text-slate-800 dark:text-slate-100">{intelligence.brief}</p>
                <p className="leading-relaxed">{summary.narrative}</p>
              </>
            )}
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-200/70 bg-white/70 p-2.5 dark:border-violet-400/20 dark:bg-white/[0.04]">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Next move:</span>{' '}
                {isLive && liveSummary.next_actions?.[0] ? liveSummary.next_actions[0] : summary.nextMove}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function LiveSummaryContent({ summary }: { summary: BatchAICRMSummary }) {
  return (
    <div className="space-y-3">
      <p className="leading-relaxed font-medium text-slate-800 dark:text-slate-100">{summary.summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${softToneClass(summary.action_required ? 'rose' : 'emerald')}`}>
          {summary.action_required ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {summary.action_required ? 'Action required' : 'No urgent action'}
        </span>
        {typeof summary.priority_score === 'number' && (
          <span className="rounded-full border border-white/70 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
            Priority {summary.priority_score}
          </span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${softToneClass(summaryMoodTone(summary.mood))}`}>
          {summary.mood || 'mixed'}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
          Intent: {summary.buyer_intent || 'unknown'}
        </span>
        {summary.model && (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
            {summary.model}
          </span>
        )}
      </div>
      {(summary.action_reason || summary.recommended_action) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {summary.action_reason && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-xs leading-relaxed text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="font-semibold uppercase tracking-wider">Why it matters</div>
              <div className="mt-1">{summary.action_reason}</div>
            </div>
          )}
          {summary.recommended_action && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs leading-relaxed text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              <div className="font-semibold uppercase tracking-wider">Recommended action</div>
              <div className="mt-1">{summary.recommended_action}</div>
            </div>
          )}
        </div>
      )}
      {summary.labels?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {summary.labels.slice(0, 6).map((label) => (
            <span
              key={label}
              className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-300"
            >
              {label.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <LiveSummaryList title="What happened" items={summary.what_happened} tone="blue" />
        <LiveSummaryList title="Risks" items={summary.risks} tone="amber" />
        <LiveSummaryList title="Next actions" items={summary.next_actions} tone="emerald" />
      </div>
      {summary.warm_leads?.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Warm leads
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.warm_leads.map((lead, index) => (
              <span
                key={`${lead.phone}-${index}`}
                className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs text-emerald-800 dark:border-emerald-400/20 dark:bg-white/[0.05] dark:text-emerald-200"
                title={lead.reason}
              >
                <span className="font-semibold">{lead.name || lead.phone || 'Lead'}</span>
                {lead.reason && <span className="ml-1 text-emerald-700/80 dark:text-emerald-200/80">{lead.reason}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LiveSummaryList({ title, items, tone }: { title: string; items?: string[]; tone: Tone }) {
  const visible = (items || []).filter(Boolean).slice(0, 4)
  return (
    <div className={`rounded-lg border p-3 ${softToneClass(tone)}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">{title}</div>
      <div className="mt-2 space-y-1.5">
        {visible.length === 0 ? (
          <div className="text-xs opacity-75">No signal yet.</div>
        ) : visible.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function summaryMoodTone(mood: string): Tone {
  const value = mood.toLowerCase()
  if (value.includes('warm')) return 'emerald'
  if (value.includes('urgent') || value.includes('blocked')) return 'rose'
  if (value.includes('quiet')) return 'slate'
  return 'violet'
}

type BatchSummaryCopy = { headline: string; narrative: string; nextMove: string }

function shouldRefreshBatchInsight(batch: BatchSummary): boolean {
  if (!batch.enabled) return false
  const insight = batch.insight
  if (!insight) return true
  const analyzedAt = timeValue(insight.last_analyzed_at || insight.generated_at || insight.updated_at)
  const latestBatchMessage = timeValue(batch.latestActivity)
  const lastAnalyzedMessage = timeValue(insight.last_message_at || insight.last_analyzed_at || insight.generated_at)
  if (latestBatchMessage > 0 && latestBatchMessage > lastAnalyzedMessage + 1000) return true
  if (!insight.summary && !insight.generation_error) return true
  if (insight.generation_error && !insight.summary && Date.now() - analyzedAt > 5 * 60_000) return true
  if (analyzedAt > 0 && Date.now() - analyzedAt > 6 * 60 * 60_000) return true
  return false
}

function localBatchInsightLine(batch: BatchSummary, counts: BatchLeadCounts): string {
  if (!batch.enabled) {
    return `AI is off for this batch. ${counts.total.toLocaleString()} valid phone${counts.total === 1 ? '' : 's'} can be enrolled from setup.`
  }
  if (counts.failed > 0) {
    return `${counts.failed.toLocaleString()} phone${counts.failed === 1 ? '' : 's'} failed to send. Review the timeline before allowing more AI touches.`
  }
  if (counts.handedOff > 0) {
    return `${counts.handedOff.toLocaleString()} phone${counts.handedOff === 1 ? ' needs' : 's need'} a human reply before automation continues.`
  }
  if (counts.replied > 0) {
    return `${counts.replied.toLocaleString()} buyer repl${counts.replied === 1 ? 'y is' : 'ies are'} waiting. These are the warmest leads in the batch.`
  }
  if (counts.waitingFirstTouch > 0) {
    return `${counts.waitingFirstTouch.toLocaleString()} phone${counts.waitingFirstTouch === 1 ? ' is' : 's are'} still waiting for the first AI touch.`
  }
  if (batch.refreshingInsight) {
    return 'AI is refreshing the saved CRM summary from the latest batch messages.'
  }
  return 'No urgent buyer reply, failed send, or human handoff is visible right now.'
}

// pickVariant returns one of N phrasing variants deterministically
// per-call-site so the same data never reads identical on every page
// load, but stays stable while the operator is reading it.
function pickVariant<T>(items: T[], salt: number): T {
  const idx = Math.abs(salt) % items.length
  return items[idx]
}

function buildBatchSummary(batch: BatchSummary, counts: BatchLeadCounts): BatchSummaryCopy {
  // Salt mixes the batch id with a snapshot of the strongest metric
  // so the same batch produces a different sentence across days
  // (the metric drifts, the salt drifts).
  const activityBucket = Math.floor(timeValue(batch.latestActivity) / 3_600_000)
  const salt = batch.id * 31 + activityBucket

  // ---------- Headline (status + scale) ----------
  let headline: string
  if (!batch.enabled) {
    headline = pickVariant([
      `AI is currently off for this batch. ${counts.total.toLocaleString()} valid phone number${counts.total === 1 ? ' is' : 's are'} sitting idle.`,
      `This batch has AI turned off. ${counts.total.toLocaleString()} phone${counts.total === 1 ? '' : 's'} are not being touched right now.`,
      `AI follow-up is paused for this batch. ${counts.total.toLocaleString()} valid phone${counts.total === 1 ? '' : 's'} are waiting for someone to turn it back on.`,
    ], salt)
  } else if (counts.total === 0) {
    headline = pickVariant([
      `AI is on but no phone numbers have been enrolled yet.`,
      `This batch is AI-enabled but empty. Upload or sync retailer data to start seeing activity.`,
    ], salt)
  } else {
    const trackedPhrase = counts.tracked < counts.total
      ? `${counts.tracked.toLocaleString()} of ${counts.total.toLocaleString()} valid phone${counts.total === 1 ? ' is' : 's are'} tracked by AI`
      : `All ${counts.total.toLocaleString()} valid phone${counts.total === 1 ? ' is' : 's are'} tracked by AI`
    headline = pickVariant([
      `AI is on. ${trackedPhrase}, with ${counts.replied.toLocaleString()} buyer repl${counts.replied === 1 ? 'y' : 'ies'} so far.`,
      `AI follow-up is running on ${trackedPhrase}, and ${counts.replied.toLocaleString()} retailer${counts.replied === 1 ? ' has' : 's have'} already replied.`,
      `Live for ${trackedPhrase}, with ${counts.replied.toLocaleString()} buyer repl${counts.replied === 1 ? 'y' : 'ies'} logged.`,
    ], salt)
  }

  // ---------- Narrative (the strongest signal) ----------
  let narrative: string
  if (counts.failed > 0 && counts.handedOff > 0) {
    narrative = pickVariant([
      `${counts.failed} phone${counts.failed === 1 ? '' : 's'} failed to send and ${counts.handedOff} conversation${counts.handedOff === 1 ? '' : 's'} need${counts.handedOff === 1 ? 's' : ''} a human. Resolve those before more AI touches go out.`,
      `${counts.failed} send failure${counts.failed === 1 ? '' : 's'} and ${counts.handedOff} hand-off${counts.handedOff === 1 ? '' : 's'} are blocking momentum. Pick those up first.`,
    ], salt)
  } else if (counts.failed > 0) {
    narrative = pickVariant([
      `${counts.failed} phone${counts.failed === 1 ? '' : 's'} failed to deliver. WhatsApp is rejecting the send — check the recipient timeline before retrying.`,
      `${counts.failed} delivery failure${counts.failed === 1 ? '' : 's'} on this batch. The cadence keeps running, but the next touch will pile onto the same queue.`,
    ], salt)
  } else if (counts.handedOff > 0) {
    narrative = pickVariant([
      `${counts.handedOff} retailer${counts.handedOff === 1 ? '' : 's'} bounced out of AI to a human. Reply from the inbox or they'll go cold.`,
      `${counts.handedOff} conversation${counts.handedOff === 1 ? '' : 's'} are sitting on a human. Pick them up before they go stale.`,
    ], salt)
  } else if (counts.replied > 0 && counts.waitingFirstTouch === 0) {
    narrative = pickVariant([
      `${counts.replied.toLocaleString()} retailer${counts.replied === 1 ? ' has' : 's have'} replied — momentum is strong. AI is keeping the rest warm.`,
      `Reply rate is up: ${counts.replied.toLocaleString()} buyer${counts.replied === 1 ? '' : 's'} engaged. No urgent failures or hand-offs right now.`,
    ], salt)
  } else if (counts.waitingFirstTouch > 0) {
    narrative = pickVariant([
      `${counts.waitingFirstTouch.toLocaleString()} phone${counts.waitingFirstTouch === 1 ? '' : 's'} haven't received a first AI touch yet. The cadence will catch up, but a manual nudge now speeds things up.`,
      `${counts.waitingFirstTouch.toLocaleString()} phone${counts.waitingFirstTouch === 1 ? ' is' : 's are'} still waiting on the first message. Watch the timeline — if it stretches past a day, intervene.`,
    ], salt)
  } else if (counts.aiWorking > 0) {
    narrative = pickVariant([
      `AI is moving ${counts.aiWorking} phone${counts.aiWorking === 1 ? '' : 's'} through the follow-up sequence. Steady state.`,
      `${counts.aiWorking} phone${counts.aiWorking === 1 ? ' is' : 's are'} in active AI motion. No fires to put out.`,
    ], salt)
  } else {
    narrative = pickVariant([
      `Batch is quiet — no failures, no replies, no hand-offs. Either the cadence has settled or the data needs a refresh.`,
      `No movement yet. If this batch has been idle for over a day, check the cadence or upload fresh retailers.`,
    ], salt)
  }

  // ---------- Next move (one concrete action) ----------
  let nextMove: string
  if (!batch.enabled) {
    nextMove = pickVariant([
      `Turn AI on for this batch from the control room to start enrolling phones.`,
      `Open the control room and enable AI follow-up — ${counts.total.toLocaleString()} phone${counts.total === 1 ? ' is' : 's are'} waiting.`,
    ], salt)
  } else if (counts.failed > 0) {
    nextMove = pickVariant([
      `Open the ${counts.failed} failed phone${counts.failed === 1 ? '' : 's'} and retry the last send, or pause the cadence if the issue keeps repeating.`,
      `Investigate the ${counts.failed} failed delivery${counts.failed === 1 ? '' : 's'} on the timeline tab, then retry from the recipient panel.`,
    ], salt)
  } else if (counts.handedOff > 0) {
    nextMove = pickVariant([
      `Open the ${counts.handedOff} human hand-off${counts.handedOff === 1 ? '' : 's'} in the inbox and reply within the hour to keep them warm.`,
      `Reply to the ${counts.handedOff} retailer${counts.handedOff === 1 ? '' : 's'} that bounced out to a human before they go cold.`,
    ], salt)
  } else if (counts.replied > 0) {
    nextMove = pickVariant([
      `Open the ${counts.replied} buyer repl${counts.replied === 1 ? 'y' : 'ies'} first — they're the warmest leads in this batch right now.`,
      `Reply to the ${counts.replied} engaged retailer${counts.replied === 1 ? '' : 's'} from the inbox before AI sends the next cadence touch.`,
    ], salt)
  } else if (counts.waitingFirstTouch > 0) {
    nextMove = pickVariant([
      `Open the recipient panel and verify the first AI message is ready, or send a manual opener for the ${counts.waitingFirstTouch} waiting phone${counts.waitingFirstTouch === 1 ? '' : 's'}.`,
      `Check the next-touch date on the waiting phones — if it slipped, send a manual message from the timeline.`,
    ], salt)
  } else {
    nextMove = pickVariant([
      `Keep watching. AI is doing its job; jump in only if a retailer replies or the cadence drops.`,
      `No action needed right now. The next review is worthwhile after a new buyer reply comes in.`,
    ], salt)
  }

  return { headline, narrative, nextMove }
}

function BatchLeadLanes({ counts }: { counts: BatchLeadCounts }) {
  const lanes = getBatchLeadLanes(counts)
  const max = Math.max(1, ...lanes.map((lane) => lane.value))
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900 dark:text-white">Phone signals</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Signals can overlap: one phone can be in cadence and still need action.</div>
        </div>
        <Users className="h-4 w-4 text-slate-400" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {lanes.map((lane) => {
          const Icon = lane.icon
          return (
            <div key={lane.label} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-2">
                <div className={`grid h-8 w-8 place-items-center rounded-lg ${softToneClass(lane.tone)}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="text-xl font-semibold text-slate-900 dark:text-white">{lane.value.toLocaleString()}</div>
              </div>
              <div className="mt-2 text-xs font-medium text-slate-800 dark:text-slate-100">{lane.label}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white dark:bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round((lane.value / max) * 100)}%` }}
                  transition={{ duration: 0.38 }}
                  className={`h-full rounded-full ${solidToneClass(lane.tone)}`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LeadPhoneRow({
  recipient,
  index,
  insight,
  allRecipients,
}: {
  recipient: BatchAIRecipient
  index: number
  insight?: BatchAICRMSummary
  allRecipients?: BatchAIRecipient[]
}) {
  const reason = getLeadReason(recipient, insight, allRecipients)
  const ReasonIcon = reason.icon
  const activity = latestRecipientActivity(recipient)
  const aiFlagged = !isImportantLead(recipient) && isInsightActionRecipient(recipient, allRecipients || [recipient], insight)
  const detailText = aiFlagged
    ? reason.detail
    : recipient.last_message_preview || recipient.last_event || reason.detail
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.02, duration: 0.18 }}
      className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-200 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/25 dark:hover:bg-emerald-500/[0.06]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white">
              {recipient.retailer_name || 'Unknown retailer'}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${softToneClass(reason.tone)}`}>
              <ReasonIcon className="h-3 w-3" />
              {reason.label}
            </span>
          </div>
          <Link
            to={`/admin/ai/conversations?phone=${encodeURIComponent(recipient.whatsapp_number)}`}
            className="mt-1 inline-flex items-center gap-1 font-mono text-[12px] text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-300"
          >
            {recipient.whatsapp_number}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <AIFollowupStatusBadge status={recipient.ai_status} />
      </div>

      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
        {detailText}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {recipient.last_message_direction === 'in' ? (
            <ArrowDownLeft className="h-3.5 w-3.5 text-blue-500" />
          ) : recipient.last_message_direction === 'out' ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Clock3 className="h-3.5 w-3.5" />
          )}
          <span>{activity ? fmtRelative(activity) : 'No message yet'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/admin/ai/followups/recipients/${recipient.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300"
          >
            Timeline <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            to={`/admin/ai/conversations?phone=${encodeURIComponent(recipient.whatsapp_number)}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            Chat <MessageSquare className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function AgentPill({ agent }: { agent?: EffectiveAIAgent | null }) {
  if (!agent) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
        <Bot className="h-3 w-3 shrink-0" />
        <span className="truncate">Agent loading</span>
      </span>
    )
  }
  const tone = agent.source === 'batch_override' ? 'violet' : agent.source === 'global_default' ? 'blue' : 'slate'
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${softToneClass(tone)}`}>
      <Bot className="h-3 w-3 shrink-0" />
      <span className="truncate">{agent.agent?.name || 'No agent'}</span>
      {agent.agent?.is_default && <Star className="h-2.5 w-2.5 shrink-0" />}
    </span>
  )
}

function buildChatSummary(
  recipient: BatchAIRecipient,
  insight?: BatchAICRMSummary,
  allRecipients?: BatchAIRecipient[],
): ChatSummary {
  const reason = getLeadReason(recipient, insight, allRecipients)
  const name = recipient.retailer_name || recipient.whatsapp_number
  const preview = compactText(recipient.last_message_preview || recipient.last_event || '', 150)
  if (!isImportantLead(recipient) && isInsightActionRecipient(recipient, allRecipients || [recipient], insight)) {
    return {
      recipient,
      title: name,
      summary: insight?.action_reason || insight?.summary || reason.detail,
      nextAction: insight?.recommended_action || insight?.next_actions?.[0] || 'Review AI signal',
      tone: 'rose',
      icon: Sparkles,
    }
  }
  if (recipient.ai_status === 'failed') {
    return {
      recipient,
      title: name,
      summary: preview
        ? `Latest send failed after this message context: "${preview}". Treat this as blocked until the send reason is checked.`
        : 'Latest send failed. The timeline should be checked before retrying or allowing another cadence step.',
      nextAction: 'Check failed send',
      tone: 'rose',
      icon: AlertTriangle,
    }
  }
  if (recipient.ai_status === 'handed_off') {
    return {
      recipient,
      title: name,
      summary: preview
        ? `AI moved this to a human after: "${preview}". This is no longer a pure automation task.`
        : 'AI handed this conversation to the team. A human reply is the safest next step.',
      nextAction: 'Human reply needed',
      tone: 'rose',
      icon: ShieldCheck,
    }
  }
  if (recipient.last_message_direction === 'in') {
    return {
      recipient,
      title: name,
      summary: preview
        ? `Retailer replied: "${preview}". This phone is warm and should be handled before the next automated touch.`
        : 'Retailer replied. This is a warm lead and should be reviewed from the inbox.',
      nextAction: 'Reply first',
      tone: 'emerald',
      icon: ArrowDownLeft,
    }
  }
  if (recipient.last_message_direction === 'out') {
    return {
      recipient,
      title: name,
      summary: preview
        ? `AI already sent: "${preview}". Wait for buyer response unless the next scheduled touch is due.`
        : 'AI sent the latest message. Keep watching for a buyer reply or delivery issue.',
      nextAction: 'Monitor response',
      tone: 'violet',
      icon: Send,
    }
  }
  if (isWaitingFirstTouch(recipient)) {
    return {
      recipient,
      title: name,
      summary: 'This phone is enrolled but has not received the first AI follow-up yet.',
      nextAction: 'Verify first message',
      tone: 'amber',
      icon: Clock3,
    }
  }
  return {
    recipient,
    title: name,
    summary: reason.detail,
    nextAction: reason.label,
    tone: reason.tone,
    icon: reason.icon,
  }
}

function buildBatchIntelligence(
  batch: BatchSummary,
  counts: BatchLeadCounts,
  summaries: ChatSummary[],
): BatchIntelligence {
  const warm = summaries.filter((s) => s.recipient.last_message_direction === 'in')
  const failed = summaries.filter((s) => s.recipient.ai_status === 'failed')
  const handed = summaries.filter((s) => s.recipient.ai_status === 'handed_off')
  const sent = summaries.filter((s) => s.recipient.last_message_direction === 'out')
  const waiting = summaries.filter((s) => isWaitingFirstTouch(s.recipient))
  const contacted = counts.contacted
  const untouched = Math.max(0, counts.total - contacted)

  const topNames = warm
    .slice(0, 3)
    .map((s) => s.recipient.retailer_name || s.recipient.whatsapp_number)
  const brief = batch.enabled
    ? `${batch.effectiveAgent?.agent?.name || 'The selected agent'} is managing ${counts.tracked.toLocaleString()} phone${counts.tracked === 1 ? '' : 's'} in this batch. ${contacted.toLocaleString()} have message activity, ${warm.length.toLocaleString()} replied, and ${untouched.toLocaleString()} still need the first meaningful touch.`
    : `AI is not active for this batch yet. Setup will decide which agent owns these ${counts.total.toLocaleString()} phone${counts.total === 1 ? '' : 's'} and how follow-ups should run.`

  const completed: string[] = []
  if (batch.enabled) completed.push(`AI follow-up is enabled for batch #${batch.id}.`)
  if (contacted > 0) completed.push(`${contacted.toLocaleString()} phone${contacted === 1 ? ' has' : 's have'} message activity recorded.`)
  if (sent.length > 0) completed.push(`${sent.length.toLocaleString()} latest message${sent.length === 1 ? ' was' : 's were'} sent by AI or the team.`)
  if (topNames.length > 0) completed.push(`Warm buyer replies: ${topNames.join(', ')}.`)
  if (completed.length === 0) completed.push('No completed AI activity yet. Setup or the first cadence run is still pending.')

  const watch: string[] = []
  if (failed.length > 0) watch.push(`${failed.length.toLocaleString()} failed send${failed.length === 1 ? '' : 's'} need review before the next touch.`)
  if (handed.length > 0) watch.push(`${handed.length.toLocaleString()} human handoff${handed.length === 1 ? '' : 's'} should be answered from the inbox.`)
  if (warm.length > 0) watch.push(`${warm.length.toLocaleString()} buyer repl${warm.length === 1 ? 'y is' : 'ies are'} high-intent and should not wait for automation.`)
  if (waiting.length > 0) watch.push(`${waiting.length.toLocaleString()} phone${waiting.length === 1 ? ' is' : 's are'} still waiting for the first AI touch.`)
  if (watch.length === 0) watch.push('No urgent failures or handoffs are visible right now.')

  const next: string[] = []
  if (!batch.enabled) next.push('Open setup and enable the batch AI sequence.')
  if (failed.length > 0) next.push('Open failed timelines, fix the send reason, then retry only the affected phones.')
  if (warm.length > 0) next.push('Reply to warm buyer messages before changing cadence.')
  if (handed.length > 0) next.push('Clear human handoffs so AI does not leave engaged buyers waiting.')
  if (waiting.length > 0) next.push('Review the first-touch message and start the waiting phones.')
  if (next.length === 0) next.push('Keep monitoring; revisit when a buyer replies or a send fails.')

  return {
    title: batch.enabled ? 'Batch is live' : 'Batch needs setup',
    brief,
    completed: completed.slice(0, 4),
    watch: watch.slice(0, 4),
    next: next.slice(0, 4),
  }
}

function buildBatchSummaries(batches: UploadBatch[], recipients: BatchAIRecipient[]): BatchSummary[] {
  const map = new Map<number, BatchSummary>()
  for (const b of batches) {
    const shouldShow = b.ai_followup_enabled || ['approved', 'sending', 'sent', 'completed'].includes(b.status)
    if (!shouldShow) continue
    map.set(b.id, {
      id: b.id,
      batch: b,
      enabled: !!b.ai_followup_enabled,
      fileName: batchDisplayName(b),
      status: b.status || 'unknown',
      createdAt: b.created_at,
      enabledAt: b.ai_followup_enabled_at,
      validRows: b.valid_rows || 0,
      totalRows: b.total_rows || 0,
      recipients: [],
      counts: {},
    })
  }
  for (const r of recipients) {
    let s = map.get(r.batch_id)
    if (!s) {
      s = {
        id: r.batch_id,
        enabled: true,
        fileName: `Batch #${r.batch_id}`,
        status: 'ai follow-up',
        validRows: 0,
        totalRows: 0,
        recipients: [],
        counts: {},
      }
      map.set(r.batch_id, s)
    }
    s.recipients.push(r)
    s.counts[r.ai_status] = (s.counts[r.ai_status] || 0) + 1
    const eventAt = latestRecipientActivity(r)
    if (eventAt && timeValue(eventAt) > timeValue(s.latestActivity)) s.latestActivity = eventAt
    if (r.last_message_preview && timeValue(r.last_message_at) > timeValue(s.latestMessage?.last_message_at)) s.latestMessage = r
  }
  return Array.from(map.values()).sort((a, b) => {
    const ap = batchPriority(a)
    const bp = batchPriority(b)
    const aTime = timeValue(a.latestActivity || a.enabledAt || a.createdAt)
    const bTime = timeValue(b.latestActivity || b.enabledAt || b.createdAt)
    return bp - ap || bTime - aTime || b.id - a.id
  })
}

function buildLeadStats(summaries: BatchSummary[], recipients: BatchAIRecipient[], totalRecipients: number): LeadStats {
  const counts = recipients.reduce<Record<string, number>>((acc, r) => {
    acc[r.ai_status] = (acc[r.ai_status] || 0) + 1
    return acc
  }, {})
  const trackedRecipients = recipients.length
  const failed = counts.failed || 0
  const handedOff = counts.handed_off || 0
  const closed = (counts.opted_out || 0) + (counts.excluded || 0) + (counts.disabled || 0)
  const replied = recipients.filter((r) => r.last_message_direction === 'in').length
  const waitingFirstTouch = recipients.filter(isWaitingFirstTouch).length
  const aiWorking = recipients.filter((r) => ['active', 'pending'].includes(r.ai_status) && !isWaitingFirstTouch(r)).length
  const important = summaries.reduce((sum, batch) => sum + getBatchLeadCounts(batch, batch.insight).important, 0)
  return {
    totalBatches: summaries.length,
    enabledBatches: summaries.filter((b) => b.enabled).length,
    trackedRecipients,
    totalRecipients: Math.max(totalRecipients, trackedRecipients),
    important,
    replied,
    waitingFirstTouch,
    aiWorking,
    failed,
    handedOff,
    closed,
  }
}

function getBatchLeadCounts(batch: BatchSummary, insight?: BatchAICRMSummary): BatchLeadCounts {
  const counts = batch.counts
  const tracked = batch.recipients.length
  const total = tracked || batch.validRows || 0
  const failed = counts.failed || 0
  const handedOff = counts.handed_off || 0
  const closed = (counts.opted_out || 0) + (counts.excluded || 0) + (counts.disabled || 0)
  const replied = batch.recipients.filter((r) => r.last_message_direction === 'in').length
  const waitingFirstTouch = batch.recipients.filter(isWaitingFirstTouch).length
  const contacted = batch.recipients.filter((r) => !!r.last_message_preview).length
  const aiWorking = batch.recipients.filter((r) => ['active', 'pending'].includes(r.ai_status) && !isWaitingFirstTouch(r)).length
  return {
    total,
    tracked,
    important: getActionableRecipients(batch.recipients, insight).length,
    replied,
    waitingFirstTouch,
    aiWorking,
    failed,
    handedOff,
    closed,
    contacted,
  }
}

function getBatchLeadLanes(counts: BatchLeadCounts) {
  return [
    { label: 'Needs action', value: counts.important, icon: Sparkles, tone: counts.important > 0 ? 'rose' : 'slate' as Tone },
    { label: 'Buyer replies', value: counts.replied, icon: ArrowDownLeft, tone: 'emerald' as Tone },
    { label: 'In cadence', value: counts.aiWorking, icon: Send, tone: 'violet' as Tone },
    { label: 'First touch due', value: counts.waitingFirstTouch, icon: Clock3, tone: 'amber' as Tone },
    { label: 'Closed', value: counts.closed, icon: ShieldCheck, tone: 'slate' as Tone },
  ]
}

function getBatchActions(batch: BatchSummary, counts: BatchLeadCounts): string[] {
  const actions: string[] = []
  if (!batch.enabled) actions.push('Enable AI when this batch is ready for automated follow-up.')
  if (counts.failed > 0) actions.push(`Review ${counts.failed} failed phone${counts.failed === 1 ? '' : 's'} before the next send.`)
  if (counts.handedOff > 0) actions.push(`Handle ${counts.handedOff} phone${counts.handedOff === 1 ? '' : 's'} already handed to a human.`)
  if (counts.replied > 0) actions.push(`Open buyer replies first; these are the warmest leads in this batch.`)
  if (counts.waitingFirstTouch > 0) actions.push(`Start or verify the first AI touch for ${counts.waitingFirstTouch} waiting phone${counts.waitingFirstTouch === 1 ? '' : 's'}.`)
  if (actions.length === 0) actions.push('No urgent phone needs action. Keep watching latest replies and AI movement.')
  return actions.slice(0, 3)
}

function getVisibleRecipients(recipients: BatchAIRecipient[], view: ViewFilter, search: string, insight?: BatchAICRMSummary): BatchAIRecipient[] {
  const q = search.trim().toLowerCase()
  return recipients.filter((r) => {
    if (q && !recipientMatchesQuery(r, q)) return false
    if (view === 'all') return true
    if (view === 'important') return isActionableLead(r, recipients, insight)
    if (view === 'replied') return r.last_message_direction === 'in'
    if (view === 'waiting') return isWaitingFirstTouch(r)
    return true
  })
}

function filterBatchSummaries(summaries: BatchSummary[], search: string): BatchSummary[] {
  const q = search.trim().toLowerCase()
  if (!q) return summaries
  return summaries.filter((s) => {
    const fields = [
      String(s.id),
      s.fileName,
      s.status,
      s.effectiveAgent?.agent?.name || '',
      s.insight?.summary || '',
      s.insight?.recommended_action || '',
      s.insight?.action_reason || '',
      s.insight?.buyer_intent || '',
      ...(s.insight?.labels || []),
    ].join(' ').toLowerCase()
    return fields.includes(q) || s.recipients.some((r) => recipientMatchesQuery(r, q))
  })
}

function recipientMatchesQuery(r: BatchAIRecipient, q: string): boolean {
  return [
    r.whatsapp_number,
    r.retailer_name || '',
    r.ai_status,
    r.last_event || '',
    r.last_message_preview || '',
  ].join(' ').toLowerCase().includes(q)
}

function isImportantLead(r: BatchAIRecipient): boolean {
  return r.ai_status === 'failed' || r.ai_status === 'handed_off' || r.last_message_direction === 'in'
}

function isActionableLead(r: BatchAIRecipient, recipients: BatchAIRecipient[], insight?: BatchAICRMSummary): boolean {
  return isImportantLead(r) || isInsightActionRecipient(r, recipients, insight)
}

function getActionableRecipients(recipients: BatchAIRecipient[], insight?: BatchAICRMSummary): BatchAIRecipient[] {
  const byId = new Map<number, BatchAIRecipient>()
  for (const recipient of recipients) {
    if (isImportantLead(recipient)) byId.set(recipient.id, recipient)
  }
  for (const recipient of getInsightActionRecipients(recipients, insight)) {
    byId.set(recipient.id, recipient)
  }
  return Array.from(byId.values())
}

function getInsightActionRecipients(recipients: BatchAIRecipient[], insight?: BatchAICRMSummary): BatchAIRecipient[] {
  if (!insight?.action_required || recipients.length === 0) return []

  const matched = new Map<number, BatchAIRecipient>()
  const warmLeads = insight.warm_leads || []
  for (const warm of warmLeads) {
    const phone = normalizePhoneDigits(warm.phone || '')
    const name = (warm.name || '').trim().toLowerCase()
    for (const recipient of recipients) {
      const recipientPhone = normalizePhoneDigits(recipient.whatsapp_number)
      const recipientName = (recipient.retailer_name || '').trim().toLowerCase()
      const phoneMatches = !!phone && !!recipientPhone && (
        phone === recipientPhone || phone.endsWith(recipientPhone) || recipientPhone.endsWith(phone)
      )
      const nameMatches = !!name && !!recipientName && name === recipientName
      if (phoneMatches || nameMatches) matched.set(recipient.id, recipient)
    }
  }
  if (matched.size > 0) return Array.from(matched.values())

  if (recipients.length === 1) return recipients
  const latest = recipients
    .slice()
    .sort((a, b) => timeValue(latestRecipientActivity(b)) - timeValue(latestRecipientActivity(a)))[0]
  return latest ? [latest] : []
}

function isInsightActionRecipient(
  recipient: BatchAIRecipient,
  recipients: BatchAIRecipient[],
  insight?: BatchAICRMSummary,
): boolean {
  return getInsightActionRecipients(recipients, insight).some((r) => r.id === recipient.id)
}

function isWaitingFirstTouch(r: BatchAIRecipient): boolean {
  return r.ai_status === 'pending' && !r.last_message_preview
}

function leadPriority(r: BatchAIRecipient, insight?: BatchAICRMSummary, recipients?: BatchAIRecipient[]): number {
  const reason = getLeadReason(r, insight, recipients)
  const recency = Math.min(20, Math.round(timeValue(latestRecipientActivity(r)) / 86_400_000_000))
  return reason.priority + recency
}

function batchPriority(batch: BatchSummary): number {
  const counts = getBatchLeadCounts(batch, batch.insight)
  const insightBoost = batch.insight?.action_required
    ? 10_000 + getBatchPriorityScore(batch, counts, batch.insight) * 20
    : 0
  const refreshBoost = batch.refreshingInsight ? 120 : 0
  return insightBoost + refreshBoost + counts.important * 100 + counts.replied * 32 + counts.failed * 20 + counts.waitingFirstTouch * 4 + (batch.enabled ? 2 : 0)
}

function isBatchActionRequired(batch: BatchSummary, counts: BatchLeadCounts, insight?: BatchAICRMSummary): boolean {
  return !!insight?.action_required || counts.important > 0 || counts.failed > 0 || counts.handedOff > 0 || counts.replied > 0 || (!batch.enabled && counts.total > 0)
}

function getBatchPriorityScore(batch: BatchSummary, counts: BatchLeadCounts, insight?: BatchAICRMSummary): number {
  const localScore = counts.failed > 0
    ? 95
    : counts.handedOff > 0
      ? 90
      : counts.replied > 0
        ? 82
        : counts.waitingFirstTouch > 0
          ? 58
          : !batch.enabled && counts.total > 0
            ? 42
            : batch.enabled
              ? 18
              : 0
  return Math.max(insight?.priority_score || 0, localScore)
}

function fallbackBuyerIntent(batch: BatchSummary, counts: BatchLeadCounts): string {
  if (!batch.enabled) return 'setup needed'
  if (counts.failed > 0) return 'delivery blocked'
  if (counts.handedOff > 0) return 'human needed'
  if (counts.replied > 0) return 'engaged buyer'
  if (counts.waitingFirstTouch > 0) return 'needs first touch'
  return 'monitoring'
}

function getLeadReason(r: BatchAIRecipient, insight?: BatchAICRMSummary, recipients?: BatchAIRecipient[]): LeadReason {
  if (r.ai_status === 'failed') {
    return {
      label: 'Send failed',
      detail: 'WhatsApp delivery failed. Review the timeline and retry only after the reason is clear.',
      tone: 'rose',
      priority: 100,
      icon: AlertTriangle,
    }
  }
  if (r.ai_status === 'handed_off') {
    return {
      label: 'Human needed',
      detail: 'AI handed this conversation to the team. A person should reply from the inbox.',
      tone: 'rose',
      priority: 94,
      icon: ShieldCheck,
    }
  }
  if (r.last_message_direction === 'in') {
    return {
      label: 'Buyer replied',
      detail: 'The latest visible message came from the retailer. This is a warm lead.',
      tone: 'emerald',
      priority: 88,
      icon: ArrowDownLeft,
    }
  }
  if (isInsightActionRecipient(r, recipients || [r], insight)) {
    return {
      label: insightLeadLabel(insight),
      detail: insight?.action_reason || insight?.recommended_action || 'AI summary flagged this phone as needing review.',
      tone: 'rose',
      priority: Math.max(86, insight?.priority_score || 0),
      icon: Sparkles,
    }
  }
  if (r.ai_status === 'active') {
    return {
      label: 'AI engaged',
      detail: 'AI is actively following up on this phone number.',
      tone: 'violet',
      priority: 68,
      icon: Send,
    }
  }
  if (isWaitingFirstTouch(r)) {
    return {
      label: 'First touch',
      detail: 'This phone is queued but has not received the first AI follow-up yet.',
      tone: 'amber',
      priority: 58,
      icon: Clock3,
    }
  }
  if (r.ai_status === 'pending') {
    return {
      label: 'Next touch',
      detail: 'The next AI follow-up is waiting on its cadence.',
      tone: 'amber',
      priority: 52,
      icon: Clock3,
    }
  }
  if (r.ai_status === 'opted_out') {
    return {
      label: 'Opted out',
      detail: 'The retailer opted out. Do not send further messages.',
      tone: 'slate',
      priority: 18,
      icon: ShieldCheck,
    }
  }
  if (r.ai_status === 'excluded') {
    return {
      label: 'Skipped',
      detail: 'This phone number was skipped for this batch.',
      tone: 'slate',
      priority: 16,
      icon: ShieldCheck,
    }
  }
  if (r.ai_status === 'disabled') {
    return {
      label: 'AI off',
      detail: 'AI follow-up is disabled for this phone number.',
      tone: 'slate',
      priority: 14,
      icon: ShieldCheck,
    }
  }
  return {
    label: r.ai_status || 'Tracked',
    detail: 'This phone number is tracked by the AI follow-up system.',
    tone: 'blue',
    priority: 40,
    icon: Phone,
  }
}

function viewTitle(view: ViewFilter): string {
  if (view === 'important') return 'Phones needing action'
  if (view === 'replied') return 'Buyer replies'
  if (view === 'waiting') return 'First touch due'
  return 'All phone numbers'
}

function emptyViewMessage(view: ViewFilter): string {
  if (view === 'important') return 'No phone needs action right now. Buyer replies, failed sends, and human handoffs will appear here.'
  if (view === 'replied') return 'No buyer replies yet for this batch.'
  if (view === 'waiting') return 'No phone is waiting for the first AI touch right now.'
  return 'No phone numbers match this search for the selected batch.'
}

function latestRecipientActivity(r: BatchAIRecipient): string | null {
  return r.last_message_at || r.last_event_at || r.updated_at || r.created_at || null
}

function timeValue(s?: string | null): number {
  if (!s) return 0
  const n = new Date(s).getTime()
  return Number.isFinite(n) ? n : 0
}

function compactText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function insightLeadLabel(insight?: BatchAICRMSummary): string {
  const labels = (insight?.labels || []).map((label) => label.toLowerCase())
  if (labels.some((label) => label.includes('human'))) return 'Human needed'
  if (labels.some((label) => label.includes('hot'))) return 'Hot lead'
  if (labels.some((label) => label.includes('price'))) return 'Price question'
  if (labels.some((label) => label.includes('confusion'))) return 'Needs clarity'
  return 'AI flagged'
}

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.error || e?.message || fallback
}

function softToneClass(tone: Tone): string {
  switch (tone) {
    case 'emerald':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'blue':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-300'
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-300'
    case 'rose':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-300'
    case 'violet':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/15 dark:text-violet-300'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-300'
  }
}

function solidToneClass(tone: Tone): string {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500'
    case 'blue':
      return 'bg-blue-500'
    case 'amber':
      return 'bg-amber-500'
    case 'rose':
      return 'bg-rose-500'
    case 'violet':
      return 'bg-violet-500'
    default:
      return 'bg-slate-400 dark:bg-slate-500'
  }
}

function useTickNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
