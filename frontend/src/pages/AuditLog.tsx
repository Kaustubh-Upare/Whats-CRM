import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, ChevronDown, ChevronRight, Inbox, RefreshCw,
  LogIn, Send, FileText, Webhook, Users, ShieldCheck, Search, Filter,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { fmtDate, fmtRelative } from '@/lib/format'
import type { AuditLog } from '@/lib/types'

/**
 * /audit-log — dedicated page for the full audit trail. Mirrors the
 * WebhookLogs page layout (sticky card with !p-0 + divide-y list +
 * expand/collapse for full JSON metadata) and adds filter chips so
 * operators can quickly isolate one action class (login, batch, template,
 * webhook, retailer, other).
 */

type ActionBucket = 'all' | 'login' | 'batch' | 'template' | 'webhook' | 'retailer' | 'other'

const BUCKETS: { key: ActionBucket; label: string; match: (a: string) => boolean; icon: any; chipClass: string }[] = [
  { key: 'all',      label: 'All',       match: () => true,                          icon: Activity,  chipClass: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'login',    label: 'Login',     match: (a) => a.startsWith('auth.') || a.startsWith('session.'), icon: LogIn, chipClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  { key: 'batch',    label: 'Batches',   match: (a) => a.startsWith('batch.'),       icon: Send,      chipClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'template', label: 'Templates', match: (a) => a.startsWith('template.'),    icon: FileText,  chipClass: 'bg-violet-50 text-violet-700 border-violet-200' },
  { key: 'webhook',  label: 'Webhooks',  match: (a) => a.startsWith('webhook.'),     icon: Webhook,   chipClass: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { key: 'retailer', label: 'Retailers', match: (a) => a.startsWith('retailer.') || a.startsWith('opt'), icon: Users, chipClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'other',    label: 'Other',     match: () => true,                          icon: ShieldCheck, chipClass: 'bg-slate-50 text-slate-700 border-slate-200' },
]

// Visual class for the action pill — depends on action verb, not bucket
function actionStyle(action: string): { bg: string; fg: string } {
  if (action.startsWith('auth.') || action.startsWith('session.')) {
    return { bg: 'bg-sky-50 border-sky-200', fg: 'text-sky-700' }
  }
  if (action.startsWith('batch.'))   return { bg: 'bg-emerald-50 border-emerald-200', fg: 'text-emerald-700' }
  if (action.startsWith('template.'))return { bg: 'bg-violet-50 border-violet-200',   fg: 'text-violet-700' }
  if (action.startsWith('webhook.')) return { bg: 'bg-cyan-50 border-cyan-200',       fg: 'text-cyan-700' }
  if (action.startsWith('retailer.') || action.startsWith('opt')) {
    return { bg: 'bg-amber-50 border-amber-200', fg: 'text-amber-700' }
  }
  return { bg: 'bg-slate-50 border-slate-200', fg: 'text-slate-700' }
}

export default function AuditLogPage() {
  const [bucket, setBucket] = useState<ActionBucket>('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)

  const audit = useQuery({
    queryKey: ['audit-all', limit],
    queryFn: async () => (await api.get(`/api/dashboard/activity?limit=${limit}`)).data as AuditLog[],
    refetchInterval: 10_000,
  })

  const all = audit.data || []

  // Counts per bucket for chip badges
  const counts = useMemo(() => {
    const c: Record<ActionBucket, number> = { all: all.length, login: 0, batch: 0, template: 0, webhook: 0, retailer: 0, other: 0 }
    for (const a of all) {
      for (const b of BUCKETS) {
        if (b.key === 'all' || b.key === 'other') continue
        if (b.match(a.action)) c[b.key]++
      }
    }
    // "other" = everything not matched by any specific bucket
    const matched = c.login + c.batch + c.template + c.webhook + c.retailer
    c.other = Math.max(0, c.all - matched)
    return c
  }, [all])

  const filtered = useMemo(() => {
    const b = BUCKETS.find((x) => x.key === bucket)!
    let out = all.filter((a) => b.key === 'all' || b.key === 'other' || b.match(a.action))
    if (bucket === 'other') {
      // "other" excludes everything in specific buckets
      out = all.filter((a) =>
        !BUCKETS.some((bb) => bb.key !== 'all' && bb.key !== 'other' && bb.match(a.action)),
      )
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      out = out.filter((a) => {
        if (a.action.toLowerCase().includes(needle)) return true
        if ((a.actor_email || '').toLowerCase().includes(needle)) return true
        if ((a.entity_type || '').toLowerCase().includes(needle)) return true
        if (a.entity_id != null && String(a.entity_id).includes(needle)) return true
        if (a.metadata && JSON.stringify(a.metadata).toLowerCase().includes(needle)) return true
        return false
      })
    }
    return out
  }, [all, bucket, q])

  const newest = all[0]
  const oldest = all[all.length - 1]
  const subtitle = !audit.isLoading && all.length > 0 && newest && oldest
    ? `${all.length} actions · newest ${fmtRelative(newest.created_at)} · oldest ${fmtRelative(oldest.created_at)}`
    : 'Every admin action — logins, batch approvals, template changes, retailer opt-outs.'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        subtitle={subtitle}
        right={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Live · 10s
            </div>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-300 rounded-md px-2 py-1.5"
              title="How many recent actions to fetch"
            >
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={200}>Last 200</option>
              <option value={500}>Last 500</option>
            </select>
            <button
              onClick={() => audit.refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         border border-slate-300 hover:bg-slate-50 text-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        }
      />

      {/* Filter chips + search */}
      <Card hover={false} className="!p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-medium text-slate-500 pr-1">
            <Filter className="w-3.5 h-3.5" />
            Filter
          </div>
          {BUCKETS.map((b) => {
            const Icon = b.icon
            const active = bucket === b.key
            const n = counts[b.key] ?? 0
            return (
              <motion.button
                key={b.key}
                onClick={() => setBucket(b.key)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : `${b.chipClass} hover:bg-slate-50`
                }`}
              >
                <Icon className="w-3 h-3" />
                {b.label}
                <span className={`tabular-nums text-[10px] px-1 rounded-full ${
                  active ? 'bg-white/15 text-white' : 'bg-white/70 text-slate-600'
                }`}>
                  {n.toLocaleString()}
                </span>
              </motion.button>
            )
          })}

          <div className="ml-auto relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search action, actor, entity, metadata…"
              className="text-sm border border-slate-300 rounded-md pl-7 pr-2.5 py-1.5 w-72 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>
      </Card>

      <Card hover={false} className="!p-0">
        {audit.isLoading ? (
          <div className="p-8"><Spinner /></div>
        ) : audit.isError ? (
          <div className="p-4"><ErrorBox msg={(audit.error as any)?.response?.data?.error || (audit.error as any)?.message || 'Failed to load audit log'} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 grid place-items-center mb-3 border border-dashed border-slate-200">
              <Inbox className="w-7 h-7 text-slate-300" />
            </div>
            <div className="text-sm font-medium text-slate-700">
              {all.length === 0 ? 'No audit entries yet' : 'No actions match this filter'}
            </div>
            <div className="text-xs text-slate-400 mt-1 max-w-[420px] mx-auto leading-relaxed">
              {all.length === 0
                ? 'Every admin action — logins, batch approvals, template edits, retailer opt-outs — will appear here as it happens.'
                : 'Try a different filter or clear the search.'}
            </div>
            {(bucket !== 'all' || q) && (
              <button
                onClick={() => { setBucket('all'); setQ('') }}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-300 hover:bg-slate-50 rounded-md text-slate-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            <AnimatePresence initial={false}>
              {filtered.map((a, i) => (
                <LogRow key={a.id} log={a} highlight={i === 0 && !q && bucket === 'all'} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </div>
  )
}

function LogRow({ log, highlight }: { log: AuditLog; highlight: boolean }) {
  const [open, setOpen] = useState(false)
  const style = actionStyle(log.action)
  const summary = summarize(log)

  return (
    <motion.li
      layout
      initial={highlight ? { opacity: 0, y: -6, backgroundColor: '#f0f9ff' } : false}
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
            {log.action}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-800 truncate">{summary}</div>
            <div className="flex items-center gap-2 shrink-0">
              {log.entity_type && (
                <span className="text-[10px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-1.5">
                  {log.entity_type}#{log.entity_id ?? '—'}
                </span>
              )}
              <span className="text-[11px] text-slate-400 tabular-nums">
                {fmtRelative(log.created_at)}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            by <span className="font-mono">{log.actor_email || 'system'}</span>
            {log.ip_address && <span className="text-slate-400"> · {log.ip_address}</span>}
          </div>
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
                <div><span className="text-slate-400">When:</span> {fmtDate(log.created_at)}</div>
                <div><span className="text-slate-400">Actor:</span> <span className="font-mono">{log.actor_email || 'system'}</span></div>
                {log.actor_id != null && <div><span className="text-slate-400">Actor ID:</span> <span className="font-mono">#{log.actor_id}</span></div>}
                {log.ip_address && <div><span className="text-slate-400">IP:</span> <span className="font-mono">{log.ip_address}</span></div>}
                {log.user_agent && (
                  <div className="truncate"><span className="text-slate-400">UA:</span> {log.user_agent}</div>
                )}
                {log.entity_type && (
                  <div>
                    <span className="text-slate-400">Entity:</span>{' '}
                    <span className="font-mono">{log.entity_type}#{log.entity_id ?? '—'}</span>
                  </div>
                )}
              </div>
              {log.metadata && (
                <pre className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto max-h-96">
{JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

function summarize(a: AuditLog): string {
  // A short, human-friendly line about what changed.
  const meta = (a.metadata && typeof a.metadata === 'object') ? a.metadata : {}
  const m = meta as Record<string, any>
  switch (a.action) {
    case 'auth.login':          return 'signed in'
    case 'auth.logout':         return 'signed out'
    case 'auth.login_failed':   return `failed sign-in (${m.reason || 'unknown'})`
    case 'batch.uploaded':      return `uploaded ${m.file || 'a file'} — ${m.valid ?? 0} valid / ${m.invalid ?? 0} invalid`
    case 'batch.approved_and_queued': return `approved a batch — queued ${m.queued ?? 0} messages via ${m.template || 'template'}`
    case 'template.created':    return `created template ${m.name || ''} (${m.lang || ''})`
    case 'template.updated':    return `updated template ${m.name || ''} (${m.lang || ''})`
    case 'template.active_toggled': return `${m.is_active ? 'activated' : 'deactivated'} template ${m.name || ''}`
    case 'template.deleted':    return `deleted template ${m.name || ''} (${m.lang || ''})`
    case 'webhook.configured':  return 'webhook configuration changed'
    case 'retailer.opted_out':  return `opted retailer ${m.retailer_id || ''} out`
    case 'retailer.opted_in':   return `opted retailer ${m.retailer_id || ''} back in`
    default:                    return a.action
  }
}
