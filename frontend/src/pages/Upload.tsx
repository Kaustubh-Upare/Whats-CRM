import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowRight, ArrowUpRight, Download, RefreshCw, Sparkles,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { containerStagger, itemFadeUp, CountUp } from '@/lib/motion'
import { fmtMoney } from '@/lib/format'
import PhonePreview from '@/components/PhonePreview'
import type { BillingRecord, UploadBatch } from '@/lib/types'

type UploadResp = {
  batch: UploadBatch
  summary: { total: number; valid: number; invalid: number; duplicates: number; optouts: number }
  preview: BillingRecord[]
  errors: BillingRecord[]
  file_path: string
}

export default function Upload() {
  const nav = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResp | null>(null)
  const [previewRow, setPreviewRow] = useState<number | null>(null)

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'] },
    multiple: false,
    onDrop: (files) => setFile(files[0] || null),
  })

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('file', file!)
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

  function reset() {
    setFile(null); setResult(null); setPreviewRow(null)
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
                className={`bg-white border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400'
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
                <div className="mt-4 text-slate-900 font-medium">
                  {isDragActive ? 'Drop the file here…' : 'Drag & drop, or click to browse'}
                </div>
                <div className="text-xs text-slate-500 mt-1.5">.xlsx or .csv · up to 25 MB</div>
                <AnimatePresence>
                  {file && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                      className="mt-5 inline-flex items-center gap-2 text-sm text-slate-700 bg-slate-100 px-3.5 py-2 rounded-lg"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span className="font-medium">{file.name}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              </motion.div>

              <div className="mt-5 flex gap-3 items-center flex-wrap">
                <PrimaryButton
                  onClick={() => upload.mutate()}
                  disabled={!file || upload.isPending}
                >
                  {upload.isPending ? (
                    <><Spinner /> Validating…</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Validate file</>
                  )}
                </PrimaryButton>
                <a href="/sample-billing-template.xlsx" download
                   className="px-4 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50 text-slate-700">
                  Download sample template
                </a>
                {file && (
                  <button onClick={reset} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
                    Clear
                  </button>
                )}
              </div>
              {upload.isError && <div className="mt-4"><ErrorBox msg={(upload.error as any)?.response?.data?.error || 'Upload failed'} /></div>}
            </div>

            <Card className="self-start">
              <CardHeader title="Required columns" subtitle="Case-insensitive" />
              <div className="p-5 text-sm text-slate-700 space-y-1.5">
                {['retailer_code', 'retailer_name', 'whatsapp_number', 'invoice_number', 'billing_amount', 'due_date'].map((c) => (
                  <motion.div
                    key={c}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 }}
                    className="flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">{c}</code>
                  </motion.div>
                ))}
                <div className="mt-3 text-xs text-slate-500">
                  Optional: <code>payment_link</code>, <code>language</code> (en/hi/mr).
                </div>
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
              className="flex items-center justify-between gap-3 flex-wrap bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 grid place-items-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    Batch #{result.batch.id} · {result.batch.file_name}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Validated {new Date(result.batch.created_at).toLocaleString()} ·{' '}
                    <span className="capitalize">{result.batch.status}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SecondaryButton onClick={reset}>
                  <RefreshCw className="w-4 h-4" /> Upload another
                </SecondaryButton>
                {result.batch.valid_rows > 0 && (
                  <PrimaryButton onClick={() => nav(`/batches/${result.batch.id}`)}>
                    Approve &amp; open <ArrowRight className="w-4 h-4" />
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
                <Card hover={false} className="!p-0 overflow-hidden bg-gradient-to-b from-slate-50 to-white">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-500" />
                      <div className="font-semibold text-sm">Recipient preview</div>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      What the retailer will see
                    </div>
                  </div>
                  <div className="p-6 flex justify-center bg-gradient-to-b from-slate-50 to-slate-100/40">
                    <PhonePreview
                      batchId={result.batch.id}
                      initialRow={previewRow}
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
                      <thead className="bg-slate-50 text-slate-600">
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
                              whileHover={{ backgroundColor: '#f8fafc' }}
                              className={`border-t border-slate-100 cursor-pointer transition-colors ${
                                active ? 'bg-brand-50/60' : ''
                              }`}
                            >
                              <Td><span className="text-slate-400 font-mono text-xs">{r.row_number}</span></Td>
                              <Td>{r.retailer_name}</Td>
                              <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                              <Td className="font-mono text-xs">{r.invoice_number}</Td>
                              <Td>{fmtMoney(r.billing_amount)}</Td>
                              <Td>{r.due_date}</Td>
                              <Td>
                                {active ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700">
                                    Previewing <ArrowUpRight className="w-3 h-3" />
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">Tap to preview</span>
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
                    <thead className="bg-slate-50 text-slate-600">
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
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.1 + j * 0.04 }}
                                  className="flex items-start gap-1.5 text-rose-700"
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
  const colors = { green: 'text-emerald-700', red: 'text-rose-700', amber: 'text-amber-700' } as const
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${tone ? colors[tone] : 'text-slate-800'}`}>
        <CountUp value={value} format={(v) => Math.round(v).toLocaleString()} />
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
