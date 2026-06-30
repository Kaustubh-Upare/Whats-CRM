import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, Bot, CalendarClock, CheckCircle2,
  BookOpen, Brain, ClipboardList,
  Clock3, Edit, ExternalLink, FileText, MessageSquare, Pause, Play,
  Power, RefreshCw, RotateCcw, Route, Search, Send, Settings, Sparkles, UploadCloud,
  UserRound, Users, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton,
  SecondaryButton, Spinner, TextArea,
} from '@/components/ui'
import { batchDisplayName, fmtDate, fmtRelative } from '@/lib/format'
import {
  AIFollowupLastMessage, AIFollowupStatusBadge, AIFollowupStatusCounts,
  humanizeAIFollowupStatus,
} from '@/components/AIFollowupParts'
import {
  AIDecisionLogList, AIWorkflowCard, AIWorkflowSummaryCards,
} from '@/components/AIWorkflowParts'
import {
  batchAIKeys, clearBatchAINextMessage, excludeBatchAIRecipient, generateBatchAINextMessage, getBatchAgent,
  generateBatchAIRecipientWorkflowBrief, getBatchAIFollowup, getBatchAIRecipient, getBatchAIRecipientWorkflow, includeBatchAIRecipient, listAIWorkflows,
  listBatchAIRecipientAudit,
  pauseBatchAIRecipient, preflightBatchAIFollowupDuplicates, putBatchAIFollowup,
  resumeBatchAIRecipient,
  saveBatchAINextMessage, sendNextBatchAIStep, setBatchAgent,
  startBatchAIFollowupSequence,
  type SaveNextMessageBody, type UpdatePlanBody, updateBatchAIRecipientPlan,
} from '@/lib/batchAI'
import DuplicatePhonesWarningModal from '@/components/DuplicatePhonesWarningModal'
import {
  aiKeys, getConversationMessages, listAIAgents, searchKB,
} from '@/lib/ai'
import type {
  AIAgentConfig, AIConversationMessage, AuditLog, BatchAIFollowup, BatchAIFollowupDuplicate,
  BatchAIRecipient, BatchAIRecipientDetail, BatchFollowupConfig, EffectiveAIAgent,
  FollowupBehavior, FollowupEnrollmentRow, FollowupTone, RetrievedChunk,
  StartBatchFollowupOpts, UploadBatch, AIWorkflowState,
} from '@/lib/types'

type StatusFilter = 'all' | 'pending' | 'active' | 'failed' | 'handed_off' | 'excluded' | 'opted_out' | 'disabled'
type TimelineTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'

type TimelineItem = {
  key: string
  at?: string | null
  title: string
  body?: string
  meta?: string
  icon: JSX.Element
  tone: TimelineTone
}

type NextMessageEditorSave = {
  plan: UpdatePlanBody
  nextMessage?: SaveNextMessageBody
  clearNextMessage?: boolean
}

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'handed_off', label: 'Handed off' },
  { key: 'excluded', label: 'Excluded' },
  { key: 'opted_out', label: 'Opted out' },
  { key: 'disabled', label: 'Disabled' },
]

const emptyFollowupOpts: StartBatchFollowupOpts = { excludePhones: [], overridePhones: [] }

