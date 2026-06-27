import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Bot, CalendarClock, CheckCircle2, CircleDashed, Clock3,
  ExternalLink, FileText, Hash, MessageSquare, Phone, RefreshCw,
  Ban, Route, Send, Store, UserRound, XCircle,
} from 'lucide-react'
import {
  Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton,
  SecondaryButton, Spinner,
} from '@/components/ui'
import { AIFollowupStatusBadge, humanizeAIFollowupStatus } from '@/components/AIFollowupParts'
import { aiKeys, getConversationMessages } from '@/lib/ai'
import {
  batchAIKeys, excludeBatchAIRecipient, getBatchAIRecipient, includeBatchAIRecipient,
} from '@/lib/batchAI'
import { batchDisplayName, fmtDate, fmtRelative } from '@/lib/format'
import type { AIConversationMessage, BatchAIRecipientDetail } from '@/lib/types'

type TimelineItem = {
  key: string
  at?: string | null
  title: string
  body?: string
  meta?: string
  icon: JSX.Element
  tone: 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate'
}

export default function FollowupDetail() {
  const { recipientId } = useParams<{ recipientId: string }>()
  const id = Number(recipientId)
  const validId = Number.isFinite(id) && id > 0
  const qc = useQueryClient()

  const detail = useQuery({
    queryKey: validId ? batchAIKeys.recipient(id) : ['batch-ai-recipient', 'bad-id'],
    queryFn: () => getBatchAIRecipient(id),
    enabled: validId,
    refetchInterval: 5000,
  })

  const conversationID = detail.data?.conversation?.id
  const messages = useQuery({
    queryKey: conversationID ? aiKeys.messages(conversationID) : ['ai', 'conversations', 'no-thread', 'messages'],
    queryFn: () => getConversationMessages(conversationID!),
    enabled: !!conversationID,
    refetchInterval: 5000,
  })

  const statusMutation = useMutation({
    mutationFn: async (target: 'exclude' | 'include') => {
      if (target === 'exclude') return excludeBatchAIRecipient(id)
      return includeBatchAIRecipient(id)
    },
    onSuccess: (_, target) => {
      toast.success(target === 'exclude' ? 'Recipient excluded from AI follow-up' : 'Recipient included again')
      qc.invalidateQueries({ queryKey: batchAIKeys.recipient(id) })
      qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
      if (detail.data?.recipient.batch_id) {
        qc.invalidateQueries({ queryKey: batchAIKeys.followup(detail.data.recipient.batch_id) })
      }
    },
    onError: (e: any) => toast.error(apiError(e, 'Failed to update AI status')),
  })

  const timeline = useMemo(
    () => buildTimeline(detail.data, messages.data || []),
    [detail.data, messages.data],
  )

  if (!validId) {
    return <ErrorBox msg="Bad recipient id" />
  }

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title="AI recipient" subtitle="Loading follow-up profile..." />
        <Spinner />
      </>
    )
  }

  if (detail.isError) {
    return <ErrorBox msg={apiError(detail.error, 'Failed to load AI follow-up detail')} />
  }

  if (!detail.data) {
    return <Empty>Recipient not found.</Empty>
  }

  const d = detail.data
  const r = d.recipient
  const lead = d.lead
  const followup = d.followup
  const batch = d.batch
  const conv = d.conversation
  const isExcluded = r.ai_status === 'excluded'

  return (
    <>
      <PageHeader
        title={r.retailer_name || `Recipient #${r.id}`}
        subtitle={`${r.whatsapp_number} - AI follow-up profile`}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => detail.refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[var(--input-bg)] hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 text-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${detail.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link to="/admin/ai/followups">
              <SecondaryButton><ArrowLeft className="w-4 h-4" /> Follow-ups</SecondaryButton>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <SummaryTile
          icon={<Bot className="w-4 h-4" />}
          label="AI status"
          value={humanizeAIFollowupStatus(r.ai_status)}
          sub={r.updated_at ? `Updated ${fmtRelative(r.updated_at)}` : undefined}
        />
        <SummaryTile
          icon={<Route className="w-4 h-4" />}
          label="Follow-up mode"
          value={followup ? followup.status : 'Not enrolled'}
          sub={followup ? `Step ${followup.current_step} of ${followup.max_messages}` : 'Waiting for sequence setup'}
        />
        <SummaryTile
          icon={<CalendarClock className="w-4 h-4" />}
          label="Next run"
          value={followup?.next_run_at ? fmtRelative(followup.next_run_at) : 'No run scheduled'}
          sub={followup?.next_run_at ? fmtDate(followup.next_run_at) : undefined}
        />
        <SummaryTile
          icon={<MessageSquare className="w-4 h-4" />}
          label="Thread"
          value={conv ? conv.status : 'No conversation'}
          sub={conv ? `${conv.ai_handled_count || 0} AI, ${conv.human_handled_count || 0} human` : 'No WhatsApp reply yet'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.85fr] gap-5">
        <Card hover={false} className="!p-0 overflow-hidden">
          <CardHeader
            title="AI timeline"
            subtitle="Recipient events, follow-up schedule, and WhatsApp conversation messages."
            right={<AIFollowupStatusBadge status={r.ai_status} />}
          />
          {messages.isError && (
            <div className="p-4">
              <ErrorBox msg={apiError(messages.error, 'Failed to load conversation messages')} />
            </div>
          )}
          {timeline.length === 0 ? (
            <Empty>No AI timeline events yet.</Empty>
          ) : (
            <div className="p-5">
              <div className="relative space-y-4">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200 dark:bg-white/10" />
                {timeline.map((item, index) => (
                  <TimelineRow key={item.key} item={item} index={index} />
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card hover={false} className="!p-0">
            <CardHeader title="Retailer context" subtitle="Customer context connected to this AI follow-up." />
            <div className="p-5 space-y-4">
              <InfoRow icon={<Store className="w-4 h-4" />} label="Retailer">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.retailer_name || 'Unknown retailer'}</span>
                  {r.retailer_id && (
                    <Link to={`/admin/retailers/${r.retailer_id}`} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1">
                      Open retailer <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </InfoRow>
              <InfoRow icon={<Phone className="w-4 h-4" />} label="WhatsApp">
                <span className="font-mono">{r.whatsapp_number}</span>
              </InfoRow>
              <InfoRow icon={<UserRound className="w-4 h-4" />} label="Linked lead">
                {lead ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{lead.name || r.retailer_name || r.whatsapp_number}</span>
                    </div>
                    <div className="text-[12px] text-slate-500 dark:text-slate-400">
                      Score {lead.score ?? 0} - {lead.status || 'unknown'}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 text-[12px]">
                      <MiniFact label="Interest" value={lead.interest} />
                      <MiniFact label="Budget" value={lead.budget} />
                      <MiniFact label="Timeline" value={lead.timeline} />
                      <MiniFact label="Location" value={lead.location} />
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">No linked lead yet</span>
                )}
              </InfoRow>
            </div>
          </Card>

          <Card hover={false} className="!p-0">
            <CardHeader title="Agent plan" subtitle="Schedule and behavior driving this recipient." />
            <div className="p-5 space-y-4">
              {followup ? (
                <>
                  <InfoRow icon={<CircleDashed className="w-4 h-4" />} label="Enrollment">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="capitalize">{followup.status}</span>
                      {followup.pause_reason && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-400/20">
                          {followup.pause_reason}
                        </span>
                      )}
                    </div>
                  </InfoRow>
                  <InfoRow icon={<Clock3 className="w-4 h-4" />} label="Cadence">
                    Every {followup.cadence_days} day{followup.cadence_days === 1 ? '' : 's'} - max {followup.max_messages} messages
                  </InfoRow>
                  <InfoRow icon={<Bot className="w-4 h-4" />} label="Tone">
                    {followup.tone || 'friendly'}{followup.checkin_enabled ? ' - check-ins enabled' : ''}
                  </InfoRow>
                  <InfoRow icon={<FileText className="w-4 h-4" />} label="Goal">
                    {followup.goal || 'Default AI follow-up goal'}
                  </InfoRow>
                </>
              ) : (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  This recipient is tracked, but no active AI follow-up enrollment was found.
                </div>
              )}
            </div>
          </Card>

          <Card hover={false} className="!p-0">
            <CardHeader title="Batch and actions" subtitle="Source batch, conversation, and AI controls." />
            <div className="p-5 space-y-4">
              <InfoRow icon={<Hash className="w-4 h-4" />} label="Batch">
                {batch ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/ai/followups/${batch.id}`} className="text-emerald-600 dark:text-emerald-400 hover:underline">
                      AI control #{batch.id}
                    </Link>
                    <Link to={`/admin/batches/${batch.id}`} className="text-xs text-slate-600 dark:text-slate-300 hover:underline inline-flex items-center gap-1">
                      Batch <ExternalLink className="w-3 h-3" />
                    </Link>
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">{batch.status}</span>
                  </div>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Batch not found</span>
                )}
              </InfoRow>
              <InfoRow icon={<MessageSquare className="w-4 h-4" />} label="Conversation">
                {conv ? (
                  <Link to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`} className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1">
                    Open chat <ExternalLink className="w-3 h-3" />
                  </Link>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">No chat created yet</span>
                )}
              </InfoRow>
              <div className="pt-2 flex flex-wrap gap-2">
                {isExcluded ? (
                  <PrimaryButton
                    onClick={() => statusMutation.mutate('include')}
                    disabled={statusMutation.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Include again
                  </PrimaryButton>
                ) : (
                  <SecondaryButton
                    onClick={() => statusMutation.mutate('exclude')}
                    disabled={statusMutation.isPending}
                  >
                    <Ban className="w-4 h-4" /> Exclude from AI
                  </SecondaryButton>
                )}
                {conv && (
                  <Link to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`}>
                    <SecondaryButton><MessageSquare className="w-4 h-4" /> Open chat</SecondaryButton>
                  </Link>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function buildTimeline(detail: BatchAIRecipientDetail | undefined, messages: AIConversationMessage[]): TimelineItem[] {
  if (!detail) return []
  const r = detail.recipient
  const items: TimelineItem[] = [
    {
      key: `recipient-created-${r.id}`,
      at: r.created_at,
      title: 'Recipient entered AI follow-up',
      body: `Status: ${humanizeAIFollowupStatus(r.ai_status)}`,
      icon: <Bot className="w-3.5 h-3.5" />,
      tone: 'emerald',
    },
  ]

  if (detail.batch?.created_at) {
    items.push({
      key: `batch-${detail.batch.id}`,
      at: detail.batch.created_at,
      title: `Batch #${detail.batch.id} uploaded`,
      body: batchDisplayName(detail.batch),
      meta: detail.batch.status,
      icon: <FileText className="w-3.5 h-3.5" />,
      tone: 'slate',
    })
  }

  if (detail.followup?.next_run_at) {
    items.push({
      key: `followup-next-${detail.followup.id}`,
      at: detail.followup.next_run_at,
      title: 'Next AI follow-up scheduled',
      body: `Step ${detail.followup.current_step} - ${detail.followup.tone || 'friendly'} tone`,
      meta: `Every ${detail.followup.cadence_days} day${detail.followup.cadence_days === 1 ? '' : 's'}`,
      icon: <CalendarClock className="w-3.5 h-3.5" />,
      tone: 'amber',
    })
  }

  if (detail.conversation?.started_at) {
    items.push({
      key: `conversation-${detail.conversation.id}`,
      at: detail.conversation.started_at,
      title: 'AI conversation opened',
      body: detail.conversation.summary || detail.conversation.last_message_preview || '',
      meta: detail.conversation.status,
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      tone: 'blue',
    })
  }

  if (r.last_event || r.last_event_at) {
    items.push({
      key: `last-event-${r.id}`,
      at: r.last_event_at || r.updated_at,
      title: 'Latest follow-up event',
      body: r.last_event || 'Recipient status changed',
      icon: r.ai_status === 'failed' ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />,
      tone: r.ai_status === 'failed' ? 'rose' : 'emerald',
    })
  }

  for (const m of messages) {
    const isCustomer = m.role === 'user'
    const isFailed = m.send_status === 'failed'
    items.push({
      key: `message-${m.id}`,
      at: m.created_at,
      title: isCustomer ? 'Customer message' : m.role === 'human' ? 'Team reply' : m.role === 'assistant' ? 'AI reply' : `${m.role} event`,
      body: m.content || '(empty message)',
      meta: messageMeta(m),
      icon: isCustomer ? <UserRound className="w-3.5 h-3.5" /> : m.role === 'human' ? <Send className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />,
      tone: isFailed ? 'rose' : isCustomer ? 'blue' : m.role === 'human' ? 'amber' : m.role === 'assistant' ? 'emerald' : 'violet',
    })
  }

  return items.sort((a, b) => timeValue(b.at) - timeValue(a.at))
}

function messageMeta(m: AIConversationMessage): string {
  const bits: string[] = []
  if (m.model_used) bits.push(m.model_used)
  if (m.send_status) bits.push(m.send_status)
  if (m.send_error) bits.push(m.send_error)
  if (m.tokens_in != null || m.tokens_out != null) bits.push(`${m.tokens_in ?? 0}/${m.tokens_out ?? 0} tokens`)
  return bits.join(' - ')
}

function timeValue(s?: string | null): number {
  if (!s) return 0
  const n = new Date(s).getTime()
  return Number.isFinite(n) ? n : 0
}

function SummaryTile({
  icon, label, value, sub,
}: {
  icon: JSX.Element
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card hover={false} className="p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span className="w-7 h-7 rounded-md grid place-items-center bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-white truncate" title={value}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate" title={sub}>{sub}</div>}
    </Card>
  )
}

function TimelineRow({ item, index }: { item: TimelineItem; index: number }) {
  const tone = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    blue: 'bg-blue-50 text-blue-700 border-blue-200/70 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/20',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/20',
    rose: 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/20',
    violet: 'bg-violet-50 text-violet-700 border-violet-200/70 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/20',
    slate: 'bg-slate-50 text-slate-600 border-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:border-white/15',
  }[item.tone]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.2 }}
      className="relative pl-11"
    >
      <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border grid place-items-center ${tone}`}>
        {item.icon}
      </div>
      <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</div>
            {item.body && (
              <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap line-clamp-3">
                {item.body}
              </div>
            )}
            {item.meta && (
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 break-words">
                {item.meta}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">
            <div>{fmtRelative(item.at)}</div>
            <div className="mt-0.5">{fmtDate(item.at)}</div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function InfoRow({
  icon, label, children,
}: {
  icon: JSX.Element
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-8 h-8 rounded-md grid place-items-center bg-slate-50 text-slate-500 dark:bg-white/10 dark:text-slate-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </div>
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-100 break-words">
          {children}
        </div>
      </div>
    </div>
  )
}

function MiniFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-800 dark:text-slate-100 truncate" title={value || 'Not set'}>
        {value || 'Not set'}
      </div>
    </div>
  )
}

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback
}
