import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Send, Download, Sparkles, FileText, AlertTriangle, CheckCircle2,
  Bot, Pencil, Repeat2, X, ChevronRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner, StatusPill } from '@/components/ui'
import { batchDisplayName, fmtDate, fmtMoney } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import PhonePreview from '@/components/PhonePreview'
import { Avatar, PhonePreviewCard } from '@/components/PhonePreview'
import { approveBatchOnly, patchBatch, resendBatch } from '@/lib/batchAI'
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
  // templateName is now derived from the user's active templates — see
  // the effect below. We keep it in state so the operator can switch
  // between templates, but the initial value is no longer a hard-coded
  // 'billing_summary_v1' (which would 409 if the user named their
  // template anything else).
  const [templateName, setTemplateName] = useState('')
  const [language, setLanguage] = useState('en')
  const [previewRow, setPreviewRow] = useState<number | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [firstSendOpen, setFirstSendOpen] = useState(false)
  const [resendOpen, setResendOpen] = useState(false)

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

  // Auto-pick the first active template as soon as the list arrives.
  // Done in an effect (not during render) so we don't fire state
  // updates mid-render — and so a manual user override stays sticky.
  useEffect(() => {
    if (!templates.data || templates.data.length === 0) return
    if (templateName && templates.data.some((t) => templateName === templateValue(t) && t.is_active)) return
    const firstActive = templates.data.find((t) => t.is_active) ?? templates.data[0]
    setTemplateName(templateValue(firstActive))
    setLanguage(firstActive.language_code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data])

  const selectedTemplate = splitTemplateValue(templateName, language)
  const activeTemplates = useMemo(
    () => (templates.data || []).filter((t) => t.is_active),
    [templates.data],
  )

  const approve = useMutation({
    mutationFn: async (pick?: { template: string; lang: string }) => {
      // The dropdown encodes "name|language" so we don't have to keep
      // them in sync across two separate <select>s — the user picks
      // one row and we split on the fly.
      const tname = pick?.template || selectedTemplate.name
      const tlang = pick?.lang || selectedTemplate.lang
      const { data } = await api.post(`/api/batches/${id}/approve?template=${encodeURIComponent(tname)}&lang=${encodeURIComponent(tlang)}`)
      return data as { ok: boolean; queued: number }
    },
    onSuccess: (d) => {
      toast.success(`Queued ${d.queued} messages`)
      setFirstSendOpen(false)
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['messages'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['batches', 'ai-followup-hub'] })
      qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Approve failed'),
  })

  // approveOnly flips the batch status to 'approved' WITHOUT queuing
  // any message jobs. Useful when the admin wants to stage AI
  // follow-up tracking first and send later — the per-batch AI
  // follow-up toggle on the Upload page unlocks once the batch is
  // approved.
  const approveOnly = useMutation({
    mutationFn: async () => approveBatchOnly(Number(id)),
    onSuccess: () => {
      toast.success('Batch approved — no messages queued yet')
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (e: any) => {
      const status = e?.response?.status
      const msg = e?.response?.data?.error || 'Approve-only failed'
      // 409 is a benign "already approved" case — surface as info.
      if (status === 409) { toast(msg, { icon: 'ℹ️' }); return }
      toast.error(msg)
    },
  })

  const rename = useMutation({
    mutationFn: async (displayName: string | null) => patchBatch(Number(id), { display_name: displayName }),
    onSuccess: (batch) => {
      toast.success(batch.display_name ? 'Batch name updated' : 'Batch name cleared')
      setRenameOpen(false)
      qc.setQueryData<Detail | undefined>(['batch', id], (old) => (
        old ? { ...old, batch } : old
      ))
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['batches', 'ai-followup-hub'] })
      qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not rename batch'),
  })

  const resend = useMutation({
    mutationFn: async (body: { template: string; lang: string; only_failed?: boolean }) => resendBatch(Number(id), body),
    onSuccess: (d) => {
      toast.success(`Queued ${d.queued} message${d.queued === 1 ? '' : 's'}${d.skipped ? `, skipped ${d.skipped}` : ''}`)
      setResendOpen(false)
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['messages'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Send again failed'),
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

  const batch = q.data?.batch
  const pageTitle = batch ? batchDisplayName(batch) : `Batch #${id}`
  const pageSubtitle = batch
    ? `${batch.display_name ? `Batch #${batch.id} - ${batch.file_name}` : batch.file_name} - ${fmtDate(batch.created_at)}`
    : 'Loading...'
  const latestFailedRows = countLatestFailedRows(q.data?.jobs || [])
  const hasAnyJobs = (q.data?.jobs.length || 0) > 0
  const sendAgainLabel = hasAnyJobs ? 'Send again' : 'Send now'
  const canSendAgain = !!q.data && q.data.batch.valid_rows > 0 && q.data.batch.status !== 'validated'

  // Representative recipient for the Send-Now phone preview. The dialog
  // sends to N retailers at once, so there's no single recipient — we
  // surface the first valid billing record's name as a stand-in (the
  // bubble content is the same shape for everyone). Falls back to
  // "Retailer" if the batch hasn't loaded yet or has no valid rows.
  const firstRecipientName = useMemo(() => {
    const rec = q.data?.preview?.find((r) => r.is_valid && r.retailer_name)
    return rec?.retailer_name || 'Retailer'
  }, [q.data])

  // Valid recipients to surface in the Send-Now dialog's recipient
  // list. Backend caps `preview` at 100 rows so the list is bounded —
  // we render the full slice in a scrollable container so operators
  // can eyeball who'll get the message before confirming.
  const validRecipients = useMemo(
    () => (q.data?.preview || []).filter((r) => r.is_valid),
    [q.data],
  )

  return (
    <>
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {q.data && (
              <>
                <SecondaryButton onClick={() => setRenameOpen(true)}>
                  <Pencil className="w-4 h-4" /> {q.data.batch.display_name ? 'Rename' : 'Name batch'}
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => setResendOpen(true)}
                  disabled={!canSendAgain || resend.isPending}
                  title={
                    q.data.batch.status === 'validated'
                      ? 'Approve the batch first'
                      : q.data.batch.valid_rows === 0
                        ? 'No valid rows to send'
                        : undefined
                  }
                >
                  <Repeat2 className="w-4 h-4" /> {sendAgainLabel}
                </PrimaryButton>
              </>
            )}
            {q.data?.batch.ai_followup_enabled && (
              <Link
                to={`/admin/messages/bulk/batches/${id}/ai-followup`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                           text-emerald-700 dark:text-emerald-300
                           border border-emerald-200 dark:border-emerald-400/30
                           hover:bg-emerald-50 dark:hover:bg-emerald-500/10
                           transition-colors"
                title="Open the per-batch AI follow-up page"
              >
                <Bot className="w-4 h-4" /> AI Follow-ups
              </Link>
            )}
            <Link to="/admin/messages/bulk/batches">
              <SecondaryButton><ArrowLeft className="w-4 h-4" /> All batches</SecondaryButton>
            </Link>
          </div>
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
                  {templates.isLoading ? (
                    <Spinner />
                  ) : activeTemplates.length === 0 ? (
                    <Link
                      to="/admin/messages/bulk/templates"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                                 border border-amber-300 dark:border-amber-400/40
                                 bg-amber-50 dark:bg-amber-500/15
                                 hover:bg-amber-100 dark:hover:bg-amber-500/25
                                 text-amber-800 dark:text-amber-200 text-sm font-medium"
                    >
                      <AlertTriangle className="w-4 h-4" /> Create a template first
                    </Link>
                  ) : q.data.batch.status === 'validated' ? (
                    <>
                      <select
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="text-sm border border-slate-300 dark:border-slate-700
                                   bg-white dark:bg-[var(--input-bg)]
                                   text-slate-900 dark:text-slate-100
                                   rounded-md px-2 py-1.5"
                        title="Pick an active template from your workspace"
                      >
                        {activeTemplates.map((t) => (
                          <option key={t.id} value={templateValue(t)}>
                            {t.name} ({t.language_code})
                          </option>
                        ))}
                      </select>
                      <PrimaryButton
                        onClick={() => setFirstSendOpen(true)}
                        disabled={
                          q.data.batch.valid_rows === 0 ||
                          q.data.batch.status !== 'validated' ||
                          approve.isPending ||
                          approveOnly.isPending ||
                          !templateName
                        }
                        title={q.data.batch.status !== 'validated' ? 'Batch is not in validated status' : ''}
                      >
                        <Send className="w-4 h-4" /> {approve.isPending ? 'Queuing...' : 'Review & Send'}
                      </PrimaryButton>
                      {/* "Approve only" — flips status to 'approved'
                          WITHOUT queuing any messages. Use this when
                          you want to stage AI follow-up tracking for
                          the batch first, before committing to the
                          send. */}
                      <SecondaryButton
                        onClick={() => approveOnly.mutate()}
                        disabled={
                          q.data.batch.status !== 'validated' ||
                          approve.isPending ||
                          approveOnly.isPending
                        }
                        title={
                          q.data.batch.status !== 'validated'
                            ? 'Batch is not in validated status'
                            : 'Approve the batch without sending messages — lets you set up AI follow-up first'
                        }
                      >
                        <CheckCircle2 className="w-4 h-4" /> {approveOnly.isPending ? 'Approving…' : 'Approve only'}
                      </SecondaryButton>
                    </>
                  ) : (
                    <div className="hidden md:flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                      <Repeat2 className="w-3.5 h-3.5 text-emerald-500" />
                      Use Send again for a new message round.
                    </div>
                  )}
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
                    templateName={selectedTemplate.name}
                    language={selectedTemplate.lang}
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
      {q.data && (
        <RenameBatchModal
          open={renameOpen}
          batch={q.data.batch}
          saving={rename.isPending}
          onClose={() => setRenameOpen(false)}
          onSave={(name) => rename.mutate(name)}
        />
      )}
      {q.data && (
        <FirstSendConfirmModal
          open={firstSendOpen}
          batch={q.data.batch}
          templates={activeTemplates}
          selectedTemplateValue={templateName}
          sending={approve.isPending}
          recipientName={firstRecipientName}
          recipients={validRecipients}
          onClose={() => setFirstSendOpen(false)}
          onTemplatePick={(value) => {
            setTemplateName(value)
            const selected = splitTemplateValue(value, language)
            setLanguage(selected.lang)
          }}
          onSubmit={(body) => approve.mutate(body)}
        />
      )}
      {q.data && (
        <ResendBatchModal
          open={resendOpen}
          batch={q.data.batch}
          templates={activeTemplates}
          selectedTemplateValue={templateName}
          failedRows={latestFailedRows}
          hasAnyJobs={hasAnyJobs}
          sending={resend.isPending}
          recipientName={firstRecipientName}
          recipients={validRecipients}
          onClose={() => setResendOpen(false)}
          onSubmit={(body) => resend.mutate(body)}
        />
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

function RenameBatchModal({
  open,
  batch,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  batch: UploadBatch
  saving: boolean
  onClose: () => void
  onSave: (name: string | null) => void
}) {
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName(batch.display_name || '')
  }, [open, batch.display_name])

  const trimmed = name.trim()
  const primaryLabel = batch.display_name ? 'Save name' : 'Set name'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
          onClick={() => {
            if (!saving) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-lg admin-card rounded-xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                  <Pencil className="w-4 h-4 text-emerald-500" />
                  Batch name
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Batch #{batch.id} - {batch.file_name}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Display name
              </label>
              <input
                autoFocus
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="Example: Diwali sweets buyer batch"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 dark:border-[var(--input-border)] dark:bg-[var(--input-bg)] dark:text-slate-100"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>{trimmed || batch.file_name}</span>
                <span>{trimmed.length}/100</span>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onSave(null)}
                disabled={saving || !batch.display_name}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100"
              >
                Clear name
              </button>
              <div className="flex items-center gap-2">
                <SecondaryButton onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
                <PrimaryButton onClick={() => onSave(trimmed || null)} disabled={saving || trimmed.length > 100}>
                  {saving ? 'Saving...' : primaryLabel}
                </PrimaryButton>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FirstSendConfirmModal({
  open,
  batch,
  templates,
  selectedTemplateValue,
  sending,
  recipientName,
  recipients,
  onClose,
  onTemplatePick,
  onSubmit,
}: {
  open: boolean
  batch: UploadBatch
  templates: Template[]
  selectedTemplateValue: string
  sending: boolean
  recipientName: string
  recipients: BillingRecord[]
  onClose: () => void
  onTemplatePick: (value: string) => void
  onSubmit: (body: { template: string; lang: string }) => void
}) {
  const [template, setTemplate] = useState('')
  const [reviewed, setReviewed] = useState(false)
  // Row number picked from the recipients list. When set, the phone
  // preview fetches the per-row substituted body via
  // /api/batches/{id}/preview-message?row=N — that's what the
  // retailer will actually see. null = no row picked yet, so we fall
  // back to the raw template body (no variable substitution).
  const [previewRowNumber, setPreviewRowNumber] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setTemplate(selectedTemplateValue || (templates[0] ? templateValue(templates[0]) : ''))
    setReviewed(false)
    setPreviewRowNumber(null)
  }, [open, selectedTemplateValue, templates])

  const selected = splitTemplateValue(template, templates[0]?.language_code || 'en')
  const selectedTemplateRow = templates.find((t) => templateValue(t) === template)
  const targetCount = batch.valid_rows || 0
  const disabled =
    sending ||
    templates.length === 0 ||
    batch.status !== 'validated' ||
    targetCount <= 0 ||
    !selected.name ||
    !reviewed

  // Per-row preview query — hits the same backend endpoint the page-
  // level PhonePreview uses, so the bubble text matches what the
  // retailer actually receives. Disabled when no row is picked so
  // we don't fetch on dialog open.
  const rowPreview = useQuery({
    queryKey: ['preview-message', batch.id, selected.name, selected.lang, previewRowNumber],
    queryFn: async () => {
      const params: Record<string, string> = { template: selected.name, lang: selected.lang }
      if (previewRowNumber != null) params.row = String(previewRowNumber)
      const { data } = await api.get(`/api/batches/${batch.id}/preview-message`, { params })
      return data as {
        body: string
        template_name: string
        language_code: string
        row_number: number
        retailer_name: string
        whatsapp_number: string
        template_params: string[]
      }
    },
    enabled: open && !!selected.name && previewRowNumber != null,
    refetchOnWindowFocus: false,
  })

  // What the phone should show: substituted body + real retailer name
  // when a row is picked, otherwise the raw template body + the
  // representative name.
  const previewBody = rowPreview.data?.body ?? (selectedTemplateRow?.body || '')
  const previewRecipientName = rowPreview.data?.retailer_name || recipientName

  function pickTemplate(value: string) {
    setTemplate(value)
    onTemplatePick(value)
    setReviewed(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
          onClick={() => {
            if (!sending) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-2xl admin-card rounded-xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                  <Send className="w-4 h-4 text-emerald-500" />
                  Review first send
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Approves this batch and queues WhatsApp messages only after you confirm.
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1 -mr-1">
              {/* Row 1 — template picker (full width) */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  WhatsApp template
                </label>
                {templates.length === 0 ? (
                  <Link
                    to="/admin/messages/bulk/templates"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-200"
                  >
                    <AlertTriangle className="w-4 h-4" /> Create a template first
                  </Link>
                ) : (
                  <select
                    value={template}
                    onChange={(e) => pickTemplate(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 dark:border-[var(--input-border)] dark:bg-[var(--input-bg)] dark:text-slate-100"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={templateValue(t)}>
                        {t.name} ({t.language_code})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Row 2 — phone preview + send summary */}
              <div className="grid gap-5 md:grid-cols-[auto_1fr] items-start">
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Live preview
                    </div>
                    {previewRowNumber != null && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-400/30">
                        row {previewRowNumber}
                        {rowPreview.isFetching && (
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                            className="inline-block w-2.5 h-2.5 rounded-full border border-emerald-300 border-t-emerald-700 dark:border-emerald-400/40 dark:border-t-emerald-200"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <PhonePreviewCard
                    body={previewBody}
                    recipientName={previewRecipientName}
                    size="compact"
                  />
                  {previewRowNumber != null && rowPreview.data && (
                    <button
                      type="button"
                      onClick={() => setPreviewRowNumber(null)}
                      className="mt-2 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline underline-offset-2"
                    >
                      Clear row selection
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Send summary
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    <ReviewLine label="Batch" value={batchDisplayName(batch)} />
                    <ReviewLine label="Template" value={selected.name || '-'} />
                    <ReviewLine label="Language" value={selected.lang || '-'} />
                    <ReviewLine label="Will queue" value={targetCount.toLocaleString()} strong />
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200">
                      This is the first send for this batch. The batch will move out of validated status after confirmation.
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3 — recipients list (clickable: selecting a row loads
                  its per-row substituted message into the phone above) */}
              <RecipientsList
                recipients={recipients}
                selectedRowNumber={previewRowNumber}
                onSelectRow={(rowNumber) => {
                  setPreviewRowNumber(rowNumber)
                  setReviewed(false)
                }}
              />

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>I reviewed the template and recipient count. Queue this send now.</span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <SecondaryButton onClick={onClose} disabled={sending}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={() => onSubmit({ template: selected.name, lang: selected.lang })}
                disabled={disabled}
              >
                <Send className="w-4 h-4" /> {sending ? 'Queueing...' : `Confirm & send ${targetCount.toLocaleString()}`}
              </PrimaryButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ResendBatchModal({
  open,
  batch,
  templates,
  selectedTemplateValue,
  failedRows,
  hasAnyJobs,
  sending,
  recipientName,
  recipients,
  onClose,
  onSubmit,
}: {
  open: boolean
  batch: UploadBatch
  templates: Template[]
  selectedTemplateValue: string
  failedRows: number
  hasAnyJobs: boolean
  sending: boolean
  recipientName: string
  recipients: BillingRecord[]
  onClose: () => void
  onSubmit: (body: { template: string; lang: string; only_failed?: boolean }) => void
}) {
  const [template, setTemplate] = useState('')
  const [scope, setScope] = useState<'all' | 'failed'>('all')
  const [reviewed, setReviewed] = useState(false)
  // Row number picked from the recipients list. When set, the phone
  // preview fetches the per-row substituted body via
  // /api/batches/{id}/preview-message?row=N — that's what the
  // retailer will actually see.
  const [previewRowNumber, setPreviewRowNumber] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setTemplate(selectedTemplateValue || (templates[0] ? templateValue(templates[0]) : ''))
    setScope('all')
    setReviewed(false)
    setPreviewRowNumber(null)
  }, [open, selectedTemplateValue, templates])

  const selected = splitTemplateValue(template, templates[0]?.language_code || 'en')
  const selectedTemplateRow = templates.find((t) => templateValue(t) === template)
  const targetCount = scope === 'failed' ? failedRows : batch.valid_rows
  const disabled =
    sending ||
    templates.length === 0 ||
    batch.status === 'validated' ||
    targetCount <= 0 ||
    !selected.name ||
    !reviewed
  const verb = hasAnyJobs ? 'Send again' : 'Send now'

  // Per-row preview query — same endpoint used by the page-level
  // PhonePreview, so the bubble text matches the actual send.
  const rowPreview = useQuery({
    queryKey: ['preview-message', batch.id, selected.name, selected.lang, previewRowNumber],
    queryFn: async () => {
      const params: Record<string, string> = { template: selected.name, lang: selected.lang }
      if (previewRowNumber != null) params.row = String(previewRowNumber)
      const { data } = await api.get(`/api/batches/${batch.id}/preview-message`, { params })
      return data as {
        body: string
        template_name: string
        language_code: string
        row_number: number
        retailer_name: string
        whatsapp_number: string
        template_params: string[]
      }
    },
    enabled: open && !!selected.name && previewRowNumber != null,
    refetchOnWindowFocus: false,
  })

  const previewBody = rowPreview.data?.body ?? (selectedTemplateRow?.body || '')
  const previewRecipientName = rowPreview.data?.retailer_name || recipientName

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
          onClick={() => {
            if (!sending) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="w-full max-w-2xl admin-card rounded-xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                  <Repeat2 className="w-4 h-4 text-emerald-500" />
                  {verb}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {batchDisplayName(batch)} - {batch.valid_rows.toLocaleString()} valid recipient{batch.valid_rows === 1 ? '' : 's'}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1 -mr-1">
              {/* Row 1 — template picker + scope */}
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    WhatsApp template
                  </label>
                  {templates.length === 0 ? (
                    <Link
                      to="/admin/messages/bulk/templates"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-200"
                    >
                      <AlertTriangle className="w-4 h-4" /> Create a template first
                    </Link>
                  ) : (
                    <select
                      value={template}
                      onChange={(e) => {
                        setTemplate(e.target.value)
                        setReviewed(false)
                      }}
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 dark:border-[var(--input-border)] dark:bg-[var(--input-bg)] dark:text-slate-100"
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={templateValue(t)}>
                          {t.name} ({t.language_code})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="grid gap-2 grid-cols-2 sm:min-w-[280px]">
                  <ScopeButton
                    active={scope === 'all'}
                    title="All valid"
                    value={batch.valid_rows}
                    body="Every valid phone in the batch."
                    onClick={() => { setScope('all'); setReviewed(false) }}
                  />
                  <ScopeButton
                    active={scope === 'failed'}
                    title="Failed only"
                    value={failedRows}
                    body="Only phones whose latest job failed."
                    disabled={failedRows === 0}
                    onClick={() => { setScope('failed'); setReviewed(false) }}
                  />
                </div>
              </div>

              {/* Row 2 — phone preview + review panel */}
              <div className="grid gap-5 md:grid-cols-[auto_1fr] items-start">
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Live preview
                    </div>
                    {previewRowNumber != null && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-400/30">
                        row {previewRowNumber}
                        {rowPreview.isFetching && (
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                            className="inline-block w-2.5 h-2.5 rounded-full border border-emerald-300 border-t-emerald-700 dark:border-emerald-400/40 dark:border-t-emerald-200"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <PhonePreviewCard
                    body={previewBody}
                    recipientName={previewRecipientName}
                    size="compact"
                  />
                  {previewRowNumber != null && rowPreview.data && (
                    <button
                      type="button"
                      onClick={() => setPreviewRowNumber(null)}
                      className="mt-2 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline underline-offset-2"
                    >
                      Clear row selection
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Review
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    <ReviewLine label="Batch" value={batchDisplayName(batch)} />
                    <ReviewLine label="Template" value={selected.name || '-'} />
                    <ReviewLine label="Language" value={selected.lang || '-'} />
                    <ReviewLine label="Will queue" value={targetCount.toLocaleString()} strong />
                    {batch.status === 'validated' && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
                        Approve the batch before sending. Use Approve & Send on this page for the first send.
                      </div>
                    )}
                    {scope === 'all' && hasAnyJobs && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200">
                        This creates a new message job for each valid recipient. It does not retry old jobs.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3 — recipients list (clickable: selecting a row loads
                  its per-row substituted message into the phone above) */}
              <RecipientsList
                recipients={recipients}
                selectedRowNumber={previewRowNumber}
                onSelectRow={(rowNumber) => {
                  setPreviewRowNumber(rowNumber)
                  setReviewed(false)
                }}
                hint={scope === 'failed'
                  ? `Showing all valid recipients. Failed-only filtering happens server-side — ${failedRows} phone${failedRows === 1 ? '' : 's'} will be retried.`
                  : undefined}
              />

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>I reviewed the template and recipient scope. Queue this send now.</span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <SecondaryButton onClick={onClose} disabled={sending}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={() => onSubmit({ template: selected.name, lang: selected.lang, only_failed: scope === 'failed' })}
                disabled={disabled}
              >
                <Send className="w-4 h-4" /> {sending ? 'Queueing...' : `Confirm & ${verb.toLowerCase()} ${targetCount.toLocaleString()}`}
              </PrimaryButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ScopeButton({
  active,
  title,
  value,
  body,
  disabled,
  onClick,
}: {
  active: boolean
  title: string
  value: number
  body: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-200'
          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-emerald-500/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold dark:bg-black/15">
          {value.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 text-xs opacity-75">{body}</div>
    </button>
  )
}

/**
 * RecipientsList — the user-visible recipients of the Send-Now round.
 *
 * Lives inside the dialog body so the operator can scroll the full
 * audience (or at least the capped 100-row preview slice from the
 * backend) before confirming. Each row shows the same coloured avatar
 * that appears in the phone preview header so the visual identity
 * matches.
 *
 * When `onSelectRow` is provided, rows become buttons — clicking one
 * asks the parent to load that row's substituted body into the phone
 * preview via /api/batches/{id}/preview-message?row=N. The selected
 * row gets a highlighted background + a chevron on the right.
 *
 * The list is its OWN scroll container (`max-h-48`) so the outer
 * dialog body can stay scrollable too — the inner list caps its own
 * height and adds a tiny inner scrollbar to keep the layout dense.
 */
function RecipientsList({
  recipients,
  selectedRowNumber,
  onSelectRow,
  hint,
}: {
  recipients: BillingRecord[]
  selectedRowNumber?: number | null
  onSelectRow?: (rowNumber: number) => void
  hint?: string
}) {
  if (recipients.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
        No valid recipients in this batch yet.
      </div>
    )
  }

  const interactive = !!onSelectRow

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Recipients
          </div>
          {interactive && (
            <div className="text-[10px] text-slate-400 dark:text-slate-500 normal-case tracking-normal">
              · click a row to preview
            </div>
          )}
        </div>
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
          {recipients.length.toLocaleString()} shown
        </div>
      </div>
      {hint && (
        <div className="px-3 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-400/20">
          {hint}
        </div>
      )}
      <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
        {recipients.map((r) => {
          const isSelected = selectedRowNumber === r.row_number
          const inner = (
            <>
              <Avatar name={r.retailer_name || 'Retailer'} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {r.retailer_name || <span className="text-slate-400 italic">Unnamed</span>}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {r.retailer_code && <span className="font-mono">{r.retailer_code}</span>}
                  {r.retailer_code && r.whatsapp_number && <span> · </span>}
                  {r.whatsapp_number && <span className="font-mono">+{r.whatsapp_number}</span>}
                </div>
              </div>
              {r.invoice_number && (
                <div className="hidden sm:flex flex-col items-end shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Invoice</div>
                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    {r.invoice_number}
                  </div>
                </div>
              )}
              {interactive && (
                <ChevronRight
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isSelected ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'
                  }`}
                />
              )}
            </>
          )

          const baseClass = `w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
            isSelected
              ? 'bg-emerald-50 dark:bg-emerald-500/15'
              : interactive
                ? 'hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer'
                : ''
          }`

          if (interactive) {
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelectRow!(r.row_number)}
                  className={baseClass}
                  aria-pressed={isSelected}
                >
                  {inner}
                </button>
              </li>
            )
          }
          return <li key={r.id} className={baseClass}>{inner}</li>
        })}
      </ul>
    </div>
  )
}

function TemplateBodyPreview({ body }: { body?: string }) {
  if (!body) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
        Template preview will appear after selecting an active template.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Template preview
      </div>
      <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {body}
      </div>
    </div>
  )
}

function ReviewLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`${strong ? 'text-base font-semibold' : 'font-medium'} text-slate-900 dark:text-white`}>
        {value}
      </span>
    </div>
  )
}

function templateValue(t: Template) {
  return `${t.name}|${t.language_code}`
}

function splitTemplateValue(value: string, fallbackLang: string) {
  if (!value) return { name: '', lang: fallbackLang || 'en' }
  const [name, lang] = value.includes('|') ? value.split('|') : [value, fallbackLang]
  return { name: name || '', lang: lang || fallbackLang || 'en' }
}

function countLatestFailedRows(jobs: MessageJob[]) {
  const latest = new Map<number, MessageJob>()
  for (const job of jobs) {
    const prev = latest.get(job.billing_record_id)
    if (!prev || job.id > prev.id) latest.set(job.billing_record_id, job)
  }
  let count = 0
  latest.forEach((job) => {
    if (job.status === 'failed') count += 1
  })
  return count
}
