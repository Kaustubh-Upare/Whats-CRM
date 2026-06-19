import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { fmtRelative } from '@/lib/format'
import { containerStagger, itemFadeUp, PillPop } from '@/lib/motion'
import type { Retailer } from '@/lib/types'

export default function Settings() {
  const optedOut = useQuery({
    queryKey: ['optouts'],
    queryFn: async () => (await api.get('/api/retailers?q=&limit=500')).data as { items: Retailer[] },
  })

  const opted = (optedOut.data?.items || []).filter((r) => r.is_opted_out)

  return (
    <>
      <PageHeader title="Settings" subtitle="Opt-outs, integration health, and a link to the full audit log." />

      <motion.div
        variants={containerStagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <motion.div variants={itemFadeUp}>
          <Card>
            <CardHeader title="Opted-out retailers" subtitle="These won't receive billing messages." />
            {optedOut.isLoading ? <Spinner /> : optedOut.isError ? <ErrorBox msg={(optedOut.error as any)?.message} /> :
              opted.length === 0 ? <Empty>No opt-outs yet. Great!</Empty> : (
                <motion.ul
                  variants={containerStagger}
                  initial="hidden"
                  animate="show"
                  className="p-3 max-h-96 overflow-auto divide-y divide-slate-100"
                >
                  {opted.map((r) => (
                    <motion.li
                      key={r.id}
                      variants={itemFadeUp}
                      whileHover={{ x: 2, backgroundColor: 'rgba(254,226,226,0.3)' }}
                      className="px-2 py-2 text-sm flex items-center gap-3"
                    >
                      <PillPop className="pill-red">opted out</PillPop>
                      <Link to={`/retailers/${r.id}`} className="font-medium hover:underline">{r.retailer_name}</Link>
                      <span className="font-mono text-xs text-slate-500">{r.whatsapp_number}</span>
                      <span className="ml-auto text-xs text-slate-500">{fmtRelative(r.opted_out_at)}</span>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
          </Card>
        </motion.div>

        <motion.div variants={itemFadeUp}>
          <Card>
            <CardHeader title="Integration" subtitle="What's wired into Meta" />
            <div className="p-5 text-sm space-y-3">
              <Row k="Send API" v={<PillPop className="pill-green">Active</PillPop>} />
              <Row k="Webhook" v={<PillPop className="pill-amber">Configure in Meta</PillPop>} sub="Subscribe to 'message_status' field" />
              <Row k="Token"   v={<span className="font-mono text-xs">WHATS_ACCESS_TOKEN</span>} />
              <Row k="Phone ID" v={<span className="font-mono text-xs">WHATS_PHONE_NUMBER_ID</span>} />
              <p className="text-xs text-slate-500">
                See <code>META_SETUP.md</code> in the project root for step-by-step setup of the webhook and
                test-number sandbox.
              </p>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={itemFadeUp} className="lg:col-span-2">
          <Card hover={false}>
            <CardHeader
              title="Audit log"
              subtitle="Every admin action — logins, batch approvals, template changes, retailer opt-outs."
              right={
                <Link
                  to="/audit-log"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm"
                >
                  Open full log <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              }
            />
            <div className="p-5 text-sm text-slate-600">
              The audit log is now its own page with filters by action type (login, batches, templates, webhooks, retailers), live polling, and a search box.
              Click <span className="font-medium text-slate-800">Open full log</span> to view it.
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </>
  )
}

function Row({ k, v, sub }: { k: string; v: any; sub?: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 pb-2 last:border-0">
      <div className="text-xs text-slate-500 w-24 shrink-0">{k}</div>
      <div>
        <div className="text-slate-800">{v}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}
