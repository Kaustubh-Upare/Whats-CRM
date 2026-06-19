import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, KpiCard, PageHeader, PrimaryButton, Spinner } from '@/components/ui'
import { fmtRelative, pct } from '@/lib/format'
import { containerStagger, itemFadeUp, StaggerList } from '@/lib/motion'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from 'recharts'
import { Activity, Users, Send, CheckCheck, Eye, AlertCircle, RefreshCw } from 'lucide-react'
import type { AuditLog, DashboardKPI, DailyTrendPoint } from '@/lib/types'

export default function Dashboard() {
  const kpi = useQuery({ queryKey: ['kpi'], queryFn: async () => (await api.get('/api/dashboard/kpi')).data as DashboardKPI })
  const trend = useQuery({ queryKey: ['trend'], queryFn: async () => (await api.get('/api/dashboard/trend?days=7')).data as DailyTrendPoint[] })
  const audit = useQuery({ queryKey: ['audit'], queryFn: async () => (await api.get('/api/dashboard/activity?limit=15')).data as AuditLog[] })

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of your WhatsApp billing communications."
        right={
          <PrimaryButton onClick={() => { kpi.refetch(); trend.refetch(); audit.refetch() }}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </PrimaryButton>
        }
      />

      {kpi.isError && <ErrorBox msg={(kpi.error as any)?.message || 'Failed to load KPIs'} />}
      {kpi.isLoading && <Spinner />}

      {kpi.data && (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        >
          <motion.div variants={itemFadeUp}>
            <KpiCard label="Retailers" value={kpi.data.total_retailers} sub={`${kpi.data.opted_out_retailers} opted out`} tone="slate" countUp />
          </motion.div>
          <motion.div variants={itemFadeUp}>
            <KpiCard label="Messages today" value={kpi.data.messages_today} sub={`${pct(kpi.data.delivery_rate_today)} delivered`} tone="blue" countUp />
          </motion.div>
          <motion.div variants={itemFadeUp}>
            <KpiCard label="Read today" value={kpi.data.read_today} sub={`${pct(kpi.data.read_rate_today)} read rate`} tone="green" countUp />
          </motion.div>
          <motion.div variants={itemFadeUp}>
            <KpiCard label="Failed today" value={kpi.data.failed_today} sub="Re-check phone numbers" tone="red" countUp />
          </motion.div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 7 days" subtitle="Daily message counts by status" />
          <div className="p-5 h-72">
            {trend.isLoading ? <Spinner /> : trend.isError ? <ErrorBox msg={(trend.error as any)?.message} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend.data || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="sent"      stackId="a" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" stackId="a" fill="#34d399" />
                  <Bar dataKey="read"      stackId="a" fill="#8b5cf6" />
                  <Bar dataKey="failed"    stackId="a" fill="#fb7185" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Audit log (latest 15)" />
          <div className="p-3 max-h-80 overflow-auto">
            {audit.isLoading ? <Spinner /> : (
              <StaggerList>
                <ul className="divide-y divide-slate-100">
                  {(audit.data || []).map((a) => (
                    <motion.li
                      key={a.id}
                      variants={itemFadeUp}
                      whileHover={{ x: 2 }}
                      className="px-2 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-medium text-slate-800">{a.action}</span>
                        <span className="ml-auto text-xs text-slate-500">{fmtRelative(a.created_at)}</span>
                      </div>
                      <div className="text-xs text-slate-500 ml-5">
                        {a.actor_email || 'system'} · {a.entity_type || ''} #{a.entity_id || ''}
                      </div>
                    </motion.li>
                  ))}
                  {!audit.data?.length && (
                    <li className="text-slate-500 text-sm py-4 text-center">No activity yet.</li>
                  )}
                </ul>
              </StaggerList>
            )}
          </div>
        </Card>
      </div>

      <StaggerList className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6 text-xs">
        <Hint icon={<Users className="w-4 h-4" />}        title="Retailers" desc="Upload an Excel to onboard." />
        <Hint icon={<Send className="w-4 h-4" />}         title="Send"      desc="Approve a batch — workers send via WhatsApp." />
        <Hint icon={<CheckCheck className="w-4 h-4" />}   title="Delivered" desc="Webhook updates this within seconds." />
        <Hint icon={<Eye className="w-4 h-4" />}          title="Read"      desc="Recipient opened the chat." />
        <Hint icon={<AlertCircle className="w-4 h-4" />}  title="Failed"    desc="Bad number or template — see Messages." />
      </StaggerList>
    </>
  )
}

function Hint({ icon, title, desc }: { icon: JSX.Element; title: string; desc: string }) {
  return (
    <motion.div
      variants={itemFadeUp}
      whileHover={{ y: -2 }}
      className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-2 transition-shadow hover:shadow-sm"
    >
      <div className="text-brand-600 mt-0.5">{icon}</div>
      <div>
        <div className="font-medium text-slate-800">{title}</div>
        <div className="text-slate-500">{desc}</div>
      </div>
    </motion.div>
  )
}
