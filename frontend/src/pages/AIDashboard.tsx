import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, BarChart3, BellRing, Bot, BrainCircuit, CheckCircle2,
  Clock3, FileText, HeartHandshake, Layers, MessageSquare, MessagesSquare, Phone,
  RefreshCw, Send, Settings, ShieldCheck, Sparkles, UserCheck, Users, Zap,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import {
  Card, CardHeader, ErrorBox, GlassCard, PageHeader, SecondaryButton, Spinner,
} from '@/components/ui'
import { AIWorkflowStateBadge, workflowStateLabel } from '@/components/AIWorkflowParts'
import { api } from '@/lib/api'
import { aiKeys, getAIStatus, listAIAgents } from '@/lib/ai'
import {
  batchAIKeys, listAIHumanReview, listAIWorkflows, listBatchAICRMInsights, listBatchAIFollowups,
  type BatchAICRMSummary,
} from '@/lib/batchAI'
import { batchDisplayName, fmtRelative } from '@/lib/format'
import { getWhatsappSettings } from '@/lib/settings'
import type {
  AIHumanReviewItem, AIWorkflowState, BatchAIRecipient, UploadBatch,
} from '@/lib/types'

const DASHBOARD_LIMIT = 200

export default function AIDashboard() {
  const statusQ = useQuery({
    queryKey: aiKeys.status(),
    queryFn: () => getAIStatus(),
    staleTime: 30_000,
  })

  const whatsappQ = useQuery({
    queryKey: ['settings', 'whatsapp', 'ai-dashboard'],
    queryFn: () => getWhatsappSettings(),
    staleTime: 30_000,
  })

  const agentsQ = useQuery({
    queryKey: aiKeys.agents(),
    queryFn: listAIAgents,
    staleTime: 30_000,
  })

  const followupsQ = useQuery({
    queryKey: batchAIKeys.followups({ limit: DASHBOARD_LIMIT }),
    queryFn: () => listBatchAIFollowups({ limit: DASHBOARD_LIMIT }),
    refetchInterval: 10_000,
    staleTime: 4_000,
  })

  const humanQ = useQuery({
    queryKey: batchAIKeys.humanReview({ status: 'open', limit: 80 }),
    queryFn: () => listAIHumanReview({ status: 'open', limit: 80 }),
    refetchInterval: 10_000,
    staleTime: 4_000,
  })

  const workflowsQ = useQuery({
    queryKey: batchAIKeys.workflows({ limit: DASHBOARD_LIMIT, refresh: false }),
    queryFn: () => listAIWorkflows({ limit: DASHBOARD_LIMIT, refresh: false }),
    refetchInterval: 10_000,
    staleTime: 4_000,
  })

  const insightsQ = useQuery({
    queryKey: batchAIKeys.crmInsights(80),
    queryFn: () => listBatchAICRMInsights(80),
    staleTime: 30_000,
  })

  const batchesQ = useQuery({
    queryKey: ['batches', 'ai-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/api/batches', { params: { limit: 200 } })
      return (Array.isArray(data) ? data : (data?.items || [])) as UploadBatch[]
    },
    refetchInterval: 20_000,
    staleTime: 8_000,
  })

  const recipients = followupsQ.data?.items || []
  const humanItems = useMemo(() => dedupeHumanItems(humanQ.data?.items || []), [humanQ.data?.items])
  const workflows = workflowsQ.data?.items || []
  const insights = insightsQ.data?.items || []
  const batches = batchesQ.data || []
  const enabledAgents = (agentsQ.data || []).filter((agent) => agent.enabled)

  const dashboard = useMemo(
    () => buildDashboardModel({ batches, recipients, humanItems, workflows, insights }),
    [batches, humanItems, insights, recipients, workflows],
  )

  const refreshAll = () => {
    statusQ.refetch()
    whatsappQ.refetch()
    agentsQ.refetch()
    followupsQ.refetch()
    humanQ.refetch()
    workflowsQ.refetch()
    insightsQ.refetch()
    batchesQ.refetch()
  }

  const loading = statusQ.isLoading || whatsappQ.isLoading || agentsQ.isLoading || followupsQ.isLoading || humanQ.isLoading || workflowsQ.isLoading || batchesQ.isLoading
  const softErrors = [
    followupsQ.isError ? 'Follow-up data could not load.' : '',
    humanQ.isError ? 'Human review queue could not load.' : '',
    workflowsQ.isError ? 'Workflow states could not load.' : '',
    insightsQ.isError ? 'Batch insights could not load.' : '',
  ].filter(Boolean)

  const readinessChecks: ReadinessCheck[] = [
    {
      label: 'AI agent',
      ok: !!statusQ.data?.llm_enabled && enabledAgents.length > 0,
      detail: !statusQ.data?.llm_enabled
        ? 'Connect Bedrock/OpenAI'
        : enabledAgents.length > 0
          ? `${enabledAgents.length} enabled`
          : 'Create and enable agent',
      href: '/admin/ai/agent',
      icon: Bot,
    },
    {
      label: 'Knowledge',
      ok: !!statusQ.data?.embeddings_enabled,
      detail: statusQ.data?.embeddings_enabled ? 'Search is ready' : 'Add embedding settings',
      href: '/admin/ai/knowledge',
      icon: FileText,
    },
    {
      label: 'WhatsApp',
      ok: !!whatsappQ.data?.configured && !whatsappQ.data?.is_removed && !!whatsappQ.data?.is_verified,
      detail: whatsappQ.data?.configured
        ? (whatsappQ.data?.is_verified ? 'Credentials verified' : 'Test credentials')
        : 'Connect Meta credentials',
      href: '/admin/messages/bulk/credentials',
      icon: Phone,
    },
    {
      label: 'Live batches',
      ok: dashboard.activeBatchCount > 0,
      detail: dashboard.activeBatchCount > 0
        ? `${dashboard.activeBatchCount} active`
        : 'Enable AI on a batch',
      href: '/admin/ai/followups',
      icon: Layers,
    },
  ]

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="AI Dashboard"
        subtitle="The shortest useful view: what needs action, what AI is handling, and whether setup is ready."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <QuickLink to="/admin/ai/followups" icon={BellRing}>Follow-ups</QuickLink>
            <QuickLink to="/admin/ai/users" icon={Users}>Users</QuickLink>
            <QuickLink to="/admin/ai/human-review" icon={UserCheck}>Human review</QuickLink>
            <SecondaryButton onClick={refreshAll}>
              <RefreshCw className={`h-4 w-4 ${isFetching([statusQ, whatsappQ, agentsQ, followupsQ, humanQ, workflowsQ, insightsQ, batchesQ]) ? 'animate-spin' : ''}`} />
              Refresh
            </SecondaryButton>
          </div>
        }
      />

      {softErrors.length > 0 && (
        <div className="mb-4">
          <ErrorBox msg={`${softErrors.join(' ')} Showing whatever is available.`} />
        </div>
      )}

      <GlassCard className="mb-5 overflow-hidden !p-0">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.75fr)]">
          <div className="p-5 lg:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                Today
              </div>
              {dashboard.chips.slice(0, 2).map((chip) => (
                <StatusChip key={chip.label} tone={chip.tone} icon={chip.icon}>
                  {chip.label}
                </StatusChip>
              ))}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.6fr)] lg:items-end">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-3xl">
                  {dashboard.headline}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {dashboard.brief}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/25">
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${dashboard.nextMove.iconClass}`}>
                    <dashboard.nextMove.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Next action</div>
                    <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                      {dashboard.nextMove.title}
                    </div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {dashboard.nextMove.detail}
                </p>
                <Link
                  to={dashboard.nextMove.href}
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>

          <ReadinessPanel checks={readinessChecks} loading={loading} />
        </div>
      </GlassCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {dashboard.kpis.map((kpi, index) => (
          <MetricCard key={kpi.label} {...kpi} index={index} />
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
        <PriorityPanel items={dashboard.priorityItems} loading={humanQ.isLoading} />
        <BatchHealthPanel rows={dashboard.batchRows} loading={batchesQ.isLoading || followupsQ.isLoading} />
      </div>
    </div>
  )
}

function ReadinessPanel({ checks, loading }: { checks: ReadinessCheck[]; loading: boolean }) {
  const ready = checks.filter((check) => check.ok).length
  return (
    <div className="border-t border-slate-200 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-slate-950/25 xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Setup readiness</div>
          <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
            {ready}/{checks.length} ready
          </div>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${ready === checks.length ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'}`}>
          {ready === checks.length ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
      </div>

      {loading ? (
        <div className="mt-5"><Spinner /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {checks.map((check) => (
            <Link
              key={check.label}
              to={check.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${check.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}>
                  <check.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">{check.label}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{check.detail}</div>
                </div>
              </div>
              {check.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function PriorityPanel({ items, loading }: { items: PriorityItem[]; loading: boolean }) {
  return (
    <Card hover={false} className="overflow-hidden">
      <CardHeader
        title={<SectionTitle icon={Zap}>Priority queue</SectionTitle>}
        subtitle="Only buyers that need attention now. Everything else stays quiet."
        right={<Link className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300" to="/admin/ai/human-review">View all</Link>}
      />
      <div className="max-h-[560px] overflow-y-auto p-4">
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No urgent buyer needs review"
            text="AI can keep working. This page will surface hot leads, complaints, low confidence replies, and failed sends when they appear."
          />
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.025 }}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${severityTone(item.severity)}`}>
                        {item.severity}
                      </span>
                      <span className="text-sm font-semibold text-slate-950 dark:text-white">{item.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{item.phone}</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                      {item.reason}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                      {item.detail}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtRelative(item.at)}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 dark:bg-slate-950/35">
                  <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-white">AI suggests:</span> {item.action}
                  </div>
                  <Link className="shrink-0 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300" to={item.href}>
                    Open chat
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function WorkflowPanel({
  workflows, stats, loading,
}: {
  workflows: AIWorkflowState[]
  stats?: { total?: number; new?: number; ai_talking?: number; buyer_replied?: number; needs_human?: number; followup_scheduled?: number; paused?: number; closed?: number; avg_confidence_score?: number }
  loading: boolean
}) {
  const lanes = [
    { state: 'new', value: stats?.new || 0 },
    { state: 'ai_talking', value: stats?.ai_talking || 0 },
    { state: 'buyer_replied', value: stats?.buyer_replied || 0 },
    { state: 'needs_human', value: stats?.needs_human || 0 },
    { state: 'followup_scheduled', value: stats?.followup_scheduled || 0 },
    { state: 'paused', value: stats?.paused || 0 },
  ]
  const recent = workflows
    .slice()
    .sort((a, b) => timeValue(b.last_message_at || b.updated_at) - timeValue(a.last_message_at || a.updated_at))
    .slice(0, 5)

  return (
    <Card hover={false}>
      <CardHeader
        title={<SectionTitle icon={BrainCircuit}>Workflow intelligence</SectionTitle>}
        subtitle="Per-phone state, confidence, and the next visible reason."
        right={<Link className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300" to="/admin/ai/followups">Manage</Link>}
      />
      <div className="p-4">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {lanes.map((lane) => (
                <div key={lane.state} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{workflowStateLabel(lane.state)}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{lane.value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Average confidence</div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {stats?.avg_confidence_score ? `${Math.round(stats.avg_confidence_score)}%` : 'No score yet'}
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
                  style={{ width: `${Math.min(100, Math.max(0, stats?.avg_confidence_score || 0))}%` }}
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {recent.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="No workflow signals yet"
                  text="Once AI replies or follow-ups run, phone-level states and reasons will appear here."
                  compact
                />
              ) : recent.map((w) => (
                <Link
                  key={w.id}
                  to={`/admin/ai/followups/recipients/${w.batch_ai_recipient_id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">{w.retailer_name || w.phone}</div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{w.next_action || w.state_reason}</div>
                    </div>
                    <AIWorkflowStateBadge state={w.state} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function BatchHealthPanel({ rows, loading }: { rows: BatchRow[]; loading: boolean }) {
  return (
    <Card hover={false} className="overflow-hidden">
      <CardHeader
        title={<SectionTitle icon={Layers}>Batch health</SectionTitle>}
        subtitle="Which batches are live, warm, blocked, or waiting for the first touch."
        right={<Link className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300" to="/admin/ai/followups">Open setup</Link>}
      />
      <div className="max-h-[560px] overflow-y-auto p-4">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No AI batches yet"
            text="Enable AI on a batch to start seeing lead movement, replies, and next touches here."
          />
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.025 }}
                className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/ai/followups/${row.id}`} className="truncate text-sm font-semibold text-slate-950 hover:text-emerald-600 dark:text-white dark:hover:text-emerald-300">
                        {row.name}
                      </Link>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}>
                        {row.enabled ? 'AI on' : row.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {row.tracked.toLocaleString()} tracked - {row.replies.toLocaleString()} buyer replies - {row.needsAction.toLocaleString()} needs action
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtRelative(row.lastActivity || row.createdAt)}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-lg border border-slate-200 dark:border-white/10">
                  <MiniLane label="Warm" value={row.replies} tone="emerald" />
                  <MiniLane label="Action" value={row.needsAction} tone="rose" />
                  <MiniLane label="Cadence" value={row.inCadence} tone="blue" />
                  <MiniLane label="Failed" value={row.failed} tone="amber" />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="line-clamp-1 text-xs text-slate-600 dark:text-slate-300">{row.recommendation}</div>
                  <Link className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300" to={`/admin/ai/ai-followup-crm/${row.id}`}>
                    Details
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function SystemHealthPanel({
  loading, llm, embeddings, whatsappConfigured, whatsappVerified, activeBatches, knowledgeReady,
}: {
  loading: boolean
  llm: boolean
  embeddings: boolean
  whatsappConfigured: boolean
  whatsappVerified: boolean
  activeBatches: number
  knowledgeReady: boolean
}) {
  const rows = [
    {
      label: 'LLM replies',
      ok: llm,
      detail: llm ? 'Agent can generate replies' : 'Configure Bedrock/OpenAI',
      href: '/admin/ai/agent',
      icon: Bot,
    },
    {
      label: 'Knowledge search',
      ok: embeddings && knowledgeReady,
      detail: embeddings ? 'Embeddings are ready' : 'Add embedding key/model',
      href: '/admin/ai/knowledge',
      icon: FileText,
    },
    {
      label: 'WhatsApp send',
      ok: whatsappConfigured && whatsappVerified,
      detail: whatsappConfigured ? (whatsappVerified ? 'Credentials verified' : 'Test credentials') : 'Connect Meta credentials',
      href: '/admin/messages/bulk/credentials',
      icon: Phone,
    },
    {
      label: 'Active batches',
      ok: activeBatches > 0,
      detail: activeBatches > 0 ? `${activeBatches} batch${activeBatches === 1 ? '' : 'es'} live` : 'Enable AI on a batch',
      href: '/admin/ai/followups',
      icon: Layers,
    },
  ]
  return (
    <Card hover={false}>
      <CardHeader
        title={<SectionTitle icon={Settings}>System health</SectionTitle>}
        subtitle="Small checks that explain why AI may or may not reply."
      />
      <div className="p-4">
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <Link
                key={row.label}
                to={row.href}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${row.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'}`}>
                    <row.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">{row.label}</div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">{row.detail}</div>
                  </div>
                </div>
                {row.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function MetricCard({
  label, value, sub, icon: Icon, tone, index,
}: Metric & { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025 }}
      className={`rounded-2xl border p-4 shadow-sm ${metricTone(tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value.toLocaleString()}</div>
          <div className="mt-1 text-xs opacity-75">{sub}</div>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/70 shadow-sm dark:bg-white/10">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </motion.div>
  )
}

function QuickLink({ to, icon: Icon, children }: { to: string; icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-emerald-500" />
      {children}
    </span>
  )
}

function StatusChip({ tone, icon: Icon, children }: { tone: Tone; icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipTone(tone)}`}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}

function EmptyState({
  icon: Icon, title, text, compact = false,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  text: string
  compact?: boolean
}) {
  return (
    <div className={`rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center dark:border-white/10 dark:bg-white/[0.03] ${compact ? 'p-4' : 'p-8'}`}>
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-400 shadow-sm dark:bg-white/10">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}

function MiniLane({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className={`p-2 text-center ${miniLaneTone(tone)}`}>
      <div className="text-sm font-semibold">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
    </div>
  )
}

type Tone = 'emerald' | 'blue' | 'rose' | 'amber' | 'violet' | 'slate'

interface Metric {
  label: string
  value: number
  sub: string
  icon: ComponentType<{ className?: string }>
  tone: Tone
}

interface ReadinessCheck {
  label: string
  ok: boolean
  detail: string
  href: string
  icon: ComponentType<{ className?: string }>
}

interface PriorityItem {
  key: string
  name: string
  phone: string
  reason: string
  detail: string
  action: string
  severity: string
  at?: string | null
  href: string
}

interface BatchRow {
  id: number
  name: string
  status: string
  enabled: boolean
  tracked: number
  replies: number
  needsAction: number
  inCadence: number
  failed: number
  recommendation: string
  createdAt?: string | null
  lastActivity?: string | null
}

function buildDashboardModel({
  batches, recipients, humanItems, workflows, insights,
}: {
  batches: UploadBatch[]
  recipients: BatchAIRecipient[]
  humanItems: AIHumanReviewItem[]
  workflows: AIWorkflowState[]
  insights: BatchAICRMSummary[]
}) {
  const workflowStats = countWorkflowStates(workflows)
  const recipientCounts = countRecipients(recipients)
  const activeBatchCount = batches.filter((b) => b.ai_followup_enabled).length || new Set(recipients.map((r) => r.batch_id)).size
  const buyerReplies = workflowStats.buyer_replied || recipients.filter((r) => r.last_message_direction === 'in').length
  const needsHuman = humanItems.length || workflowStats.needs_human || recipientCounts.handed_off || 0
  const scheduled = workflowStats.followup_scheduled || recipientCounts.pending || 0
  const failed = recipientCounts.failed || humanItems.filter((item) => item.reason_code === 'send_failed').length
  const aiTalking = workflowStats.ai_talking || recipientCounts.active || 0
  const tracked = recipients.length || workflows.length

  const headline = needsHuman > 0
    ? `${needsHuman} buyer${needsHuman === 1 ? '' : 's'} need a human look`
    : tracked > 0
      ? 'AI is watching the sales floor'
      : 'Set up AI follow-ups to start the command center'

  const brief = needsHuman > 0
    ? 'The urgent queue is intentionally small. Handle these buyers first, then let AI continue the normal cadence.'
    : tracked > 0
      ? 'No urgent blocker is visible. AI can continue answering buyers, scheduling nudges, and logging the reason behind each move.'
      : 'Once a batch has AI enabled, this page will show priority buyers, batch health, workflow states, and system readiness.'

  const nextMove = getNextMove({ needsHuman, failed, buyerReplies, activeBatchCount, tracked })
  const priorityItems = buildPriorityItems(humanItems, workflows)
  const batchRows = buildBatchRows(batches, recipients, insights, humanItems)

  const kpis: Metric[] = [
    {
      label: 'Tracked phones',
      value: tracked,
      sub: `${activeBatchCount.toLocaleString()} active AI batch${activeBatchCount === 1 ? '' : 'es'}`,
      icon: Phone,
      tone: 'blue',
    },
    {
      label: 'AI talking',
      value: aiTalking,
      sub: 'being handled by the agent',
      icon: Bot,
      tone: 'emerald',
    },
    {
      label: 'Buyer replies',
      value: buyerReplies,
      sub: 'warm conversations',
      icon: MessageSquare,
      tone: 'violet',
    },
    {
      label: 'Needs human',
      value: needsHuman,
      sub: failed > 0 ? `${failed} failed send${failed === 1 ? '' : 's'}` : 'kept minimal by confidence gate',
      icon: UserCheck,
      tone: needsHuman > 0 ? 'rose' : 'slate',
    },
    {
      label: 'Scheduled',
      value: scheduled,
      sub: 'waiting on cadence',
      icon: Clock3,
      tone: 'amber',
    },
  ]

  const chips = [
    {
      label: needsHuman > 0 ? 'Action required' : 'No urgent review',
      tone: needsHuman > 0 ? 'rose' as Tone : 'emerald' as Tone,
      icon: needsHuman > 0 ? AlertTriangle : ShieldCheck,
    },
    {
      label: `${buyerReplies.toLocaleString()} buyer repl${buyerReplies === 1 ? 'y' : 'ies'}`,
      tone: 'violet' as Tone,
      icon: MessagesSquare,
    },
    {
      label: `${scheduled.toLocaleString()} scheduled touch${scheduled === 1 ? '' : 'es'}`,
      tone: 'amber' as Tone,
      icon: Send,
    },
    {
      label: `${activeBatchCount.toLocaleString()} AI batch${activeBatchCount === 1 ? '' : 'es'}`,
      tone: 'blue' as Tone,
      icon: Layers,
    },
  ]

  return {
    headline,
    brief,
    nextMove,
    priorityItems,
    batchRows,
    kpis,
    chips,
    activeBatchCount,
  }
}

function getNextMove({
  needsHuman, failed, buyerReplies, activeBatchCount, tracked,
}: {
  needsHuman: number
  failed: number
  buyerReplies: number
  activeBatchCount: number
  tracked: number
}) {
  if (failed > 0) {
    return {
      title: 'Fix failed sends first',
      detail: 'Failed WhatsApp sends block revenue. Open human review, inspect the error, then retry only the affected phones.',
      href: '/admin/ai/human-review',
      icon: AlertTriangle,
      iconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    }
  }
  if (needsHuman > 0) {
    return {
      title: 'Clear the urgent queue',
      detail: 'A few buyers need a human. Open the queue, use AI help for a draft, and hand back to AI when the issue is resolved.',
      href: '/admin/ai/human-review',
      icon: UserCheck,
      iconClass: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    }
  }
  if (buyerReplies > 0) {
    return {
      title: 'Review warm replies',
      detail: 'Buyers have replied. Open follow-ups to inspect their timelines and make sure the next planned message still makes sense.',
      href: '/admin/ai/followups',
      icon: HeartHandshake,
      iconClass: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    }
  }
  if (activeBatchCount === 0 || tracked === 0) {
    return {
      title: 'Enable your first AI batch',
      detail: 'Pick a batch, choose the agent behavior, and let the dashboard start tracking phone-level states.',
      href: '/admin/ai/followups',
      icon: Sparkles,
      iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    }
  }
  return {
    title: 'Keep monitoring quietly',
    detail: 'Nothing is blocking right now. Let AI continue and revisit this page when a buyer replies or confidence drops.',
    href: '/admin/ai/conversations',
    icon: CheckCircle2,
    iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  }
}

function buildPriorityItems(humanItems: AIHumanReviewItem[], workflows: AIWorkflowState[]): PriorityItem[] {
  const items: PriorityItem[] = humanItems.map((item) => ({
    key: `review-${item.id}`,
    name: item.retailer_name || item.phone,
    phone: item.phone,
    reason: item.reason_label || humanize(item.reason_code || 'Needs review'),
    detail: item.last_message_preview || item.reason_detail || item.ai_summary || 'Open the thread to inspect recent context.',
    action: item.ai_next_action || item.suggested_action || item.ai_suggested_reply || 'Open the timeline and reply as a human.',
    severity: item.severity || 'medium',
    at: item.last_message_at || item.last_event_at || item.updated_at,
    href: `/admin/ai/followups/recipients/${item.batch_ai_recipient_id}`,
  }))

  const existingPhones = new Set(items.map((item) => normalizePhone(item.phone)))
  for (const workflow of workflows) {
    const key = normalizePhone(workflow.phone)
    if (existingPhones.has(key)) continue
    if (workflow.state !== 'needs_human' && workflow.risk_level !== 'critical' && workflow.risk_level !== 'high') continue
    items.push({
      key: `workflow-${workflow.id}`,
      name: workflow.retailer_name || workflow.phone,
      phone: workflow.phone,
      reason: workflow.state_label || workflowStateLabel(workflow.state),
      detail: workflow.state_reason || workflow.next_message_preview || 'Workflow risk is elevated.',
      action: workflow.next_action || 'Open the timeline before the next AI reply.',
      severity: workflow.risk_level || 'medium',
      at: workflow.last_message_at || workflow.last_event_at || workflow.updated_at,
      href: `/admin/ai/followups/recipients/${workflow.batch_ai_recipient_id}`,
    })
  }

  return items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || timeValue(b.at) - timeValue(a.at))
}

function buildBatchRows(
  batches: UploadBatch[],
  recipients: BatchAIRecipient[],
  insights: BatchAICRMSummary[],
  humanItems: AIHumanReviewItem[],
): BatchRow[] {
  const byBatch = new Map<number, BatchAIRecipient[]>()
  for (const r of recipients) {
    if (!byBatch.has(r.batch_id)) byBatch.set(r.batch_id, [])
    byBatch.get(r.batch_id)!.push(r)
  }
  const insightByBatch = new Map<number, BatchAICRMSummary>()
  for (const insight of insights) {
    if (insight.batch_id != null) insightByBatch.set(insight.batch_id, insight)
  }
  const reviewCounts = new Map<number, number>()
  for (const item of humanItems) {
    if (item.batch_id != null) reviewCounts.set(item.batch_id, (reviewCounts.get(item.batch_id) || 0) + 1)
  }

  const ids = new Set<number>()
  for (const b of batches) {
    if (b.ai_followup_enabled || ['approved', 'sending', 'completed'].includes(b.status)) ids.add(b.id)
  }
  for (const batchId of byBatch.keys()) ids.add(batchId)

  const rows: BatchRow[] = []
  for (const id of ids) {
    const batch = batches.find((b) => b.id === id)
    const recs = byBatch.get(id) || []
    const counts = countRecipients(recs)
    const insight = insightByBatch.get(id)
    const replies = recs.filter((r) => r.last_message_direction === 'in').length
    const needsAction = (reviewCounts.get(id) || 0) + (counts.failed || 0) + (counts.handed_off || 0)
    const inCadence = (counts.active || 0) + (counts.pending || 0)
    const lastActivity = recs
      .map((r) => r.last_message_at || r.last_event_at || r.updated_at)
      .sort((a, b) => timeValue(b) - timeValue(a))[0]

    rows.push({
      id,
      name: batch ? batchDisplayName(batch) : `Batch #${id}`,
      status: batch?.status || 'tracked',
      enabled: !!batch?.ai_followup_enabled || recs.length > 0,
      tracked: recs.length || batch?.valid_rows || 0,
      replies,
      needsAction,
      inCadence,
      failed: counts.failed || 0,
      recommendation: getBatchRecommendation({ insight, needsAction, replies, inCadence, enabled: !!batch?.ai_followup_enabled || recs.length > 0 }),
      createdAt: batch?.created_at,
      lastActivity,
    })
  }
  return rows.sort((a, b) => {
    const priority = (row: BatchRow) => row.needsAction * 10 + row.replies * 3 + (row.enabled ? 1 : 0)
    return priority(b) - priority(a) || timeValue(b.lastActivity || b.createdAt) - timeValue(a.lastActivity || a.createdAt)
  })
}

function getBatchRecommendation({
  insight, needsAction, replies, inCadence, enabled,
}: {
  insight?: BatchAICRMSummary
  needsAction: number
  replies: number
  inCadence: number
  enabled: boolean
}) {
  if (insight?.recommended_action) return insight.recommended_action
  if (!enabled) return 'Enable AI when this batch is ready.'
  if (needsAction > 0) return 'Open urgent phones before the next automated message.'
  if (replies > 0) return 'Warm replies are visible; check timelines before changing cadence.'
  if (inCadence > 0) return 'AI is moving these phones through cadence.'
  return 'Waiting for the first useful buyer signal.'
}

function countRecipients(recipients: BatchAIRecipient[]) {
  return recipients.reduce<Record<string, number>>((acc, recipient) => {
    acc[recipient.ai_status] = (acc[recipient.ai_status] || 0) + 1
    return acc
  }, {})
}

function countWorkflowStates(workflows: AIWorkflowState[]) {
  return workflows.reduce<Record<string, number>>((acc, workflow) => {
    acc[workflow.state] = (acc[workflow.state] || 0) + 1
    return acc
  }, {})
}

function dedupeHumanItems(items: AIHumanReviewItem[]) {
  const best = new Map<string, AIHumanReviewItem>()
  for (const item of items) {
    const key = normalizePhone(item.phone) || String(item.id)
    const prev = best.get(key)
    if (!prev || severityRank(item.severity) > severityRank(prev.severity) || timeValue(item.updated_at) > timeValue(prev.updated_at)) {
      best.set(key, item)
    }
  }
  return Array.from(best.values())
}

function isFetching(queries: Array<{ isFetching?: boolean }>) {
  return queries.some((q) => q.isFetching)
}

function severityRank(severity?: string) {
  switch (severity) {
    case 'critical': return 4
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

function normalizePhone(phone?: string) {
  return (phone || '').replace(/\D/g, '')
}

function timeValue(value?: string | null) {
  if (!value) return 0
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function humanize(value: string) {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function severityTone(severity?: string) {
  switch (severity) {
    case 'critical': return 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200'
    case 'high': return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
    case 'medium': return 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200'
    default: return 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  }
}

function metricTone(tone: Tone) {
  switch (tone) {
    case 'emerald': return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-100'
    case 'blue': return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-100'
    case 'rose': return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-100'
    case 'amber': return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-100'
    case 'violet': return 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-400/20 dark:bg-violet-500/15 dark:text-violet-100'
    default: return 'border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white'
  }
}

function chipTone(tone: Tone) {
  switch (tone) {
    case 'emerald': return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-200'
    case 'blue': return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-200'
    case 'rose': return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-200'
    case 'amber': return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-200'
    case 'violet': return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/15 dark:text-violet-200'
    default: return 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200'
  }
}

function miniLaneTone(tone: Tone) {
  switch (tone) {
    case 'emerald': return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
    case 'blue': return 'bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200'
    case 'rose': return 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'
    case 'amber': return 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
    default: return 'bg-slate-50 text-slate-800 dark:bg-white/[0.05] dark:text-slate-200'
  }
}
