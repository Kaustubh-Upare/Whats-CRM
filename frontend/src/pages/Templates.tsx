import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Plus, FileText, Trash2, Save, Sparkles, Power, Pencil, Eye,
  AlertTriangle, CheckCircle2, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import PhonePreview from '@/components/PhonePreview'
import type { Template } from '@/lib/types'

type PreviewResp = {
  body: string
  variable_count: number
  sample_params: Record<string, any>
  unresolved_tokens: string[]
}

const LANG_OPTIONS = ['en', 'hi', 'mr']
const CATEGORY_OPTIONS = ['utility', 'marketing', 'authentication']

const DEFAULT_FORM = {
  name: 'billing_summary_v1',
  language_code: 'en',
  category: 'utility',
  body:
    'Hello {{1}},\n\nYour billing summary for {{2}}.\n\n' +
    'Invoice: {{3}}\nAmount: INR {{4}}\nDue Date: {{5}}\n\n' +
    'For billing queries contact {{6}}.',
  sample_payload:
    '{\n  "1": "Sharma Kirana Store",\n  "2": "2026-06-19",\n  "3": "INV-2026-001",\n  "4": "12500.50",\n  "5": "2026-06-26",\n  "6": "support@itc.example"\n}',
  is_active: true,
}

export default function Templates() {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [form, setForm] = useState({ ...DEFAULT_FORM })

  const list = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data as Template[],
  })

  // Live preview (debounced) — uses POST /templates/preview so the user
  // doesn't have to save before seeing what their template renders to.
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  useEffect(() => {
    if (!form.body.trim()) {
      setPreview(null)
      setPreviewErr(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        let sample: any = undefined
        if (form.sample_payload.trim()) {
          try {
            sample = JSON.parse(form.sample_payload)
          } catch (e: any) {
            if (!cancelled) {
              setPreviewErr('Sample payload is not valid JSON')
              setPreview(null)
            }
            return
          }
        }
        const { data } = await api.post('/api/templates/preview', {
          body: form.body,
          sample_payload: sample,
        })
        if (!cancelled) {
          setPreview(data)
          setPreviewErr(null)
        }
      } catch (e: any) {
        if (!cancelled) {
          setPreviewErr(e?.response?.data?.error || e?.message || 'preview failed')
          setPreview(null)
        }
      }
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [form.body, form.sample_payload])

  const activeTemplate = useMemo(
    () => (list.data || []).find((t) => t.is_active) || null,
    [list.data],
  )

  function startCreate() {
    setEditingId(null)
    setCreatingNew(true)
    setForm({ ...DEFAULT_FORM })
  }
  function startEdit(t: Template) {
    setEditingId(t.id)
    setCreatingNew(false)
    setForm({
      name: t.name,
      language_code: t.language_code,
      category: t.category,
      body: t.body,
      sample_payload:
        t.sample_payload && Object.keys(t.sample_payload || {}).length
          ? JSON.stringify(t.sample_payload, null, 2)
          : sampleForBody(t.variable_count),
      is_active: t.is_active,
    })
  }
  function cancelEdit() {
    setEditingId(null)
    setCreatingNew(false)
    setForm({ ...DEFAULT_FORM })
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        language_code: form.language_code,
        category: form.category,
        body: form.body,
        sample_payload: parseSample(form.sample_payload),
        is_active: form.is_active,
      }
      if (editingId) {
        const { data } = await api.put(`/api/templates/${editingId}`, body)
        return { kind: 'update' as const, data }
      }
      const { data } = await api.post('/api/templates', {
        name: body.name,
        language_code: body.language_code,
        category: body.category,
        body: body.body,
        sample_payload: body.sample_payload,
      })
      return { kind: 'create' as const, data }
    },
    onSuccess: (r) => {
      toast.success(r.kind === 'create' ? 'Template created' : 'Template saved')
      qc.invalidateQueries({ queryKey: ['templates'] })
      if (r.kind === 'create' && r.data?.id) {
        setEditingId(r.data.id)
        setCreatingNew(false)
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Save failed'),
  })

  const toggleActive = useMutation({
    mutationFn: async (t: Template) => {
      const { data } = await api.patch(`/api/templates/${t.id}/active`, { is_active: !t.is_active })
      return data as { id: number; is_active: boolean }
    },
    onSuccess: (d) => {
      toast.success(d.is_active ? 'Template activated' : 'Template deactivated')
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Toggle failed'),
  })

  const del = useMutation({
    mutationFn: async (t: Template) => {
      await api.delete(`/api/templates/${t.id}`)
      return t
    },
    onSuccess: (t) => {
      toast.success(`Deleted ${t.name}`)
      qc.invalidateQueries({ queryKey: ['templates'] })
      if (editingId === t.id) cancelEdit()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Delete failed'),
  })

  const selected = useMemo(() => {
    if (!editingId) return null
    return (list.data || []).find((t) => t.id === editingId) || null
  }, [editingId, list.data])

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Define the WhatsApp message bodies sent to retailers. Activate one to make it the default for new batches."
        right={
          <PrimaryButton onClick={startCreate}>
            <Plus className="w-4 h-4" /> New template
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT — template list */}
        <div className="lg:col-span-4 space-y-3">
          {list.isLoading && <Spinner />}
          {list.isError && <ErrorBox msg={(list.error as any)?.message || 'Failed to load'} />}
          {list.data && list.data.length === 0 && (
            <Card hover={false}>
              <Empty>
                No templates yet. Create one to start sending billing messages.
              </Empty>
            </Card>
          )}
          {list.data && list.data.length > 0 && (
            <motion.div variants={containerStagger} initial="hidden" animate="show" className="space-y-3">
              {activeTemplate && (
                <motion.div variants={itemFadeUp}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-1">
                    Currently active
                  </div>
                  <div className="mt-1.5">
                    <TemplateRow
                      t={activeTemplate}
                      active
                      selected={selected?.id === activeTemplate.id}
                      onSelect={() => startEdit(activeTemplate)}
                    />
                  </div>
                </motion.div>
              )}
              {list.data.filter((t) => t.id !== activeTemplate?.id).length > 0 && (
                <motion.div variants={itemFadeUp}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-1 mt-3">
                    Inactive
                  </div>
                  <div className="mt-1.5 space-y-2">
                    {list.data
                      .filter((t) => t.id !== activeTemplate?.id)
                      .map((t) => (
                        <TemplateRow
                          key={t.id}
                          t={t}
                          selected={selected?.id === t.id}
                          onSelect={() => startEdit(t)}
                        />
                      ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </div>

        {/* RIGHT — editor / preview */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!creatingNew && !editingId ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
              >
                <Card hover={false} className="p-10 text-center">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-50 grid place-items-center">
                    <FileText className="w-6 h-6 text-brand-600" />
                  </div>
                  <div className="mt-4 text-base font-semibold text-slate-900">
                    Pick a template to edit
                  </div>
                  <div className="mt-1.5 text-sm text-slate-500">
                    Or create a new one to send a different message body to your retailers.
                  </div>
                  <div className="mt-5">
                    <PrimaryButton onClick={startCreate}>
                      <Plus className="w-4 h-4" /> Create your first template
                    </PrimaryButton>
                  </div>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key={creatingNew ? 'new' : `edit-${editingId}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                <Card hover={false}>
                  <CardHeader
                    title={
                      <div className="flex items-center gap-2">
                        {creatingNew ? <Sparkles className="w-4 h-4 text-brand-500" /> : <Pencil className="w-4 h-4 text-slate-400" />}
                        {creatingNew ? 'New template' : `Edit · ${form.name}`}
                      </div>
                    }
                    subtitle={
                      creatingNew
                        ? 'The body uses {{1}}…{{N}} placeholders. Save it before approving batches.'
                        : 'Saving re-derives the variable count from your body.'
                    }
                    right={
                      <div className="flex items-center gap-2">
                        {!creatingNew && selected && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete template "${selected.name}" (${selected.language_code})?`)) del.mutate(selected)
                            }}
                            disabled={del.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-rose-700 hover:bg-rose-50 text-sm disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        )}
                        <SecondaryButton onClick={cancelEdit}>
                          <RotateCcw className="w-4 h-4" /> Cancel
                        </SecondaryButton>
                        <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending}>
                          <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : creatingNew ? 'Create template' : 'Save changes'}
                        </PrimaryButton>
                      </div>
                    }
                  />

                  <motion.div
                    variants={containerStagger}
                    initial="hidden"
                    animate="show"
                    className="p-5 grid grid-cols-1 md:grid-cols-6 gap-3"
                  >
                    <motion.div variants={itemFadeUp} className="md:col-span-3">
                      <Field label="Template name">
                        <input
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="billing_summary_v1"
                          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
                        />
                        <Hint>The unique key used by ApproveBatch — keep stable once you go live.</Hint>
                      </Field>
                    </motion.div>
                    <motion.div variants={itemFadeUp} className="md:col-span-1">
                      <Field label="Language">
                        <select
                          value={form.language_code}
                          onChange={(e) => setForm({ ...form, language_code: e.target.value })}
                          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                        >
                          {LANG_OPTIONS.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </Field>
                    </motion.div>
                    <motion.div variants={itemFadeUp} className="md:col-span-2">
                      <Field label="Category">
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                        >
                          {CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                    </motion.div>

                    <motion.div variants={itemFadeUp} className="md:col-span-6">
                      <Field
                        label={
                          <div className="flex items-center justify-between">
                            <span>Message body</span>
                            <span className="text-[11px] text-slate-500 normal-case font-normal">
                              {preview?.variable_count ?? countVarsClient(form.body)} variable
                              {(preview?.variable_count ?? countVarsClient(form.body)) === 1 ? '' : 's'} detected
                            </span>
                          </div>
                        }
                      >
                        <textarea
                          value={form.body}
                          onChange={(e) => setForm({ ...form, body: e.target.value })}
                          rows={8}
                          spellCheck={false}
                          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono leading-relaxed"
                        />
                        <Hint>
                          Use <code className="bg-slate-100 px-1 rounded">{'{{1}}'}</code>..<code className="bg-slate-100 px-1 rounded">{'{{N}}'}</code> for
                          positional values, or <code className="bg-slate-100 px-1 rounded">{'{{key}}'}</code> for
                          name-based values from sample_payload.
                        </Hint>
                      </Field>
                    </motion.div>

                    <motion.div variants={itemFadeUp} className="md:col-span-6">
                      <Field
                        label={
                          <div className="flex items-center justify-between">
                            <span>Sample payload (JSON)</span>
                            <button
                              onClick={() => setForm({ ...form, sample_payload: sampleForBody(countVarsClient(form.body)) })}
                              className="text-[11px] text-brand-700 hover:underline"
                            >
                              Auto-generate
                            </button>
                          </div>
                        }
                      >
                        <textarea
                          value={form.sample_payload}
                          onChange={(e) => setForm({ ...form, sample_payload: e.target.value })}
                          rows={6}
                          spellCheck={false}
                          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono leading-relaxed"
                        />
                        <Hint>
                          Used to render the live preview below. Not required — the worker
                          re-derives values from each billing record at send time.
                        </Hint>
                      </Field>
                    </motion.div>

                    <motion.div variants={itemFadeUp} className="md:col-span-6">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.is_active}
                          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>
                          <span className="font-medium">Active</span>
                          <span className="text-slate-500 ml-1.5">
                            — only active templates are used by ApproveBatch.
                          </span>
                        </span>
                      </label>
                    </motion.div>
                  </motion.div>

                  {save.isError && (
                    <div className="px-5 pb-5">
                      <ErrorBox msg={(save.error as any)?.response?.data?.error || 'Save failed'} />
                    </div>
                  )}
                </Card>

                {/* LIVE PREVIEW */}
                <Card hover={false} className="!p-0 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-brand-500" />
                      <div className="font-semibold text-sm">Live preview</div>
                      <span className="text-[11px] text-slate-500">
                        rendered with the sample payload above
                      </span>
                    </div>
                    {preview?.unresolved_tokens && preview.unresolved_tokens.length > 0 && (
                      <div className="flex items-center gap-1.5 text-amber-700 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {preview.unresolved_tokens.length} unresolved placeholder
                        {preview.unresolved_tokens.length === 1 ? '' : 's'}
                      </div>
                    )}
                    {preview && preview.unresolved_tokens.length === 0 && (
                      <div className="flex items-center gap-1.5 text-emerald-700 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        all placeholders resolved
                      </div>
                    )}
                  </div>

                  <div className="p-8 bg-gradient-to-br from-slate-50 via-white to-slate-100/60">
                    <div className="flex justify-center">
                      <PhonePreviewStandalone
                        body={preview?.body || form.body}
                        recipientName={pickStringValue(form.sample_payload, ['1', 'retailer_name', 'name']) || 'Preview'}
                        larger
                      />
                    </div>
                    {preview?.unresolved_tokens && preview.unresolved_tokens.length > 0 && (
                      <div className="mt-6 max-w-[360px] mx-auto">
                        <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold">
                          Unresolved placeholders
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 justify-center">
                          {preview.unresolved_tokens.map((tok) => (
                            <span
                              key={tok}
                              className="text-[11px] font-mono bg-amber-50 text-amber-800 border border-amber-200 rounded px-1.5 py-0.5"
                            >
                              {tok}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {previewErr && (
                      <div className="mt-4 max-w-[420px] mx-auto">
                        <ErrorBox msg={previewErr} />
                      </div>
                    )}
                  </div>
                </Card>

                {/* Activate / Deactivate (only when editing an existing template) */}
                {!creatingNew && selected && (
                  <Card hover={false}>
                    <CardHeader
                      title="Activation"
                      subtitle={
                        selected.is_active
                          ? 'This template is currently active. New batches will use it.'
                          : 'This template is inactive. Activate it to use it for new batches.'
                      }
                      right={
                        <button
                          onClick={() => toggleActive.mutate(selected)}
                          disabled={toggleActive.isPending}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 ${
                            selected.is_active
                              ? 'border border-slate-300 hover:bg-slate-50 text-slate-700'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          <Power className="w-4 h-4" />
                          {selected.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      }
                    />
                    {activeTemplate && activeTemplate.id !== selected.id && (
                      <div className="p-5 text-sm text-slate-600">
                        <span className="font-medium text-slate-800">{activeTemplate.name}</span>{' '}
                        <span className="text-slate-400">·</span> {activeTemplate.language_code} is currently active.
                        Activating <span className="font-mono">{selected.name}</span> will replace it.
                      </div>
                    )}
                  </Card>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

/* ---------- atoms ---------- */

function TemplateRow({
  t,
  active = false,
  selected = false,
  onSelect,
}: {
  t: Template
  active?: boolean
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      className={`w-full text-left bg-white border rounded-xl p-3.5 transition-shadow ${
        selected
          ? 'border-brand-400 ring-2 ring-brand-100 shadow-sm'
          : active
            ? 'border-emerald-300 shadow-sm'
            : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="font-mono text-sm truncate text-slate-800">{t.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {active && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              ACTIVE
            </span>
          )}
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {t.language_code}
          </span>
        </div>
      </div>
      <div className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
        <span>{t.variable_count} var{t.variable_count === 1 ? '' : 's'}</span>
        <span className="text-slate-300">·</span>
        <span className="capitalize">{t.category}</span>
        <span className="text-slate-300">·</span>
        <span>{fmtDate(t.created_at)}</span>
      </div>
      <div className="mt-2 text-[12px] text-slate-600 line-clamp-2 font-mono">
        {t.body.split('\n')[0]}
      </div>
    </motion.button>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 text-[11px] text-slate-500">{children}</div>
}

/**
 * Small standalone phone preview — used on the /templates page where we don't
 * have a batch row to render. Mirrors PhonePreview's bubble styling but
 * takes raw body + recipient name instead of fetching from a batch.
 *
 * Two sizes:
 *   - default: 280×580 phone, fits two-up in the preview grid
 *   - larger:  340×700 phone, fills the right column at desktop widths
 */
function PhonePreviewStandalone({
  body,
  recipientName,
  larger = false,
}: {
  body: string
  recipientName: string
  larger?: boolean
}) {
  const w = larger ? 340 : 280
  const h = larger ? 700 : 580
  const radius = larger ? 44 : 36
  const innerRadius = larger ? 36 : 28
  const pad = larger ? 3 : 2
  const statusFont = larger ? 'text-[11px]' : 'text-[10px]'
  const nameFont = larger ? 'text-[14px]' : 'text-[12px]'
  const subFont = larger ? 'text-[11px]' : 'text-[10px]'
  const bodyFont = larger ? 'text-[13.5px]' : 'text-[12px]'
  const timeFont = larger ? 'text-[10px]' : 'text-[9px]'
  const headerPx = larger ? 'px-4 py-2.5' : 'px-3 py-2'
  const bubblePx = larger ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const composerPx = larger ? 'px-3 py-2.5' : 'px-2 py-2'
  const composerFont = larger ? 'text-[12px] py-2' : 'text-[11px] py-1.5'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="relative bg-slate-950 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
      style={{ width: w, height: h, borderRadius: radius, padding: pad }}
    >
      <div
        className="relative w-full h-full bg-white overflow-hidden flex flex-col"
        style={{ borderRadius: innerRadius }}
      >
        {/* Status bar */}
        <div className={`flex items-center justify-between px-5 pt-2.5 pb-1 font-semibold text-slate-800 ${statusFont}`}>
          <span>9:41</span>
          <div className="flex items-center gap-1 text-slate-700">
            <span>•••</span>
            <span>◐</span>
            <span>▮</span>
          </div>
        </div>
        {/* Notch */}
        <div className="relative h-5 flex items-center justify-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-slate-900 rounded-b-2xl"
               style={{ width: larger ? 130 : 96, height: 18 }} />
        </div>
        {/* App header */}
        <div className={`bg-[#075E54] text-white flex items-center gap-2 -mt-1 ${headerPx}`}>
          <span className={`opacity-90 ${subFont}`}>‹</span>
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${nameFont}`}>{recipientName}</div>
            <div className={`opacity-80 ${subFont}`}>online</div>
          </div>
          <span className={`opacity-90 ${subFont}`}>📹</span>
          <span className={`opacity-90 ${subFont}`}>📞</span>
          <span className={`opacity-90 ${subFont}`}>⋮</span>
        </div>
        {/* Chat background + bubble */}
        <div
          className="flex-1 overflow-hidden px-3 py-4"
          style={{
            backgroundColor: '#E5DDD5',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 0h40v40H0z' fill='none'/><path d='M8 6c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM8 32c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM20 14c1.5 0 1.5 2 0 2s-1.5-2 0-2zm0 14c1.5 0 1.5 2 0 2s-1.5-2 0-2z' fill='%23c9c2b6' opacity='0.4'/></svg>\")",
            backgroundSize: '40px 40px',
          }}
        >
          <motion.div
            key={body}
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22 }}
            className="flex justify-end"
          >
            <div className="relative max-w-[88%]">
              <div
                className={`relative bg-[#DCF8C6] text-slate-900 rounded-lg shadow-sm whitespace-pre-wrap break-words ${bubblePx} ${bodyFont}`}
                style={{ lineHeight: 1.4 }}
              >
                <svg
                  className="absolute -right-1 -top-1 w-2 h-2 text-[#DCF8C6]"
                  viewBox="0 0 8 8"
                  fill="currentColor"
                >
                  <path d="M0 0 L8 0 L0 8 Z" />
                </svg>
                {body}
                <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                  <span className={`text-slate-500 tabular-nums ${timeFont}`}>9:41</span>
                  <svg viewBox="0 0 18 18" className={`text-sky-500 ${larger ? 'w-3.5 h-3.5' : 'w-3 h-3'}`} fill="currentColor">
                    <path d="M17.4 4.2L7.6 14L4.2 10.6L5.2 9.6L7.6 12L16.4 3.2Z" />
                    <path d="M12.4 4.2L2.6 14L1.6 13L11.4 3.2Z" />
                  </svg>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
        {/* Composer */}
        <div className={`bg-[#F0F0F0] flex items-center gap-1.5 ${composerPx}`}>
          <div className="flex-1 bg-white rounded-full px-3 text-slate-400 flex items-center" style={{ height: larger ? 36 : 30 }}>
            <span className={composerFont}>Type a message</span>
          </div>
          <div
            className="rounded-full bg-[#075E54] grid place-items-center"
            style={{ width: larger ? 36 : 28, height: larger ? 36 : 28 }}
          >
            <svg viewBox="0 0 24 24" className="text-white" style={{ width: larger ? 16 : 13, height: larger ? 16 : 13 }} fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </div>
        </div>
      </div>
      {/* Side buttons */}
      <span className="absolute -left-[2px] bg-slate-800 rounded-l-sm" style={{ top: 110, width: 3, height: 32 }} />
      <span className="absolute -left-[2px] bg-slate-800 rounded-l-sm" style={{ top: 160, width: 3, height: larger ? 56 : 48 }} />
      <span className="absolute -right-[2px] bg-slate-800 rounded-r-sm" style={{ top: 160, width: 3, height: larger ? 76 : 64 }} />
    </motion.div>
  )
}

/* ---------- helpers ---------- */

function parseSample(s: string): any {
  const trimmed = s.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function countVarsClient(body: string): number {
  let max = 0
  for (let i = 1; i <= 20; i++) {
    if (!body.includes(`{{${i}}}`)) break
    max = i
  }
  return max
}

function sampleForBody(n: number): string {
  if (n <= 0) return '{\n  \n}'
  const entries: string[] = []
  for (let i = 1; i <= n; i++) entries.push(`  "${i}": "value-${i}"`)
  return '{\n' + entries.join(',\n') + '\n}'
}

function pickStringValue(sample: string, keys: string[]): string | null {
  try {
    const obj = JSON.parse(sample)
    for (const k of keys) {
      if (obj && obj[k] != null) return String(obj[k])
    }
  } catch {}
  return null
}
