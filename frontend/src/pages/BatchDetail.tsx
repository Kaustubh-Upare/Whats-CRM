import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { ArrowLeft, Send, Download, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner, StatusPill } from '@/components/ui'
import { fmtDate, fmtMoney } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import PhonePreview from '@/components/PhonePreview'
import type { BillingRecord, MessageJob, Template, UploadBatch } from '@/lib/types'

type Detail = {
  batch: UploadBatch
  errors: BillingRecord[]
  preview: BillingRecord[]
  summary: { total_rows: number; valid_rows: number; invalid_rows: number }
  jobs: MessageJob[]
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [templateName, setTemplateName] = useState('billing_summary_v1')
  const [language, setLanguage] = useState('en')
  const [previewRow, setPreviewRow] = useState<number | null>(null)

  const q = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => (await api.get(`/api/batches/${id}`)).data as Detail,
    enabled: !!id,
    refetchInterval: 5000,
  })

  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data as Template[],
  })

  const approve = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/api/batches/${id}/approve?template=${encodeURIComponent(templateName)}&lang=${language}`)
      return data as { ok: boolean; queued: number }
    },
    onSuccess: (d) => {
      toast.success(`Queued ${d.queued} messages`)
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Approve failed'),
  })

  function downloadCsv() {
    if (!q.data) return
    const lines = ['retailer_code,retailer_name,whatsapp_number,invoice_number,billing_amount,due_date']
    for (const r of q.data.preview) {
      lines.push([r.retailer_code, r.retailer_name, r.whatsapp_number, r.invoice_number, r.billing_amount, r.due_date]
        .map((v) => (v == null ? '' : String(v).replace(/,/g, ' '))).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `batch-${id}-preview.csv`; a.click()
  }

  return (
    <>
      <PageHeader
        title={`Batch #${id}`}
        subtitle={q.data ? `${q.data.batch.file_name} · ${fmtDate(q.data.batch.created_at)}` : 'Loading…'}
        right={
          <Link to="/batches">
            <SecondaryButton><ArrowLeft className="w-4 h-4" /> All batches</SecondaryButton>
          </Link>
        }
      />

      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox msg={(q.error as any)?.message || 'Failed to load'} />}
      {q.data && (
        <>
          <Card className="mb-6" hover={false}>
            <CardHeader
              title="Summary"
              right={
                <div className="flex items-center gap-2">
                  <select
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="text-sm border border-slate-300 rounded-md px-2 py-1.5"
                  >
                    {(templates.data || []).filter((t) => t.is_active).map((t) => (
                      <option key={t.id} value={t.name}>{t.name} ({t.language_code})</option>
                    ))}
                    {(!templates.data || templates.data.length === 0) && (
                      <option value="billing_summary_v1">billing_summary_v1 (en)</option>
                    )}
                  </select>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="text-sm border border-slate-300 rounded-md px-2 py-1.5"
                  >
                    <option value="en">en</option>
                    <option value="hi">hi</option>
                    <option value="mr">mr</option>
                  </select>
                  <PrimaryButton
                    onClick={() => approve.mutate()}
                    disabled={q.data.batch.valid_rows === 0 || q.data.batch.status !== 'validated' || approve.isPending}
                    title={q.data.batch.status !== 'validated' ? 'Batch is not in validated status' : ''}
                  >
                    <Send className="w-4 h-4" /> {approve.isPending ? 'Queuing…' : 'Approve & Send'}
                  </PrimaryButton>
                </div>
              }
            />
            <motion.div
              variants={containerStagger}
              initial="hidden"
              animate="show"
              className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"
            >
              <motion.div variants={itemFadeUp}><Stat label="Status" value={<StatusPill status={q.data.batch.status} />} /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Total rows" value={q.data.summary.total_rows} /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Valid" value={q.data.summary.valid_rows} tone="green" /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Invalid" value={q.data.summary.invalid_rows} tone="red" /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Started" value={fmtDate(q.data.batch.started_at)} /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Completed" value={fmtDate(q.data.batch.completed_at)} /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Approved by" value={q.data.batch.approved_by ? `#${q.data.batch.approved_by}` : '—'} /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Uploaded by" value={q.data.batch.uploaded_by ? `#${q.data.batch.uploaded_by}` : '—'} /></motion.div>
            </motion.div>
          </Card>

          {/* Phone preview — sits between summary and the rows table */}
          {q.data.summary.valid_rows > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 mb-6">
              <Card hover={false} className="!p-0 overflow-hidden bg-gradient-to-b from-slate-50 to-white">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-brand-500" />
                    <div className="font-semibold text-sm">Recipient preview</div>
                  </div>
                  <div className="text-[11px] text-slate-500">What the retailer will see</div>
                </div>
                <div className="p-6 flex justify-center bg-gradient-to-b from-slate-50 to-slate-100/40">
                  <PhonePreview
                    batchId={Number(id)}
                    initialRow={previewRow ?? q.data.preview[0]?.row_number ?? null}
                    templateName={templateName}
                    language={language}
                    onRowChange={setPreviewRow}
                  />
                </div>
              </Card>

              <Card hover={false}>
                <CardHeader
                  title={`Valid rows — ${q.data.summary.valid_rows} total · ${q.data.preview.length} shown`}
                  subtitle="Tap a row to preview that recipient's message"
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600"><tr>
                      <Th>Row</Th><Th>Retailer</Th><Th>Phone</Th><Th>Invoice</Th><Th>Amount</Th><Th>Due</Th>
                    </tr></thead>
                    <tbody>
                      {q.data.preview.map((r, i) => {
                        const active = (previewRow ?? q.data.preview[0]?.row_number) === r.row_number
                        return (
                          <motion.tr
                            key={r.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.025, duration: 0.2 }}
                            whileHover={{ backgroundColor: '#f8fafc' }}
                            onClick={() => setPreviewRow(r.row_number)}
                            className={`border-t border-slate-100 cursor-pointer ${active ? 'bg-brand-50/60' : ''}`}
                          >
                            <Td><span className="text-slate-400 font-mono text-xs">{r.row_number}</span></Td>
                            <Td>{r.retailer_name}</Td>
                            <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                            <Td className="font-mono text-xs">{r.invoice_number}</Td>
                            <Td>{fmtMoney(r.billing_amount)}</Td>
                            <Td>{r.due_date}</Td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {q.data.errors.length > 0 && (
            <Card className="mb-6" hover={false}>
              <CardHeader title={`Invalid rows (${q.data.errors.length})`} subtitle="Fix and re-upload" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <Th>Row</Th><Th>Code</Th><Th>Retailer</Th><Th>Phone</Th><Th>Errors</Th>
                  </tr></thead>
                  <tbody>
                    {q.data.errors.map((e, i) => (
                      <motion.tr
                        key={e.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.02, duration: 0.2 }}
                        whileHover={{ backgroundColor: '#fff1f2' }}
                        className="border-t border-slate-100 align-top"
                      >
                        <Td>{e.row_number}</Td>
                        <Td className="font-mono text-xs">{e.retailer_code || '—'}</Td>
                        <Td>{e.retailer_name || '—'}</Td>
                        <Td className="font-mono text-xs">{e.whatsapp_number || '—'}</Td>
                        <Td>
                          <div className="space-y-1">
                            {(e.validation_errors || []).map((v, j) => (
                              <motion.div
                                key={j}
                                initial={{ opacity: 0, x: -3 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.05 + j * 0.03 }}
                                className="text-rose-700"
                              >
                                {v.field}: {v.message}
                              </motion.div>
                            ))}
                          </div>
                        </Td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="mb-6" hover={false}>
            <CardHeader
              title={`All valid rows — ${q.data.summary.valid_rows}`}
              right={
                <SecondaryButton onClick={downloadCsv}><Download className="w-4 h-4" /> Export preview CSV</SecondaryButton>
              }
            />
            {q.data.preview.length === 0 ? <Empty>No valid rows.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <Th>Row</Th><Th>Code</Th><Th>Retailer</Th><Th>Phone</Th><Th>Invoice</Th><Th>Amount</Th><Th>Due</Th>
                  </tr></thead>
                  <tbody>
                    {q.data.preview.map((r, i) => (
                      <motion.tr
                        key={r.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.025, duration: 0.2 }}
                        whileHover={{ backgroundColor: '#f8fafc' }}
                        className="border-t border-slate-100"
                      >
                        <Td>{r.row_number}</Td>
                        <Td className="font-mono text-xs">{r.retailer_code}</Td>
                        <Td>{r.retailer_name}</Td>
                        <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                        <Td className="font-mono text-xs">{r.invoice_number}</Td>
                        <Td>{fmtMoney(r.billing_amount)}</Td>
                        <Td>{r.due_date}</Td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <AnimatePresence>
            {q.data.jobs.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Card hover={false}>
                  <CardHeader title={`Message jobs — ${q.data.jobs.length}`} subtitle="Live status from queue + Meta" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600"><tr>
                        <Th>#</Th><Th>To</Th><Th>Retailer</Th><Th>Invoice</Th><Th>Status</Th><Th>Provider ID</Th><Th>Sent</Th>
                      </tr></thead>
                      <tbody>
                        {q.data.jobs.map((j, i) => (
                          <motion.tr
                            key={j.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.02, duration: 0.2 }}
                            whileHover={{ backgroundColor: '#f8fafc' }}
                            className="border-t border-slate-100"
                          >
                            <Td>{j.id}</Td>
                            <Td className="font-mono text-xs">{j.to_number}</Td>
                            <Td>{j.retailer_name || '—'}</Td>
                            <Td className="font-mono text-xs">{j.invoice_number || '—'}</Td>
                            <Td><StatusPill status={j.status} /></Td>
                            <Td className="font-mono text-[10px] text-slate-500">{j.provider_msg_id || '—'}</Td>
                            <Td>{fmtDate(j.sent_at)}</Td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: 'green' | 'red' }) {
  const colors = { green: 'text-emerald-700', red: 'text-rose-700' } as const
  return (
    <div className="bg-slate-50 rounded-md px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-base font-medium ${tone ? colors[tone] : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
