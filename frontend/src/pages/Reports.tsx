import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { format, parseISO, subDays, startOfMonth, startOfDay, endOfDay } from 'date-fns'
import {
  Download, Sparkles, TrendingUp, Inbox, RefreshCw, MoreHorizontal,
  CheckCheck, Eye, Send, AlertTriangle, Clock, MessageSquare,
} from 'lucide-react'
import { api } from '@/lib/api'
import {
  Card, ErrorBox, PageHeader, Spinner,
} from '@/components/ui'
import { containerStagger, itemFadeUp, CountUp } from '@/lib/motion'
import { pct } from '@/lib/format'
import type { DailyTrendPoint, ReportsTrendResponse, ReportSummary } from '@/lib/types'

/* ---------- types & helpers ---------- */

type PresetKey = '24h' | '7d' | '30d' | '90d' | 'mtd'

const STATUS_COLORS = {
  sent:      '#3b82f6', // blue-500
  delivered: '#10b981', // emerald-500
  read:      '#8b5cf6', // violet-500
  failed:    '#f43f5e', // rose-500
  queued:    '#f59e0b', // amber-500
  sending:   '#06b6d4', // cyan-500
} as const

function fmtRange(from: string, to: string) {
  try {
    const f = parseISO(from)
    const t = parseISO(to)
    if (from.slice(0, 7) === to.slice(0, 7)) {
      return `${format(f, 'd MMM')} – ${format(t, 'd MMM yyyy')}`
    }
    return `${format(f, 'd MMM yyyy')} – ${format(t, 'd MMM yyyy')}`
  } catch {
    return `${from} – ${to}`
  }
}

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = startOfDay(new Date())
  switch (key) {
    case '24h': {
      const f = startOfDay(subDays(today, 1))
      return { from: format(f, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    }
    case '7d': {
      const f = subDays(today, 6)
      return { from: format(f, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    }
    case '30d': {
      const f = subDays(today, 29)
      return { from: format(f, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    }
    case '90d': {
      const f = subDays(today, 89)
      return { from: format(f, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    }
    case 'mtd': {
      const f = startOfMonth(today)
      return { from: format(f, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') }
    }
  }
}

/* ---------- page ---------- */

export default function Reports() {
  const reducedMotion = useReducedMotion()
  const [preset, setPreset] = useState<PresetKey>('7d')
  const [{ from, to }, setRange] = useState(presetRange('7d'))

  function applyPreset(k: PresetKey) {
    setPreset(k)
    setRange(presetRange(k))
  }
  function setFrom(v: string) {
    setPreset('mtd') // arbitrary sentinel so the chip selection clears
    setRange((r) => ({ ...r, from: v }))
  }
  function setTo(v: string) {
    setPreset('mtd')
    setRange((r) => ({ ...r, to: v }))
  }

  const summary = useQuery({
    queryKey: ['reports-summary', from, to],
    queryFn: async () => (await api.get(`/api/reports/summary?from=${from}&to=${to}`)).data as ReportSummary,
  })
  const trend = useQuery({
    queryKey: ['reports-trend', from, to],
    queryFn: async () =>
      (await api.get(`/api/reports/trend?from=${from}&to=${to}`)).data as ReportsTrendResponse,
  })

  const counts = summary.data?.status_counts || {}
  const sent = (counts.queued || 0) + (counts.sending || 0) + (counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0)
  const delivered = (counts.delivered || 0) + (counts.read || 0)
  const read = counts.read || 0
  const failed = counts.failed || 0
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const deliveryRate = total ? (delivered / total) * 100 : 0
  const readRate = sent ? (read / sent) * 100 : 0
  const failedRate = total ? (failed / total) * 100 : 0

  // Deltas: compare to the immediately preceding window of the same length.
  const days = useMemo(() => {
    try {
      const a = parseISO(from)
      const b = parseISO(to)
      return Math.max(1, Math.round((endOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000) + 1)
    } catch { return 7 }
  }, [from, to])

  const prior = useQuery({
    queryKey: ['reports-summary-prior', from, to, days],
    queryFn: async () => {
      const f = parseISO(from)
      const t = parseISO(to)
      const pf = format(subDays(f, days), 'yyyy-MM-dd')
      const pt = format(subDays(t, days), 'yyyy-MM-dd')
      return (await api.get(`/api/reports/summary?from=${pf}&to=${pt}`)).data as ReportSummary
    },
  })
  const priorCounts = prior.data?.status_counts || {}
  const priorTotal = Object.values(priorCounts).reduce((a, b) => a + b, 0)
  const priorSent = (priorCounts.queued || 0) + (priorCounts.sending || 0) + (priorCounts.sent || 0) + (priorCounts.delivered || 0) + (priorCounts.read || 0)
  const priorDelivered = (priorCounts.delivered || 0) + (priorCounts.read || 0)
  const priorRead = priorCounts.read || 0
  const priorFailed = priorCounts.failed || 0
  const priorDeliveryRate = priorTotal ? (priorDelivered / priorTotal) * 100 : 0
  const priorReadRate = priorSent ? (priorRead / priorSent) * 100 : 0
  const priorFailedRate = priorTotal ? (priorFailed / priorTotal) * 100 : 0

  const empty = !summary.isLoading && total === 0

  // Show the prior-window data as a soft "loading" until the main query settles,
  // so the user sees the page paint even when both queries are in-flight.
  const loading = summary.isLoading && !summary.data

  // Last-refresh time shown in the header.
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date())
  useEffect(() => {
    if (!summary.isFetching) setRefreshedAt(new Date())
  }, [summary.isFetching])

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-6 lg:py-8">
      <PageHeader
        title="Reports"
        subtitle="WhatsApp delivery & read performance across any date range."
        right={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Updated {format(refreshedAt, 'HH:mm:ss')}
            </div>
            <motion.a
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              href={`/api/reports/export.csv?from=${from}&to=${to}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 text-sm font-medium"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </motion.a>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              onClick={() => { summary.refetch(); trend.refetch(); prior.refetch() }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </motion.button>
          </div>
        }
      />

      {/* Date window card — sticky on scroll */}
      <div className="sticky top-0 z-20 -mx-6 lg:-mx-10 px-6 lg:px-10 pt-1 pb-4
                      bg-white/80 dark:bg-[#020617]/85
                      backdrop-blur-md border-b border-slate-200/70 dark:border-white/5 mb-6">
        <Card hover={false} className="!border-slate-200/70 dark:!border-white/10">
          <div className="p-4 lg:p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] font-medium text-slate-500 dark:text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                Date window
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span className="hidden sm:inline">Updates automatically</span>
                <span className="sm:hidden">Auto-updates</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(['24h', '7d', '30d', '90d', 'mtd'] as PresetKey[]).map((k) => (
                <PresetChip key={k} label={labelFor(k)} active={preset === k} onClick={() => applyPreset(k)} />
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <label className="text-slate-600 dark:text-slate-300">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border border-slate-300 dark:border-slate-700
                             bg-white dark:bg-[var(--input-bg)]
                             text-slate-900 dark:text-slate-100
                             rounded-md px-2.5 py-1.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-slate-600 dark:text-slate-300">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="border border-slate-300 dark:border-slate-700
                             bg-white dark:bg-[var(--input-bg)]
                             text-slate-900 dark:text-slate-100
                             rounded-md px-2.5 py-1.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>
              <div className="ml-auto text-slate-700 dark:text-slate-200 text-sm">
                <span className="text-slate-400 dark:text-slate-500 mr-1.5">·</span>
                {fmtRange(from, to)}
                <span className="text-slate-400 dark:text-slate-500 ml-1.5">·</span>{' '}
                <span className="text-slate-500 dark:text-slate-400">{days} {days === 1 ? 'day' : 'days'}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Plain-English summary — answers "what does this date range do?" */}
      {!loading && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mb-5 text-sm text-slate-600"
        >
          {empty ? (
            <span>
              No messages between <strong className="text-slate-800">{fmtRange(from, to)}</strong>. Pick a wider range or send a batch first.
            </span>
          ) : (
            <span>
              <span className="text-slate-800 font-medium">{total.toLocaleString()}</span> messages between{' '}
              <span className="text-slate-800 font-medium">{fmtRange(from, to)}</span>{' '}
              · delivery <span className="text-emerald-700 font-medium">{pct(deliveryRate)}</span>{' '}
              · read <span className="text-violet-700 font-medium">{pct(readRate)}</span>{' '}
              · failed <span className="text-rose-700 font-medium">{pct(failedRate)}</span>
            </span>
          )}
        </motion.div>
      )}

      {loading && (
        <div className="mb-5"><ReportSkeleton /></div>
      )}

      {summary.isError && <ErrorBox msg={(summary.error as any)?.response?.data?.error || (summary.error as any)?.message || 'Failed to load'} />}

      {/* KPI tiles */}
      {!loading && !empty && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        >
          <KpiTile
            label="Delivered"
            value={`${deliveryRate.toFixed(1)}%`}
            sub={`${delivered.toLocaleString()} of ${total.toLocaleString()} messages`}
            tone="emerald"
            delta={prior.data ? deliveryRate - priorDeliveryRate : undefined}
            deltaSuffix="pts"
            icon={<CheckCheck className="w-3.5 h-3.5" />}
            sparkData={sparkFor(trend.data?.points, 'delivered')}
          />
          <KpiTile
            label="Read rate"
            value={`${readRate.toFixed(1)}%`}
            sub={`${read.toLocaleString()} messages opened`}
            tone="violet"
            delta={prior.data ? readRate - priorReadRate : undefined}
            deltaSuffix="pts"
            icon={<Eye className="w-3.5 h-3.5" />}
            sparkData={sparkFor(trend.data?.points, 'read')}
          />
          <KpiTile
            label="Failed"
            value={`${failedRate.toFixed(1)}%`}
            sub={`${failed.toLocaleString()} messages bounced`}
            tone="rose"
            delta={prior.data ? failedRate - priorFailedRate : undefined}
            deltaSuffix="pts"
            invertDelta
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            sparkData={sparkFor(trend.data?.points, 'failed')}
          />
          <KpiTile
            label="Total sent"
            value={sent}
            sub={`+${(total - priorTotal).toLocaleString()} vs prior ${days}d`}
            tone="slate"
            countUp
            icon={<Send className="w-3.5 h-3.5" />}
            sparkData={sparkFor(trend.data?.points, 'sent')}
          />
        </motion.div>
      )}

      {/* Charts row: daily volume (2/3) + status share donut (1/3) */}
      {!loading && !empty && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6"
        >
          <motion.div variants={itemFadeUp} className="lg:col-span-2">
            <Card hover={false} className="h-full">
              <SectionHeader
                eyebrow="Daily volume"
                title="Messages per day"
                subtitle="Sent, delivered, read and failed across the selected range"
                right={<SeriesToggle />}
              />
              <div className="p-5 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend.data?.points || []} margin={{ top: 5, right: 8, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="g-sent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={STATUS_COLORS.sent} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={STATUS_COLORS.sent} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="g-delivered" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={STATUS_COLORS.delivered} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={STATUS_COLORS.delivered} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="g-read" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={STATUS_COLORS.read} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={STATUS_COLORS.read} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="g-failed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={STATUS_COLORS.failed} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={STATUS_COLORS.failed} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      stroke="#94a3b8"
                      tickFormatter={(d) => formatTick(d)}
                      minTickGap={28}
                    />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="sent"      stroke={STATUS_COLORS.sent}      strokeWidth={2} fill="url(#g-sent)"      isAnimationActive={!reducedMotion} animationDuration={900} />
                    <Area type="monotone" dataKey="delivered" stroke={STATUS_COLORS.delivered} strokeWidth={2} fill="url(#g-delivered)" isAnimationActive={!reducedMotion} animationDuration={900} />
                    <Area type="monotone" dataKey="read"      stroke={STATUS_COLORS.read}      strokeWidth={2} fill="url(#g-read)"      isAnimationActive={!reducedMotion} animationDuration={900} />
                    <Area type="monotone" dataKey="failed"    stroke={STATUS_COLORS.failed}    strokeWidth={2} fill="url(#g-failed)"    isAnimationActive={!reducedMotion} animationDuration={900} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={itemFadeUp}>
            <Card hover={false} className="h-full">
              <SectionHeader
                eyebrow="Status share"
                title="What happened"
                subtitle="Of all messages in this range"
              />
              <div className="p-5">
                <StatusDonut
                  segments={[
                    { key: 'delivered', label: 'Delivered', value: delivered, color: STATUS_COLORS.delivered },
                    { key: 'read',      label: 'Read',      value: read,      color: STATUS_COLORS.read },
                    { key: 'sent',      label: 'Sent',      value: counts.sent || 0, color: STATUS_COLORS.sent },
                    { key: 'queued',    label: 'Queued',    value: counts.queued || 0, color: STATUS_COLORS.queued },
                    { key: 'sending',   label: 'Sending',   value: counts.sending || 0, color: STATUS_COLORS.sending },
                    { key: 'failed',    label: 'Failed',    value: failed,    color: STATUS_COLORS.failed },
                  ]}
                  centerLabel={total.toLocaleString()}
                  centerSubLabel="messages"
                />
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Delivery funnel — horizontal bars */}
      {!loading && !empty && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6"
        >
          <motion.div variants={itemFadeUp} className="lg:col-span-2">
            <Card hover={false}>
              <SectionHeader
                eyebrow="Delivery funnel"
                title="Queued → Sent → Delivered → Read"
                subtitle="Each row shows how much of the prior stage made it to the next"
              />
              <div className="p-5 space-y-3">
                <FunnelRow label="Queued"    value={total}        max={total} color={STATUS_COLORS.queued}    sub="100%" />
                <FunnelRow label="Sent"      value={sent}         max={total} color={STATUS_COLORS.sent}      sub={pct(total ? (sent / total) * 100 : 0)} />
                <FunnelRow label="Delivered" value={delivered}    max={total} color={STATUS_COLORS.delivered} sub={pct(total ? (delivered / total) * 100 : 0)} />
                <FunnelRow label="Read"      value={read}         max={total} color={STATUS_COLORS.read}      sub={pct(total ? (read / total) * 100 : 0)} />
                <FunnelRow label="Failed"    value={failed}       max={total} color={STATUS_COLORS.failed}    sub={pct(total ? (failed / total) * 100 : 0)} />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={itemFadeUp}>
            <Card hover={false} className="h-full">
              <SectionHeader
                eyebrow="Status mix"
                title="By count"
                subtitle="Tap a row to highlight"
              />
              <div className="p-5 grid grid-cols-2 gap-3">
                {([
                  ['queued',    counts.queued || 0,    STATUS_COLORS.queued,    Clock],
                  ['sending',   counts.sending || 0,   STATUS_COLORS.sending,   MessageSquare],
                  ['sent',      counts.sent || 0,      STATUS_COLORS.sent,      Send],
                  ['delivered', delivered,             STATUS_COLORS.delivered, CheckCheck],
                  ['read',      read,                  STATUS_COLORS.read,      Eye],
                  ['failed',    failed,                STATUS_COLORS.failed,    AlertTriangle],
                ] as const).map(([k, v, c, Icon]) => (
                  <motion.div
                    key={k}
                    whileHover={{ y: -2 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    className="admin-card rounded-lg p-3 hover:shadow-sm dark:hover:shadow-[0_8px_24px_-12px_rgba(16,185,129,0.25)] transition-shadow"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 capitalize">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c }} />
                      {k}
                    </div>
                    <div className="text-xl font-semibold text-slate-900 tabular-nums mt-0.5">
                      <CountUp value={v} />
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Top failures + system status */}
      {!loading && !empty && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
        >
          <motion.div variants={itemFadeUp} className="lg:col-span-2">
            <Card hover={false}>
              <SectionHeader
                eyebrow="Daily volume breakdown"
                title="Last 7 days by status"
                subtitle="Mini bar chart per status — hover for exact counts"
              />
              <div className="p-5">
                <MiniBarChart points={trend.data?.points || []} />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={itemFadeUp}>
            <Card hover={false} className="h-full">
              <SectionHeader
                eyebrow="Snapshot"
                title="Quick read"
                subtitle="Single-screen summary"
              />
              <div className="p-5 space-y-3 text-sm">
                <Snapshot label="Total messages" value={total.toLocaleString()} tone="slate" />
                <Snapshot label="Delivery rate" value={pct(deliveryRate)} tone={deliveryRate >= 90 ? 'emerald' : deliveryRate >= 75 ? 'amber' : 'rose'} />
                <Snapshot label="Read rate" value={pct(readRate)} tone={readRate >= 50 ? 'emerald' : readRate >= 25 ? 'amber' : 'rose'} />
                <Snapshot label="Failed" value={`${failed.toLocaleString()} (${pct(failedRate)})`} tone={failedRate <= 2 ? 'emerald' : failedRate <= 5 ? 'amber' : 'rose'} />
                <div className="pt-3 mt-3 border-t border-slate-100">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-slate-500 mb-1.5">Verdict</div>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {verdictSentence({ deliveryRate, readRate, failedRate, total })}
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && empty && (
        <Card hover={false} className="p-12">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="text-center max-w-md mx-auto"
          >
            <div className="w-14 h-14 rounded-2xl bg-slate-50 grid place-items-center mx-auto mb-4 border border-dashed border-slate-200">
              <Inbox className="w-7 h-7 text-slate-300" />
            </div>
            <div className="font-semibold text-slate-900">No messages in this range</div>
            <div className="text-sm text-slate-500 mt-1">
              Try <button className="text-brand-700 hover:underline" onClick={() => applyPreset('30d')}>Last 30 days</button> or upload a billing file to send your first batch.
            </div>
          </motion.div>
        </Card>
      )}
    </div>
  )
}

/* ---------- atoms ---------- */

function labelFor(k: PresetKey) {
  return k === 'mtd' ? 'This month' : k === '24h' ? 'Last 24h' : `Last ${k.replace('d', '')} days`
}

function formatTick(d: string) {
  try {
    const dt = parseISO(d)
    return format(dt, 'd MMM')
  } catch {
    return d
  }
}

function PresetChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 ${
        active
          ? 'bg-slate-900 dark:bg-emerald-500 text-white dark:text-emerald-950 shadow-sm'
          : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </motion.button>
  )
}

function SectionHeader({ eyebrow, title, subtitle, right }: { eyebrow: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{eyebrow}</div>
        <div className="font-semibold text-slate-900 mt-0.5">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

function KpiTile({
  label, value, sub, tone, delta, deltaSuffix, invertDelta, countUp, icon, sparkData,
}: {
  label: string
  value: number | string
  sub?: string
  tone: 'emerald' | 'violet' | 'rose' | 'slate'
  delta?: number
  deltaSuffix?: string
  invertDelta?: boolean
  countUp?: boolean
  icon?: React.ReactNode
  sparkData: number[]
}) {
  const toneCls = {
    emerald: { ring: 'ring-emerald-100', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    violet:  { ring: 'ring-violet-100',  dot: 'bg-violet-500',  text: 'text-violet-700',  bg: 'bg-violet-50' },
    rose:    { ring: 'ring-rose-100',    dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50' },
    slate:   { ring: 'ring-slate-100',   dot: 'bg-slate-500',   text: 'text-slate-700',   bg: 'bg-slate-50' },
  }[tone]
  const sparkColor = STATUS_COLORS[
    tone === 'emerald' ? 'delivered' : tone === 'violet' ? 'read' : tone === 'rose' ? 'failed' : 'sent'
  ]
  const deltaPositive = invertDelta ? (delta != null && delta < 0) : (delta != null && delta > 0)
  const deltaNegative = invertDelta ? (delta != null && delta > 0) : (delta != null && delta < 0)

  return (
    <motion.div
      variants={itemFadeUp}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className={`admin-card rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] dark:hover:shadow-[0_24px_50px_-16px_rgba(16,185,129,0.20)] p-4 lg:p-5 transition-shadow`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${toneCls.dot}`} />
          {label}
        </div>
        {icon && <div className={`${toneCls.text} opacity-70`}>{icon}</div>}
      </div>
      <div className="text-3xl font-semibold text-slate-900 tabular-nums tracking-tight mt-1.5">
        {countUp && typeof value === 'number' ? <CountUp value={value} /> : value}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500 truncate">{sub}</div>
        {delta != null && Math.abs(delta) > 0.01 && (
          <span
            className={`text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${
              deltaPositive ? 'bg-emerald-50 text-emerald-700'
              : deltaNegative ? 'bg-rose-50 text-rose-700'
              : 'bg-slate-50 text-slate-500'
            }`}
            title={`vs prior ${deltaSuffix === 'pts' ? 'window' : 'period'}`}
          >
            <span>{deltaPositive ? '▲' : deltaNegative ? '▼' : '·'}</span>
            {Math.abs(delta).toFixed(1)}{deltaSuffix}
          </span>
        )}
      </div>
      <div className="mt-2">
        <Sparkline values={sparkData} color={sparkColor} />
      </div>
    </motion.div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const reducedMotion = useReducedMotion()
  if (!values.length) {
    return <div className="h-7" />
  }
  const w = 160
  const h = 28
  const max = Math.max(1, ...values)
  const stepX = values.length > 1 ? w / (values.length - 1) : w
  const pts = values.map((v, i) => {
    const x = i * stepX
    const y = h - (v / max) * (h - 4) - 2
    return [x, y] as const
  })
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${w},${h} L0,${h} Z`
  const id = `g-${color.replace('#', '')}`
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${id})`}
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      />
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reducedMotion ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  )
}

function StatusDonut({
  segments, centerLabel, centerSubLabel,
}: {
  segments: { key: string; label: string; value: number; color: string }[]
  centerLabel: string
  centerSubLabel?: string
}) {
  const reducedMotion = useReducedMotion()
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const size = 180
  const r = 72
  const stroke = 22
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r

  // Collapse sub-1% slivers into "Other" so the donut stays legible.
  const visible: typeof segments = []
  let otherVal = 0
  for (const s of segments) {
    const pctOfTotal = (s.value / total) * 100
    if (s.value > 0 && pctOfTotal < 1) otherVal += s.value
    else visible.push(s)
  }
  if (otherVal > 0) visible.push({ key: 'other', label: 'Other', value: otherVal, color: '#94a3b8' })

  let offset = 0
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {visible.map((s, i) => {
          const fraction = s.value / total
          const dash = fraction * circ
          const seg = (
            <motion.circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
              initial={reducedMotion ? false : { strokeDasharray: `0 ${circ}` }}
              animate={{ strokeDasharray: `${dash} ${circ - dash}` }}
              transition={{ duration: 0.9, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            />
          )
          offset += dash
          return seg
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-900 font-semibold" style={{ fontSize: 24 }}>
          {centerLabel}
        </text>
        {centerSubLabel && (
          <text x={cx} y={cy + 16} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {centerSubLabel}
          </text>
        )}
      </svg>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs w-full">
        {visible.map((s) => (
          <div key={s.key} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-slate-600 truncate">{s.label}</span>
            <span className="ml-auto tabular-nums text-slate-900 font-medium">{s.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FunnelRow({ label, value, max, color, sub }: { label: string; value: number; max: number; color: string; sub: string }) {
  const reducedMotion = useReducedMotion()
  const pct = max ? (value / max) * 100 : 0
  return (
    <motion.div whileHover={{ x: 2 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
      <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums">
          <span className="text-slate-900 font-semibold">{value.toLocaleString()}</span>
          <span className="text-slate-400 ml-2">{sub}</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={reducedMotion ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  )
}

function MiniBarChart({ points }: { points: DailyTrendPoint[] }) {
  const reducedMotion = useReducedMotion()
  if (!points.length) return <div className="text-sm text-slate-400 py-6 text-center">No data</div>
  const keys = ['sent', 'delivered', 'read', 'failed'] as const
  return (
    <div className="space-y-3">
      {keys.map((k, i) => (
        <MiniBarRow
          key={k}
          label={k}
          color={STATUS_COLORS[k]}
          points={points}
          accessor={(p) => p[k]}
          total={points.reduce((s, p) => s + p[k], 0)}
          delay={i * 0.04}
          reducedMotion={!!reducedMotion}
        />
      ))}
    </div>
  )
}

function MiniBarRow({
  label, color, points, accessor, total, delay, reducedMotion,
}: {
  label: string
  color: string
  points: DailyTrendPoint[]
  accessor: (p: DailyTrendPoint) => number
  total: number
  delay: number
  reducedMotion: boolean
}) {
  const values = points.map(accessor)
  const max = Math.max(1, ...values)
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs text-slate-600 capitalize">{label}</div>
      <div className="flex-1 flex items-end gap-0.5 h-7">
        {values.map((v, i) => {
          const h = (v / max) * 100
          return (
            <motion.div
              key={i}
              className="flex-1 rounded-sm"
              style={{ backgroundColor: color, opacity: v > 0 ? 0.9 : 0.18 }}
              initial={reducedMotion ? false : { height: 0 }}
              animate={{ height: `${Math.max(2, h)}%` }}
              transition={{ duration: 0.5, delay: delay + i * 0.01, ease: [0.22, 1, 0.36, 1] }}
              title={`${points[i]?.date || ''}: ${v.toLocaleString()}`}
            />
          )
        })}
      </div>
      <div className="w-20 text-right text-xs text-slate-700 tabular-nums">
        {total.toLocaleString()}
      </div>
    </div>
  )
}

function Snapshot({ label, value, tone }: { label: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  const toneCls = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
  }[tone]
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  )
}

function SeriesToggle() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS.sent }} /> Sent</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS.delivered }} /> Delivered</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS.read }} /> Read</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS.failed }} /> Failed</span>
    </div>
  )
}

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rounded-lg px-3 py-2 shadow-lg text-xs" style={{ background: '#0f172a', color: '#f1f5f9' }}>
      <div className="font-medium mb-1" style={{ color: '#cbd5e1' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
            <span style={{ color: '#cbd5e1' }}>{p.name}</span>
          </span>
          <span className="tabular-nums">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-3 w-80 bg-slate-100 rounded animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-50 animate-pulse" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-slate-50 animate-pulse" />
    </div>
  )
}

/* ---------- data shaping ---------- */

function sparkFor(points: DailyTrendPoint[] | undefined, key: 'sent' | 'delivered' | 'read' | 'failed'): number[] {
  if (!points || !points.length) return []
  // Last 14 days max — keeps the sparkline readable.
  return points.slice(-14).map((p) => p[key] || 0)
}

function verdictSentence({ deliveryRate, readRate, failedRate, total }: { deliveryRate: number; readRate: number; failedRate: number; total: number }): string {
  if (!total) return 'No activity in this window yet.'
  const dVerdict = deliveryRate >= 90 ? 'Delivery is steady' : deliveryRate >= 75 ? 'Delivery is acceptable but has room to grow' : 'Delivery is below target'
  const rVerdict = readRate >= 50 ? 'strong read-through' : readRate >= 25 ? 'moderate read-through' : 'low read-through'
  const fVerdict = failedRate <= 2 ? 'failures are well controlled' : failedRate <= 5 ? 'failures are noticeable' : 'failures are elevated'
  return `${dVerdict} at ${deliveryRate.toFixed(1)}%. Recipients show ${rVerdict} at ${readRate.toFixed(1)}%, and ${fVerdict} at ${failedRate.toFixed(1)}%.`
}
