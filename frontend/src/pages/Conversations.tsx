import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  MessagesSquare, Search, Send, ChevronLeft, ChevronRight, Hand, Bot,
  CheckCircle2, AlertTriangle, Mic, User as UserIcon, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { fmtRelative } from '@/lib/format'
import {
  aiKeys, getConversation, getConversationMessages, handBackConversation,
  listConversations, sendHumanMessage, takeOverConversation,
} from '@/lib/ai'
import type { AIConversation, AIConversationMessage } from '@/lib/types'

/**
 * /admin/ai/conversations — live inbox of AI-handled WhatsApp threads.
 *
 * Split layout:
 *   - Left (380px): conversation list, newest first. Polls every 5s.
 *   - Right: selected conversation's thread + AI metadata disclosure +
 *     footer with "Take over" / "Hand back to AI" / "Send reply".
 *
 * No SSE in Phase 2 — polling is sufficient for an internal admin tool.
 */
export default function Conversations() {
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [phoneFilter, setPhoneFilter] = useState('')
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const phoneParam = searchParams.get('phone') || ''

  const list = useQuery({
    queryKey: aiKeys.conversations({ status: statusFilter === 'all' ? undefined : statusFilter }),
    queryFn: () => listConversations({ status: statusFilter === 'all' ? undefined : statusFilter, limit: 100 }),
    refetchInterval: 5000,
  })

  const items = list.data?.items || []
  const filtered = useMemo(() => {
    if (!phoneFilter.trim()) return items
    const q = phoneFilter.toLowerCase()
    return items.filter((c) => c.phone.toLowerCase().includes(q))
  }, [items, phoneFilter])

  useEffect(() => {
    if (phoneParam.trim()) setPhoneFilter(phoneParam.trim())
  }, [phoneParam])

  // Auto-select the first visible conversation, and recover if the selected
  // conversation is no longer in the list after a refresh/key migration.
  useEffect(() => {
    if (!items.length) {
      if (selectedID) setSelectedID(null)
      return
    }
    const visible = filtered.length ? filtered : items
    if (!selectedID || !visible.some((c) => c.id === selectedID)) {
      setSelectedID(visible[0].id)
    }
  }, [filtered, items, selectedID])

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <PageHeader
        title="Conversations"
        subtitle="Live inbox of WhatsApp threads the AI is handling. Polls every 5s."
        right={
          <button
            type="button"
            onClick={() => list.refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                       border border-slate-300 dark:border-slate-700
                       bg-white dark:bg-[var(--input-bg)]
                       hover:bg-slate-50 dark:hover:bg-white/5
                       text-slate-700 dark:text-slate-200 text-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${list.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className="admin-conversation-split lg:gap-4">
        {/* Left: list */}
        <Card className="!p-0 overflow-hidden sm:sticky sm:top-6" hover={false}>
          <div className="p-3 border-b border-slate-200 dark:border-white/10 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Users</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {filtered.length} shown from {items.length}
                </div>
              </div>
              {list.isFetching && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={phoneFilter}
                onChange={(e) => setPhoneFilter(e.target.value)}
                placeholder="Filter by phone…"
                className="w-full pl-9 pr-3 py-2 rounded-md text-sm
                           bg-white dark:bg-[var(--input-bg)]
                           border border-slate-300 dark:border-[var(--input-border)]
                           text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { v: 'all', label: 'All' },
                { v: 'active', label: 'Active' },
                { v: 'handed_off', label: 'Handed off' },
              ].map((f) => (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => setStatusFilter(f.v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                             border transition-colors
                             ${statusFilter === f.v
                               ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                               : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100vh-300px)] min-h-[420px] overflow-y-auto">
            {list.isLoading ? <Spinner /> :
             list.isError ? <ErrorBox msg={(list.error as any)?.message || 'Failed to load'} /> :
             filtered.length === 0 ? (
               <Empty>{phoneFilter || statusFilter !== 'all' ? 'No conversations match.' : 'No conversations yet. Send a WhatsApp message to get started.'}</Empty>
             ) : (
              <ul>
                {filtered.map((c) => (
                  <li key={c.id}>
                    <ConvListItem conv={c} active={c.id === selectedID} onClick={() => setSelectedID(c.id)} />
                  </li>
                ))}
              </ul>
             )}
          </div>
        </Card>

        {/* Right: thread */}
        <div className="min-w-0">
          {selectedID ? (
            <ConversationDetail id={selectedID} />
          ) : (
            <Card className="h-[400px] grid place-items-center">
              <Empty>
                <MessagesSquare className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                Select a conversation on the left to view its thread.
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversation list item
// ---------------------------------------------------------------------------

function ConvListItem({ conv, active, onClick }: {
  conv: AIConversation
  active: boolean
  onClick: () => void
}) {
  const isHandedOff = conv.status === 'handed_off'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-slate-100 dark:border-white/5
                 transition-colors
                 ${active
                   ? 'bg-emerald-50 dark:bg-emerald-500/10'
                   : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-sm text-slate-800 dark:text-slate-100">
          {conv.phone}
        </span>
        {isHandedOff ? (
          <PillPop className="pill-amber !text-[9px]">handed off</PillPop>
        ) : (
          <PillPop className="pill-green !text-[9px]">{conv.status}</PillPop>
        )}
        <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
          {fmtRelative(conv.last_message_at)}
        </span>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
        {conv.last_message_preview || <span className="italic text-slate-400">(no messages yet)</span>}
      </div>
      {conv.lead_id && (
        <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          Lead #{conv.lead_id}{conv.lead_name ? ` — ${conv.lead_name}` : ''}
        </div>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Conversation detail (right pane)
// ---------------------------------------------------------------------------

function ConversationDetail({ id }: { id: number }) {
  const qc = useQueryClient()

  const conv = useQuery({
    queryKey: aiKeys.conversation(id),
    queryFn: () => getConversation(id),
    refetchInterval: 5000,
  })
  const messages = useQuery({
    queryKey: aiKeys.messages(id),
    queryFn: () => getConversationMessages(id),
    refetchInterval: 5000,
  })

  const take = useMutation({
    mutationFn: () => takeOverConversation(id),
    onSuccess: () => {
      toast.success('AI paused. You are now handling this conversation.')
      qc.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      qc.invalidateQueries({ queryKey: aiKeys.conversation(id) })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Failed'),
  })
  const hand = useMutation({
    mutationFn: () => handBackConversation(id),
    onSuccess: () => {
      toast.success('AI is back handling this conversation.')
      qc.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      qc.invalidateQueries({ queryKey: aiKeys.conversation(id) })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Failed'),
  })

  const isHandedOff = conv.data?.status === 'handed_off'
  const visibleMessages = (messages.data || [])
    .filter(isCustomerVisibleMessage)
    .map((msg) => ({ ...msg, content: cleanVisibleConversationText(msg.content) }))

  return (
    <Card className="!p-0 overflow-hidden flex flex-col min-h-[620px]" hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{conv.data?.phone || '…'}</span>
            {isHandedOff ? (
              <PillPop className="pill-amber">handed off</PillPop>
            ) : (
              <PillPop className="pill-green">active</PillPop>
            )}
            {conv.data?.lead_id && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                · Lead #{conv.data.lead_id}
              </span>
            )}
          </span>
        }
        subtitle={`${conv.data?.ai_handled_count || 0} AI · ${conv.data?.human_handled_count || 0} human`}
        right={
          <div className="flex items-center gap-2">
            {isHandedOff ? (
              <PrimaryButton onClick={() => hand.mutate()} disabled={hand.isPending}>
                <Bot className="w-4 h-4" /> Hand back to AI
              </PrimaryButton>
            ) : (
              <SecondaryButton onClick={() => take.mutate()} disabled={take.isPending}>
                <Hand className="w-4 h-4" /> Take over
              </SecondaryButton>
            )}
          </div>
        }
      />

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/40 dark:bg-white/[0.02] min-h-[360px] max-h-[calc(100vh-360px)]">
        {messages.isLoading ? <Spinner /> :
         messages.isError ? <ErrorBox msg={(messages.error as any)?.message || 'Failed'} /> :
         visibleMessages.length === 0 ? <Empty>No messages yet.</Empty> :
         visibleMessages.map((m) => (
           <MessageBubble key={m.id} m={m} />
         ))}
      </div>

      {/* Composer (Phase 2: store + audit; outbound send comes in Phase 3) */}
      <div className="p-3 border-t border-slate-200 dark:border-white/10">
        <ReplyComposer
          conversationID={id}
          disabled={!isHandedOff}
          onSent={() => {
            qc.invalidateQueries({ queryKey: aiKeys.messages(id) })
            qc.invalidateQueries({ queryKey: ['ai', 'conversations'] })
          }}
        />
        {!isHandedOff && (
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Bot className="w-3 h-3" /> AI is handling this conversation. Click "Take over" to send replies manually.
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

const INTERNAL_TEXT_MARKERS = [
  '\u003c\uff5cDSML\uff5cfunction_calls',
  '\u003c\uff5cfunction_calls',
  '\u003c\uff5ctool_calls',
  '<｜DSML｜function_calls',
  '<|DSML|function_calls',
  '<｜function_calls',
  '<function_calls',
  '<｜tool_calls',
  '<tool_calls',
  '<|tool_call',
  '<tool_call',
]

function cleanVisibleConversationText(value?: string | null): string {
  let clean = (value || '').trim()
  if (!clean) return ''

  for (const marker of INTERNAL_TEXT_MARKERS) {
    const idx = clean.indexOf(marker)
    if (idx >= 0) clean = clean.slice(0, idx).trim()
  }

  clean = clean
    .split('<customer_reply>').join('')
    .split('</customer_reply>').join('')
    .split('<human_review_json>').join('')
    .split('</human_review_json>').join('')
    .trim()

  return clean
}

function isCustomerVisibleMessage(m: AIConversationMessage): boolean {
  if (m.role === 'tool' || m.role === 'system') return false
  if (m.role === 'assistant' && !cleanVisibleConversationText(m.content)) return false
  return true
}

function MessageBubble({ m }: { m: AIConversationMessage }) {
  const [showMeta, setShowMeta] = useState(false)
  const isUser = m.role === 'user'
  const isTool = false
  const isHuman = m.role === 'human'
  const isAssistant = m.role === 'assistant'
  const sendFailed = (isHuman || isAssistant) && m.send_status === 'failed'
  const humanSendPending = isHuman && m.send_status === 'pending'

  // Chat-app convention: incoming on the LEFT, outgoing on the RIGHT.
  // Tool messages are debug metadata — render small, left-aligned, dimmed.
  const isIncoming = isUser
  const Icon = isUser ? UserIcon : isHuman ? Hand : Bot
  const tone = isUser
    // Incoming user message — neutral slate bubble on the LEFT.
    ? 'bg-white dark:bg-white/[0.05] border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-100'
    : sendFailed
      // Failed outbound — rose tint on the RIGHT.
      ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-400/30 text-rose-900 dark:text-rose-100'
    : isHuman
      // Team-sent (manual takeover reply) — amber tint on the RIGHT.
      ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-400/30 text-amber-900 dark:text-amber-100'
      : isTool
        // Tool/system message — violet, dimmed.
        ? 'bg-violet-50/70 dark:bg-violet-500/10 border-violet-200 dark:border-violet-400/30 text-violet-900 dark:text-violet-100'
        // AI-sent reply — emerald tint on the RIGHT.
        : 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-400/30 text-emerald-900 dark:text-emerald-100'

  // Avatar color mirrors the bubble tint so the operator reads "incoming"
  // vs "outgoing" at a glance.
  const avatarClass = isTool
    ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
    : isHuman
      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
      : isUser
        ? 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
        : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex gap-2 ${isIncoming ? 'justify-start' : 'justify-end'}`}
    >
      {isIncoming && (
        <div className={`shrink-0 w-7 h-7 rounded-full grid place-items-center ${avatarClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      )}
      <div className={`max-w-[78%] rounded-2xl border px-3 py-2 text-sm shadow-sm ${tone}
                       ${isIncoming ? 'rounded-tl-sm' : 'rounded-tr-sm'}`}>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
            {isUser ? 'customer'
              : isHuman ? 'team (human)'
              : isTool ? 'tool'
              : 'AI'}
          </span>
          {m.is_voice && (
            <PillPop className="pill-violet !text-[9px]"><Mic className="w-3 h-3 inline -mt-0.5 mr-0.5" />voice</PillPop>
          )}
          <span className="ml-auto text-[10px] opacity-50">{fmtRelative(m.created_at)}</span>
        </div>
        <div className="whitespace-pre-wrap">
          {m.content || <span className="italic opacity-60">(empty)</span>}
        </div>
        {isHuman && humanSendPending && (
          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> Sending to WhatsApp...
          </div>
        )}
        {sendFailed && (
          <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="break-words">Not sent{m.send_error ? ` - ${m.send_error}` : ''}</span>
          </div>
        )}
        {(isHuman || isAssistant) && m.send_status === 'sent' && (
          <div className="mt-1 text-[11px] opacity-70 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span className="break-all">Sent to WhatsApp{m.provider_msg_id ? ` - ${m.provider_msg_id}` : ''}</span>
          </div>
        )}
        {isAssistant && (m.model_used || m.tokens_in != null) && (
          <button
            type="button"
            onClick={() => setShowMeta((s) => !s)}
            className="mt-1 text-[10px] opacity-70 hover:opacity-100
                       inline-flex items-center gap-0.5"
          >
            {showMeta ? <ChevronRight className="w-3 h-3 rotate-90" /> : <ChevronRight className="w-3 h-3" />}
            {m.model_used ? `${m.model_used}` : 'meta'} · {m.tokens_in ?? 0}/{m.tokens_out ?? 0} tok · ${(m.cost_usd ?? 0).toFixed(6)}
          </button>
        )}
        {isAssistant && showMeta && (
          <div className="mt-1 text-[10px] opacity-70 grid grid-cols-2 gap-x-3">
            <div><span className="opacity-60">model:</span> {m.model_used || '—'}</div>
            <div><span className="opacity-60">provider:</span> {m.provider || '—'}</div>
            <div><span className="opacity-60">tokens:</span> {m.tokens_in ?? 0} in / {m.tokens_out ?? 0} out</div>
            <div><span className="opacity-60">latency:</span> {m.latency_ms ?? 0} ms</div>
            <div><span className="opacity-60">cost:</span> ${(m.cost_usd ?? 0).toFixed(6)}</div>
            <div><span className="opacity-60">voice:</span> {m.is_voice ? 'yes' : 'no'}</div>
          </div>
        )}
        {isTool && m.tool_summary && (
          <div className="mt-1 text-[11px] italic opacity-80">
            → {m.tool_summary}
          </div>
        )}
      </div>
      {!isIncoming && (
        <div className={`shrink-0 w-7 h-7 rounded-full grid place-items-center ${avatarClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Reply composer (human-only)
// ---------------------------------------------------------------------------

function ReplyComposer({ conversationID, disabled, onSent }: {
  conversationID: number
  disabled: boolean
  onSent: () => void
}) {
  const [text, setText] = useState('')
  const [lastStatus, setLastStatus] = useState<'sent' | 'failed' | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () => sendHumanMessage(conversationID, text.trim()),
    onSuccess: (resp) => {
      setText('')
      onSent()
      if (resp && (resp as any).sent === false) {
        const errMsg = (resp as any).error || (resp as any).message?.send_error || 'WhatsApp send failed'
        setLastStatus('failed')
        setLastError(errMsg)
        toast.error(errMsg)
        return
      }
      setLastStatus('sent')
      setLastError(null)
      toast.success('Reply sent to WhatsApp')
      // Clear the status pill after a short delay so the UI isn't noisy.
      setTimeout(() => setLastStatus(null), 4000)
    },
    onError: (e: any) => {
      const errMsg = apiError(e, 'Send failed')
      setLastStatus('failed')
      setLastError(errMsg)
      toast.error(errMsg)
    },
  })

  function submit() {
    if (!text.trim() || disabled || send.isPending) return
    setLastStatus(null)
    setLastError(null)
    send.mutate()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={disabled ? 'Take over the conversation to reply manually.' : 'Type a reply…'}
          disabled={disabled}
          className="flex-1"
        />
        <PrimaryButton onClick={submit} disabled={disabled || !text.trim() || send.isPending}>
          <Send className="w-4 h-4" /> {send.isPending ? 'Sending…' : 'Send'}
        </PrimaryButton>
      </div>
      {lastStatus === 'sent' && (
        <div className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Sent to WhatsApp.
        </div>
      )}
      {lastStatus === 'failed' && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-words">Message was not sent{lastError ? ` - ${lastError}` : ''}.</span>
        </div>
      )}
    </div>
  )
}

function apiError(e: any, fallback: string) {
  return e?.response?.data?.error || e?.message || fallback
}

// Compile-time silence on unused imports for lib references
// that the runtime path uses through JSX only.
const _ = { ChevronLeft, CheckCircle2, CardHeader: true, PageHeader: true }
void _
