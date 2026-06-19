import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, ChevronDown, ChevronRight, Inbox, RefreshCw, AlertTriangle, MessageSquare, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { fmtDate, fmtRelative } from '@/lib/format'

type WebhookLog = {
  id: number
  received_at: string
  source_ip?: string | null
  user_agent?: string | null
  event_kind: string
  payload: any
  parsed_messages: number
  parsed_statuses: number
  parse_error?: string | null
}

const kindStyle: Record<string, { bg: string; fg: string; label: string; icon: any }> = {
  message: { bg: 'bg-emerald-50 border-emerald-200', fg: 'text-emerald-700', label: 'inbound', icon: MessageSquare },
  status:  { bg: 'bg-sky-50 border-sky-200',         fg: 'text-sky-700',     label: 'status',  icon: CheckCircle2 },
  mixed:   { bg: 'bg-violet-50 border-violet-200',   fg: 'text-violet-700',  label: 'mixed',   icon: Activity },
  error:   { bg: 'bg-rose-50 border-rose-200',       fg: 'text-rose-700',    label: 'error',   icon: AlertTriangle },
  unknown: { bg: 'bg-slate-50 border-slate-200',     fg: 'text-slate-600',   label: 'other',   icon: Inbox },
}

export default function WebhookLogs() {
  const logs = useQuery({
    queryKey: ['webhook-logs'],
    queryFn: async () => (await api.get('/api/webhook-logs?limit=100')).data as { items: WebhookLog[] },
    refetchInterval: 3000,
  })

  const totalMessages = (logs.data?.items || []).reduce((s, l) => s + (l.parsed_messages || 0), 0)
  const totalStatuses = (logs.data?.items || []).reduce((s, l) => s + (l.parsed_statuses || 0), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Webhook log"
        subtitle={`Live feed of every Meta webhook hit. ${totalMessages} inbound message${totalMessages === 1 ? '' : 's'} · ${totalStatuses} status update${totalStatuses === 1 ? '' : 's'} in the last 100 events.`}
        right={
          <button
            onClick={() => logs.refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                       border border-slate-300 hover:bg-slate-50 text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      <Card hover={false} className="!p-0">
        {logs.isLoading ? (
          <div className="p-8"><Spinner /></div>
        ) : logs.isError ? (
          <div className="p-4"><ErrorBox msg={(logs.error as any)?.message} /></div>
        ) : (logs.data?.items || []).length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 grid place-items-center mb-3">
              <Activity className="w-7 h-7 text-slate-300" />
            </div>
            <div className="text-sm font-medium text-slate-700">No webhooks yet</div>
            <div className="text-xs text-slate-400 mt-1 max-w-[360px] mx-auto leading-relaxed">
              Every inbound Meta webhook (status updates, delivery receipts, retailer replies)
              will appear here in real time. Newest first.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            <AnimatePresence initial={false}>
              {logs.data!.items.map((log, i) => (
                <LogRow key={log.id} log={log} highlight={i === 0} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </div>
  )
}

function LogRow({ log, highlight }: { log: WebhookLog; highlight: boolean }) {
  const [open, setOpen] = useState(highlight && log.event_kind === 'message')
  const style = kindStyle[log.event_kind] || kindStyle.unknown
  const Icon = style.icon

  // Extract a short summary line.
  const summary = summarize(log)

  return (
    <motion.li
      layout
      initial={highlight ? { opacity: 0, y: -6, backgroundColor: '#ecfeff' } : false}
      animate={{ opacity: 1, y: 0, backgroundColor: '#ffffff' }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.25 }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3"
      >
        <div className="mt-0.5">
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </div>
        <div className="shrink-0 mt-0.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase
                            tracking-wide px-2 py-0.5 rounded-full border ${style.bg} ${style.fg}`}>
            <Icon className="w-3 h-3" /> {style.label}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-800 truncate">{summary}</div>
            <div className="flex items-center gap-2 shrink-0">
              {log.parsed_messages > 0 && (
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5">
                  {log.parsed_messages} msg
                </span>
              )}
              {log.parsed_statuses > 0 && (
                <span className="text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5">
                  {log.parsed_statuses} status
                </span>
              )}
              <span className="text-[11px] text-slate-400 tabular-nums">
                {fmtRelative(log.received_at)}
              </span>
            </div>
          </div>
          {log.parse_error && (
            <div className="text-xs text-rose-600 mt-0.5 truncate">parse error: {log.parse_error}</div>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="payload"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pl-11 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-500">
                <div><span className="text-slate-400">Received:</span> {fmtDate(log.received_at)}</div>
                {log.source_ip && <div><span className="text-slate-400">IP:</span> <span className="font-mono">{log.source_ip}</span></div>}
                {log.user_agent && (
                  <div className="truncate"><span className="text-slate-400">UA:</span> {log.user_agent}</div>
                )}
              </div>
              <pre className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto max-h-96">
{JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

function summarize(log: WebhookLog): string {
  if (log.parse_error) return log.parse_error

  const p = log.payload
  if (!p || typeof p !== 'object') return '(empty payload)'

  try {
    const entries = p?.entry || []
    if (!Array.isArray(entries) || entries.length === 0) return '(no entries)'

    const lines: string[] = []
    for (const e of entries) {
      for (const c of e.changes || []) {
        const v = c?.value || {}
        for (const s of v.statuses || []) {
          lines.push(`status → ${s.status} (wamid ${(s.id || '').slice(0, 14)}…)`)
        }
        for (const m of v.messages || []) {
          const txt = m?.text?.body || ''
          const preview = txt.length > 60 ? txt.slice(0, 57) + '…' : txt
          lines.push(`message ← ${m.from || '?'}: "${preview}"`)
        }
        if (!v.statuses?.length && !v.messages?.length && v.metadata?.phone_number_id) {
          lines.push(`meta: phone_id=${v.metadata.phone_number_id}`)
        }
      }
    }
    if (lines.length === 0) return '(no statuses or messages)'
    return lines.slice(0, 3).join('  ·  ')
  } catch {
    return '(unparseable)'
  }
}