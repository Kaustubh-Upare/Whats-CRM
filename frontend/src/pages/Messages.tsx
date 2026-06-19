import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner, StatusPill } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import type { MessageJob } from '@/lib/types'

const STATUSES = ['', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed']

export default function Messages() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const list = useQuery({
    queryKey: ['messages', status, q],
    queryFn: async () => (await api.get(`/api/messages?status=${status}&q=${encodeURIComponent(q)}&limit=200`)).data as { items: MessageJob[]; total: number },
    refetchInterval: 5000,
  })

  // Single-row resend (only meaningful for failed jobs).
  const resendOne = useMutation({
    mutationFn: async (id: number) => (await api.post(`/api/messages/${id}/resend`)).data,
    onSuccess: (data: any) => {
      toast.success(`Resent job #${data?.id ?? '?'}`)
      qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Resend failed'),
  })

  // Bulk resend of every failed row in the currently-filtered list.
  const failedCount = (list.data?.items || []).filter((j) => j.status === 'failed').length
  const resendAll = useMutation({
    mutationFn: async () => (await api.post('/api/messages/resend-failed')).data,
    onSuccess: (data: any) => {
      const n = data?.retried ?? 0
      toast.success(n > 0 ? `Retrying ${n} failed message${n === 1 ? '' : 's'}` : 'No failed messages')
      qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Bulk resend failed'),
  })

  return (
    <>
      <PageHeader title="Messages" subtitle={`${list.data?.total ?? 0} total`} />

      <Card className="mb-4" hover={false}>
        <div className="p-3 flex flex-wrap gap-3 items-center">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5">
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'all statuses'}</option>)}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search retailer or phone…"
            className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-300 rounded-md"
          />
          <SecondaryButton onClick={() => list.refetch()}>Refresh</SecondaryButton>
          <AnimatePresence>
            {failedCount > 0 && (
              <motion.div
                key="bulk-resend"
                initial={{ opacity: 0, scale: 0.92, x: 4 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
              >
                <PrimaryButton onClick={() => resendAll.mutate()} disabled={resendAll.isPending}>
                  <RotateCcw className="w-4 h-4" />
                  {resendAll.isPending ? 'Retrying…' : `Retry ${failedCount} failed`}
                </PrimaryButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {list.isLoading && <Spinner />}
      {list.isError && <ErrorBox msg={(list.error as any)?.message} />}
      {list.data && (
        <Card hover={false}>
          <CardHeader title="All messages" subtitle="Auto-refreshes every 5 seconds." />
          {list.data.items.length === 0 ? <Empty>No messages yet. Approve a batch to send.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600"><tr>
                  <Th>#</Th><Th>Status</Th><Th>To</Th><Th>Retailer</Th><Th>Template</Th><Th>Invoice</Th><Th>Amount</Th><Th>Sent</Th><Th>Delivered</Th><Th>Read</Th><Th></Th>
                </tr></thead>
                <AnimatePresence initial={false}>
                  <motion.tbody variants={containerStagger} initial="hidden" animate="show" key={`${status}-${q}`}>
                    {list.data.items.map((j) => (
                      <motion.tr
                        key={j.id}
                        variants={itemFadeUp}
                        layout
                        whileHover={{ backgroundColor: '#f8fafc' }}
                        className="border-t border-slate-100"
                      >
                        <Td>{j.id}</Td>
                        <Td><StatusPill status={j.status} /></Td>
                        <Td className="font-mono text-xs">{j.to_number}</Td>
                        <Td>{j.retailer_name || '—'}</Td>
                        <Td>{j.template_name}</Td>
                        <Td className="font-mono text-xs">{j.invoice_number || '—'}</Td>
                        <Td>{j.amount ? '₹ ' + j.amount.toFixed(2) : '—'}</Td>
                        <Td>{fmtDate(j.sent_at)}</Td>
                        <Td>{fmtDate(j.delivered_at)}</Td>
                        <Td>{fmtDate(j.read_at)}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            {j.status === 'failed' && (
                              <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.95 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                                onClick={() => resendOne.mutate(j.id)}
                                disabled={resendOne.isPending}
                                title="Re-queue this message"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                                           bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100
                                           disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <RotateCcw className="w-3 h-3" /> Resend
                              </motion.button>
                            )}
                            <Link to={`/messages/${j.id}`} className="text-brand-700 hover:underline text-sm">Open →</Link>
                          </div>
                        </Td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                </AnimatePresence>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
