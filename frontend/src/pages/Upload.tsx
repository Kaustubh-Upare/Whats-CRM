import { useState, useEffect, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowRight, ArrowUpRight, Download, RefreshCw, Sparkles,
  Bot, ChevronDown, ChevronUp, ExternalLink, ShieldAlert,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { containerStagger, itemFadeUp, CountUp } from '@/lib/motion'
import { fmtMoney } from '@/lib/format'
import PhonePreview from '@/components/PhonePreview'
import { getAIAgentConfig, aiKeys } from '@/lib/ai'
import { getBatchAIFollowup, putBatchAIFollowup, batchAIKeys } from '@/lib/batchAI'
import {
  AIFollowupStatusBadge, AIFollowupStatusCounts, AIFollowupLastMessage,
} from '@/components/AIFollowupParts'
import type { BatchAIFollowup, BatchAIRecipient, BillingRecord, Template, UploadBatch } from '@/lib/types'

type UploadResp = {
  batch: UploadBatch
  summary: { total: number; valid: number; invalid: number; duplicates: number; optouts: number }
  preview: BillingRecord[]
  errors: BillingRecord[]
  file_path: string
}

type UploadInspectResp = {
  headers: string[]
  sample_rows: Record<string, string>[]
  total_rows: number
  file_name: string
}

type UploadMappingState = {
  phone: string
  name: string
  retailer_code: string
  invoice_number: string
  billing_amount: string
  due_date: string
  payment_link: string
  language: string
  template_vars: Record<string, string>
}

export default function Upload() {
  const nav = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResp | null>(null)
  const [previewRow, setPreviewRow] = useState<number | null>(null)
  const [templateKey, setTemplateKey] = useState('')
  const [mapping, setMapping] = useState<UploadMappingState>(emptyUploadMapping())
  // We need to refresh the result view's local "enabled" state from
  // the server if a GET comes back with a different value (e.g.
  // another tab toggled it, or the server rejected a PUT). The
  // uploaded `result.batch` only carries the value at upload-time;
  // subsequent refreshes come through queryClient.invalidate.

  // Merge the latest server-confirmed batch status /
  // ai_followup_enabled back into the upload result, so the header
  // chip and the toggle's parent context don't drift after the user
  // navigates to the batch detail page and back. Without this, the
  // header still says "validated" even after a successful Approve
  // on /admin/batches/:id.
  function applyFollowupSnapshot(f: BatchAIFollowup) {
    setResult((prev) => prev && prev.batch.id === f.batch_id
      ? {
          ...prev,
          batch: {
            ...prev.batch,
            status: f.batch_status as UploadBatch['status'],
            ai_followup_enabled: f.enabled,
            ai_followup_enabled_at: f.enabled_at ?? prev.batch.ai_followup_enabled_at,
          },
        }
      : prev)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'] },
    multiple: false,
    onDrop: (files) => {
      setFile(files[0] || null)
      setMapping(emptyUploadMapping())
      inspect.reset()
    },
  })

  const inspect = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('file', file!)
      const { data } = await api.post('/api/batches/inspect-upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data as UploadInspectResp
    },
    onSuccess: (data) => {
      const vars = activeTemplate ? extractTemplateVars(activeTemplate.body) : []
      setMapping(suggestUploadMapping(data.headers, vars))
      toast.success(`Found ${data.headers.length} columns and ${data.total_rows} rows`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not read columns'),
  })

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('file', file!)
      if (inspect.data) {
        fd.append('mapping', JSON.stringify(mapping))
      }
      const { data } = await api.post('/api/batches/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data as UploadResp
    },
    onSuccess: (data) => {
      setResult(data)
      setPreviewRow(data.preview[0]?.row_number ?? null)
      toast.success(`Validated ${data.summary.valid} of ${data.summary.total} rows`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Upload failed'),
  })

  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data as Template[],
  })
  const activeTemplates = useMemo(() => (templates.data || []).filter((t) => t.is_active), [templates.data])
  useEffect(() => {
    if (templateKey || activeTemplates.length === 0) return
    setTemplateKey(templateValue(activeTemplates[0]))
  }, [activeTemplates, templateKey])
  const activeTemplate = useMemo(
    () => activeTemplates.find((t) => templateValue(t) === templateKey) || activeTemplates[0] || null,
    [activeTemplates, templateKey],
  )
  const templateVars = useMemo(
    () => activeTemplate ? extractTemplateVars(activeTemplate.body) : [],
    [activeTemplate],
  )
  const missingTemplateVars = useMemo(
    () => templateVars.filter((v) => !mapping.template_vars[v]),
    [templateVars, mapping.template_vars],
  )

  function reset() {
    setFile(null); setResult(null); setPreviewRow(null); setMapping(emptyUploadMapping()); inspect.reset()
  }

  function downloadErrors() {
    if (!result) return
    const cols = ['row_number', 'retailer_code', 'retailer_name', 'whatsapp_number', 'invoice_number', 'billing_amount', 'due_date', 'errors']
    const lines = [cols.join(',')]
    for (const e of result.errors) {
      const errs = (e.validation_errors || []).map((v) => `${v.field}:${v.code}:${v.message}`).join(' | ')
      lines.push([e.row_number, e.retailer_code || '', e.retailer_name || '', e.whatsapp_number || '',
                  e.invoice_number || '', e.billing_amount ?? '', e.due_date || '', '"' + errs + '"'].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `batch-${result.batch.id}-errors.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Upload billing file"
        subtitle="Drop an .xlsx or .csv to validate and preview before sending."
      />

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-2">
              <motion.div
                animate={{ scale: isDragActive ? 1.01 : 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className={`bg-white dark:bg-[var(--bg-elevated)] border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-400/60'
                    : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-400/60'
                }`}
              >
                <div {...getRootProps()} className="cursor-pointer">
                <input {...getInputProps()} />
                <motion.div
                  animate={{ y: isDragActive ? -4 : 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="inline-block"
                >
                  <UploadCloud className="w-12 h-12 mx-auto text-brand-500" />
                </motion.div>
                <div className="mt-4 text-slate-900 dark:text-white font-medium">
                  {isDragActive ? 'Drop the file here…' : 'Drag & drop, or click to browse'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">.xlsx or .csv · up to 25 MB</div>
                <AnimatePresence>
                  {file && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                      className="mt-5 inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 px-3.5 py-2 rounded-lg"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span className="font-medium">{file.name}</span>
                      <span className="text-slate-500 dark:text-slate-400">·</span>
                      <span className="text-slate-500 dark:text-slate-400">{(file.size / 1024).toFixed(1)} KB</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              </motion.div>

              <div className="mt-5 flex gap-3 items-center flex-wrap">
                <PrimaryButton
                  onClick={() => inspect.data ? upload.mutate() : inspect.mutate()}
                  disabled={!file || upload.isPending || inspect.isPending || (inspect.data ? !mapping.phone : false)}
                >
                  {inspect.isPending ? (
                    <><Spinner /> Reading columns...</>
                  ) : upload.isPending ? (
                    <><Spinner /> Validating…</>
                  ) : inspect.data ? (
                    <><Sparkles className="w-4 h-4" /> Validate with mapping</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Read columns</>
                  )}
                </PrimaryButton>
                <a href="/sample-billing-template.xlsx" download
                   className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200">
                  Download sample template
                </a>
                {file && (
                  <button onClick={reset} className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
                    Clear
                  </button>
                )}
              </div>
              {inspect.data && activeTemplate && (
                <SmartMappingPanel
                  inspect={inspect.data}
                  template={activeTemplate}
                  templateVars={templateVars}
                  mapping={mapping}
                  setMapping={setMapping}
                  missingTemplateVars={missingTemplateVars}
                />
              )}
              {inspect.isError && <div className="mt-4"><ErrorBox msg={(inspect.error as any)?.response?.data?.error || 'Could not read columns'} /></div>}
              {upload.isError && <div className="mt-4"><ErrorBox msg={(upload.error as any)?.response?.data?.error || 'Upload failed'} /></div>}
            </div>

            <Card className="self-start">
              <CardHeader title="Template-first upload" subtitle="Any spreadsheet format is okay" />
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Active template
                  </label>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                    value={templateKey}
                    onChange={(e) => {
                      const next = e.target.value
                      setTemplateKey(next)
                      const tpl = activeTemplates.find((t) => templateValue(t) === next)
                      if (inspect.data && tpl) {
                        setMapping(suggestUploadMapping(inspect.data.headers, extractTemplateVars(tpl.body)))
                      }
                    }}
                    disabled={activeTemplates.length === 0}
                  >
                    {activeTemplates.length === 0 ? (
                      <option value="">No active templates</option>
                    ) : activeTemplates.map((t) => (
                      <option key={t.id} value={templateValue(t)}>{t.name} / {t.language_code}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-950 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <div className="font-semibold">How it works</div>
                  <div className="mt-1 leading-6">
                    Upload any file, then map your columns to the selected template variables. Extra columns are ignored. Missing template variables show a warning before send.
                  </div>
                </div>
                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Phone number is required for delivery.
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Name is optional; a safe fallback is created if empty.
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    Unmapped template variables will send blank values.
                  </div>
                </div>
                {!activeTemplate && (
                  <Link
                    to="/admin/templates"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    Create or activate template <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
                <TemplateMessagePreview
                  template={activeTemplate}
                  title="Selected template"
                  subtitle="Before mapping, variables stay visible."
                />
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Action bar — clean, premium */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center justify-between gap-3 flex-wrap admin-card rounded-2xl px-5 py-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 grid place-items-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">
                    Batch #{result.batch.id} · {result.batch.file_name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Validated {new Date(result.batch.created_at).toLocaleString()} ·{' '}
                    <span className="capitalize">{result.batch.status}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SecondaryButton onClick={reset}>
                  <RefreshCw className="w-4 h-4" /> Upload another
                </SecondaryButton>
                <AIFollowupToggle batch={result.batch} onBatchRefreshed={applyFollowupSnapshot} />
                {result.batch.ai_followup_enabled && (
                  <Link
                    to={`/admin/messages/bulk/batches/${result.batch.id}/ai-followup`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                               text-emerald-700 dark:text-emerald-300
                               border border-emerald-200 dark:border-emerald-400/30
                               hover:bg-emerald-50 dark:hover:bg-emerald-500/10
                               transition-colors"
                    title="Open the per-batch AI follow-up page — survives navigation, polls every 10s"
                  >
                    <Bot className="w-4 h-4" /> View AI panel →
                  </Link>
                )}
                {result.batch.valid_rows > 0 && (
                  <PrimaryButton onClick={() => nav(`/admin/messages/bulk/batches/${result.batch.id}`)}>
                    {['approved', 'sending', 'sent', 'completed'].includes(result.batch.status) ? (
                      <>Open batch <ArrowRight className="w-4 h-4" /></>
                    ) : (
                      <>Approve &amp; open <ArrowRight className="w-4 h-4" /></>
                    )}
                  </PrimaryButton>
                )}
              </div>
            </motion.div>

            {/* Stat strip */}
            <motion.div
              variants={containerStagger}
              initial="hidden"
              animate="show"
              className="grid grid-cols-2 md:grid-cols-5 gap-3"
            >
              <motion.div variants={itemFadeUp}><Stat label="Total"      value={result.summary.total}      /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Valid"      value={result.summary.valid}      tone="green" /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Invalid"    value={result.summary.invalid}    tone="red" /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Duplicates" value={result.summary.duplicates} tone="amber" /></motion.div>
              <motion.div variants={itemFadeUp}><Stat label="Opted out"  value={result.summary.optouts}    tone="amber" /></motion.div>
            </motion.div>

            {/* Phone preview + row picker */}
            {result.batch.valid_rows > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
                {/* Phone */}
                <Card hover={false} className="!p-0 overflow-hidden bg-gradient-to-b from-slate-50 to-white dark:from-slate-900/40 dark:to-slate-950/30">
                  <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-500" />
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-white">Recipient preview</div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {activeTemplate
                            ? `${activeTemplate.name} / ${activeTemplate.language_code}`
                            : templates.isLoading
                              ? 'Loading templates...'
                              : 'No active template selected'}
                        </div>
                      </div>
                    </div>
                    {activeTemplate ? (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        What the retailer will see
                      </div>
                    ) : (
                      <Link
                        to="/admin/templates"
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
                      >
                        Templates <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="p-6 flex justify-center bg-gradient-to-b from-slate-50 to-slate-100/40 dark:from-slate-900/30 dark:to-slate-800/30">
                    <PhonePreview
                      batchId={result.batch.id}
                      initialRow={previewRow}
                      templateName={activeTemplate?.name || ''}
                      language={activeTemplate?.language_code || ''}
                      onRowChange={setPreviewRow}
                    />
                  </div>
                </Card>

                {/* Row picker + summary */}
                <Card hover={false}>
                  <CardHeader
                    title={`Preview — first ${result.preview.length} valid rows`}
                    subtitle="Tap a row to preview that recipient's message"
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                        <tr>
                          <Th>#</Th><Th>Retailer</Th><Th>WhatsApp</Th><Th>Invoice</Th><Th>Amount</Th><Th>Due</Th><Th></Th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.preview.map((r, i) => {
                          const active = previewRow === r.row_number
                          return (
                            <motion.tr
                              key={r.id}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.03, duration: 0.2 }}
                              onClick={() => setPreviewRow(r.row_number)}
                              whileHover={{ backgroundColor: 'rgba(148,163,184,0.08)' }}
                              className={`border-t border-slate-100 dark:border-white/10 cursor-pointer transition-colors ${
                                active ? 'bg-emerald-50/60 dark:bg-emerald-500/15' : ''
                              }`}
                            >
                              <Td><span className="text-slate-400 dark:text-slate-500 font-mono text-xs">{r.row_number}</span></Td>
                              <Td>{r.retailer_name}</Td>
                              <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                              <Td className="font-mono text-xs">{r.invoice_number}</Td>
                              <Td>{fmtMoney(r.billing_amount)}</Td>
                              <Td>{r.due_date}</Td>
                              <Td>
                                {active ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    Previewing <ArrowUpRight className="w-3 h-3" />
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Tap to preview</span>
                                )}
                              </Td>
                            </motion.tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* AI agent activity — per-recipient AI follow-up state for
                this batch. Hidden entirely when there are no valid
                recipients (i.e. no one to track). */}
            {result.batch.valid_rows > 0 && (
              <AIAgentActivityPanel batchId={result.batch.id} />
            )}

            {/* Errors (collapsed if none) */}
            {result.errors.length > 0 && (
              <Card hover={false}>
                <CardHeader
                  title={`Validation errors — ${result.errors.length} rows`}
                  subtitle="Fix these in your file and re-upload."
                  right={
                    <SecondaryButton onClick={downloadErrors}>
                      <Download className="w-4 h-4" /> Export errors CSV
                    </SecondaryButton>
                  }
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                      <tr>
                        <Th>Row</Th><Th>Code</Th><Th>Retailer</Th><Th>WhatsApp</Th><Th>Errors</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <motion.tr
                          key={e.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.2 }}
                          whileHover={{ backgroundColor: 'rgba(244,63,94,0.10)' }}
                          className="border-t border-slate-100 dark:border-white/10 align-top"
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
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.1 + j * 0.04 }}
                                  className="flex items-start gap-1.5 text-rose-700 dark:text-rose-300"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <span><span className="font-medium">{v.field}</span> ({v.code}): {v.message}</span>
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' | 'amber' }) {
  const colors = {
    green: 'text-emerald-700 dark:text-emerald-300',
    red:   'text-rose-700   dark:text-rose-300',
    amber: 'text-amber-700  dark:text-amber-300',
  } as const
  return (
    <div className="admin-card rounded-xl px-4 py-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${tone ? colors[tone] : 'text-slate-800 dark:text-white'}`}>
        <CountUp value={value} format={(v) => Math.round(v).toLocaleString()} />
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }

