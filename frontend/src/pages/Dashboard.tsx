import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Activity, AlertCircle, ArrowRight, ArrowUpRight, ArrowDownRight,
  CheckCheck, CloudSun, Eye, FileText, Layers, Loader2, Moon,
  RefreshCw, Send, Sparkles, Sun, TrendingUp, UploadCloud, Users,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, PageHeader, PrimaryButton, Spinner } from '@/components/ui'
import { containerStagger, CountUp, HoverCard, itemFadeUp, StaggerList } from '@/lib/motion'
import { fmtRelative, pct } from '@/lib/format'
import type { AuditLog, DashboardKPI, DailyTrendPoint } from '@/lib/types'

/* useIsDark — small hook that mirrors the `<html class="dark">` flag.
 * Used by Recharts (which doesn't read CSS classes) so the chart's
 * grid + axis + tooltip text recolour when the user flips the toggle. */
function useIsDark() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function GreetingIcon({ className = '' }: { className?: string }) {
  const h = new Date().getHours()
  const Icon = h < 12 ? Sun : h < 17 ? CloudSun : Moon
  return <Icon className={className} />
}

/** Pick a calm background ring for an action verb so the activity rail scans fast.
 *  Dark-mode variants use translucent tinted fills (semantic-500/15) instead of
 *  flat pastels, which read as cheap on a deep canvas. */
function actionTone(action: string) {
  const a = action.toLowerCase()
  if (a.includes('login'))
    return 'bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30'
  if (a.includes('logout'))
    return 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30'
  if (a.includes('approve'))
    return 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
  if (a.includes('delete') || a.includes('fail'))
    return 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30'
  if (a.includes('create') || a.includes('upload'))
    return 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30'
  if (a.includes('send'))
    return 'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30'
  if (a.includes('webhook'))
    return 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
  return 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30'
}

