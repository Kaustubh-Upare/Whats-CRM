import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Plus, FileText, Trash2, Save, Sparkles, Power, Pencil, Eye,
  AlertTriangle, CheckCircle2, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import { PhonePreviewCard } from '@/components/PhonePreview'
import type { Template } from '@/lib/types'

type PreviewResp = {
  body: string
  variable_count: number
  sample_params: Record<string, any>
  unresolved_tokens: string[]
}

const LANG_OPTIONS = ['en', 'hi', 'mr']
const CATEGORY_OPTIONS = ['utility', 'marketing', 'authentication']

// Starter body — a reasonable billing-summary template the user can edit
// inline. Name is left BLANK so each new template is named by the user,
// not pre-filled with a global default that another user might already
// own. Per-admin uniqueness on (name, language_code) means two users
// can independently create their own copies.
const STARTER_BODY =
  'Hello {{1}},\n\nYour billing summary for {{2}}.\n\n' +
  'Invoice: {{3}}\nAmount: INR {{4}}\nDue Date: {{5}}\n\n' +
  'For billing queries contact {{6}}.'

const STARTER_SAMPLE =
  '{\n  "1": "Sharma Kirana Store",\n  "2": "2026-06-19",\n  "3": "INV-2026-001",\n  "4": "12500.50",\n  "5": "2026-06-26",\n  "6": "support@itc.example"\n}'

function makeDefaultForm(): {
  name: string
  language_code: string
  category: string
  body: string
  sample_payload: string
  is_active: boolean
} {
  return {
    // Empty so the operator types their own name. We DO NOT pre-fill
    // 'billing_summary_v1' — another admin in this same workspace might
    // already own that name, and per-admin uniqueness (migration 007)
    // would 409 the save. Let the user decide what to call theirs.
    name: '',
    language_code: 'en',
    category: 'utility',
    body: STARTER_BODY,
    sample_payload: STARTER_SAMPLE,
    is_active: true,
  }
}

export default function Templates() {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [form, setForm] = useState(makeDefaultForm())

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
    setForm(makeDefaultForm())
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
    setForm(makeDefaultForm())
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
              <div className="p-10 text-center">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="mx-auto w-14 h-14 rounded-2xl
                             bg-emerald-50 dark:bg-emerald-500/15
                             grid place-items-center mb-4
                             border border-emerald-200 dark:border-emerald-400/30"
                >
                  <FileText className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                </motion.div>
                <div className="text-base font-semibold text-slate-900 dark:text-white">
                  No templates in your workspace yet
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                  Templates are scoped to your workspace — anything you create here is private to you
                  and won't be visible to other admins.
                </div>
                <div className="mt-5">
                  <PrimaryButton onClick={startCreate}>
                    <Plus className="w-4 h-4" /> Create your first template
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          )}
          {list.data && list.data.length > 0 && (
            <motion.div variants={containerStagger} initial="hidden" animate="show" className="space-y-3">
              {activeTemplate && (
                <motion.div variants={itemFadeUp}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
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
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 grid place-items-center">
                    <FileText className="w-6 h-6 text-emerald-600 dark:text-emerald-300" />
                  </div>
                  <div className="mt-4 text-base font-semibold text-slate-900 dark:text-white">
                    Pick a template to edit
                  </div>
                  <div className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
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
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/15 text-sm disabled:opacity-50"
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
                          placeholder="e.g. acme_billing_v1, monthly_summary, festival_offer"
                          className="w-full border border-slate-300 dark:border-[var(--input-border)]
                                     bg-white dark:bg-[var(--input-bg)]
                                     text-slate-900 dark:text-slate-100
                                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                                     rounded-md px-3 py-2 text-sm font-mono
                                     focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:focus:ring-emerald-500/60"
                        />
                        <Hint>
                          A unique name within your workspace. Lowercase + underscores recommended.
                          Other admins can use the same name — each user has their own namespace.
                        </Hint>
                      </Field>
                    </motion.div>
                    <motion.div variants={itemFadeUp} className="md:col-span-1">
                      <Field label="Language">
                        <select
                          value={form.language_code}
                          onChange={(e) => setForm({ ...form, language_code: e.target.value })}
                          className="w-full border border-slate-300 dark:border-[var(--input-border)]
                                     bg-white dark:bg-[var(--input-bg)]
                                     text-slate-900 dark:text-slate-100
                                     rounded-md px-3 py-2 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:focus:ring-emerald-500/60"
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
                          className="w-full border border-slate-300 dark:border-[var(--input-border)]
                                     bg-white dark:bg-[var(--input-bg)]
                                     text-slate-900 dark:text-slate-100
                                     rounded-md px-3 py-2 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:focus:ring-emerald-500/60"
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
                          className="w-full border border-slate-300 dark:border-[var(--input-border)]
                                     bg-white dark:bg-[var(--input-bg)]
                                     text-slate-900 dark:text-slate-100
                                     rounded-md px-3 py-2 text-sm font-mono leading-relaxed
                                     focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:focus:ring-emerald-500/60"
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
                          className="w-full border border-slate-300 dark:border-[var(--input-border)]
                                     bg-white dark:bg-[var(--input-bg)]
                                     text-slate-900 dark:text-slate-100
                                     rounded-md px-3 py-2 text-sm font-mono leading-relaxed
                                     focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:focus:ring-emerald-500/60"
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
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-emerald-500" />
                      <div className="font-semibold text-sm text-slate-900 dark:text-white">Live preview</div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
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
                      <PhonePreviewCard
                        body={preview?.body || form.body}
                        recipientName={pickStringValue(form.sample_payload, ['1', 'retailer_name', 'name']) || 'Preview'}
                        size="larger"
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
                              ? 'border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          <Power className="w-4 h-4" />
                          {selected.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      }
                    />
                    {activeTemplate && activeTemplate.id !== selected.id && (
                      <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
                        <span className="font-medium text-slate-800 dark:text-white">{activeTemplate.name}</span>{' '}
                        <span className="text-slate-400 dark:text-slate-500">·</span> {activeTemplate.language_code} is currently active.
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
      className={`w-full text-left admin-card border rounded-xl p-3.5 transition-shadow ${
        selected
          ? '!border-emerald-400 ring-2 ring-emerald-100 dark:ring-emerald-400/30 shadow-sm'
          : active
            ? '!border-emerald-300 dark:!border-emerald-400/50 shadow-sm'
            : '!border-slate-200 dark:!border-white/10 hover:!border-slate-300 dark:hover:!border-white/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <span className="font-mono text-sm truncate text-slate-800 dark:text-slate-100">{t.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {active && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-400/30">
              ACTIVE
            </span>
          )}
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
            {t.language_code}
          </span>
        </div>
      </div>
      <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        <span>{t.variable_count} var{t.variable_count === 1 ? '' : 's'}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="capitalize">{t.category}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>{fmtDate(t.created_at)}</span>
      </div>
      <div className="mt-2 text-[12px] text-slate-600 dark:text-slate-300 line-clamp-2 font-mono">
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
