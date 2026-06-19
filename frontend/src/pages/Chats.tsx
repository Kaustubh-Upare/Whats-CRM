import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, MessagesSquare, Inbox,
  Check, CheckCheck, AlertTriangle, Clock,
  Phone, ArrowRight, ArrowDown, Send, FlaskConical, X, RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { fmtRelative } from '@/lib/format'

type Conversation = {
  retailer_id?: number | null
  phone: string
  retailer_name: string
  last_message_at: string
  last_preview: string
  last_status: string
  last_direction: 'outbound' | 'inbound' | string
  message_count: number
  has_failed: boolean
}

type ThreadMessage = {
  id: number
  direction: 'outbound' | 'inbound'
  body: string
  status: string
  occurred_at: string
  template_name?: string
  language_code?: string
  last_error?: string | null
  provider_msg_id?: string | null
  invoice_number?: string | null
  amount?: number | null
  message_job_id: number
}

function convKey(c: Conversation) {
  return c.retailer_id != null ? `r:${c.retailer_id}` : `p:${c.phone}`
}

export default function Chats() {
  const [q, setQ] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [simOpen, setSimOpen] = useState(false)
  const [simPhone, setSimPhone] = useState('')
  const [simBody, setSimBody] = useState('')
  const [simName, setSimName] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)
  const qc = useQueryClient()

  const convs = useQuery({
    queryKey: ['conversations', q],
    queryFn: async () =>
      (await api.get(`/api/conversations?q=${encodeURIComponent(q)}&limit=200`)).data as {
        items: Conversation[]
        total: number
      },
    refetchInterval: 5000,
  })

  const active = useMemo(
    () => (convs.data?.items || []).find((c) => convKey(c) === activeKey) || null,
    [convs.data, activeKey],
  )

  // Auto-pick the first conversation on first load.
  useEffect(() => {
    if (!activeKey && convs.data?.items?.length) {
      setActiveKey(convKey(convs.data.items[0]))
    }
  }, [convs.data, activeKey])

  // Thread query — uses retailer_id when available, otherwise falls back to
  // a dedicated endpoint for unlinked-phone messages (added below).
  const thread = useQuery({
    queryKey: ['conversation', active?.retailer_id, active?.phone],
    queryFn: async () => {
      if (!active) return { items: [] as ThreadMessage[] }
      if (active.retailer_id != null) {
        return (await api.get(`/api/conversations/${active.retailer_id}/messages?limit=500`)).data as { items: ThreadMessage[] }
      }
      // Unlinked phone fallback
      return (await api.get(`/api/conversations/by-phone/${encodeURIComponent(active.phone)}/messages?limit=500`)).data as { items: ThreadMessage[] }
    },
    enabled: !!active,
    refetchInterval: 5000,
  })

  const failedCount = (convs.data?.items || []).filter((c) => c.has_failed).length

  // Helper to fire the dev simulate-inbound endpoint. Useful when the user
  // wants to test the /chats UI from the admin side without a real Meta
  // round-trip (e.g. before ngrok is configured).
  async function fireSimulatedInbound() {
    setSimBusy(true)
    setSimError(null)
    try {
      const phone = simPhone || active?.phone || ''
      const body = simBody || 'Test inbound from dev tool'
      const name = simName || active?.retailer_name || ''
      if (!phone) {
        setSimError('phone is required (pick a conversation or type a phone)')
        return
      }
      const res = await api.post('/api/dev/simulate-inbound', { phone, body, name })
      // Refresh both lists so the new bubble shows up immediately.
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation'] })
      // Auto-select the conversation for this phone.
      setActiveKey(`p:${res.data.phone}`) // works whether retailer_id is null or set
      setSimOpen(false)
      setSimBody('')
    } catch (e: any) {
      setSimError(e?.response?.data?.error || e?.message || 'failed')
    } finally {
      setSimBusy(false)
    }
  }

  return (
    <div className="-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 h-[calc(100vh-64px)] flex flex-col bg-slate-50">
      <PageHeader
        title="Chats"
        subtitle={`${convs.data?.total ?? 0} conversation${(convs.data?.total ?? 0) === 1 ? '' : 's'} · ${failedCount > 0 ? `${failedCount} with failures` : 'all clear'}`}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => convs.refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         border border-slate-300 hover:bg-slate-50 text-sm"
              title="Refresh conversations"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              onClick={() => {
                setSimError(null)
                setSimOpen(true)
                setSimPhone(active?.phone || '')
                setSimName(active?.retailer_name || '')
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         bg-emerald-600 hover:bg-emerald-700 text-white text-sm
                         shadow-sm transition-colors"
              title="Simulate an inbound WhatsApp message (dev tool)"
            >
              <FlaskConical className="w-3.5 h-3.5" /> Simulate inbound
            </button>
          </div>
        }
      />

      {/* Simulate-inbound modal */}
      <AnimatePresence>
        {simOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4"
            onClick={() => !simBusy && setSimOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-emerald-600" />
                  <div className="font-semibold">Simulate inbound message</div>
                </div>
                <button
                  onClick={() => setSimOpen(false)}
                  disabled={simBusy}
                  className="p-1 rounded hover:bg-slate-100 text-slate-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div className="text-xs text-slate-500 -mt-1 mb-2">
                  Posts to <span className="font-mono">/api/dev/simulate-inbound</span> using
                  the same code path as the Meta webhook — useful when ngrok isn't reachable.
                </div>
                <Field label="Phone" hint="E.164 without + (e.g. 919168810152)">
                  <input
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    placeholder="919168810152"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  />
                </Field>
                <Field label="Message body">
                  <textarea
                    value={simBody}
                    onChange={(e) => setSimBody(e.target.value)}
                    rows={3}
                    placeholder="Type the inbound message text…"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  />
                </Field>
                <Field label="Display name (optional)">
                  <input
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    placeholder="Retailer name (upgrades '(unknown)' placeholder)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  />
                </Field>
                {simError && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
                    {simError}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2">
                <button
                  onClick={() => setSimOpen(false)}
                  disabled={simBusy}
                  className="px-3 py-1.5 rounded-md text-sm text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={fireSimulatedInbound}
                  disabled={simBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                             bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm
                             shadow-sm transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  {simBusy ? 'Sending…' : 'Send inbound'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 px-6 lg:px-8 pb-6 lg:pb-8 min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 h-full">
          {/* LEFT: conversation list */}
          <aside className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-0">
            {/* Search header */}
            <div className="p-4 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search retailer or phone…"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl
                             placeholder:text-slate-400 text-slate-800
                             focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400
                             transition-shadow"
                />
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {convs.isLoading ? (
                <div className="p-8"><Spinner /></div>
              ) : convs.isError ? (
                <div className="p-4"><ErrorBox msg={(convs.error as any)?.message} /></div>
              ) : (convs.data?.items || []).length === 0 ? (
                <EmptyConversations hasQuery={!!q} />
              ) : (
                <AnimatePresence initial={false}>
                  {convs.data!.items.map((c, i) => (
                    <ConversationRow
                      key={convKey(c)}
                      c={c}
                      isActive={convKey(c) === activeKey}
                      onClick={() => setActiveKey(convKey(c))}
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </aside>

          {/* RIGHT: thread */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-0">
            {!active ? (
              <EmptyThread />
            ) : (
              <>
                <ThreadHeader active={active} />
                <ThreadPane thread={thread} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Conversation row ---------------- */

function ConversationRow({
  c,
  isActive,
  onClick,
  index,
}: {
  c: Conversation
  isActive: boolean
  onClick: () => void
  index: number
}) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ delay: Math.min(index * 0.02, 0.2), duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={`relative w-full text-left px-4 py-3.5 flex items-start gap-3 border-b border-slate-100
                  transition-colors duration-150
                  ${isActive ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
    >
      {isActive && (
        <motion.span
          layoutId="active-conv-indicator"
          className="absolute left-0 top-3 bottom-3 w-0.5 bg-brand-500 rounded-r-full"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <Avatar name={c.retailer_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm text-slate-900 truncate flex items-center gap-1.5">
            {c.retailer_name}
            <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wide
                             text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-px rounded shrink-0">
              WA
            </span>
          </span>
          <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
            {fmtRelative(c.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Phone className="w-3 h-3 text-slate-400" />
          <span className="text-[11px] text-slate-500 font-mono truncate">{c.phone}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <StatusDot status={c.last_status} failed={c.has_failed} direction={c.last_direction} />
          <span className="text-xs text-slate-600 truncate flex-1">
            {c.last_preview || <span className="text-slate-400 italic">No messages yet</span>}
          </span>
        </div>
      </div>
      {c.message_count > 0 && (
        <span className="ml-1 bg-slate-100 text-slate-600 text-[10px] font-semibold
                         rounded-full px-2 py-0.5 shrink-0 tabular-nums">
          {c.message_count}
        </span>
      )}
    </motion.button>
  )
}

/* ---------------- Thread (right pane) ---------------- */

function ThreadHeader({ active }: { active: Conversation }) {
  return (
    <header className="px-5 py-3.5 border-b border-slate-100 bg-white flex items-center gap-3 shrink-0">
      <Avatar name={active.retailer_name} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
          {active.retailer_name}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide
                           text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
            via WhatsApp
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Phone className="w-3 h-3 text-slate-400" />
          <span className="text-xs text-slate-500 font-mono truncate">{active.phone}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {active.has_failed && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700
                           bg-rose-50 border border-rose-200 px-2 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" /> failed
          </span>
        )}
        <span className="text-[11px] text-slate-500 tabular-nums">
          {active.message_count} message{active.message_count === 1 ? '' : 's'}
        </span>
      </div>
    </header>
  )
}

function ThreadPane({
  thread,
}: {
  thread: ReturnType<typeof useQuery<{ items: ThreadMessage[] }>>
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [thread.data?.items?.length])

  if (thread.isLoading) {
    return <div className="flex-1 grid place-items-center"><Spinner /></div>
  }
  if (thread.isError) {
    return <div className="p-4"><ErrorBox msg={(thread.error as any)?.message} /></div>
  }
  const items = thread.data?.items || []

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto min-h-0 px-6 py-6 space-y-3"
      style={{
        backgroundColor: '#f0f2f5',
        backgroundImage:
          'radial-gradient(circle at 20px 20px, rgba(255,255,255,0.7) 1px, transparent 1.5px)',
        backgroundSize: '32px 32px',
      }}
    >
      {items.length === 0 ? (
        <div className="h-full grid place-items-center">
          <div className="text-center text-slate-500">
            <div className="w-14 h-14 mx-auto rounded-full bg-white shadow-sm grid place-items-center mb-3">
              <MessagesSquare className="w-6 h-6 text-slate-400" />
            </div>
            <div className="text-sm font-medium text-slate-700">No messages yet</div>
            <div className="text-xs text-slate-400 mt-1">Approved batch messages will appear here.</div>
          </div>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {items.map((m, i) => (
            <Bubble
              key={`${m.direction}-${m.id}`}
              m={m}
              showDate={i === 0 || dayChanged(items[i - 1].occurred_at, m.occurred_at)}
            />
          ))}
        </AnimatePresence>
      )}
    </div>
  )
}

function dayChanged(prev: string, cur: string): boolean {
  if (!prev) return true
  return new Date(prev).toDateString() !== new Date(cur).toDateString()
}

/* ---------------- Bubble ---------------- */

function Bubble({ m, showDate }: { m: ThreadMessage; showDate: boolean }) {
  const isOut = m.direction === 'outbound'
  const shortErr = m.last_error ? shortError(m.last_error) : null
  const [showFullErr, setShowFullErr] = useState(false)
  const isFailed = m.status === 'failed'

  return (
    <>
      {showDate && (
        <div className="flex justify-center my-2">
          <span className="text-[11px] text-slate-600 bg-white/80 backdrop-blur-sm
                           border border-slate-200 rounded-full px-3 py-1 shadow-sm">
            {dayLabel(m.occurred_at)}
          </span>
        </div>
      )}
      <motion.div
        layout
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className={`relative max-w-[72%] min-w-[80px] rounded-2xl px-3.5 py-2 shadow-sm
                      ${isFailed
                        ? 'bg-rose-50 text-slate-900 rounded-br-md border-2 border-rose-300'
                        : isOut
                          ? 'bg-[#d9fdd3] text-slate-900 rounded-br-md'
                          : 'bg-white text-slate-900 rounded-bl-md border border-slate-100'
                      }`}
        >
          {/* Direction pill — ITC ↔ WhatsApp ↔ Retailer */}
          <div className={`flex items-center gap-1 mb-1 text-[10px] font-medium ${isOut ? 'text-emerald-700' : 'text-sky-700'}`}>
            {isOut ? (
              <>
                <span>ITC</span>
                <ArrowRight className="w-3 h-3" />
                <span className="px-1 rounded bg-emerald-100/60">WhatsApp</span>
                <ArrowRight className="w-3 h-3" />
                <span>Retailer</span>
              </>
            ) : (
              <>
                <span>Retailer</span>
                <ArrowRight className="w-3 h-3" />
                <span className="px-1 rounded bg-sky-100/60">WhatsApp</span>
                <ArrowRight className="w-3 h-3" />
                <span>ITC</span>
              </>
            )}
          </div>

          {/* Body */}
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
            {m.body || <span className="text-slate-400 italic">—</span>}
          </div>

          {/* Meta row: time + ticks */}
          <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
            <span className="text-[10px] text-slate-500 tabular-nums">
              {fmtTime(m.occurred_at)}
            </span>
            {isOut && <StatusTicks status={m.status} />}
          </div>

          {/* Compact error block — short by default, click to expand */}
          {shortErr && (
            <button
              onClick={() => setShowFullErr((v) => !v)}
              className="mt-1.5 w-full text-left text-[11px] text-rose-700 bg-rose-50
                         border border-rose-200 rounded-lg px-2 py-1.5
                         flex items-start gap-1.5 hover:bg-rose-100 transition-colors"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="break-words">
                {showFullErr ? m.last_error : shortErr}
              </span>
              {m.last_error && m.last_error.length > shortErr.length && (
                <span className="ml-auto text-[10px] text-rose-500 shrink-0">
                  {showFullErr ? 'less' : 'more'}
                </span>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </>
  )
}

/**
 * Pull the friendly title + error code out of Meta's verbose error JSON.
 *
 * Input:  `whatsapp api error: status=403 body={"error":{"message":"(#131005) Access denied",...}}`
 * Output: `Access denied (#131005)`
 *
 * Falls back to the first 100 chars if the body isn't a JSON envelope.
 */
function shortError(raw: string): string {
  // Try to find the JSON envelope
  const idx = raw.indexOf('{')
  if (idx === -1) {
    return raw.length > 100 ? raw.slice(0, 97) + '…' : raw
  }
  const jsonStart = idx
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonEnd <= jsonStart) {
    return raw.length > 100 ? raw.slice(0, 97) + '…' : raw
  }
  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    const msg = parsed?.error?.message
    const code = parsed?.error?.code
    if (msg && typeof msg === 'string') {
      // Strip the leading "(#123456)" if it's already in the message
      const cleaned = msg.replace(/^\s*\(#\d+\)\s*/, '')
      if (code) return `${cleaned} (#${code})`
      return cleaned
    }
  } catch {
    // not JSON, fall through
  }
  return raw.length > 100 ? raw.slice(0, 97) + '…' : raw
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

/* ---------------- Atoms ---------------- */

function StatusTicks({ status }: { status: string }) {
  if (status === 'failed') {
    return <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
  }
  if (status === 'read') {
    return <CheckCheck className="w-3.5 h-3.5 text-sky-600" />
  }
  if (status === 'delivered') {
    return <CheckCheck className="w-3.5 h-3.5 text-slate-500" />
  }
  if (status === 'sent') {
    return <Check className="w-3.5 h-3.5 text-slate-500" />
  }
  if (status === 'sending' || status === 'queued') {
    return <Clock className="w-3.5 h-3.5 text-slate-400 animate-pulse" />
  }
  return null
}

function StatusDot({
  status,
  failed,
  direction,
}: {
  status: string
  failed: boolean
  direction: string
}) {
  if (failed) return <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
  if (direction === 'inbound') return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
  if (status === 'read') return <CheckCheck className="w-3 h-3 text-sky-500 shrink-0" />
  if (status === 'delivered') return <CheckCheck className="w-3 h-3 text-slate-400 shrink-0" />
  if (status === 'sent') return <Check className="w-3 h-3 text-slate-400 shrink-0" />
  return <Clock className="w-3 h-3 text-slate-300 shrink-0" />
}

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  const hue = hashHue(name)
  return (
    <div
      className="w-10 h-10 rounded-full grid place-items-center text-white text-sm font-semibold shrink-0 shadow-sm ring-2 ring-white"
      style={{
        backgroundColor: `hsl(${hue} 55% 48%)`,
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${(hue + 30) % 360} 55% 42%))`,
      }}
    >
      {initials}
    </div>
  )
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return h
}

/* ---------------- Empty states ---------------- */

function EmptyConversations({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="h-full grid place-items-center px-6">
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 grid place-items-center mb-3">
          <Inbox className="w-7 h-7 text-slate-300" />
        </div>
        <div className="text-sm font-medium text-slate-700">
          {hasQuery ? 'No matches' : 'No conversations yet'}
        </div>
        <div className="text-xs text-slate-400 mt-1 max-w-[240px] mx-auto leading-relaxed">
          {hasQuery
            ? 'Try a different name or phone number.'
            : 'Approve a batch in /batches — sent messages will appear here as chat threads.'}
        </div>
      </div>
    </div>
  )
}

function EmptyThread() {
  return (
    <div className="flex-1 grid place-items-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-brand-50 to-brand-100
                        grid place-items-center mb-4 shadow-inner">
          <MessagesSquare className="w-9 h-9 text-brand-500" />
        </div>
        <div className="text-base font-semibold text-slate-700">Your chats</div>
        <div className="text-sm text-slate-400 mt-1 max-w-[280px]">
          Select a conversation from the left to view messages and delivery status.
        </div>
      </div>
    </div>
  )
}

/* ---------------- Field (modal input) ---------------- */

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-700 mb-1">
        {label}
        {hint && <span className="text-slate-400 font-normal ml-1">— {hint}</span>}
      </div>
      {children}
    </label>
  )
}