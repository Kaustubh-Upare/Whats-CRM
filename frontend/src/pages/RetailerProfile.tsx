import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { ArrowLeft, Phone, MapPin, Clock, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner, StatusPill } from '@/components/ui'
import { fmtDate, fmtMoney, fmtRelative } from '@/lib/format'
import { containerStagger, itemFadeUp, PillPop } from '@/lib/motion'
import type { MessageJob, Retailer } from '@/lib/types'

type Detail = {
  retailer: Retailer
  history: MessageJob[]
}

export default function RetailerProfile() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const q = useQuery({
    queryKey: ['retailer', id],
    queryFn: async () => (await api.get(`/api/retailers/${id}`)).data as Detail,
    enabled: !!id,
  })

  const optToggle = useMutation({
    mutationFn: async (vars: { optOut: boolean }) => {
      await api.post(`/api/retailers/${id}/opt`, { opt_out: vars.optOut, reason })
    },
    onSuccess: (_, vars) => {
      toast.success(vars.optOut ? 'Retailer opted out' : 'Retailer opted in')
      qc.invalidateQueries({ queryKey: ['retailer', id] })
      qc.invalidateQueries({ queryKey: ['retailers'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed'),
  })

  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorBox msg={(q.error as any)?.message || 'Failed to load'} />
  if (!q.data) return <Empty>Not found</Empty>

  const r = q.data.retailer
  return (
    <>
      <PageHeader
        title={r.retailer_name}
        subtitle={`Retailer #${r.id} · ${r.retailer_code}`}
        right={
          <Link to="/retailers">
            <SecondaryButton><ArrowLeft className="w-4 h-4" /> All retailers</SecondaryButton>
          </Link>
        }
      />

      <motion.div
        variants={containerStagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <motion.div variants={itemFadeUp}>
          <Card>
            <CardHeader title="Contact" />
            <div className="p-5 space-y-3 text-sm">
              <Field icon={<Phone className="w-4 h-4" />} label="WhatsApp">
                <span className="font-mono">{r.whatsapp_number}</span>
              </Field>
              <Field icon={<MapPin className="w-4 h-4" />} label="Location">
                {r.city || '—'}{r.state ? `, ${r.state}` : ''}
              </Field>
              <Field icon={<Clock className="w-4 h-4" />} label="Created">
                {fmtDate(r.created_at)}
              </Field>
              <Field icon={<MessageSquare className="w-4 h-4" />} label="Status">
                {r.is_opted_out
                  ? <PillPop className="pill-red">Opted out</PillPop>
                  : <PillPop className="pill-green">Active</PillPop>}
              </Field>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={itemFadeUp} className="lg:col-span-2">
          <Card>
            <CardHeader title="Opt-out" subtitle="Stop sending billing messages to this retailer." />
            <div className="p-5 space-y-3">
              <motion.input
                whileFocus={{ scale: 1.005 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              {r.is_opted_out ? (
                <PrimaryButton onClick={() => optToggle.mutate({ optOut: false })}>Re-activate retailer</PrimaryButton>
              ) : (
                <SecondaryButton onClick={() => optToggle.mutate({ optOut: true })}>Opt this retailer out</SecondaryButton>
              )}
              {r.is_opted_out && (
                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-xs text-slate-500"
                >
                  Opted out {fmtRelative(r.opted_out_at)} · {r.opted_out_reason || 'no reason'}
                </motion.p>
              )}
            </div>
          </Card>
        </motion.div>
      </motion.div>

      <Card className="mt-6" hover={false}>
        <CardHeader title={`Communication history — ${q.data.history.length}`} subtitle="Newest first" />
        {q.data.history.length === 0 ? <Empty>No messages yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <Th>#</Th><Th>Status</Th><Th>Template</Th><Th>Invoice</Th><Th>Amount</Th><Th>Queued</Th><Th>Sent</Th><Th>Delivered</Th><Th>Read</Th><Th></Th>
              </tr></thead>
              <motion.tbody variants={containerStagger} initial="hidden" animate="show">
                {q.data.history.map((j, i) => (
                  <motion.tr
                    key={j.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    whileHover={{ backgroundColor: '#f8fafc' }}
                    className="border-t border-slate-100"
                  >
                    <Td>{j.id}</Td>
                    <Td><StatusPill status={j.status} /></Td>
                    <Td>{j.template_name}</Td>
                    <Td className="font-mono text-xs">{j.invoice_number || '—'}</Td>
                    <Td>{fmtMoney(j.amount)}</Td>
                    <Td>{fmtDate(j.queued_at)}</Td>
                    <Td>{fmtDate(j.sent_at)}</Td>
                    <Td>{fmtDate(j.delivered_at)}</Td>
                    <Td>{fmtDate(j.read_at)}</Td>
                    <Td><Link to={`/messages/${j.id}`} className="text-brand-700 hover:underline text-sm">Open →</Link></Td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function Field({ icon, label, children }: { icon: JSX.Element; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-slate-400 mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-slate-800">{children}</div>
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