function actionLabel(action: string) {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Build an SVG path string for a tiny sparkline that fits a 100x32 viewBox. */
function sparklinePath(values: number[], w = 100, h = 32, pad = 2) {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * stepX
      const y = h - pad - ((v - min) / range) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function trendDelta(values: number[]) {
  if (values.length < 2) return { delta: 0, pct: 0 }
  const last = values[values.length - 1]
  const prev = values[values.length - 2] || 0
  const delta = last - prev
  const change = prev > 0 ? (delta / prev) * 100 : 0
  return { delta, pct: change }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const kpi = useQuery({
    queryKey: ['kpi'],
    queryFn: async () => (await api.get('/api/dashboard/kpi')).data as DashboardKPI,
  })
  const trend = useQuery({
    queryKey: ['trend'],
    queryFn: async () => (await api.get('/api/dashboard/trend?days=7')).data as DailyTrendPoint[],
  })
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get('/api/dashboard/activity?limit=10')).data as AuditLog[],
  })
  const me = useQuery({
    queryKey: ['me-dash'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  // Recharts uses literal color strings (not CSS classes) for axes /
  // grid / tooltip — so we sample the live theme with a tiny hook.
  const isDark = useIsDark()
  const axisColor = isDark ? '#64748b' : '#94a3b8'
  const gridColor = isDark ? 'rgba(148,163,184,0.10)' : '#e2e8f0'
  const cursorColor = isDark ? 'rgba(148,163,184,0.25)' : '#cbd5e1'

  const reduced = useReducedMotion() ?? false
  const isLoading = kpi.isLoading || trend.isLoading || audit.isLoading

  const today = useMemo(
    () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    [],
  )

  function refresh() {
    kpi.refetch()
    trend.refetch()
    audit.refetch()
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of your WhatsApp billing communications."
        right={
          <PrimaryButton onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </PrimaryButton>
        }
      />

      {kpi.isError && <ErrorBox msg={(kpi.error as any)?.message || 'Failed to load KPIs'} />}

      {/* --- hero greeting ------------------------------------------------- */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden mb-6 rounded-2xl p-6 lg:p-8
                   border border-slate-200/80 dark:border-white/10
                   bg-gradient-to-br from-white via-emerald-50/60 to-violet-50/40
                   dark:from-[#0f1a2f] dark:via-[#0c1424] dark:to-[#11142b]
                   shadow-sm dark:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]"
      >
        {/* Decorative aurora blobs — coloured in light, vivid in dark. */}
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full
                                  bg-emerald-300/30 dark:bg-emerald-500/30 blur-3xl
                                  dark:mix-blend-screen animate-[aurora-shift_18s_ease-in-out_infinite]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 w-80 h-80 rounded-full
                                  bg-violet-300/30 dark:bg-violet-500/25 blur-3xl
                                  dark:mix-blend-screen animate-[aurora-shift_22s_ease-in-out_infinite_reverse]" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <motion.div
              initial={{ scale: 0.7, rotate: -15, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 18 }}
              className="hidden sm:grid place-items-center w-14 h-14 rounded-2xl
                         bg-white dark:bg-gradient-to-br dark:from-emerald-500/20 dark:to-violet-500/20
                         shadow-sm border border-slate-200 dark:border-white/10
                         text-amber-500 dark:text-amber-300
                         dark:shadow-[0_8px_30px_-8px_rgba(16,185,129,0.4)]"
            >
              <GreetingIcon className="w-7 h-7" />
            </motion.div>
            <div>
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-sm text-slate-500 dark:text-slate-400"
              >
                {today}
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-2xl lg:text-3xl font-semibold tracking-tight mt-0.5
                           text-slate-900 dark:text-white"
              >
                {greeting()}
                {me.data?.name ? `, ${me.data.name.split(' ')[0]}` : ''}{' '}
                <span aria-hidden>👋</span>
              </motion.h2>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-1 text-sm text-slate-600 dark:text-slate-300 max-w-xl"
              >
                {kpi.data ? (
                  <>
                    You sent{' '}
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {kpi.data.messages_today.toLocaleString()}
                    </span>{' '}
                    messages today —{' '}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {pct(kpi.data.delivery_rate_today)}
                    </span>{' '}
                    reached their destination.
                  </>
                ) : (
                  "Loading today's activity…"
                )}
              </motion.div>
            </div>
          </div>

          <LivePill reduced={reduced} />
        </div>
      </motion.div>

      {/* --- KPI tiles ----------------------------------------------------- */}
      {kpi.data && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        >
          <KpiTile
            tone="blue"
            icon={Users}
            label="Retailers"
            value={kpi.data.total_retailers}
            sub={`${kpi.data.opted_out_retailers} opted out`}
            values={trend.data?.map((t) => t.sent) || []}
          />
          <KpiTile
            tone="violet"
            icon={Send}
            label="Messages today"
            value={kpi.data.messages_today}
            sub={`${pct(kpi.data.delivery_rate_today)} delivered`}
            values={trend.data?.map((t) => t.sent) || []}
          />
          <KpiTile
            tone="emerald"
            icon={Eye}
            label="Read today"
            value={kpi.data.read_today}
            sub={`${pct(kpi.data.read_rate_today)} read rate`}
            values={trend.data?.map((t) => t.read) || []}
          />
          <KpiTile
            tone="rose"
            icon={AlertCircle}
            label="Failed today"
            value={kpi.data.failed_today}
            sub="Re-check phone numbers"
            values={trend.data?.map((t) => t.failed) || []}
          />
        </motion.div>
      )}

      {/* --- chart + donut ------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2" hover>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brand-500" />
                Last 7 days
              </span>
            }
            subtitle="Daily message counts by status"
            right={
              <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <LegendDot color="#3b82f6" label="Sent" />
                <LegendDot color="#10b981" label="Delivered" />
                <LegendDot color="#8b5cf6" label="Read" />
                <LegendDot color="#f43f5e" label="Failed" />
              </div>
            }
          />
          <div className="p-5 h-80">
            {trend.isLoading ? (
              <Spinner />
            ) : trend.isError ? (
              <ErrorBox msg={(trend.error as any)?.message} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-sent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={isDark ? 0.55 : 0.35} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="g-delivered" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={isDark ? 0.55 : 0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="g-read" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={isDark ? 0.55 : 0.35} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="g-failed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={isDark ? 0.55 : 0.35} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="date" fontSize={11} stroke={axisColor} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} fontSize={11} stroke={axisColor} tickLine={false} axisLine={false} />
                  <Tooltip
                    content={<SoftTooltip isDark={isDark} />}
                    cursor={{ stroke: cursorColor, strokeDasharray: '3 3' }}
                  />
                  <Area type="monotone" dataKey="sent"      stroke="#3b82f6" strokeWidth={2.5} fill="url(#g-sent)"      dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: isDark ? '#0f172a' : '#fff' }} />
                  <Area type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2.5} fill="url(#g-delivered)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: isDark ? '#0f172a' : '#fff' }} />
                  <Area type="monotone" dataKey="read"      stroke="#8b5cf6" strokeWidth={2.5} fill="url(#g-read)"      dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: isDark ? '#0f172a' : '#fff' }} />
                  <Area type="monotone" dataKey="failed"    stroke="#f43f5e" strokeWidth={2.5} fill="url(#g-failed)"    dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: isDark ? '#0f172a' : '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <DeliveryDonut kpi={kpi.data} reduced={reduced} />
      </div>

      {/* --- activity + quick actions ------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" hover>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Activity className="w-4 h-4 text-brand-500" />
                Recent activity
              </span>
            }
            subtitle="Latest events across your workspace"
          />
          <div className="p-3 max-h-96 overflow-auto">
            {audit.isLoading ? (
              <Spinner />
            ) : (
              <StaggerList>
                <ul className="space-y-1">
                  {(audit.data || []).map((a) => (
                    <motion.li
                      key={a.id}
                      variants={itemFadeUp}
                      whileHover={{ x: 3 }}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg
                                 hover:bg-slate-50 dark:hover:bg-white/5
                                 transition-colors"
                    >
                      <div
                        className={`grid place-items-center w-9 h-9 rounded-full text-xs font-semibold ring-1 ${actionTone(a.action)}`}
                      >
                        {actionLabel(a.action).charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {actionLabel(a.action)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {a.actor_email || 'system'} · {a.entity_type || 'event'}{' '}
                          {a.entity_id ? `#${a.entity_id}` : ''}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                        {fmtRelative(a.created_at)}
                      </div>
                    </motion.li>
                  ))}
                  {!audit.data?.length && (
                    <li className="text-slate-500 dark:text-slate-400 text-sm py-6 text-center">No activity yet.</li>
                  )}
                </ul>
              </StaggerList>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-1">
              Quick actions
            </div>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction to="/admin/upload"    icon={UploadCloud} title="Upload batch"  desc="Excel / CSV" />
              <QuickAction to="/admin/batches"   icon={Layers}      title="Batches"       desc="Manage sends" />
              <QuickAction to="/admin/templates" icon={FileText}    title="Templates"     desc="WA templates" />
              <QuickAction to="/admin/reports"   icon={TrendingUp}  title="Reports"       desc="Trends · exports" />
            </div>
          </div>

          <Card hover>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  How it works
                </span>
              }
            />
            <div className="p-4 space-y-2.5 text-xs text-slate-600">
              <Step n={1} title="Upload"  desc="Drop an Excel with retailer billing rows." />
              <Step n={2} title="Approve" desc="Review the rows, then click Approve." />
              <Step n={3} title="Deliver" desc="Workers send via WhatsApp automatically." />
              <Step n={4} title="Track"   desc="Status comes back as webhooks in seconds." />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// subcomponents
// ---------------------------------------------------------------------------

function LivePill({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.35, type: 'spring', stiffness: 220, damping: 20 }}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full self-start md:self-auto
                 bg-white dark:bg-emerald-500/10
                 border border-emerald-200 dark:border-emerald-400/30
                 shadow-sm dark:shadow-[0_0_20px_-4px_rgba(16,185,129,0.4)]"
    >
      <motion.span
        aria-hidden
        animate={reduced ? {} : { scale: [1, 1.5, 1], opacity: [0.9, 0.4, 0.9] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
      />
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">All systems operational</span>
    </motion.div>
  )
}

function KpiTile({
  tone, icon: Icon, label, value, sub, values,
}: {
  tone: 'blue' | 'violet' | 'emerald' | 'rose'
  icon: ComponentType<{ className?: string }>
  label: string
  value: number
  sub?: string
  values: number[]
}) {
  // Light/dark tone palettes — pastels in light, deep translucent
  // tints in dark. The dark variant is what makes the dashboard feel
  // rich instead of flat-on-black.
  const styles = {
    blue:    { light: 'from-blue-50 to-indigo-50',           dark: 'dark:from-blue-500/15 dark:to-indigo-500/10',     icon: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',      bar: '#3b82f6', dot: 'bg-blue-500' },
    violet:  { light: 'from-violet-50 to-fuchsia-50',        dark: 'dark:from-violet-500/15 dark:to-fuchsia-500/10',  icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300', bar: '#8b5cf6', dot: 'bg-violet-500' },
    emerald: { light: 'from-emerald-50 to-teal-50',          dark: 'dark:from-emerald-500/15 dark:to-teal-500/10',    icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300', bar: '#10b981', dot: 'bg-emerald-500' },
    rose:    { light: 'from-rose-50 to-orange-50',           dark: 'dark:from-rose-500/15 dark:to-orange-500/10',     icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',       bar: '#f43f5e', dot: 'bg-rose-500' },
  }[tone]

  const path = sparklinePath(values)
  const { delta, pct: pctChange } = trendDelta(values)
  const positive = delta >= 0

  return (
    <motion.div variants={itemFadeUp}>
      <HoverCard
        className={`relative overflow-hidden
                    bg-gradient-to-br ${styles.light} ${styles.dark}
                    border border-slate-200 dark:border-white/10
                    rounded-xl p-5 shadow-sm h-full
                    dark:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)]`}
      >
        {/* Subtle radial accent in the top-right of each tile. */}
        <div aria-hidden className={`absolute -top-12 -right-12 w-32 h-32 rounded-full ${styles.dot} opacity-10 dark:opacity-20 blur-2xl`} />

        <div className="flex items-start justify-between relative">
          <div className={`grid place-items-center w-10 h-10 rounded-lg ${styles.icon}`}>
            <Icon className="w-5 h-5" />
          </div>
          {values.length > 1 && (
            <div
              className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${
                positive
                  ? 'text-emerald-700 bg-emerald-100/70 dark:text-emerald-300 dark:bg-emerald-500/20'
                  : 'text-rose-700 bg-rose-100/70 dark:text-rose-300 dark:bg-rose-500/20'
              }`}
            >
              {positive ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {Math.abs(pctChange).toFixed(0)}%
            </div>
          )}
        </div>
        <div
          aria-live="polite"
          className="mt-3 text-3xl font-semibold tracking-tight text-slate-800 dark:text-white tabular-nums"
        >
          <CountUp value={value} format={(v) => Math.round(v).toLocaleString()} />
        </div>
        <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
        {path && (
          <svg
            viewBox="0 0 100 32"
            className="absolute bottom-2 right-2 w-20 h-7 opacity-70"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d={path}
              fill="none"
              stroke={styles.bar}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </HoverCard>
    </motion.div>
  )
}

function DeliveryDonut({ kpi, reduced }: { kpi?: DashboardKPI; reduced: boolean }) {
  if (!kpi) {
    return (
      <Card hover>
        <CardHeader title="Delivery health" subtitle="Today's snapshot" />
        <div className="p-6 grid place-items-center">
          <Spinner />
        </div>
      </Card>
    )
  }

  const total = Math.max(kpi.messages_today, 1)
  const deliveredPct = (kpi.delivered_today / total) * 100
  const failedPct = (kpi.failed_today / total) * 100
  const pendingPct = Math.max(0, 100 - deliveredPct - failedPct)
  const readRate =
    kpi.delivered_today > 0 ? (kpi.read_today / kpi.delivered_today) * 100 : 0

  return (
    <Card hover>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-emerald-500" />
            Delivery health
          </span>
        }
        subtitle="Today's snapshot"
      />
      <div className="p-5 flex flex-col items-center">
        <DonutChart
          segments={[
            { value: deliveredPct, color: '#10b981' },
            { value: failedPct,    color: '#f43f5e' },
            { value: pendingPct,   color: '#cbd5e1' },
          ]}
          reduced={reduced}
          centerValue={`${deliveredPct.toFixed(0)}%`}
          centerLabel="delivered"
        />
        <div className="mt-4 w-full space-y-1.5 text-xs">
          <DonutRow color="#10b981" label="Delivered" value={kpi.delivered_today} pct={deliveredPct} />
          <DonutRow color="#8b5cf6" label="Read rate" value={kpi.read_today}      pct={readRate} />
          <DonutRow color="#f43f5e" label="Failed"    value={kpi.failed_today}    pct={failedPct} />
        </div>
      </div>
    </Card>
  )
}

function DonutChart({
  segments, reduced, centerValue, centerLabel,
}: {
  segments: { value: number; color: string }[]
  reduced: boolean
  centerValue: string
  centerLabel: string
}) {
  const isDark = useIsDark()
  const size = 168
  const cx = size / 2
  const cy = size / 2
  const r = 64
  const stroke = 16
  const C = 2 * Math.PI * r
  const trackColor = isDark ? 'rgba(148,163,184,0.12)' : '#f1f5f9'

  let cumDeg = 0
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-44 h-44"
      role="img"
      aria-label="Delivery breakdown"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      {segments.map((s, i) => {
        const segLen = (s.value / 100) * C
        const rotation = -90 + cumDeg
        cumDeg += (s.value / 100) * 360
        return (
          <g key={i} transform={`rotate(${rotation} ${cx} ${cy})`}>
            <motion.circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${segLen} ${C}`}
              initial={{ strokeDashoffset: segLen, opacity: 0 }}
              animate={{ strokeDashoffset: 0, opacity: 1 }}
              transition={{
                duration: reduced ? 0 : 0.9,
                delay: reduced ? 0 : 0.15 + i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          </g>
        )
      })}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="fill-slate-800 dark:fill-white"
        style={{ fontSize: 24, fontWeight: 700 }}
      >
        {centerValue}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        className="fill-slate-500 dark:fill-slate-400"
        style={{ fontSize: 10 }}
      >
        {centerLabel}
      </text>
    </svg>
  )
}

function DonutRow({
  color, label, value, pct,
}: {
  color: string
  label: string
  value: number
  pct: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-slate-700 dark:text-slate-300 flex-1">{label}</span>
      <span className="text-slate-500 dark:text-slate-400 tabular-nums">{value.toLocaleString()}</span>
      <span className="text-slate-400 dark:text-slate-500 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function SoftTooltip({ active, payload, label, isDark }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={
      `backdrop-blur shadow-lg rounded-lg px-3 py-2 text-xs border ` +
      (isDark
        ? 'bg-slate-900/95 border-white/10 shadow-black/40'
        : 'bg-white/95 border-slate-200')
    }>
      <div className={`font-medium mb-1 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{label}</div>
      <div className="space-y-0.5">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className={`capitalize ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{p.dataKey}</span>
            <span className={`ml-auto font-medium tabular-nums ${isDark ? 'text-white' : 'text-slate-800'}`}>
              {Number(p.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickAction({
  to, icon: Icon, title, desc,
}: {
  to: string
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
}) {
  const nav = useNavigate()
  return (
    <motion.button
      type="button"
      onClick={() => nav(to)}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="group text-left w-full admin-card rounded-xl p-4
                 hover:border-emerald-300 dark:hover:border-emerald-400/40
                 hover:shadow-md dark:hover:shadow-[0_16px_40px_-12px_rgba(16,185,129,0.25)]
                 transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="grid place-items-center w-9 h-9 rounded-lg
                        bg-emerald-50 text-emerald-700
                        dark:bg-emerald-500/15 dark:text-emerald-300
                        group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25
                        transition-colors">
          <Icon className="w-4 h-4" />
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-500
                                group-hover:text-emerald-500 dark:group-hover:text-emerald-400
                                group-hover:translate-x-0.5 transition-all" />
      </div>
      <div className="text-sm font-medium text-slate-900 dark:text-white">{title}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{desc}</div>
    </motion.button>
  )
}

function Step({
  n, title, desc,
}: {
  n: number
  title: string
  desc: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid place-items-center w-5 h-5 rounded-full
                      bg-emerald-100 text-emerald-700
                      dark:bg-emerald-500/20 dark:text-emerald-300
                      text-[10px] font-semibold shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
        <div className="text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</div>
      </div>
    </div>
  )
}