function SmartMappingPanel({
  inspect,
  template,
  templateVars,
  mapping,
  setMapping,
  missingTemplateVars,
}: {
  inspect: UploadInspectResp
  template: Template
  templateVars: string[]
  mapping: UploadMappingState
  setMapping: React.Dispatch<React.SetStateAction<UploadMappingState>>
  missingTemplateVars: string[]
}) {
  const sample = inspect.sample_rows[0] || {}
  const ignoredCount = Math.max(0, inspect.headers.length - mappedColumnCount(mapping))

  function update<K extends keyof UploadMappingState>(key: K, value: UploadMappingState[K]) {
    setMapping((prev) => ({ ...prev, [key]: value }))
  }
  function updateVar(token: string, column: string) {
    setMapping((prev) => ({
      ...prev,
      template_vars: { ...prev.template_vars, [token]: column },
    }))
  }

  return (
    <Card hover={false} className="mt-6 overflow-hidden">
      <CardHeader
        title="Map columns to template"
        subtitle={`${inspect.total_rows} rows found in ${inspect.file_name}`}
        right={
          <button
            type="button"
            onClick={() => setMapping(suggestUploadMapping(inspect.headers, templateVars))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <Sparkles className="h-3.5 w-3.5" /> Auto map
          </button>
        }
      />
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MappingSelect label="Phone number" required value={mapping.phone} headers={inspect.headers} sample={sample} onChange={(v) => update('phone', v)} />
            <MappingSelect label="Customer / retailer name" value={mapping.name} headers={inspect.headers} sample={sample} onChange={(v) => update('name', v)} />
          </div>
          <TemplateMessagePreview
            template={template}
            sample={sample}
            mapping={mapping}
            title="Live sample message"
            subtitle="Updates from the first row as you map columns."
          />
        </div>

        {templateVars.length > 0 ? (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Template variables</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {template.name} needs {templateVars.length} variable{templateVars.length === 1 ? '' : 's'}.
                </div>
              </div>
              {ignoredCount > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {ignoredCount} extra column{ignoredCount === 1 ? '' : 's'} ignored
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templateVars.map((token) => (
                <MappingSelect
                  key={token}
                  label={`{{${token}}}`}
                  value={mapping.template_vars[token] || ''}
                  headers={inspect.headers}
                  sample={sample}
                  onChange={(v) => updateVar(token, v)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
            This template has no variables. Only the phone column is required.
          </div>
        )}

        {missingTemplateVars.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Some template variables are not mapped</div>
                <div className="mt-1 leading-6">
                  {missingTemplateVars.map((v) => `{{${v}}}`).join(', ')} will be blank in the final message unless you map them.
                </div>
              </div>
            </div>
          </div>
        )}

        <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-white">Sample row preview</summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {inspect.headers.slice(0, 12).map((h) => (
              <div key={h} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
                <div className="font-medium text-slate-700 dark:text-slate-200">{h}</div>
                <div className="mt-0.5 truncate text-slate-500 dark:text-slate-400">{sample[h] || '-'}</div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </Card>
  )
}

function TemplateMessagePreview({
  template,
  sample,
  mapping,
  title,
  subtitle,
}: {
  template: Template | null
  sample?: Record<string, string>
  mapping?: UploadMappingState
  title: string
  subtitle: string
}) {
  const body = template?.body || ''
  const mapped = mapping && sample ? previewTemplateParts(body, mapping, sample) : previewTemplateParts(body)

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
          <div className="mt-0.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{subtitle}</div>
        </div>
        {template && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
            {template.language_code}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-[#e5ddd5] p-3 shadow-inner dark:border-white/10">
        <div className="mb-2 flex items-center gap-2 rounded-t-xl bg-[#075e54] px-3 py-2 text-white">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-[11px] font-bold">
            {template?.name?.slice(0, 1)?.toUpperCase() || 'T'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{template?.name || 'Select template'}</div>
            <div className="text-[10px] text-white/75">WhatsApp preview</div>
          </div>
        </div>
        <div className="rounded-2xl rounded-tr-md bg-[#dcf8c6] px-3 py-2 text-[12.5px] leading-relaxed text-slate-900 shadow-sm">
          {body ? (
            <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words">
              {mapped}
            </div>
          ) : (
            <div className="text-slate-600">Choose an active template to preview the message.</div>
          )}
        </div>
      </div>

      {mapping && (
        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Green values are filled from the sample row. Amber placeholders still need mapping.
        </div>
      )}
    </div>
  )
}

function previewTemplateParts(body: string, mapping?: UploadMappingState, sample?: Record<string, string>) {
  if (!body) return null
  const parts: React.ReactNode[] = []
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    if (match.index > last) parts.push(body.slice(last, match.index))
    const token = match[1].trim()
    const column = mapping?.template_vars[token] || ''
    const value = column && sample ? sample[column] : ''
    parts.push(
      value ? (
        <span key={`${token}-${match.index}`} className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-900">
          {value}
        </span>
      ) : (
        <span key={`${token}-${match.index}`} className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
          {`{{${token}}}`}
        </span>
      ),
    )
    last = re.lastIndex
  }
  if (last < body.length) parts.push(body.slice(last))
  return parts
}

function MappingSelect({
  label,
  value,
  headers,
  sample,
  required,
  onChange,
}: {
  label: string
  value: string
  headers: string[]
  sample: Record<string, string>
  required?: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}{required ? ' *' : ''}
        </span>
        {value && (
          <span className="max-w-[160px] truncate text-[11px] text-slate-400 dark:text-slate-500">
            {sample[value] || 'blank in sample'}
          </span>
        )}
      </div>
      <select
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-slate-950 dark:text-white ${
          required && !value ? 'border-rose-300 dark:border-rose-400/50' : 'border-slate-200 dark:border-white/10'
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Do not map</option>
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </label>
  )
}

function emptyUploadMapping(): UploadMappingState {
  return {
    phone: '',
    name: '',
    retailer_code: '',
    invoice_number: '',
    billing_amount: '',
    due_date: '',
    payment_link: '',
    language: '',
    template_vars: {},
  }
}

function suggestUploadMapping(headers: string[], vars: string[]): UploadMappingState {
  const mapping = emptyUploadMapping()
  mapping.phone = pickHeader(headers, ['whatsapp', 'mobile', 'phone', 'contact', 'number'])
  mapping.name = pickHeader(headers, ['retailer', 'customer', 'client', 'buyer', 'shop', 'store', 'name'])
  mapping.retailer_code = pickHeader(headers, ['retailer_code', 'code', 'customer_id', 'id'])
  mapping.invoice_number = pickHeader(headers, ['invoice', 'bill', 'order'])
  mapping.billing_amount = pickHeader(headers, ['amount', 'total', 'pending', 'balance', 'price'])
  mapping.due_date = pickHeader(headers, ['due', 'date', 'payment_date'])
  mapping.payment_link = pickHeader(headers, ['payment_link', 'link', 'url'])
  mapping.language = pickHeader(headers, ['language', 'lang'])
  for (const token of vars) {
    mapping.template_vars[token] = suggestForToken(headers, token, mapping)
  }
  return mapping
}

function suggestForToken(headers: string[], token: string, mapping: UploadMappingState): string {
  const key = token.toLowerCase()
  if (/^\d+$/.test(key)) {
    const defaults = [mapping.name, '', mapping.invoice_number, mapping.billing_amount, mapping.due_date, mapping.payment_link]
    return defaults[Number(key) - 1] || ''
  }
  if (/(phone|mobile|whatsapp|number)/.test(key)) return mapping.phone
  if (/(name|customer|retailer|shop|client)/.test(key)) return mapping.name
  if (/(invoice|bill|order)/.test(key)) return mapping.invoice_number
  if (/(amount|total|price|balance|pending)/.test(key)) return mapping.billing_amount
  if (/(due|date|time)/.test(key)) return mapping.due_date
  if (/(link|url|pay)/.test(key)) return mapping.payment_link
  return pickHeader(headers, [key])
}

function pickHeader(headers: string[], hints: string[]): string {
  const normalized = hints.map(normalizeHeader)
  return headers.find((h) => {
    const n = normalizeHeader(h)
    return normalized.some((hint) => n.includes(hint) || hint.includes(n))
  }) || ''
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function extractTemplateVars(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const token = match[1].trim()
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

function mappedColumnCount(mapping: UploadMappingState): number {
  const values = [
    mapping.phone,
    mapping.name,
    mapping.retailer_code,
    mapping.invoice_number,
    mapping.billing_amount,
    mapping.due_date,
    mapping.payment_link,
    mapping.language,
    ...Object.values(mapping.template_vars),
  ].filter(Boolean)
  return new Set(values).size
}

function templateValue(t: Template) {
  return `${t.name}|${t.language_code}`
}

/* ----------------------------------------------------------------------- */
/* AI follow-up — per-batch toggle + activity panel                         */
/* ----------------------------------------------------------------------- */

// AIFollowupToggle is the inline switch in the result action bar.
//
// Behaviour:
//   - Disabled when the batch hasn't been approved yet — the user
//     explicitly chose "AI follow-up activates only after Approve &
//     open", so we surface a tooltip explaining why. The batch statuses
//     `approved | sending | sent | completed` are all "approved".
//   - Independent of the global AIAgentConfig.enabled. If the global
//     agent is disabled we show a small amber warning chip that links
//     to /admin/ai/agent — non-blocking, since the admin may want to
//     schedule the batch to turn on AI later.
//   - On change, PUTs to /api/batches/:id/ai-followup, then invalidates
//     the matching query so AIAgentActivityPanel re-fetches.
function AIFollowupToggle({ batch, onBatchRefreshed }: { batch: UploadBatch; onBatchRefreshed?: (f: BatchAIFollowup) => void }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)

  // Source of truth: the same GET that powers the AI agent activity
  // panel below. This makes the toggle reactive to changes that
  // happen elsewhere (e.g. the user approves the batch on
  // /admin/batches/:id and then comes back here — the refetch picks
  // up the new status). Without this, the toggle was gated on the
  // upload-time-frozen `batch.status` and stayed disabled forever.
  const followupQ = useQuery({
    queryKey: batchAIKeys.followup(batch.id),
    queryFn: () => getBatchAIFollowup(batch.id),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  })

  // Probe the global agent to surface a warning when the global
  // switch is off. We don't fail-closed — the admin might be planning
  // to enable both at the same time, so the chip is informational.
  const agentQ = useQuery({
    queryKey: aiKeys.agent(),
    queryFn: getAIAgentConfig,
    // Cached for 5 minutes; re-fetched on demand via qc.invalidateQueries.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const approvedStatuses = new Set(['approved', 'sending', 'sent', 'completed'])
  const data = followupQ.data
  // Derive everything from the query. The `followup` response carries
  // `batch_status` (server-confirmed) and `enabled` (server-confirmed),
  // so we no longer trust the upload-time snapshot. We fall back to
  // the prop only while the first GET is in flight, so the toggle
  // doesn't flash a wrong state on the very first render.
  const batchApproved = data ? approvedStatuses.has(data.batch_status) : approvedStatuses.has(batch.status)
  const enabled = data ? data.enabled : !!batch.ai_followup_enabled
  const recipientsTotal = data?.recipients_total ?? null
  const globalDisabled = agentQ.data ? agentQ.data.enabled === false : false

  // Bubble the latest server state up so the parent keeps its
  // header chip ("Validated X · approved") in sync.
  useEffect(() => {
    if (data && onBatchRefreshed) onBatchRefreshed(data)
    // onBatchRefreshed identity may change on every render; we
    // only want to fire when the snapshot itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  async function onChange(next: boolean) {
    if (saving || !batchApproved) return
    setSaving(true)
    try {
      // The PUT response IS the new truth. Don't optimistic-set a
      // local boolean — let the invalidation + refetch below
      // re-derive `enabled` from the server response, so a 422
      // (no_valid_recipients) correctly leaves the toggle in its
      // prior state instead of looking "on" with no rows.
      await putBatchAIFollowup(batch.id, next)
      await qc.invalidateQueries({ queryKey: batchAIKeys.followup(batch.id) })
      // Re-fetch immediately so the toggle flips without waiting
      // for the next polling tick of the activity panel.
      await qc.refetchQueries({ queryKey: batchAIKeys.followup(batch.id) })
      toast.success(next ? 'AI follow-up enabled for this batch' : 'AI follow-up disabled for this batch')
    } catch (e: any) {
      const status = e?.response?.status
      const code = e?.response?.data?.error
      if (status === 422 && code === 'no_valid_recipients') {
        toast.error(
          'AI follow-up was enabled, but this batch has no valid WhatsApp numbers to track. ' +
          'Re-upload a file with at least one valid number.',
          { duration: 7000 },
        )
      } else {
        toast.error(
          e?.response?.data?.message ||
          e?.response?.data?.error ||
          'Failed to update AI follow-up',
        )
      }
      // Refetch so the toggle snaps back to the server's view of
      // reality (the flag did flip to true but with 0 rows).
      qc.refetchQueries({ queryKey: batchAIKeys.followup(batch.id) })
    } finally {
      setSaving(false)
    }
  }

  const disabled = !batchApproved || saving

  return (
    <div className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border border-slate-200/80 dark:border-white/10
                    bg-white/70 dark:bg-white/5">
      <Bot className={`w-4 h-4 ${enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
      <div className="text-[12px] font-medium text-slate-700 dark:text-slate-200 select-none">
        AI follow-up
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle AI follow-up for this batch"
        title={batchApproved ? undefined : 'Approve the batch first'}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                    ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}
                    ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                      ${enabled ? 'translate-x-5' : 'translate-x-1'}`}
        />
      </button>
      {saving && <Spinner />}
      {!batchApproved && (
        <Link
          to={`/admin/messages/bulk/batches/${batch.id}`}
          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
          title="Approve the batch first — opens the batch detail page"
        >
          · approve first
        </Link>
      )}
      {enabled && recipientsTotal === 0 && (
        <span
          className="text-[11px] text-amber-700 dark:text-amber-300"
          title="AI follow-up is on but the server couldn't back-fill any recipients. This usually means the batch was uploaded before per-admin ownership was tracked, or the file has no valid WhatsApp numbers."
        >
          · 0 recipients
        </span>
      )}
      {globalDisabled && batchApproved && (
        <Link
          to="/admin/ai/agent"
          className="inline-flex items-center gap-1 text-[11px] font-medium
                     text-amber-700 dark:text-amber-300 hover:underline"
          title="The global AI agent is disabled. The per-batch toggle will be a no-op until you turn it on."
        >
          <ShieldAlert className="w-3 h-3" /> agent off
        </Link>
      )}
    </div>
  )
}

// AIAgentActivityPanel — the dedicated section under the preview grid
// that lists every recipient in this batch and the AI agent's current
// status for them. Polled every 10s while the panel is open.
function AIAgentActivityPanel({ batchId }: { batchId: number }) {
  const [open, setOpen] = useState(true)
  const q = useQuery({
    queryKey: batchAIKeys.followup(batchId),
    queryFn: () => getBatchAIFollowup(batchId),
    refetchInterval: open ? 10_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  })

  const data = q.data
  const recipients: BatchAIRecipient[] = data?.recipients ?? []
  const counts = data?.recipients_by_status ?? {}
  const total = data?.recipients_total ?? recipients.length
  const enabled = !!data?.enabled

  return (
    <Card hover={false}>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-500" />
            <span>AI agent activity — this batch</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
              ({total} recipient{total === 1 ? '' : 's'})
            </span>
          </div>
        }
        subtitle={enabled
          ? 'Agent will auto-reply to inbound messages from recipients in this batch.'
          : 'Turn on AI follow-up above to start tracking replies for these retailers.'}
        right={
          <div className="flex items-center gap-2">
            {enabled && (
              <StatusCounts counts={counts} />
            )}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-expanded={open}
            >
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {open ? 'Collapse' : 'Expand'}
            </button>
          </div>
        }
      />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-5 pt-0">
              {q.isLoading && (
                <div className="py-6"><Spinner /></div>
              )}
              {q.isError && (
                <ErrorBox msg={(q.error as any)?.response?.data?.error || 'Failed to load AI activity'} />
              )}
              {q.isSuccess && !enabled && (
                <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  <Bot className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                  AI follow-up is off for this batch. Toggle the switch in the action bar above to start tracking.
                </div>
              )}
              {q.isSuccess && enabled && recipients.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No recipients to track yet — this is normal for a freshly uploaded batch.
                </div>
              )}
              {q.isSuccess && enabled && recipients.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                      <tr>
                        <Th>Retailer</Th>
                        <Th>WhatsApp</Th>
                        <Th>Status</Th>
                        <Th>Last message</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((r, i) => (
                        <motion.tr
                          key={r.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02, duration: 0.2 }}
                          className="border-t border-slate-100 dark:border-white/10"
                        >
                          <Td>{r.retailer_name || '—'}</Td>
                          <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                          <Td><AIStatusBadge status={r.ai_status} /></Td>
                          <Td><LastMessageCell r={r} /></Td>
                          <Td>
                            <Link
                              to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`}
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline"
                            >
                              Open chat <ExternalLink className="w-3 h-3" />
                            </Link>
                          </Td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

// StatusCounts, humanizeStatus, AIStatusBadge, and LastMessageCell
// were lifted into components/AIFollowupParts.tsx so the per-batch
// panel here and the cross-batch queue at /admin/ai/followups render
// the exact same look. We re-export them under their old names at
// the bottom of this file for any future local call site.
const StatusCounts = AIFollowupStatusCounts
const AIStatusBadge = AIFollowupStatusBadge
const LastMessageCell = AIFollowupLastMessage
