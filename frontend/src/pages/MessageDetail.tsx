import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, SecondaryButton, Spinner, StatusPill } from '@/components/ui'
import { fmtDate, fmtMoney } from '@/lib/format'
import type { MessageJob, StatusEvent } from '@/lib/types'

type Detail = {
  message: MessageJob
  events: StatusEvent[]
}

export default function MessageDetail() {
  const { id } = useParams<{ id: string }>()
  const q = useQuery({
    queryKey: ['message', id],
    queryFn: async () => (await api.get(`/api/messages/${id}`)).data as Detail,
    enabled: !!id,
    refetchInterval: 5000,
  })

  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorBox msg={(q.error as any)?.message} />
  if (!q.data) return <Empty>Not found</Empty>

  const m = q.data.message
  const events = q.data.events
  return (
    <>
      <PageHeader
        title={`Message #${m.id}`}
        subtitle={`${m.retailer_name || '—'} · ${m.to_number}`}
        right={
          <Link to="/admin/messages/bulk/messages">
            <SecondaryButton><ArrowLeft className="w-4 h-4" /> All messages</SecondaryButton>
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
          className="lg:col-span-1"
        >
          <Card hover={false}>
            <CardHeader title="Details" />
            <div className="p-5 text-sm space-y-2">
              <Row k="Status" v={<StatusPill status={m.status} />} />
              <Row k="Template" v={m.template_name} />
              <Row k="Language" v={m.language_code} />
              <Row k="To" v={<span className="font-mono text-xs">{m.to_number}</span>} />
              <Row k="Invoice" v={<span className="font-mono text-xs">{m.invoice_number || '—'}</span>} />
              <Row k="Amount" v={fmtMoney(m.amount)} />
              <Row k="Attempts" v={`${m.attempts}/${m.max_attempts}`} />
              <Row k="Provider ID" v={<span className="font-mono text-[10px] text-slate-500">{m.provider_msg_id || '—'}</span>} />
              <Row k="Queued" v={fmtDate(m.queued_at)} />
              <Row k="Sent" v={fmtDate(m.sent_at)} />
              <Row k="Delivered" v={fmtDate(m.delivered_at)} />
              <Row k="Read" v={fmtDate(m.read_at)} />
              <Row k="Failed" v={fmtDate(m.failed_at)} />
              {m.last_error && <Row k="Last error" v={<span className="text-rose-700">{m.last_error}</span>} />}
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="lg:col-span-2"
        >
          <Card hover={false}>
            <CardHeader title="Status timeline" subtitle="All events received from Meta's webhook" />
            {events.length === 0 ? <Empty>No status events yet.</Empty> : (
              <ol className="p-5 space-y-3">
                <AnimatePresence initial={false}>
                  {events.map((e, i) => (
                    <motion.li
                      key={e.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="flex gap-3"
                    >
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: i * 0.04 + 0.05, type: 'spring', stiffness: 500, damping: 20 }}
                        className="mt-1 w-2 h-2 rounded-full bg-brand-500 shrink-0"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <StatusPill status={e.status} />
                          <span className="text-xs text-slate-500">{fmtDate(e.occurred_at)}</span>
                        </div>
                        {e.reason_text && (
                          <div className="text-sm text-slate-700 mt-0.5">{e.reason_text} {e.reason_code && <span className="text-slate-400">({e.reason_code})</span>}</div>
                        )}
                        {e.provider_msg_id && (
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5">wamid: {e.provider_msg_id}</div>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </Card>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="mt-6"
      >
        <Card hover={false}>
          <CardHeader title="Template parameters" subtitle={`Sent as {{1}}..{{${(m.template_params as any)?.length || 0}}}`} />
          <div className="p-5">
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 overflow-x-auto">
{JSON.stringify(m.template_params, null, 2)}
            </pre>
          </div>
        </Card>
      </motion.div>
    </>
  )
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-slate-100 pb-1.5 last:border-0">
      <span className="text-xs text-slate-500 w-24 shrink-0">{k}</span>
      <span className="text-slate-800">{v}</span>
    </div>
  )
}