export default function BatchAIFollowup() {
  const { id } = useParams<{ id: string }>()
  const batchID = parseInt(id || '0', 10)
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedRecipientId, setSelectedRecipientId] = useState<number | null>(null)
  const [batchPlanOpen, setBatchPlanOpen] = useState(false)
  const [checkingPlan, setCheckingPlan] = useState(false)
  const [noValidPlan, setNoValidPlan] = useState<string | null>(null)
  const [readyReviewCount, setReadyReviewCount] = useState<number | null>(null)
  const [pendingPlanOpts, setPendingPlanOpts] = useState<StartBatchFollowupOpts>(emptyFollowupOpts)
  const [editPlanOpen, setEditPlanOpen] = useState(false)
  const [sendNextConfirm, setSendNextConfirm] = useState<BatchAIRecipientDetail | null>(null)

  const followupQ = useQuery({
    queryKey: batchAIKeys.followup(batchID),
    queryFn: () => getBatchAIFollowup(batchID),
    enabled: batchID > 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    retry: false,
  })

  const batchQ = useQuery({
    queryKey: ['batch', String(batchID)],
    queryFn: async () => {
      const { data } = await api.get(`/api/batches/${batchID}`)
      return (data?.batch ?? null) as UploadBatch | null
    },
    enabled: batchID > 0,
    refetchInterval: 15_000,
    retry: false,
  })

  // Effective agent for this batch (Phase 8 multi-agent). Returns the
  // batch override when set, otherwise the global default. The source
  // string lets the UI render "(overrides default)" vs
  // "(using global default)" so the operator is never confused about
  // which agent is actually live.
  const effectiveAgentQ = useQuery({
    queryKey: batchAIKeys.agent(batchID),
    queryFn: () => getBatchAgent(batchID),
    enabled: batchID > 0,
    staleTime: 10_000,
    retry: false,
  })
  // Full agent list — drives the override dropdown.
  const agentsListQ = useQuery({
    queryKey: aiKeys.agents(),
    queryFn: listAIAgents,
    enabled: batchID > 0,
    staleTime: 30_000,
    retry: false,
  })
  // Legacy alias kept so the rest of the file (which references
  // agentQ.data?.enabled for the "global agent disabled" warning) keeps
  // working without a rename pass.
  const agentQ = effectiveAgentQ

  const data: BatchAIFollowup | undefined = followupQ.data
  const recipients: BatchAIRecipient[] = data?.recipients ?? []
  const counts = data?.recipients_by_status ?? {}
  const total = data?.recipients_total ?? recipients.length
  const enabled = !!data?.enabled
  const batchStatus = data?.batch_status ?? batchQ.data?.status ?? ''

  const filteredRecipients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recipients.filter((r) => {
      if (statusFilter !== 'all' && r.ai_status !== statusFilter) return false
      if (!q) return true
      const haystack = [
        r.retailer_name || '',
        r.whatsapp_number || '',
        r.last_message_preview || '',
        r.last_event || '',
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [recipients, search, statusFilter])

  useEffect(() => {
    if (filteredRecipients.length === 0) return
    if (!selectedRecipientId || !filteredRecipients.some((r) => r.id === selectedRecipientId)) {
      setSelectedRecipientId(filteredRecipients[0].id)
    }
  }, [filteredRecipients, selectedRecipientId])

  const selectedQ = useQuery({
    queryKey: selectedRecipientId ? batchAIKeys.recipient(selectedRecipientId) : ['batch-ai-recipient', 'none'],
    queryFn: () => getBatchAIRecipient(selectedRecipientId!),
    enabled: !!selectedRecipientId,
    refetchInterval: 5_000,
    retry: false,
  })

  const conversationID = selectedQ.data?.conversation?.id
  const messagesQ = useQuery({
    queryKey: conversationID ? aiKeys.messages(conversationID) : ['ai', 'conversations', 'none', 'messages'],
    queryFn: () => getConversationMessages(conversationID!),
    enabled: !!conversationID,
    refetchInterval: 5_000,
    retry: false,
  })

  const auditQ = useQuery({
    queryKey: selectedRecipientId ? batchAIKeys.audit(selectedRecipientId) : ['batch-ai-recipient', 'none', 'audit'],
    queryFn: () => listBatchAIRecipientAudit(selectedRecipientId!, 20),
    enabled: !!selectedRecipientId,
    refetchInterval: 15_000,
    retry: false,
  })

  const workflowListQ = useQuery({
    queryKey: batchAIKeys.workflows({ batch_id: batchID, limit: 200 }),
    queryFn: () => listAIWorkflows({ batch_id: batchID, limit: 200 }),
    enabled: batchID > 0,
    refetchInterval: 20_000,
    retry: false,
  })

  const selectedWorkflowQ = useQuery({
    queryKey: selectedRecipientId ? batchAIKeys.workflow(selectedRecipientId) : ['batch-ai-recipient', 'none', 'workflow'],
    queryFn: () => getBatchAIRecipientWorkflow(selectedRecipientId!),
    enabled: !!selectedRecipientId,
    refetchInterval: 5_000,
    retry: false,
  })

  const workflowBriefMut = useMutation({
    mutationFn: (recipientId: number) => generateBatchAIRecipientWorkflowBrief(recipientId, { history_limit: 20 }),
    onSuccess: (state, recipientId) => {
      toast.success('AI workflow brief updated')
      qc.setQueryData(batchAIKeys.workflow(recipientId), state)
      qc.invalidateQueries({ queryKey: batchAIKeys.decisions(recipientId, 20) })
      qc.invalidateQueries({ queryKey: ['ai', 'workflows'] })
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to generate AI workflow brief')),
  })

  const selected = selectedQ.data
  const selectedMessages = messagesQ.data ?? []
  const selectedAudit = auditQ.data ?? []
  const knowledgeSearchText = useMemo(
    () => buildKnowledgeSearchText(selected, selectedMessages),
    [selected, selectedMessages],
  )
  const knowledgeQ = useQuery({
    queryKey: ['ai', 'kb', 'batch-recipient', batchID, selectedRecipientId, knowledgeSearchText],
    queryFn: () => searchKB({ query: knowledgeSearchText, top_k: 5 }),
    enabled: !!selected && knowledgeSearchText.trim().length > 0,
    staleTime: 30_000,
    retry: false,
  })

  function invalidateBatch(recipientId?: number | null) {
    qc.invalidateQueries({ queryKey: batchAIKeys.followup(batchID) })
    qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
    qc.invalidateQueries({ queryKey: ['ai', 'workflows'] })
    if (recipientId) {
      qc.invalidateQueries({ queryKey: batchAIKeys.recipient(recipientId) })
      qc.invalidateQueries({ queryKey: batchAIKeys.audit(recipientId) })
      qc.invalidateQueries({ queryKey: batchAIKeys.workflow(recipientId) })
    }
    if (conversationID) {
      qc.invalidateQueries({ queryKey: aiKeys.messages(conversationID) })
    }
  }

  const toggleMut = useMutation({
    mutationFn: (next: boolean) => putBatchAIFollowup(batchID, next),
    onSuccess: (_, next) => {
      toast.success(next ? 'AI enabled for this batch' : 'AI disabled for this batch')
      invalidateBatch(selectedRecipientId)
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to update AI follow-up')),
  })

  // Phase 9 — duplicate-resolution flow. The "Create batch plan"
// modal goes through the same preflight + conflict modal as the
// /admin/ai/followups "Enable AI" path. The original code bypassed
// the preflight entirely (passing exclude_phones: []), which silently
// created parallel enrollments for any phone already enrolled on
// another batch. Now we always preflight first.
const [dupStage, setDupStage] = useState<null | {
  duplicates: BatchAIFollowupDuplicate[]
  freshCount: number
}>(null)

const planSeqMut = useMutation({
  mutationFn: ({ config, opts }: { config: BatchFollowupConfig; opts: StartBatchFollowupOpts }) =>
    startBatchAIFollowupSequence(batchID, config, opts),
  onSuccess: (d, vars) => {
    const parts: string[] = []
    if (d.count > 0) {
      parts.push(`Created batch AI plan for ${d.count} recipient${d.count === 1 ? '' : 's'}`)
    } else {
      parts.push('Batch AI plan saved')
    }
    const ops = vars.opts.excludePhones.length + vars.opts.overridePhones.length
    if (ops > 0) {
      const bits: string[] = []
      if (vars.opts.excludePhones.length > 0) bits.push(`excluded ${vars.opts.excludePhones.length}`)
      if (vars.opts.overridePhones.length > 0) bits.push(`overrode ${vars.opts.overridePhones.length}`)
      parts.push(`(${bits.join(', ')} duplicate${ops === 1 ? '' : 's'})`)
    }
    toast.success(parts.join(' '))
    setBatchPlanOpen(false)
    setDupStage(null)
    setPendingPlanOpts(emptyFollowupOpts)
    invalidateBatch(selectedRecipientId)
  },
  onError: (e: any) => {
    if (e?.response?.status === 422 && e?.response?.data?.error === 'no_valid_recipients') {
      setNoValidPlan(e?.response?.data?.message || 'This batch has no valid WhatsApp numbers to track.')
      return
    }
    toast.error(apiError(e, 'Failed to create batch AI plan'))
  },
})

async function openBatchPlanFlow() {
  setCheckingPlan(true)
  try {
    const dups = await preflightBatchAIFollowupDuplicates(batchID)
    setCheckingPlan(false)
    if (dups.total > 0) {
      setDupStage({ duplicates: dups.duplicates, freshCount: dups.fresh_count })
    } else if (dups.fresh_count <= 0) {
      setNoValidPlan('This batch has no valid WhatsApp numbers to track, so the AI agent will not see any recipients.')
    } else {
      setReadyReviewCount(dups.fresh_count)
    }
  } catch (e: any) {
    setCheckingPlan(false)
    toast.error(apiError(e, 'Failed to check for duplicate phones'))
  }
}

function handlePlanSave(cfg: BatchFollowupConfig) {
  planSeqMut.mutate({ config: cfg, opts: pendingPlanOpts })
}

  const recipientStatusMut = useMutation({
    mutationFn: async ({ recipientId, target }: { recipientId: number; target: 'exclude' | 'include' }) => {
      if (target === 'exclude') return excludeBatchAIRecipient(recipientId)
      return includeBatchAIRecipient(recipientId)
    },
    onSuccess: (_, vars) => {
      toast.success(vars.target === 'exclude' ? 'Recipient excluded from AI' : 'Recipient included again')
      invalidateBatch(vars.recipientId)
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to update recipient status')),
  })

  const recipientActionMut = useMutation({
    mutationFn: async ({ recipientId, action }: { recipientId: number; action: 'pause' | 'resume' | 'send-next' }) => {
      if (action === 'pause') return pauseBatchAIRecipient(recipientId, {
        reason: 'admin_paused',
        detail: 'paused from batch AI control page',
      })
      if (action === 'resume') return resumeBatchAIRecipient(recipientId)
      return sendNextBatchAIStep(recipientId)
    },
    onSuccess: (_, vars) => {
      const label = vars.action === 'pause'
        ? 'Follow-up paused'
        : vars.action === 'resume'
          ? 'Follow-up resumed'
          : 'Next AI step queued'
      toast.success(label)
      if (vars.action === 'send-next') {
        setSendNextConfirm(null)
      }
      invalidateBatch(vars.recipientId)
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to update follow-up')),
  })

  const planMut = useMutation({
    mutationFn: async ({
      recipientId, value,
    }: {
      recipientId: number
      value: NextMessageEditorSave
    }) => {
      await updateBatchAIRecipientPlan(recipientId, value.plan)
      if (value.clearNextMessage) {
        await clearBatchAINextMessage(recipientId)
      } else if (value.nextMessage) {
        await saveBatchAINextMessage(recipientId, value.nextMessage)
      }
    },
    onSuccess: (_, vars) => {
      toast.success(vars.value.clearNextMessage ? 'Live AI generation restored' : 'Exact next message saved')
      setEditPlanOpen(false)
      invalidateBatch(vars.recipientId)
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to save the next message')),
  })

  // Resolve the "agent is enabled" boolean from the new shape. The
  // effective agent is enabled iff the agent object itself has
  // enabled=true (batch override OR global default).
  const resolvedAgentEnabled = !!effectiveAgentQ.data?.agent?.enabled

  const health = useMemo(() => buildHealth(enabled, total, counts, recipients, resolvedAgentEnabled), [
    enabled,
    total,
    counts,
    recipients,
    resolvedAgentEnabled,
  ])

  const selectedError = findLatestError(selected, selectedMessages)
  const timeline = useMemo(
    () => buildTimeline(selected, selectedMessages, selectedAudit),
    [selected, selectedMessages, selectedAudit],
  )

  function requestSendNext(recipientId: number) {
    if (selected?.recipient.id === recipientId) {
      setSendNextConfirm(selected)
      return
    }
    recipientActionMut.mutate({ recipientId, action: 'send-next' })
  }

  if (!Number.isFinite(batchID) || batchID <= 0) {
    return <ErrorBox msg="Bad batch id" />
  }

  return (
    <>
      <PageHeader
        title={batchQ.data ? `${batchDisplayName(batchQ.data)} AI Control` : `Batch AI Control #${batchID}`}
        subtitle={
          batchQ.data
            ? `Batch #${batchID} - ${batchQ.data.file_name} - ${fmtRelative(batchQ.data.created_at)} - ${batchStatus}`
            : followupQ.isLoading
              ? 'Loading batch AI control center...'
              : 'Batch AI follow-up control center'
        }
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                followupQ.refetch()
                batchQ.refetch()
                agentQ.refetch()
                selectedQ.refetch()
                messagesQ.refetch()
                auditQ.refetch()
                workflowListQ.refetch()
                selectedWorkflowQ.refetch()
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-[var(--input-bg)] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${followupQ.isFetching || selectedQ.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link to="/admin/ai/followups">
              <SecondaryButton><ArrowLeft className="w-4 h-4" /> AI follow-ups</SecondaryButton>
            </Link>
            <Link to={`/admin/messages/bulk/batches/${batchID}`}>
              <SecondaryButton><FileText className="w-4 h-4" /> Batch</SecondaryButton>
            </Link>
            <Link to={`/admin/ai/followups/${batchID}/agent`}>
              <SecondaryButton><Bot className="w-4 h-4" /> Agent setup</SecondaryButton>
            </Link>
            <Link to="/admin/messages/bulk/upload">
              <SecondaryButton><UploadCloud className="w-4 h-4" /> Upload</SecondaryButton>
            </Link>
            {enabled ? (
              <button
                type="button"
                onClick={() => toggleMut.mutate(false)}
                disabled={toggleMut.isPending}
                className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20"
              >
                <Power className="w-4 h-4" /> {toggleMut.isPending ? 'Disabling...' : 'Disable AI'}
              </button>
            ) : (
              <PrimaryButton
                onClick={openBatchPlanFlow}
                disabled={planSeqMut.isPending || checkingPlan}
              >
                <Bot className="w-4 h-4" /> {checkingPlan ? 'Checking...' : 'Enable AI'}
              </PrimaryButton>
            )}
          </div>
        }
      />

      {followupQ.isError && (
        <div className="mb-5">
          <ErrorBox msg={apiError(followupQ.error, 'Failed to load AI follow-up recipients')} />
        </div>
      )}

      {enabled && (
        <div className="mb-4">
          <AIWorkflowSummaryCards stats={workflowListQ.data?.stats} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-stretch">
        <Card hover={false} className="!p-0 overflow-hidden">
          <div className="h-full p-4 border-b border-slate-200 dark:border-white/10 bg-gradient-to-br from-white via-emerald-50/45 to-blue-50/35 dark:from-white/[0.04] dark:via-emerald-500/10 dark:to-blue-500/10">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <Bot className="w-3.5 h-3.5 text-emerald-500" />
                  Current state
                </div>
                <div className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-white">
                  {health.title}
                </div>
                <div className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400 max-w-2xl">
                  {health.body}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {health.action === 'enable' && (
                  <PrimaryButton onClick={openBatchPlanFlow} disabled={planSeqMut.isPending || checkingPlan}>
                    <Power className="w-4 h-4" /> {checkingPlan ? 'Checking...' : 'Enable AI'}
                  </PrimaryButton>
                )}
                {health.action === 'failed' && (
                  <SecondaryButton onClick={() => setStatusFilter('failed')}>
                    <AlertTriangle className="w-4 h-4" /> Show failed
                  </SecondaryButton>
                )}
                {enabled && (
                  <PrimaryButton onClick={openBatchPlanFlow} disabled={planSeqMut.isPending || checkingPlan}>
                    <Settings className="w-4 h-4" /> Create batch plan
                  </PrimaryButton>
                )}
              </div>
            </div>
          </div>

        </Card>

        <Card hover={false} className="!p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Bot className="w-3.5 h-3.5 text-blue-500" />
                Agent for this batch
              </div>
              <Pill tone={enabled ? 'emerald' : 'slate'}>{enabled ? 'AI enabled' : 'AI off'}</Pill>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <BatchAgentPicker
              batchID={batchID}
              effective={effectiveAgentQ.data ?? null}
              agents={agentsListQ.data ?? []}
              isLoading={effectiveAgentQ.isLoading || agentsListQ.isLoading}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: batchAIKeys.agent(batchID) })
                qc.invalidateQueries({ queryKey: aiKeys.agents() })
              }}
            />
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <div className="min-w-0 flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <FileText className="w-4 h-4 shrink-0 text-slate-400" />
                <Link to={`/admin/messages/bulk/batches/${batchID}`} className="text-emerald-600 dark:text-emerald-400 hover:underline">
                  Batch #{batchID}
                </Link>
                <span className="text-xs text-slate-500 dark:text-slate-400">{batchStatus || 'unknown'}</span>
              </div>
              {data?.enabled_at && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{fmtRelative(data.enabled_at)}</span>}
            </div>
            {enabled && effectiveAgentQ.data?.agent && !effectiveAgentQ.data.agent.enabled && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                The resolved agent is disabled. This batch can be tracked, but auto-replies will not run until the agent is enabled.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-118px)]">
          <Card hover={false} className="!p-0 overflow-hidden lg:h-[calc(100vh-140px)] lg:min-h-[520px] flex flex-col">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  Recipients
                </span>
              }
              subtitle={
                followupQ.isLoading
                  ? 'Loading recipients...'
                  : enabled
                    ? `${filteredRecipients.length} shown from ${total} tracked recipients.`
                    : 'Turn on AI follow-up to track recipients in this batch.'
              }
              right={
                enabled ? (
                  <div className="text-right">
                    <div className="text-lg font-semibold text-slate-900 dark:text-white">{filteredRecipients.length}</div>
                    <div className="text-[10px] uppercase text-slate-500 dark:text-slate-400">shown</div>
                  </div>
                ) : (
                  <AIFollowupStatusBadge status="disabled" />
                )
              }
            />

            {enabled && (
              <div className="shrink-0 border-b border-slate-200 dark:border-white/10 px-3 py-3 space-y-2.5 bg-slate-50/60 dark:bg-white/[0.02]">
                <AIFollowupStatusCounts counts={counts} />
                <StatusFilters value={statusFilter} onChange={setStatusFilter} />
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search retailer, phone..."
                    className="w-full pl-7 pr-2 py-2 text-[12px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                </div>
                {(statusFilter !== 'all' || search.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('all')
                      setSearch('')
                    }}
                    className="text-[12px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {followupQ.isLoading && <div className="p-6"><Spinner /></div>}

              {followupQ.isSuccess && !enabled && (
                <div className="p-6">
                  <Empty>
                    <span className="inline-flex flex-col items-center gap-2 text-center">
                      <Bot className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      <span>AI follow-up is off for this batch.</span>
                      <span className="text-slate-500 dark:text-slate-400">Enable AI above to create tracking rows for this batch.</span>
                    </span>
                  </Empty>
                </div>
              )}

              {followupQ.isSuccess && enabled && recipients.length === 0 && (
                <div className="p-6">
                  <Empty>No valid WhatsApp recipients were found for this batch.</Empty>
                </div>
              )}

              {followupQ.isSuccess && enabled && recipients.length > 0 && filteredRecipients.length === 0 && (
                <div className="p-6">
                  <Empty>No recipients match the current filter.</Empty>
                </div>
              )}

              {followupQ.isSuccess && enabled && filteredRecipients.length > 0 && (
                <div className="p-2.5 space-y-2">
                  {filteredRecipients.map((r, i) => (
                    <RecipientRailItem
                      key={r.id}
                      recipient={r}
                      selected={r.id === selectedRecipientId}
                      index={i}
                      onSelect={() => setSelectedRecipientId(r.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>
        </aside>

        <RecipientPanel
          detail={selected}
          loading={selectedQ.isLoading || selectedQ.isFetching}
          workflow={selectedWorkflowQ.data}
          onGenerateWorkflowBrief={(recipientId) => workflowBriefMut.mutate(recipientId)}
          workflowBriefLoading={workflowBriefMut.isPending}
          workflowBriefError={(workflowBriefMut.error as any)?.response?.data?.error || (workflowBriefMut.error as any)?.message || ''}
          agent={agentQ.data?.agent ?? undefined}
          knowledge={knowledgeQ.data?.chunks ?? []}
          knowledgeLoading={knowledgeQ.isLoading || knowledgeQ.isFetching}
          knowledgeError={knowledgeQ.isError ? apiError(knowledgeQ.error, 'Failed to load knowledge context') : ''}
          messages={selectedMessages}
          messagesError={messagesQ.isError ? apiError(messagesQ.error, 'Failed to load messages') : ''}
          audit={selectedAudit}
          auditError={auditQ.isError ? apiError(auditQ.error, 'Failed to load history') : ''}
          timeline={timeline}
          latestError={selectedError}
          busy={recipientStatusMut.isPending || recipientActionMut.isPending || planMut.isPending}
          onInclude={(recipientId) => recipientStatusMut.mutate({ recipientId, target: 'include' })}
          onExclude={(recipientId) => recipientStatusMut.mutate({ recipientId, target: 'exclude' })}
          onPause={(recipientId) => recipientActionMut.mutate({ recipientId, action: 'pause' })}
          onResume={(recipientId) => recipientActionMut.mutate({ recipientId, action: 'resume' })}
          onSendNext={requestSendNext}
          onEditPlan={() => setEditPlanOpen(true)}
        />
      </div>

      {checkingPlan && (
        <ModalShell title={`Checking batch #${batchID}`} onClose={() => setCheckingPlan(false)}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Spinner />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Checking duplicate phone numbers</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Looking for retailers that already have AI follow-up in another batch.
              </div>
            </div>
          </div>
        </ModalShell>
      )}

      {readyReviewCount !== null && (
        <ModalShell title={`Ready to enable AI for batch #${batchID}`} onClose={() => setReadyReviewCount(null)}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                No phone numbers in this batch are currently owned by another active batch AI follow-up.
              </div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <Users className="w-4 h-4" />
                {readyReviewCount} valid recipient{readyReviewCount === 1 ? '' : 's'} will be considered
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={() => setReadyReviewCount(null)}>Cancel</SecondaryButton>
            <PrimaryButton
              onClick={() => {
                setPendingPlanOpts(emptyFollowupOpts)
                setReadyReviewCount(null)
                setBatchPlanOpen(true)
              }}
            >
              <ArrowRight className="w-4 h-4" /> Continue to setup
            </PrimaryButton>
          </div>
        </ModalShell>
      )}

      {batchPlanOpen && (
        <BatchPlanModal
          batchId={batchID}
          enabled={enabled}
          saving={planSeqMut.isPending}
          onClose={() => setBatchPlanOpen(false)}
          onSave={handlePlanSave}
        />
      )}

      {dupStage && (
        <DuplicatePhonesWarningModal
          batchId={batchID}
          duplicates={dupStage.duplicates}
          freshCount={dupStage.freshCount}
          isSubmitting={false}
          onClose={() => setDupStage(null)}
          confirmActionLabel="Continue to setup"
          onConfirm={(excludes, overrides) => {
            setPendingPlanOpts({ excludePhones: excludes, overridePhones: overrides })
            setDupStage(null)
            setBatchPlanOpen(true)
          }}
        />
      )}

      {noValidPlan && (
        <ModalShell title={`No valid WhatsApp numbers in batch #${batchID}`} onClose={() => setNoValidPlan(null)}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700 dark:text-slate-200">{noValidPlan}</div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Upload rows with valid WhatsApp numbers, or fix invalid rows in this batch before enabling AI follow-up.
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <PrimaryButton onClick={() => setNoValidPlan(null)}>Got it</PrimaryButton>
          </div>
        </ModalShell>
      )}

      {sendNextConfirm && (
        <SendNextConfirmModal
          detail={sendNextConfirm}
          sending={recipientActionMut.isPending}
          onClose={() => {
            if (!recipientActionMut.isPending) setSendNextConfirm(null)
          }}
          onConfirm={(recipientId) => recipientActionMut.mutate({ recipientId, action: 'send-next' })}
        />
      )}

      {editPlanOpen && selected?.followup && (
        <EditPlanModal
          recipient={selected.recipient}
          followup={selected.followup}
          messages={selectedMessages}
          saving={planMut.isPending}
          onClose={() => setEditPlanOpen(false)}
          onSave={(value) => planMut.mutate({ recipientId: selected.recipient.id, value })}
        />
      )}
    </>
  )
}

function RecipientRailItem({
  recipient, selected, index, onSelect,
}: {
  recipient: BatchAIRecipient
  selected: boolean
  index: number
  onSelect: () => void
}) {
  const name = recipient.retailer_name || 'Unknown retailer'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.025, duration: 0.22 }}
      className={`group rounded-lg border transition-all
                  ${selected
                    ? 'border-emerald-400/80 bg-emerald-50/80 shadow-[0_12px_30px_-22px_rgba(16,185,129,0.9)] dark:border-emerald-400/35 dark:bg-emerald-500/10'
                    : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-blue-400/25 dark:hover:bg-blue-500/10'}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left p-2.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate" title={name}>
              {name}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {recipient.whatsapp_number}
            </div>
          </div>
          <AIFollowupStatusBadge status={recipient.ai_status} />
        </div>

        <div className="mt-2 rounded-md border border-slate-200/70 bg-slate-50/80 p-2 dark:border-white/10 dark:bg-black/10">
          <AIFollowupLastMessage r={recipient} maxWidth={270} />
        </div>

        {(recipient.last_event || recipient.last_event_at) && (
          <div className="mt-2">
            <LastEventCell r={recipient} />
          </div>
        )}
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-2 dark:border-white/10">
        <button
          type="button"
          onClick={onSelect}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${selected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300'}`}
        >
          <Settings className="w-3 h-3" /> Manage
        </button>
        <div className="flex items-center gap-2">
          <Link
            to={`/admin/ai/followups/recipients/${recipient.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
          >
            Timeline <ExternalLink className="w-3 h-3" />
          </Link>
          <Link
            to={`/admin/ai/conversations?phone=${encodeURIComponent(recipient.whatsapp_number)}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
          >
            Chat <MessageSquare className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function RecipientPanel({
  detail, loading, workflow, agent, knowledge, knowledgeLoading, knowledgeError,
  messages, messagesError, audit, auditError, timeline, latestError, busy,
  onInclude, onExclude, onPause, onResume, onSendNext, onEditPlan,
  onGenerateWorkflowBrief, workflowBriefLoading, workflowBriefError,
}: {
  detail?: BatchAIRecipientDetail
  loading: boolean
  workflow?: AIWorkflowState
  onGenerateWorkflowBrief: (recipientId: number) => void
  workflowBriefLoading: boolean
  workflowBriefError: string
  agent?: AIAgentConfig
  knowledge: RetrievedChunk[]
  knowledgeLoading: boolean
  knowledgeError: string
  messages: AIConversationMessage[]
  messagesError: string
  audit: AuditLog[]
  auditError: string
  timeline: TimelineItem[]
  latestError?: string
  busy: boolean
  onInclude: (recipientId: number) => void
  onExclude: (recipientId: number) => void
  onPause: (recipientId: number) => void
  onResume: (recipientId: number) => void
  onSendNext: (recipientId: number) => void
  onEditPlan: () => void
}) {
  const [timelineOpen, setTimelineOpen] = useState(false)

  useEffect(() => {
    setTimelineOpen(false)
  }, [detail?.recipient.id])

  if (!detail) {
    return (
      <Card hover={false} className="!p-0 min-h-[520px] overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
            <Bot className="w-3.5 h-3.5 text-emerald-500" />
            AI control room
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
            Select a recipient
          </div>
        </div>
        <div className="grid min-h-[430px] place-items-center p-6">
          {loading ? <Spinner /> : <Empty>Pick a retailer from the left to see the live AI plan.</Empty>}
        </div>
      </Card>
    )
  }

  const r = detail.recipient
  const f = detail.followup
  const conv = detail.conversation
  const lead = detail.lead
  const excluded = r.ai_status === 'excluded'
  const paused = f?.status === 'paused'
  const canControlPlan = !!f
  const nextStep = f ? `${Math.min(f.current_step + 1, f.max_messages)} / ${f.max_messages}` : 'No plan'
  const timelineCount = timeline.length

  return (
    <div className="space-y-4 min-w-0">
      <Card hover={false} className="!p-0 overflow-hidden">
        <div className="border-b border-slate-200 bg-gradient-to-br from-white via-blue-50/45 to-emerald-50/65 px-4 py-4 dark:border-white/10 dark:from-white/[0.06] dark:via-blue-500/10 dark:to-emerald-500/10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                AI control room
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                  {r.retailer_name || 'Unknown retailer'}
                </h2>
                <AIFollowupStatusBadge status={r.ai_status} />
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap text-sm text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                  {r.whatsapp_number}
                </span>
                {conv && (
                  <Link to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`} className="inline-flex items-center gap-1.5 text-blue-700 hover:underline dark:text-blue-300">
                    Open chat <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
                {lead && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                    Linked lead #{lead.id}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-start lg:justify-end">
              <SecondaryButton onClick={() => setTimelineOpen(true)}>
                <Clock3 className="w-4 h-4" /> Timeline{timelineCount > 0 ? ` (${Math.min(timelineCount, 99)})` : ''}
              </SecondaryButton>
              {conv && (
                <Link to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`}>
                  <SecondaryButton>
                    <MessageSquare className="w-4 h-4" /> Chat
                  </SecondaryButton>
                </Link>
              )}
              {canControlPlan && (
                <SecondaryButton onClick={onEditPlan} disabled={busy}>
                  <Edit className="w-4 h-4" /> Edit next
                </SecondaryButton>
              )}
              {canControlPlan && paused && (
                <PrimaryButton onClick={() => onResume(r.id)} disabled={busy}>
                  <Play className="w-4 h-4" /> Resume
                </PrimaryButton>
              )}
              {canControlPlan && !paused && (
                <SecondaryButton onClick={() => onPause(r.id)} disabled={busy}>
                  <Pause className="w-4 h-4" /> Pause
                </SecondaryButton>
              )}
              {canControlPlan && (
                <PrimaryButton onClick={() => onSendNext(r.id)} disabled={busy || excluded}>
                  <Send className="w-4 h-4" /> Send next
                </PrimaryButton>
              )}
              {excluded ? (
                <PrimaryButton onClick={() => onInclude(r.id)} disabled={busy}>
                  <CheckCircle2 className="w-4 h-4" /> Include
                </PrimaryButton>
              ) : (
                <SecondaryButton onClick={() => onExclude(r.id)} disabled={busy}>
                  <Ban className="w-4 h-4" /> Exclude
                </SecondaryButton>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 dark:border-white/10">
          <MetricCell label="Next step" value={nextStep} sub={f ? `${f.current_step} already sent` : 'Create a plan'} icon={<Route className="w-4 h-4" />} tone="blue" />
          <MetricCell label="Next run" value={f?.next_run_at ? fmtRelative(f.next_run_at) : 'Not scheduled'} sub={f?.next_run_at ? fmtDate(f.next_run_at) : 'No job queued'} icon={<CalendarClock className="w-4 h-4" />} tone="emerald" />
          <MetricCell label="Mode" value={f?.mode ? humanizeMode(f.mode) : 'AI follow-up'} sub={f?.tone || 'friendly'} icon={<Brain className="w-4 h-4" />} tone="violet" />
          <MetricCell label="Cadence" value={f ? `${f.cadence_days} day${f.cadence_days === 1 ? '' : 's'}` : 'Unset'} sub={f ? `${f.max_messages} max messages` : 'No enrollment'} icon={<Clock3 className="w-4 h-4" />} tone="amber" />
        </div>

        <div className="p-4 space-y-4">
          {latestError && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-400/20 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-200">
              <div className="font-semibold inline-flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Send error
              </div>
              <div className="mt-1 break-words">{latestError}</div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
            <AIWorkflowCard
              workflow={workflow}
              onGenerateBrief={() => onGenerateWorkflowBrief(r.id)}
              briefLoading={workflowBriefLoading}
              briefError={workflowBriefError}
            />
            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Decision log</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Why the AI moved this phone.</div>
                </div>
                <Brain className="h-4 w-4 text-violet-500" />
              </div>
              <AIDecisionLogList logs={workflow?.recent_decisions || []} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoLine icon={<Route className="w-4 h-4" />} label="Follow-up">
              {f ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={paused ? 'amber' : 'emerald'}>{f.status}</Pill>
                    {f.checkin_enabled && <Pill tone="blue">Check-in</Pill>}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Every {f.cadence_days} day{f.cadence_days === 1 ? '' : 's'}
                  </div>
                </div>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">No enrollment found</span>
              )}
            </InfoLine>
            <InfoLine icon={<FileText className="w-4 h-4" />} label="Linked lead">
              {lead ? (
                <span className="text-slate-800 dark:text-slate-100">
                  {lead.name || r.retailer_name || lead.phone}
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">No linked lead</span>
              )}
            </InfoLine>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              Current objective
            </div>
            <div className="mt-2 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
              {f?.goal?.trim() || `Follow up with ${r.retailer_name || r.whatsapp_number}, answer using knowledge, and move toward a clear next step.`}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <NextFollowupCard
            detail={detail}
            busy={busy}
            onEditPlan={onEditPlan}
            onSendNext={onSendNext}
          />
        </div>

        <div className="space-y-4 min-w-0">
          <AgentPreviewCard
            batchID={detail.recipient.batch_id}
            agent={agent}
            knowledge={knowledge}
            loading={knowledgeLoading}
            error={knowledgeError}
          />

          <Card hover={false} className="!p-0">
            <CardHeader title="Latest messages" subtitle="Fast read of the customer and AI conversation." />
            {messages.length === 0 ? (
              <Empty>No messages yet.</Empty>
            ) : (
              <div className="p-5 space-y-3">
                {messages.slice(-4).reverse().map((m) => (
                  <MessageSnippet key={m.id} message={m} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {timelineOpen && (
        <TimelineDialog
          recipient={r}
          timeline={timeline}
          messagesError={messagesError}
          auditError={auditError}
          onClose={() => setTimelineOpen(false)}
        />
      )}
    </div>
  )
}

function TimelineDialog({
  recipient, timeline, messagesError, auditError, onClose,
}: {
  recipient: BatchAIRecipient
  timeline: TimelineItem[]
  messagesError: string
  auditError: string
  onClose: () => void
}) {
  return (
    <ModalShell title="Live timeline" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-950 dark:text-white">
              {recipient.retailer_name || 'Unknown retailer'}
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
              {recipient.whatsapp_number}
            </div>
          </div>
          <AIFollowupStatusBadge status={recipient.ai_status} />
        </div>

        {messagesError && <ErrorBox msg={messagesError} />}
        {auditError && <ErrorBox msg={auditError} />}

        {timeline.length === 0 ? (
          <Empty>No timeline events yet.</Empty>
        ) : (
          <div className="max-h-[68vh] overflow-y-auto pr-1">
            <div className="relative space-y-2.5">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-200 dark:bg-white/10" />
              {timeline.map((item, index) => (
                <TimelineRow key={item.key} item={item} index={index} expanded />
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function NextFollowupCard({
  detail, busy, onEditPlan, onSendNext,
}: {
  detail: BatchAIRecipientDetail
  busy: boolean
  onEditPlan: () => void
  onSendNext: (recipientId: number) => void
}) {
  const r = detail.recipient
  const f = detail.followup
  const plan = buildNextFollowupPlan(detail)
  const hasExactMessage = !!f?.next_message_body?.trim()

  return (
    <Card hover={false} className="!p-0 overflow-hidden">
      <CardHeader
        title="Next follow-up"
        subtitle={hasExactMessage ? 'The exact one-time message reserved for the next send.' : 'Live AI will generate the body at send time unless you save an exact message.'}
        right={f ? <Pill tone={f.status === 'paused' ? 'amber' : 'emerald'}>{f.status}</Pill> : undefined}
      />
      {!f ? (
        <Empty>No follow-up plan has been created for this recipient.</Empty>
      ) : (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Next step" value={`${Math.min(f.current_step + 1, f.max_messages)} / ${f.max_messages}`} />
            <MiniStat label="Scheduled" value={f.next_run_at ? fmtRelative(f.next_run_at) : 'Not scheduled'} />
            <MiniStat label="Mode" value={humanizeMode(f.mode || 'ai_followup')} />
            <MiniStat label="Cadence" value={`${f.cadence_days} day${f.cadence_days === 1 ? '' : 's'}`} />
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <ClipboardList className="w-3.5 h-3.5" />
                {hasExactMessage ? 'Exact next message' : 'Live generation intent'}
              </div>
              {hasExactMessage ? (
                <Pill tone={f.next_message_stale ? 'amber' : 'emerald'}>
                  {f.next_message_stale ? 'Needs refresh' : 'Saved'}
                </Pill>
              ) : (f.override_goal || f.override_tone || f.override_cadence_days || f.override_max_messages) && (
                <Pill tone="blue">Edited</Pill>
              )}
            </div>
            <div className="mt-2 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
              {hasExactMessage ? f.next_message_body : plan.intent}
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {hasExactMessage
                ? `${f.next_message_source === 'ai' ? 'AI generated' : 'Manually edited'} from latest ${f.next_message_history_limit || 20} messages`
                : `Tone: ${f.tone || 'friendly'} - Recipient: ${r.retailer_name || r.whatsapp_number}`}
            </div>
          </div>

          {hasExactMessage && f.next_message_stale && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
              The conversation changed after this message was saved. Regenerate it before sending so the reply uses the latest chat.
            </div>
          )}

          <div className="rounded-lg border border-emerald-200/70 dark:border-emerald-400/20 bg-emerald-50/70 dark:bg-emerald-500/10 p-3">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <Brain className="w-3.5 h-3.5" />
              Send behavior
            </div>
            <div className="mt-2 text-sm text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap">
              {plan.behavior}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={onEditPlan} disabled={busy}>
              <Edit className="w-4 h-4" /> {hasExactMessage ? 'Edit exact message' : 'Create exact message'}
            </SecondaryButton>
            <PrimaryButton onClick={() => onSendNext(r.id)} disabled={busy || r.ai_status === 'excluded' || !!f.next_message_stale}>
              <Send className="w-4 h-4" /> Send next now
            </PrimaryButton>
          </div>
        </div>
      )}
    </Card>
  )
}

function SendNextConfirmModal({
  detail, sending, onClose, onConfirm,
}: {
  detail: BatchAIRecipientDetail
  sending: boolean
  onClose: () => void
  onConfirm: (recipientId: number) => void
}) {
  const r = detail.recipient
  const f = detail.followup
  const plan = buildNextFollowupPlan(detail)
  const hasExactMessage = !!f?.next_message_body?.trim()
  const cannotSendReason = !f
    ? 'No active follow-up plan exists for this recipient.'
    : r.ai_status === 'excluded'
      ? 'This recipient is excluded from AI follow-up.'
      : f.next_message_stale
        ? 'The saved message is older than the latest conversation. Edit or regenerate it first.'
        : ''

  return (
    <ModalShell title="Send next follow-up?" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-3 dark:border-blue-400/20 dark:bg-blue-500/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950 dark:text-white">
                {r.retailer_name || 'Unknown retailer'}
              </div>
              <div className="mt-0.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                {r.whatsapp_number}
              </div>
            </div>
            <AIFollowupStatusBadge status={r.ai_status} />
          </div>
        </div>

        {cannotSendReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
            {cannotSendReason}
          </div>
        )}

        {f && (
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Step" value={`${Math.min(f.current_step + 1, f.max_messages)} / ${f.max_messages}`} />
            <MiniStat label="Mode" value={humanizeMode(f.mode || 'ai_followup')} />
            <MiniStat label="Tone" value={f.tone || 'friendly'} />
            <MiniStat label="Schedule" value={f.next_run_at ? fmtRelative(f.next_run_at) : 'Send manually'} />
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
            {hasExactMessage ? <ClipboardList className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {hasExactMessage ? 'Message that will be sent' : 'AI generation brief'}
          </div>
          <div className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
            {hasExactMessage ? f?.next_message_body : plan.intent}
          </div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {hasExactMessage
              ? `${f?.next_message_source === 'ai' ? 'AI generated' : 'Manually edited'} from latest ${f?.next_message_history_limit || 20} messages.`
              : 'The worker will generate the WhatsApp text from the latest conversation, this objective, and matching knowledge.'}
          </div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100">
          <div className="font-semibold inline-flex items-center gap-2">
            <Send className="w-4 h-4" />
            This will queue the next WhatsApp follow-up immediately.
          </div>
          <div className="mt-1">{plan.behavior}</div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose} disabled={sending}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => onConfirm(r.id)}
            disabled={sending || !!cannotSendReason}
          >
            {sending ? <><Spinner /> Sending...</> : <><Send className="w-4 h-4" /> Proceed & send</>}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  )
}

function AgentPreviewCard({
  batchID, agent, knowledge, loading, error,
}: {
  batchID: number
  agent?: AIAgentConfig
  knowledge: RetrievedChunk[]
  loading: boolean
  error: string
}) {
  return (
    <Card hover={false} className="!p-0 overflow-hidden">
      <CardHeader
        title="Agent preview"
        subtitle="Assistant status and knowledge hints for this selected recipient."
        right={
          <Link to={`/admin/ai/followups/${batchID}/agent`}>
            <SecondaryButton><Settings className="w-4 h-4" /> Manage agent</SecondaryButton>
          </Link>
        }
      />
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Assistant" value={agent?.name || 'AI assistant'} />
          <MiniStat label="State" value={agent?.enabled ? 'Enabled' : 'Disabled'} />
          <MiniStat label="Knowledge" value={loading ? 'Loading...' : `${knowledge.length} match${knowledge.length === 1 ? '' : 'es'}`} />
        </div>
        {error && <ErrorBox msg={error} />}
        {!loading && !error && knowledge.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-3">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <BookOpen className="w-3.5 h-3.5" />
              Top knowledge hint
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
              {knowledge[0].title || `Knowledge #${knowledge[0].id}`}
            </div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-3">
              {knowledge[0].content}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function BatchPlanModal({
  batchId, enabled, saving, onClose, onSave,
}: {
  batchId: number
  enabled: boolean
  saving: boolean
  onClose: () => void
  onSave: (cfg: BatchFollowupConfig) => void
}) {
  const [behavior, setBehavior] = useState<FollowupBehavior>('default')
  const [cadenceDays, setCadenceDays] = useState('3')
  const [maxMessages, setMaxMessages] = useState('5')
  const [tone, setTone] = useState<FollowupTone>('friendly')
  const [goal, setGoal] = useState('')
  const [checkin, setCheckin] = useState(true)

  const cadence = clampInt(cadenceDays, 1, 30, 3)
  const max = clampInt(maxMessages, 1, 20, 5)

  function save() {
    onSave({
      behavior,
      cadence_days: cadence,
      max_messages: max,
      tone: behavior === 'agentic' ? '' : tone,
      goal: behavior === 'custom' ? goal.trim() : '',
      checkin_enabled: checkin,
    })
  }

  return (
    <ModalShell title={enabled ? `Create AI plan for batch #${batchId}` : `Enable AI for batch #${batchId}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ModeCard active={behavior === 'default'} title="Default" body="Short AI nudges from the current context." onClick={() => setBehavior('default')} />
          <ModeCard active={behavior === 'custom'} title="Custom" body="Use a goal and tone for this batch." onClick={() => setBehavior('custom')} />
          <ModeCard active={behavior === 'agentic'} title="Agentic" body="AI decides when a follow-up is useful." onClick={() => setBehavior('agentic')} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Cadence days</span>
            <Input type="number" min={1} max={30} value={cadenceDays} onChange={(e) => setCadenceDays(e.target.value)} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Max messages</span>
            <Input type="number" min={1} max={20} value={maxMessages} onChange={(e) => setMaxMessages(e.target.value)} className="mt-1" />
          </label>
        </div>

        {behavior !== 'agentic' && (
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Tone</span>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as FollowupTone)}
              className="mt-1 w-full px-3 py-2 rounded-md text-sm bg-white dark:bg-[var(--input-bg)] border border-slate-300 dark:border-[var(--input-border)] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
            >
              <option value="friendly">friendly</option>
              <option value="professional">professional</option>
              <option value="casual">casual</option>
              <option value="urgent">urgent</option>
            </select>
          </label>
        )}

        {behavior === 'custom' && (
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Batch message intent</span>
            <TextArea rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1" placeholder="Example: re-engage buyers who asked about pricing and move them toward a confirmed order." />
          </label>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={checkin}
            onChange={(e) => setCheckin(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/40"
          />
          <span>Enable customer-replied check-ins.</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? (
              <><Spinner /> Saving...</>
            ) : (
              <><CheckCircle2 className="w-4 h-4" /> {enabled ? 'Create plan' : 'Check duplicates & enable'}</>
            )}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  )
}

function EditPlanModal({
  recipient, followup, messages, saving, onClose, onSave,
}: {
  recipient: BatchAIRecipient
  followup: FollowupEnrollmentRow
  messages: AIConversationMessage[]
  saving: boolean
  onClose: () => void
  onSave: (value: NextMessageEditorSave) => void
}) {
  const [cadenceDays, setCadenceDays] = useState(String(followup.cadence_days || 3))
  const [maxMessages, setMaxMessages] = useState(String(followup.max_messages || 5))
  const [tone, setTone] = useState(followup.tone || 'friendly')
  const [goal, setGoal] = useState(followup.goal || '')
  const [historyLimit, setHistoryLimit] = useState<10 | 20>((followup.next_message_history_limit === 10 ? 10 : 20))
  const [prompt, setPrompt] = useState(
    followup.next_message_prompt ||
      'Write a personal WhatsApp follow-up using the latest chat. Keep it short, helpful, and end with one clear question.',
  )
  const [message, setMessage] = useState(followup.next_message_body || '')
  const [source, setSource] = useState<'ai' | 'manual'>((followup.next_message_source === 'ai' ? 'ai' : 'manual'))
  const [contextMessageID, setContextMessageID] = useState<number | null | undefined>(followup.next_message_context_message_id)
  const [generatedAt, setGeneratedAt] = useState<string | null | undefined>(followup.next_message_generated_at)
  const [clearSaved, setClearSaved] = useState(false)
  const didAutoGenerate = useRef(false)

  const generateMut = useMutation({
    mutationFn: () => generateBatchAINextMessage(recipient.id, {
      prompt: prompt.trim(),
      history_limit: historyLimit,
    }),
    onSuccess: (draft) => {
      setMessage(draft.message)
      setSource('ai')
      setContextMessageID(draft.context_message_id ?? null)
      setGeneratedAt(draft.generated_at)
      setClearSaved(false)
      toast.success('Next message generated')
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to generate next message')),
  })

  useEffect(() => {
    if (didAutoGenerate.current || message.trim()) return
    didAutoGenerate.current = true
    generateMut.mutate()
  }, [generateMut, message])

  function save() {
    const body = message.trim()
    const plan: UpdatePlanBody = {
      cadence_days: clampInt(cadenceDays, 1, 30, followup.cadence_days || 3),
      max_messages: clampInt(maxMessages, 1, 20, followup.max_messages || 5),
      tone,
      goal: goal.trim(),
    }
    onSave({
      plan,
      clearNextMessage: clearSaved && !body,
      nextMessage: body
        ? {
            message: body,
            prompt: prompt.trim(),
            source,
            context_message_id: contextMessageID ?? null,
            history_limit: historyLimit,
            generated_at: generatedAt ?? null,
          }
        : undefined,
    })
  }

  function restoreLiveGeneration() {
    setMessage('')
    setSource('manual')
    setContextMessageID(undefined)
    setGeneratedAt(undefined)
    setClearSaved(true)
  }

  const recent = messages.slice(-Math.min(historyLimit, 6)).reverse()

  return (
    <ModalShell title={`Edit next message: ${recipient.retailer_name || recipient.whatsapp_number}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Cadence days</span>
            <Input type="number" min={1} max={30} value={cadenceDays} onChange={(e) => setCadenceDays(e.target.value)} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Max messages</span>
            <Input type="number" min={1} max={20} value={maxMessages} onChange={(e) => setMaxMessages(e.target.value)} className="mt-1" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Tone</span>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md text-sm bg-white dark:bg-[var(--input-bg)] border border-slate-300 dark:border-[var(--input-border)] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
            >
              <option value="friendly">friendly</option>
              <option value="professional">professional</option>
              <option value="casual">casual</option>
              <option value="urgent">urgent</option>
            </select>
          </label>
          <div>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Chat history</span>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-md border border-slate-200 dark:border-white/10 p-1">
              {[10, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHistoryLimit(n as 10 | 20)}
                  className={`px-2 py-1.5 rounded text-sm font-medium ${historyLimit === n ? 'bg-emerald-500 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Message intent</span>
          <TextArea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-1"
            placeholder="Example: answer pricing clearly, mention available sweets, and ask whether they want a small or bulk order."
          />
        </label>

        <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.03] p-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Prompt for generator</span>
            <TextArea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1"
              placeholder="Example: Be polite, answer their pricing question, mention premium sweets, and ask if they want a small trial box."
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton type="button" onClick={() => generateMut.mutate()} disabled={generateMut.isPending || saving}>
              {generateMut.isPending ? <><Spinner /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate from latest chat</>}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={restoreLiveGeneration} disabled={saving}>
              <RotateCcw className="w-4 h-4" /> Use live AI instead
            </SecondaryButton>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Exact next WhatsApp message</span>
          <TextArea
            rows={6}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              setSource('manual')
              setClearSaved(false)
            }}
            className="mt-1"
            placeholder={generateMut.isPending ? 'Generating the next message...' : 'Generate a draft or type the exact message to send next.'}
          />
        </label>

        {followup.next_message_stale && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
            The saved message is older than the latest conversation. Generate again before saving or sending.
          </div>
        )}

        {recent.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Recent context preview
            </div>
            <div className="space-y-2 max-h-44 overflow-auto">
              {recent.map((m) => (
                <div key={m.id} className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{m.role}: </span>
                  {m.content}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={save} disabled={saving || generateMut.isPending}>
            {saving ? <><Spinner /> Saving...</> : <><CheckCircle2 className="w-4 h-4" /> Save next message</>}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  )
}

function buildNextFollowupPlan(detail: BatchAIRecipientDetail): { intent: string; behavior: string } {
  const r = detail.recipient
  const f = detail.followup
  const name = r.retailer_name || r.whatsapp_number
  if (!f) {
    return {
      intent: `Follow up with ${name}.`,
      behavior: 'No active plan exists yet.',
    }
  }
  const intent = f.goal?.trim()
    || `Follow up with ${name}, answer using the knowledge base, and move the conversation toward a clear next step.`
  const mode = f.mode || 'ai_followup'
  if (mode === 'agentic_followup') {
    return {
      intent,
      behavior: 'Agentic AI will inspect the conversation and matching knowledge at run time, then send only when a follow-up is useful.',
    }
  }
  if (mode === 'template') {
    return {
      intent,
      behavior: 'Template mode sends the configured sequence body on the scheduled step.',
    }
  }
  return {
    intent,
    behavior: 'AI follow-up mode generates the WhatsApp text at send time from this intent, the latest conversation, and the matching knowledge snippets.',
  }
}

function buildKnowledgeSearchText(
  detail: BatchAIRecipientDetail | undefined,
  messages: AIConversationMessage[],
): string {
  if (!detail) return ''
  const recentMessages = messages
    .slice(-6)
    .map((m) => m.content)
    .filter(Boolean)
    .join(' ')
  const parts = [
    detail.followup?.goal,
    detail.recipient.last_message_preview,
    recentMessages,
    detail.recipient.retailer_name,
    detail.lead?.interest,
    detail.lead?.budget,
    detail.lead?.timeline,
    detail.recipient.whatsapp_number,
  ]
  const text = parts
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .trim()
  return (text || 'pricing products catalog availability order').slice(0, 1200)
}

function buildHealth(
  enabled: boolean,
  total: number,
  counts: Record<string, number>,
  recipients: BatchAIRecipient[],
  agentEnabled?: boolean,
): { title: string; body: string; action: 'enable' | 'failed' | 'none' } {
  if (!enabled) {
    return {
      title: 'AI is off for this batch',
      body: 'Recipients are not being tracked by the batch AI follow-up system.',
      action: 'enable',
    }
  }
  if (agentEnabled === false) {
    return {
      title: 'Batch is enabled, global agent is off',
      body: 'Turn on the global AI agent before expecting automated replies from this batch.',
      action: 'none',
    }
  }
  if (total === 0) {
    return {
      title: 'AI is enabled, no recipients are loaded',
      body: 'This batch has no valid WhatsApp recipients for AI to track.',
      action: 'none',
    }
  }
  if ((counts.failed || 0) > 0) {
    return {
      title: `${counts.failed} recipient${counts.failed === 1 ? '' : 's'} need attention`,
      body: 'At least one AI send or follow-up event failed. Review the failed rows and the selected recipient error panel.',
      action: 'failed',
    }
  }
  if ((counts.active || 0) > 0) {
    return {
      title: 'AI is actively working this batch',
      body: `${counts.active} active, ${counts.pending || 0} pending, ${counts.handed_off || 0} handed off.`,
      action: 'none',
    }
  }
  if (recipients.some((r) => r.last_message_at)) {
    return {
      title: 'AI is tracking replies',
      body: 'Messages exist for this batch. Select a recipient to inspect the agent timeline and controls.',
      action: 'none',
    }
  }
  return {
    title: 'AI is ready and waiting',
    body: `${total} recipient${total === 1 ? '' : 's'} are ready for follow-up activity.`,
    action: 'none',
  }
}

function buildTimeline(
  detail: BatchAIRecipientDetail | undefined,
  messages: AIConversationMessage[],
  audit: AuditLog[],
): TimelineItem[] {
  if (!detail) return []
  const r = detail.recipient
  const items: TimelineItem[] = [
    {
      key: `recipient-${r.id}`,
      at: r.created_at,
      title: 'Recipient entered batch AI',
      body: humanizeAIFollowupStatus(r.ai_status),
      icon: <Bot className="w-3.5 h-3.5" />,
      tone: 'emerald',
    },
  ]

  if (detail.followup) {
    items.push({
      key: `followup-${detail.followup.id}`,
      at: detail.followup.next_run_at,
      title: 'Next follow-up scheduled',
      body: `Step ${detail.followup.current_step} of ${detail.followup.max_messages}`,
      meta: `${humanizeMode(detail.followup.mode || 'ai_followup')} - every ${detail.followup.cadence_days} day${detail.followup.cadence_days === 1 ? '' : 's'}`,
      icon: <CalendarClock className="w-3.5 h-3.5" />,
      tone: detail.followup.status === 'paused' ? 'amber' : 'blue',
    })
  }

  if (r.last_event || r.last_event_at) {
    items.push({
      key: `event-${r.id}`,
      at: r.last_event_at || r.updated_at,
      title: 'Latest batch event',
      body: r.last_event || 'Status updated',
      icon: <ActivityIcon tone={r.ai_status === 'failed' ? 'rose' : 'emerald'} />,
      tone: r.ai_status === 'failed' ? 'rose' : 'emerald',
    })
  }

  for (const m of messages) {
    const failed = m.send_status === 'failed' || !!m.send_error
    items.push({
      key: `message-${m.id}`,
      at: m.created_at,
      title: m.role === 'user' ? 'Customer message' : m.role === 'human' ? 'Team reply' : m.role === 'assistant' ? 'AI reply' : `${m.role} event`,
      body: m.content || '(empty message)',
      meta: messageMeta(m),
      icon: m.role === 'user' ? <UserRound className="w-3.5 h-3.5" /> : m.role === 'human' ? <Send className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />,
      tone: failed ? 'rose' : m.role === 'user' ? 'blue' : m.role === 'human' ? 'amber' : 'emerald',
    })
  }

  for (const a of audit) {
    items.push({
      key: `audit-${a.id}`,
      at: a.created_at,
      title: humanizeAction(a.action),
      body: auditSummary(a.metadata),
      meta: a.actor_email || undefined,
      icon: <Settings className="w-3.5 h-3.5" />,
      tone: 'violet',
    })
  }

  return items.sort((a, b) => timeValue(b.at) - timeValue(a.at))
}

function findLatestError(detail: BatchAIRecipientDetail | undefined, messages: AIConversationMessage[]): string | undefined {
  const failed = [...messages]
    .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))
    .find((m) => m.send_error || m.send_status === 'failed')
  if (failed?.send_error) return failed.send_error
  if (detail?.followup?.pause_detail) return detail.followup.pause_detail
  if (detail?.recipient.ai_status === 'failed') return detail.recipient.last_event || 'Recipient is marked failed'
  return undefined
}

function StatusFilters({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STATUS_FILTERS.map((p) => {
        const active = value === p.key
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={`px-2.5 py-1 text-[12px] font-medium rounded-full border transition-colors
                        ${active
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'}`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function MetricCell({
  label, value, sub, icon, tone = 'emerald',
}: {
  label: string
  value: string | number
  sub?: string
  icon: JSX.Element
  tone?: TimelineTone
}) {
  const toneClass = toneClasses(tone)
  return (
    <div className="p-4 min-h-[112px]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span className={`w-7 h-7 rounded-md border grid place-items-center ${toneClass}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white truncate" title={String(value)}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate" title={sub}>{sub}</div>}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-3 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white truncate" title={value}>{value}</div>
    </div>
  )
}

function InfoLine({ icon, label, children }: { icon: JSX.Element; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="mt-0.5 w-8 h-8 rounded-md grid place-items-center bg-slate-50 text-slate-500 dark:bg-white/10 dark:text-slate-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-100 break-words">{children}</div>
      </div>
    </div>
  )
}

function Pill({ tone, children }: { tone: TimelineTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${toneClasses(tone)}`}>
      {children}
    </span>
  )
}

function TimelineRow({ item, index, expanded = false }: { item: TimelineItem; index: number; expanded?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.018, duration: 0.18 }}
      className="relative pl-8"
    >
      <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border grid place-items-center ${toneClasses(item.tone)}`}>
        {item.icon}
      </div>
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">{item.title}</div>
            {item.body && (
              <div className={`mt-0.5 text-[12px] leading-snug text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-2'}`}>
                {item.body}
              </div>
            )}
            {item.meta && <div className={`mt-1 text-[10px] text-slate-500 dark:text-slate-400 break-words ${expanded ? '' : 'line-clamp-1'}`}>{item.meta}</div>}
          </div>
          <div className="shrink-0 text-right text-[10px] text-slate-500 dark:text-slate-400">
            <div>{fmtRelative(item.at)}</div>
            <div className={`mt-0.5 ${expanded ? '' : 'hidden sm:block'}`}>{fmtDate(item.at)}</div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function MessageSnippet({ message }: { message: AIConversationMessage }) {
  const tone = message.send_status === 'failed' || message.send_error
    ? 'rose'
    : message.role === 'user'
      ? 'blue'
      : message.role === 'human'
        ? 'amber'
        : 'emerald'
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <Pill tone={tone}>{message.role}</Pill>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{fmtRelative(message.created_at)}</span>
      </div>
      <div className="mt-2 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap line-clamp-3">
        {message.content || '(empty message)'}
      </div>
      {(message.send_status || message.send_error) && (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 break-words">
          {[message.send_status, message.send_error].filter(Boolean).join(' - ')}
        </div>
      )}
    </div>
  )
}

function ModeCard({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors
                  ${active
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}
    >
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-snug">{body}</div>
    </button>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="w-full max-w-2xl admin-card rounded-2xl p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  )
}

function LastEventCell({ r }: { r: BatchAIRecipient }) {
  if (!r.last_event_at && !r.last_event) {
    return <span className="text-[12px] text-slate-400 dark:text-slate-500">-</span>
  }
  return (
    <div className="max-w-[220px]">
      {r.last_event && (
        <div className="text-[12px] text-slate-700 dark:text-slate-200 truncate" title={r.last_event}>
          {r.last_event}
        </div>
      )}
      {r.last_event_at && (
        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          {fmtRelative(r.last_event_at)}
        </div>
      )}
    </div>
  )
}

function messageMeta(m: AIConversationMessage): string {
  const bits: string[] = []
  if (m.model_used) bits.push(m.model_used)
  if (m.send_status) bits.push(m.send_status)
  if (m.send_error) bits.push(m.send_error)
  if (m.tokens_in != null || m.tokens_out != null) bits.push(`${m.tokens_in ?? 0}/${m.tokens_out ?? 0} tokens`)
  return bits.join(' - ')
}

function auditSummary(meta: any): string {
  if (!meta) return ''
  if (typeof meta === 'string') return meta
  try {
    const pieces: string[] = []
    if (meta.new_status) pieces.push(`status: ${meta.new_status}`)
    if (meta.pause_reason) pieces.push(`reason: ${meta.pause_reason}`)
    if (meta.to) pieces.push(`to: ${humanizeMode(meta.to)}`)
    if (meta.enrollment_id) pieces.push(`enrollment #${meta.enrollment_id}`)
    return pieces.length > 0 ? pieces.join(' - ') : JSON.stringify(meta)
  } catch {
    return ''
  }
}

function humanizeAction(action: string): string {
  return action
    .replace(/^batch_ai_recipient\./, '')
    .replace(/^batch\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function humanizeMode(mode?: string): string {
  if (!mode) return 'AI follow-up'
  if (mode === 'agentic_followup') return 'Agentic AI'
  if (mode === 'ai_followup') return 'AI follow-up'
  if (mode === 'template') return 'Template'
  return mode.replace(/_/g, ' ')
}

function toneClasses(tone: TimelineTone): string {
  return {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    blue: 'bg-blue-50 text-blue-700 border-blue-200/70 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/20',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/20',
    rose: 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/20',
    violet: 'bg-violet-50 text-violet-700 border-violet-200/70 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/20',
    slate: 'bg-slate-50 text-slate-600 border-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:border-white/15',
  }[tone]
}

function ActivityIcon({ tone }: { tone: TimelineTone }) {
  if (tone === 'rose') return <AlertTriangle className="w-3.5 h-3.5" />
  return <CheckCircle2 className="w-3.5 h-3.5" />
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function timeValue(s?: string | null): number {
  if (!s) return 0
  const n = new Date(s).getTime()
  return Number.isFinite(n) ? n : 0
}

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback
}

// ---------------------------------------------------------------------------
// BatchAgentPicker — inline picker for "which agent handles this batch".
// Shows the resolved agent + a source discriminator pill (overrides
// default vs using global default) so the operator is never confused
// about which agent is actually live for this batch.
// ---------------------------------------------------------------------------
function BatchAgentPicker({
  batchID, effective, agents, isLoading, onChanged,
}: {
  batchID: number
  effective: EffectiveAIAgent | null
  agents: AIAgentConfig[]
  isLoading: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const defaultAgent = useMemo(() => agents.find((a) => a.is_default), [agents])
  const resolvedAgent = effective?.agent ?? null
  const source = effective?.source ?? 'none'
  const [pendingID, setPendingID] = useState<number | 'default' | null>(null)

  const apply = useMutation({
    mutationFn: (agent_id: number | null) => setBatchAgent(batchID, { agent_id }),
    onMutate: (agent_id) => {
      setPendingID(agent_id ?? 'default')
    },
    onSettled: () => {
      setPendingID(null)
    },
    onSuccess: (eff) => {
      const label = eff.agent?.name || 'global default'
      toast.success(eff.source === 'batch_override'
        ? `This batch now uses "${label}"`
        : 'Batch now uses the global default')
      qc.invalidateQueries({ queryKey: batchAIKeys.agent(batchID) })
      onChanged()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Could not update batch agent'),
  })

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (v === '__default__') {
      // "Use global default" — clear override.
      apply.mutate(null)
    } else {
      const id = parseInt(v, 10)
      if (!isNaN(id)) apply.mutate(id)
    }
  }

  const onClear = () => apply.mutate(null)

  // The select's current value mirrors the override if set, else
  // "use global default".
  const selectValue = (() => {
    if (source === 'batch_override' && resolvedAgent) return String(resolvedAgent.id)
    return '__default__'
  })()

  // Source pill — color-coded so the operator sees at a glance which
  // path resolved.
  const sourcePill = (() => {
    if (source === 'batch_override') {
      return <Pill tone="emerald">overrides default</Pill>
    }
    if (source === 'global_default') {
      return <Pill tone="slate">using global default</Pill>
    }
    return <Pill tone="amber">no agent configured</Pill>
  })()

  return (
    <div className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02] p-3 space-y-2.5">
      {/* Resolved row */}
      <div className="flex items-center gap-2 flex-wrap min-h-7">
        <Bot className="w-4 h-4 text-emerald-500" />
        <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Resolved</span>
        {isLoading ? (
          <span className="text-slate-500 dark:text-slate-400 text-sm">Loading…</span>
        ) : resolvedAgent ? (
          <>
            <span className="font-medium text-sm text-slate-800 dark:text-slate-100">
              {resolvedAgent.name || 'Unnamed agent'}
            </span>
            <Pill tone={resolvedAgent.enabled ? 'emerald' : 'rose'}>
              {resolvedAgent.enabled ? 'Enabled' : 'Disabled'}
            </Pill>
            {sourcePill}
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {resolvedAgent.primary_model}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm text-slate-500 dark:text-slate-400">No agent configured</span>
            {sourcePill}
          </>
        )}
      </div>

      {/* Override picker */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 w-16 shrink-0">
          Agent
        </label>
        <select
          value={selectValue}
          onChange={onChange}
          disabled={apply.isPending || isLoading}
          className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm
                     bg-white dark:bg-[var(--input-bg)]
                     border border-slate-300 dark:border-[var(--input-border)]
                     text-slate-900 dark:text-slate-100
                     focus:outline-none focus:ring-2 focus:ring-emerald-500/60
                     disabled:opacity-50"
        >
          <option value="__default__">
            Use global default ({defaultAgent?.name || 'none'}){defaultAgent?.is_default ? ' ★' : ''}
          </option>
          {agents.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name || `Agent #${a.id}`}{a.is_default ? ' ★' : ''}
            </option>
          ))}
        </select>
        {source === 'batch_override' && (
          <SecondaryButton onClick={onClear} disabled={apply.isPending}>
            Clear override
          </SecondaryButton>
        )}
        {pendingID !== null && (
          <span className="text-xs text-slate-500 dark:text-slate-400">Saving…</span>
        )}
      </div>

      {/* Helper text — explains what changing this does */}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Changing the global default in <Link to="/admin/ai/agent" className="text-emerald-600 dark:text-emerald-400 hover:underline">Agents</Link> never overwrites this batch's pick.
      </p>
    </div>
  )
}
