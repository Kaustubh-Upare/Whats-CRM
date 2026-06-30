import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Pencil, Globe, Search, X, FileText, MessageSquare, ListChecks,
  ChevronRight, ChevronDown, Copy, Check, BookOpen, Sparkles, Link2,
  Wand2, Headphones, Receipt, Package, ShieldCheck,
  RefreshCw, RotateCcw, Truck, Clock, Phone as PhoneIcon, MapPin,
  CreditCard, CalendarClock, BadgeCheck, AlertCircle,
  Tag, Boxes, HelpCircle, Lock, ScrollText, MessageSquareWarning,
  UserCheck, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, Input, KpiCard, PageHeader, PrimaryButton,
  SecondaryButton, Spinner, TextArea,
} from '@/components/ui'
import { PillPop, containerStagger, itemFadeUp } from '@/lib/motion'
import { fmtRelative } from '@/lib/format'
import {
  addKB, aiKeys, deleteKB, editKB, getKBImportJob, ingestKBURL, listKB, searchKB, startKBImport,
  type KBImportJob,
} from '@/lib/ai'
import { AISetupGuideButton } from '@/components/AISetupGuide'
import { KB_PRESETS, KB_PRESET_CATEGORIES, type KBPreset, type KBPresetCategoryId } from '@/lib/kbPresets'
import type { KBChunk, RetrievedChunk, SearchKBResult } from '@/lib/types'

/**
 * Icon registry — KBPreset stores icons by string name so the data file
 * stays free of React component imports. We resolve the component here
 * once and the QuickAddPanel renders it directly.
 */
const PRESET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles, Headphones, Receipt, Package, ShieldCheck, Plus,
  RefreshCw, RotateCcw, Truck, Clock, PhoneIcon, MapPin,
  CreditCard, CalendarClock, BadgeCheck, AlertCircle,
  Tag, Boxes, HelpCircle, Lock, ScrollText, MessageSquareWarning,
  UserCheck, XCircle,
}

/**
 * /admin/ai/knowledge — KB manager.
 *
 * Layout (top to bottom):
 *   1. PageHeader
 *   2. Hero banner — what this is, primary CTAs (Add / Ingest URL)
 *   3. KPI strip — Total / Manual / URLs / Q&A counts with CountUp
 *   4. Two-pane grid:
 *        - Left (360px): toolbar + chunk list with selected-row indicator
 *        - Right (1fr): chunk detail (full content + actions) or "select one" empty state
 *   5. Test retrieval — collapsible card with the live search playground
 */
export default function Knowledge() {
  const qc = useQueryClient()
  const [sourceType, setSourceType] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState<KBChunk | null>(null)
  const [showAddChooser, setShowAddChooser] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showURL, setShowURL] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  // Result from the latest "Generate from text" call. Lives on the
  // parent so the modal can show the list of created chunk titles
  // before the user closes it. Cleared on open.
  const [generateResult, setGenerateResult] = useState<
    { count: number; titles: string[]; warnings?: string[] } | null
  >(null)
  const [generateJobId, setGenerateJobId] = useState<number | null>(null)
  // When the QuickAddPanel opens the Add modal, it sets `activePreset`
  // so the modal pre-fills title + content from the preset scaffold.
  const [activePreset, setActivePreset] = useState<KBPreset | null>(null)
  // Active category filter for the QuickAddPanel ('all' = no filter).
  const [quickAddCategory, setQuickAddCategory] = useState<KBPresetCategoryId | 'all'>('all')

  function openGenerateDialog() {
    if (!generateJobId) {
      setGenerateResult(null)
      setGenerateAsyncError(null)
    }
    setShowGenerate(true)
  }

  const list = useQuery({
    queryKey: aiKeys.kb({ source_type: sourceType, search }),
    queryFn: () => listKB({ source_type: sourceType || undefined, search: search || undefined, limit: 100 }),
  })

  const del = useMutation({
    mutationFn: (id: number) => deleteKB(id),
    onSuccess: (_, id) => {
      toast.success('Chunk deleted')
      if (selectedId === id) setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['ai', 'kb'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Delete failed'),
  })

  const [generateAsyncError, setGenerateAsyncError] = useState<string | null>(null)

  // Long-document import. The backend immediately returns a job, then
  // processes source-preserving chunks in the background while the modal
  // polls for progress.
  const generate = useMutation({
    mutationFn: (payload: { text: string; max_chunks?: number; source_name?: string }) =>
      startKBImport(payload),
    onSuccess: (job) => {
      setGenerateAsyncError(null)
      setGenerateJobId(job.id)
      toast.success('Knowledge import started')
    },
    onError: (e: any) =>
      setGenerateAsyncError(e?.response?.data?.error || e?.message || 'Generate failed'),
  })

  const importJob = useQuery({
    queryKey: aiKeys.kbImport(generateJobId),
    queryFn: () => getKBImportJob(generateJobId!),
    enabled: generateJobId != null,
    refetchInterval: (query) => {
      const job = query.state.data as any
      if (job?.status === 'completed' || job?.status === 'failed') return false
      return 1500
    },
  })

  useEffect(() => {
    const job = importJob.data
    if (!job || generateJobId !== job.id) return
    if (job.status === 'completed') {
      setGenerateResult({ count: job.created_count, titles: job.titles, warnings: job.warnings })
      setGenerateJobId(null)
      toast.success(`Created ${job.created_count} chunk${job.created_count === 1 ? '' : 's'} from your document`)
      qc.invalidateQueries({ queryKey: ['ai', 'kb'] })
      if (job.created_ids[0]) setSelectedId(job.created_ids[0])
    }
    if (job.status === 'failed') {
      setGenerateAsyncError(job.error || 'Knowledge import failed')
      setGenerateJobId(null)
    }
  }, [importJob.data, generateJobId, qc])

  const items = list.data?.items || []
  const total = list.data?.total || 0

  // Auto-select the first chunk when the list loads or filters change,
  // but only if nothing is currently selected. Makes the right pane
  // immediately useful — no dead "select a chunk" screen on first load.
  useEffect(() => {
    if (selectedId != null) return
    if (items.length > 0) setSelectedId(items[0].id)
  }, [items, selectedId])

  const selectedChunk = useMemo(
    () => items.find((c) => c.id === selectedId) || null,
    [items, selectedId],
  )

  // Derive global counts from the unfiltered list for the KPI strip.
  // We fetch an extra query with no filters to power the counts even
  // when the user has a source-type chip active.
  const globalList = useQuery({
    queryKey: aiKeys.kb({ source_type: '', search: '' }),
    queryFn: () => listKB({ limit: 1000 }),
  })
  const allItems = globalList.data?.items || []

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="Content the AI grounds its answers in. Hybrid retrieval = vector + keyword."
        right={<AISetupGuideButton guide="knowledge" />}
      />

      <HeroBanner
        totalChunks={total}
        onAdd={() => setShowAddChooser(true)}
      />

      <KPIStrip chunks={allItems} />

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        <ChunkListPane
          chunks={items}
          total={total}
          loading={list.isLoading}
          error={list.isError ? (list.error as any)?.message || 'Failed to load' : null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          search={search}
          setSearch={setSearch}
          sourceType={sourceType}
          setSourceType={setSourceType}
          onAdd={() => setShowAddChooser(true)}
        />

        <ChunkDetailPane
          chunk={selectedChunk}
          onEdit={(c) => setEditing(c)}
          onDelete={(c) => {
            if (window.confirm(`Delete chunk "${c.title || c.id}"?`)) del.mutate(c.id)
          }}
        />
      </div>

      <div className="mt-6">
        <TestRetrievalCard />
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showAddChooser && (
          <AddKnowledgeDialog
            category={quickAddCategory}
            setCategory={setQuickAddCategory}
            onClose={() => setShowAddChooser(false)}
            onBlank={() => {
              setActivePreset(null)
              setShowAddChooser(false)
              setShowAdd(true)
            }}
            onTemplate={(preset) => {
              setActivePreset(preset)
              setShowAddChooser(false)
              setShowAdd(true)
            }}
            onURL={() => {
              setShowAddChooser(false)
              setShowURL(true)
            }}
            onGenerate={() => {
              setShowAddChooser(false)
              openGenerateDialog()
            }}
          />
        )}
        {showAdd && (
          <AddEditModal mode="add" preset={activePreset} onClose={() => {
            setShowAdd(false)
            setActivePreset(null)
          }} onSaved={(newId) => {
            setShowAdd(false)
            setActivePreset(null)
            qc.invalidateQueries({ queryKey: ['ai', 'kb'] })
            if (newId) setSelectedId(newId)
          }} />
        )}
        {editing && (
          <AddEditModal mode="edit" chunk={editing} onClose={() => setEditing(null)} onSaved={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['ai', 'kb'] })
          }} />
        )}
        {showURL && (
          <URLIngestModal onClose={() => setShowURL(false)} onSaved={() => {
            setShowURL(false)
            qc.invalidateQueries({ queryKey: ['ai', 'kb'] })
          }} />
        )}
        {showGenerate && (
          <GenerateFromTextModal
            pending={generate.isPending || !!generateJobId}
            result={generateResult}
            job={importJob.data || null}
            error={generateAsyncError || (importJob.isError ? (importJob.error as any)?.response?.data?.error || (importJob.error as any)?.message || 'Failed to load import progress' : null)}
            onClose={() => setShowGenerate(false)}
            onSubmit={(text, maxChunks, sourceName) => generate.mutate({ text, max_chunks: maxChunks, source_name: sourceName })}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ---------------------------------------------------------------------------
// Quick add — preset library
// ---------------------------------------------------------------------------

function AddKnowledgeDialog({
  category, setCategory,
  onBlank, onTemplate, onURL, onGenerate, onClose,
}: {
  category: KBPresetCategoryId | 'all'
  setCategory: (c: KBPresetCategoryId | 'all') => void
  onBlank: () => void
  onTemplate: (preset: KBPreset) => void
  onURL: () => void
  onGenerate: () => void
  onClose: () => void
}) {
  const filtered = category === 'all'
    ? KB_PRESETS
    : KB_PRESETS.filter((p) => p.category === category)
  const templates = filtered.filter((p) => p.category !== 'custom')

  return (
    <ModalShell onClose={onClose} title="Add knowledge">
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-400/25 dark:bg-emerald-500/10">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-emerald-700 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-950 dark:text-white">What should the AI learn?</div>
              <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Pick the easiest path. Paste a full document, import a web page, start blank, or use a ready-made template.
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <AddMethodCard
            icon={Wand2}
            title="Paste a long document"
            text="Best for catalogs, pricing sheets, FAQs, and policies. The system splits it into searchable chunks."
            action="Generate chunks"
            tone="emerald"
            onClick={onGenerate}
          />
          <AddMethodCard
            icon={Globe}
            title="Import a web page"
            text="Use a public URL like pricing, product info, delivery policy, or support FAQ."
            action="Ingest URL"
            tone="sky"
            onClick={onURL}
          />
          <AddMethodCard
            icon={FileText}
            title="Write one note"
            text="Add one clear answer, rule, offer, or instruction manually."
            action="Start blank"
            tone="slate"
            onClick={onBlank}
          />
          <AddMethodCard
            icon={MessageSquare}
            title="Use a Q&A structure"
            text="Good when one buyer question needs one ideal answer."
            action="Create Q&A"
            tone="violet"
            onClick={() => {
              const qaPreset = KB_PRESETS.find((p) => p.title === 'Product FAQ')
              if (qaPreset) onTemplate(qaPreset)
              else onBlank()
            }}
          />
        </div>

        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Wand2 className="h-4 w-4 text-emerald-500" />
                Starter templates
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Choose one, fill the blanks, and save it as normal knowledge.
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {KB_PRESET_CATEGORIES.map((c) => {
                const Icon = PRESET_ICONS[c.icon]
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors
                               ${category === c.id
                                 ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                 : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/5'}`}
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <motion.div
            key={category}
            initial="hidden"
            animate="show"
            variants={containerStagger}
            className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.025]"
          >
            {templates.map((preset) => (
              <motion.div key={preset.id} variants={itemFadeUp}>
                <PresetChip
                  preset={preset}
                  onClick={() => onTemplate(preset)}
                />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </ModalShell>
  )
}

function AddMethodCard({
  icon: Icon, title, text, action, tone, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
  action: string
  tone: 'emerald' | 'sky' | 'violet' | 'slate'
  onClick: () => void
}) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/25',
    sky: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-400/25',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-400/25',
    slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-white/5 dark:text-slate-200 dark:border-white/10',
  }[tone]

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/35 dark:hover:bg-emerald-500/10"
    >
      <div className={`grid h-10 w-10 place-items-center rounded-lg border ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 font-semibold text-slate-950 dark:text-white">{title}</div>
      <div className="mt-1 min-h-[44px] text-sm leading-5 text-slate-600 dark:text-slate-300">{text}</div>
      <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
        {action}
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  )
}

function QuickAddPanel({
  category, setCategory,
  onUseTemplate,
}: {
  category: KBPresetCategoryId | 'all'
  setCategory: (c: KBPresetCategoryId | 'all') => void
  onUseTemplate: (preset: KBPreset) => void
}) {
  const filtered = category === 'all'
    ? KB_PRESETS
    : KB_PRESETS.filter((p) => p.category === category)

  return (
    <Card hover={false} className="mb-4">
      <div className="px-5 pt-4 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 dark:border-white/10">
        <div>
          <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Wand2 className="w-4 h-4 text-emerald-500" />
            Quick add
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Click a preset to open the Add modal pre-filled with its title and scaffold.
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {KB_PRESET_CATEGORIES.map((c) => {
            const Icon = PRESET_ICONS[c.icon]
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full
                           text-[11px] font-medium
                           border transition-colors
                           ${category === c.id
                             ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                             : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}
              >
                {Icon && <Icon className="w-3 h-3" />}
                {c.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="p-4">
        <motion.div
          key={category}
          initial="hidden"
          animate="show"
          variants={containerStagger}
          className="flex flex-wrap gap-2"
        >
          {filtered.map((preset) => (
            <motion.div key={preset.id} variants={itemFadeUp}>
              <PresetChip
                preset={preset}
                onClick={() => onUseTemplate(preset)}
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </Card>
  )
}

function PresetChip({ preset, onClick }: { preset: KBPreset; onClick: () => void }) {
  const category = KB_PRESET_CATEGORIES.find((c) => c.id === preset.category)
  const Icon = PRESET_ICONS[preset.icon] || FileText
  const isCustom = preset.category === 'custom'

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      title={`${preset.title} — ${preset.description}`}
      className={`group inline-flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full
                  text-xs font-medium border transition-colors
                  ${isCustom
                    ? 'border-dashed border-slate-300 dark:border-white/15 text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-white/[0.02] hover:border-emerald-400 dark:hover:border-emerald-400/60 hover:text-emerald-700 dark:hover:text-emerald-300'
                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-700 dark:text-slate-200 hover:border-emerald-300 dark:hover:border-emerald-400/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-800 dark:hover:text-emerald-200'}`}
    >
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0
                       ${category?.accent || 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>
        <Icon className="w-3 h-3" />
      </span>
      {preset.title}
      {!isCustom && (
        <Wand2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
      )}
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Hero banner
// ---------------------------------------------------------------------------

function HeroBanner({ totalChunks, onAdd }: {
  totalChunks: number
  onAdd: () => void
}) {
  const isEmpty = totalChunks === 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl
                 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent
                 dark:from-emerald-500/15 dark:via-teal-500/10 dark:to-transparent
                 border border-emerald-200/60 dark:border-emerald-400/20
                 p-5 lg:p-6 mb-4"
    >
      {/* Subtle decorative aurora in the corner — same idiom as Layout.tsx */}
      <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full
                      bg-emerald-400/20 dark:bg-emerald-400/10 blur-3xl" />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-xl
                          bg-emerald-100 dark:bg-emerald-500/20
                          border border-emerald-200 dark:border-emerald-400/30
                          grid place-items-center shrink-0">
            <BookOpen className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight">
                {isEmpty ? 'Build your AI knowledge base' : 'Your AI knowledge base'}
              </h2>
              {!isEmpty && (
                <PillPop className="pill-emerald !text-[10px]">
                  <Sparkles className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
                  {totalChunks.toLocaleString()} chunks
                </PillPop>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              {isEmpty
                ? 'Add a document, web page, note, or Q&A from one guided dialog. The AI uses this content to answer buyers accurately.'
                : 'Keep buyer answers grounded in your own catalog, pricing, policies, and FAQs. Add new knowledge from one guided dialog whenever something changes.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <PrimaryButton onClick={onAdd}>
            <Plus className="w-4 h-4" /> {isEmpty ? 'Add your first knowledge' : 'Add knowledge'}
          </PrimaryButton>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// KPI strip — counts derived from the global (unfiltered) list
// ---------------------------------------------------------------------------

function KPIStrip({ chunks }: { chunks: KBChunk[] }) {
  const counts = useMemo(() => {
    const c = { total: chunks.length, manual: 0, url: 0, qa: 0 }
    for (const k of chunks) {
      if (k.source_type === 'manual') c.manual++
      else if (k.source_type === 'url') c.url++
      else if (k.source_type === 'qa_pair') c.qa++
    }
    return c
  }, [chunks])

  return (
    <motion.div
      variants={containerStagger}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"
    >
      <motion.div variants={itemFadeUp}>
        <KpiCard label="Total chunks" value={counts.total} tone="green" countUp />
      </motion.div>
      <motion.div variants={itemFadeUp}>
        <KpiCard label="Manual" value={counts.manual} tone="blue" countUp />
      </motion.div>
      <motion.div variants={itemFadeUp}>
        <KpiCard label="From URLs" value={counts.url} tone="violet" countUp />
      </motion.div>
      <motion.div variants={itemFadeUp}>
        <KpiCard label="Q&A pairs" value={counts.qa} tone="amber" countUp />
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// List pane (left column)
// ---------------------------------------------------------------------------

const SOURCE_FILTERS: { v: string; label: string }[] = [
  { v: '', label: 'All' },
  { v: 'manual', label: 'Manual' },
  { v: 'qa_pair', label: 'Q&A' },
  { v: 'url', label: 'URL' },
  { v: 'pdf', label: 'PDF' },
  { v: 'conversation', label: 'Chat' },
]

function ChunkListPane({
  chunks, total, loading, error,
  selectedId, onSelect,
  search, setSearch, sourceType, setSourceType,
  onAdd,
}: {
  chunks: KBChunk[]
  total: number
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  search: string
  setSearch: (s: string) => void
  sourceType: string
  setSourceType: (s: string) => void
  onAdd: () => void
}) {
  return (
    <Card className="lg:sticky lg:top-4" hover={false}>
      {/* Toolbar */}
      <div className="p-3 border-b border-slate-200 dark:border-white/10 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or content…"
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.v || 'all'}
              type="button"
              onClick={() => setSourceType(f.v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full
                         text-[11px] font-medium
                         border transition-colors
                         ${sourceType === f.v
                           ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                           : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums pt-0.5">
          {loading ? 'Loading…' : `${total} chunk${total === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* List */}
      <div className="max-h-[calc(100vh-420px)] overflow-y-auto">
        {loading ? (
          <div className="p-6"><Spinner /></div>
        ) : error ? (
          <div className="p-4"><ErrorBox msg={error} /></div>
        ) : chunks.length === 0 ? (
          <ListEmpty
            hasFilters={!!(search || sourceType)}
            onAdd={onAdd}
            onClearFilters={() => { setSearch(''); setSourceType('') }}
          />
        ) : (
          <motion.ul
            variants={containerStagger}
            initial="hidden"
            animate="show"
            className="divide-y divide-slate-100 dark:divide-white/5"
          >
            {chunks.map((c) => (
              <motion.li key={c.id} variants={itemFadeUp}>
                <ChunkRow
                  chunk={c}
                  selected={selectedId === c.id}
                  onClick={() => onSelect(c.id)}
                />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </Card>
  )
}

function ListEmpty({
  hasFilters, onAdd, onClearFilters,
}: {
  hasFilters: boolean
  onAdd: () => void
  onClearFilters: () => void
}) {
  if (hasFilters) {
    return (
      <div className="p-8 text-center">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          No chunks match your filters.
        </div>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
        >
          Clear filters
        </button>
      </div>
    )
  }
  return (
    <div className="p-8 text-center">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto w-12 h-12 rounded-2xl
                   bg-emerald-50 dark:bg-emerald-500/15
                   grid place-items-center mb-3
                   border border-emerald-200 dark:border-emerald-400/30"
      >
        <BookOpen className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
      </motion.div>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">
        No knowledge yet
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[260px] mx-auto leading-relaxed">
        Add a document, web page, note, or Q&A to ground the AI's answers in your own content.
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        <PrimaryButton onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" /> Add knowledge
        </PrimaryButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chunk row (list item)
// ---------------------------------------------------------------------------

/**
 * Tailwind classes for the AI-inferred metadata.category badge. Mirrors
 * the preset accent colours (sky/emerald/violet/amber) so the UI feels
 * consistent across manual + generated chunks.
 */
const CATEGORY_ACCENT: Record<string, string> = {
  customer_service: 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-400/30',
  billing:          'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30',
  product:          'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-400/30',
  policy:           'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-400/30',
}

const CATEGORY_LABEL: Record<string, string> = {
  customer_service: 'Customer service',
  billing:          'Billing',
  product:          'Product',
  policy:           'Policy',
}

function ChunkRow({ chunk, selected, onClick }: {
  chunk: KBChunk
  selected: boolean
  onClick: () => void
}) {
  const category = chunk?.metadata?.category as string | undefined
  const catAccent = category ? CATEGORY_ACCENT[category] || CATEGORY_ACCENT.customer_service : null
  const Icon = chunk.source_type === 'url' ? Globe
             : chunk.source_type === 'qa_pair' ? MessageSquare
             : chunk.source_type === 'pdf' ? FileText
             : chunk.source_type === 'conversation' ? MessageSquare
             : FileText

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ x: 2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`relative w-full text-left px-3 py-3 flex items-start gap-2.5 transition-colors
                  ${selected
                    ? 'bg-emerald-50 dark:bg-emerald-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}
      aria-pressed={selected}
    >
      {/* Selected indicator bar — slides between rows via layoutId */}
      {selected && (
        <motion.span
          layoutId="kb-selected-indicator"
          className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-emerald-500"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}

      <div className={`w-8 h-8 rounded-md grid place-items-center shrink-0
                      ${selected
                        ? 'bg-emerald-100 dark:bg-emerald-500/30 text-emerald-700 dark:text-emerald-200'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-300'}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
            {chunk.title || <span className="italic text-slate-400 font-normal">[no title]</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 mb-1">
          <PillPop className="pill-slate !text-[9px] !px-1.5 !py-0">{chunk.source_type}</PillPop>
          {category && (
            <span className={`inline-flex items-center px-1.5 py-0 rounded border text-[9px] font-semibold ${catAccent}`}>
              {CATEGORY_LABEL[category] || category}
            </span>
          )}
          <span>·</span>
          <span>{fmtRelative(chunk.updated_at)}</span>
          <span>·</span>
          <span className="tabular-nums">{chunk.content_size.toLocaleString()} ch</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 whitespace-pre-wrap">
          {chunk.content}
        </p>
      </div>

      <ChevronRight
        className={`w-4 h-4 shrink-0 mt-1 transition-colors ${
          selected ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'
        }`}
      />
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Detail pane (right column)
// ---------------------------------------------------------------------------

function ChunkDetailPane({
  chunk, onEdit, onDelete,
}: {
  chunk: KBChunk | null
  onEdit: (c: KBChunk) => void
  onDelete: (c: KBChunk) => void
}) {
  const [copied, setCopied] = useState(false)

  if (!chunk) {
    return (
      <Card className="lg:min-h-[420px]" hover={false}>
        <div className="p-10 text-center grid place-items-center min-h-[360px]">
          <div>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-14 h-14 rounded-2xl
                         bg-gradient-to-br from-emerald-50 to-teal-50
                         dark:from-emerald-500/15 dark:to-teal-500/15
                         grid place-items-center mb-4
                         border border-emerald-200 dark:border-emerald-400/30"
            >
              <BookOpen className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">
              Select a chunk to view
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
              Pick an item on the left to see its full content, metadata, and actions.
            </div>
          </div>
        </div>
      </Card>
    )
  }

  const Icon = chunk.source_type === 'url' ? Globe
             : chunk.source_type === 'qa_pair' ? MessageSquare
             : chunk.source_type === 'pdf' ? FileText
             : chunk.source_type === 'conversation' ? MessageSquare
             : FileText

  async function copy() {
    try {
      await navigator.clipboard.writeText(chunk!.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed')
    }
  }

  return (
    <Card hover={false}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/15
                          text-emerald-700 dark:text-emerald-300
                          grid place-items-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight truncate">
              {chunk.title || <span className="italic text-slate-400 font-normal">[no title]</span>}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
              <PillPop className="pill-slate !text-[9px]">{chunk.source_type}</PillPop>
              {chunk?.metadata?.category && (
                <span className={`inline-flex items-center px-1.5 py-0 rounded border text-[10px] font-semibold ${CATEGORY_ACCENT[chunk.metadata.category as string] || CATEGORY_ACCENT.customer_service}`}>
                  {CATEGORY_LABEL[chunk.metadata.category as string] || (chunk.metadata.category as string)}
                </span>
              )}
              <span>·</span>
              <span className="tabular-nums">{chunk.content_size.toLocaleString()} chars</span>
              <span>·</span>
              <span>updated {fmtRelative(chunk.updated_at)}</span>
              {chunk.created_at && chunk.created_at !== chunk.updated_at && (
                <>
                  <span>·</span>
                  <span>created {fmtRelative(chunk.created_at)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <SecondaryButton onClick={copy}>
              {copied
                ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> Copied</>
                : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </SecondaryButton>
            <SecondaryButton onClick={() => onEdit(chunk)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </SecondaryButton>
            <SecondaryButton onClick={() => onDelete(chunk)}>
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            </SecondaryButton>
          </div>
        </div>
        {chunk.source_ref && (
          <a
            href={chunk.source_ref}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 hover:underline truncate max-w-full"
            title={chunk.source_ref}
          >
            <Link2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{chunk.source_ref}</span>
          </a>
        )}
      </div>

      {/* Content body — scrollable so very long chunks don't push the page */}
      <div className="p-5 max-h-[calc(100vh-460px)] overflow-y-auto">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs
                        leading-relaxed text-slate-800 dark:text-slate-200
                        bg-slate-50 dark:bg-white/[0.03]
                        border border-slate-200 dark:border-white/10
                        rounded-lg p-4">
          {chunk.content}
        </pre>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------

function AddEditModal({ mode, chunk, preset, onClose, onSaved }: {
  mode: 'add' | 'edit'
  chunk?: KBChunk
  /** When provided, pre-fills title + content with the preset scaffold. */
  preset?: KBPreset | null
  onClose: () => void
  onSaved: (newId?: number) => void
}) {
  const isEdit = mode === 'edit'
  const [title, setTitle] = useState(
    isEdit ? (chunk?.title || '') : (preset?.title || ''),
  )
  const [content, setContent] = useState(
    isEdit ? (chunk?.content || '') : (preset?.placeholder || ''),
  )
  const [sourceType, setSourceType] = useState<'manual' | 'qa_pair'>(
    (chunk?.source_type as 'manual' | 'qa_pair') || 'manual',
  )

  const save = useMutation({
    mutationFn: async () => {
      if (!content.trim()) throw new Error('content is required')
      if (isEdit && chunk) {
        await editKB(chunk.id, { title, content })
        return chunk.id
      }
      const res = await addKB({ title, content, source_type: sourceType })
      return (res as any)?.id as number | undefined
    },
    onSuccess: (newId) => {
      toast.success(isEdit ? 'Chunk updated' : 'Chunk added')
      onSaved(newId)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  return (
    <ModalShell onClose={onClose}
      title={isEdit
        ? 'Edit chunk'
        : preset
          ? `Add · ${preset.title}`
          : 'Add chunk'}>
      {!isEdit && preset && (
        <div className="mb-3 inline-flex items-center gap-1.5 text-[11px]
                        text-slate-600 dark:text-slate-300
                        bg-slate-50 dark:bg-white/[0.04]
                        border border-slate-200 dark:border-white/10
                        rounded-md px-2 py-1">
          <Wand2 className="w-3 h-3 text-emerald-500" />
          Pre-filled from preset. Edit anything below before saving.
        </div>
      )}
      <div className="space-y-3">
        <Field k="Title" v={
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="FAQ: Returns policy" />
        } sub="Optional. Shown in the admin list and in [N] citations to the LLM." />
        {!isEdit && (
          <Field k="Source type" v={
            <div className="flex gap-2">
              {(['manual', 'qa_pair'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSourceType(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors
                              ${sourceType === s
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300'}`}>
                  {s}
                </button>
              ))}
            </div>
          } sub="manual = free-form text. qa_pair = a question + ideal answer (gets a small boost in retrieval)." />
        )}
        <Field k="Content" v={
          <TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder={sourceType === 'qa_pair'
              ? 'Q: How do I get a refund?\nA: Email support@example.com with your order number.'
              : 'Paste your content here…'}
            className="font-mono text-xs"
          />
        } sub="Long content auto-chunks at ~800 tokens." />
        <div className="flex items-center justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending || !content.trim()}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add chunk'}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// URL ingest modal
// ---------------------------------------------------------------------------

function URLIngestModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  const ingest = useMutation({
    mutationFn: () => ingestKBURL({ url, title: title || undefined }),
    onSuccess: (r) => {
      if (r.errors && r.errors.length > 0) {
        toast.error(`${r.added} added, ${r.skipped} skipped (${r.errors.length} errors)`)
      } else {
        toast.success(`${r.added} chunk${r.added === 1 ? '' : 's'} added`)
      }
      onSaved()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Ingest failed'),
  })

  return (
    <ModalShell onClose={onClose} title="Ingest URL">
      <div className="space-y-3">
        <Field k="URL" v={
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/our-pricing"
          />
        } sub="The page is fetched, HTML is stripped to plain text, then saved as searchable knowledge chunks." />
        <Field k="Title (optional)" v={
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Our pricing" />
        } sub="Used as the prefix for each chunk's title." />
        <div className="flex items-center justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => ingest.mutate()} disabled={ingest.isPending || !url}>
            {ingest.isPending ? 'Ingesting…' : 'Ingest'}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Generate-from-text modal: starts a background, source-preserving KB
// import and polls progress until the created chunks are available.
// ---------------------------------------------------------------------------

function GenerateFromTextModal({
  pending, result, job, error, onClose, onSubmit,
}: {
  pending: boolean
  result: { count: number; titles: string[]; warnings?: string[] } | null
  job: KBImportJob | null
  error: string | null
  onClose: () => void
  onSubmit: (text: string, maxChunks: number, sourceName: string) => void
}) {
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [maxChunks, setMaxChunks] = useState(500)
  const charCount = text.length
  const tooLong = charCount > 1_000_000
  const canSubmit = !pending && text.trim().length > 0 && !tooLong
  const progress = job
    ? job.status === 'queued'
      ? 5
      : job.total_sections > 0
        ? Math.min(100, Math.round((job.processed_sections / job.total_sections) * 100))
        : 10
    : 0

  // Reset the textarea when the dialog reopens.
  useEffect(() => {
    setText('')
    setSourceName('')
    setMaxChunks(500)
  }, [])

  return (
    <ModalShell onClose={onClose} title="Generate chunks from text">
      {!result ? (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-200 dark:border-emerald-400/30
                          bg-emerald-50 dark:bg-emerald-500/10 p-3 text-xs
                          text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <Wand2 className="w-3.5 h-3.5" /> Source-preserving import
            </div>
            Large documents are processed in the background. The saved chunk
            content stays faithful to your original text; AI only labels each
            chunk with a title, category, and tags.
          </div>
          <Field k="Source name" v={
            <Input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Winter catalog, pricing policy, franchise FAQ..."
              disabled={pending}
            />
          } sub="Used as the source label for every generated chunk." />
          <Field k="Your text" v={
            <TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              maxLength={1_000_000}
              placeholder="Paste your company info here. Example: 'Refunds are accepted within 30 days... We ship pan-India in 3-5 days... Our customer support is available Mon-Sat 9am-7pm IST...'"
              className="font-mono text-xs"
              disabled={pending}
            />
          } sub={
            <span className="flex items-center justify-between">
              <span>{charCount.toLocaleString()} / 1,000,000 chars</span>
              {tooLong && <span className="text-rose-600 dark:text-rose-400">Too long - trim to under 1,000,000 chars</span>}
            </span>
          } />
          <Field k="Coverage cap (1-1000)" v={
            <input
              type="number"
              min={1}
              max={1000}
              value={maxChunks}
              onChange={(e) => setMaxChunks(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))}
              disabled={pending}
              className="w-24 px-2 py-1.5 rounded-md text-sm font-mono
                         bg-white dark:bg-[var(--input-bg)]
                         border border-slate-300 dark:border-[var(--input-border)]
                         text-slate-900 dark:text-slate-100"
            />
          } sub="If the document needs more chunks than this, the import stops instead of dropping content." />
          <div className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1">
            The importer keeps source text intact, adds small overlap between sections, and enriches labels in batches.
          </div>
          {job && (
            <div className="rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {job.status === 'queued' ? 'Queued' : job.status === 'running' ? 'Processing document' : job.status}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {job.total_sections > 0
                      ? `${job.processed_sections} of ${job.total_sections} sections processed`
                      : 'Preparing sections...'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{progress}%</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{job.created_count} saved</div>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.25 }}
                />
              </div>
              {job.warnings?.length > 0 && (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {job.warnings[0]}
                </div>
              )}
            </div>
          )}
          {error && <ErrorBox msg={error} />}
          <div className="flex items-center justify-end gap-2 pt-2">
            <SecondaryButton onClick={onClose}>{pending ? 'Close' : 'Cancel'}</SecondaryButton>
            <PrimaryButton onClick={() => onSubmit(text, maxChunks, sourceName)} disabled={!canSubmit}>
              {pending ? (
                <>
                  <Spinner />
                  <span>{job ? 'Importing...' : 'Starting...'}</span>
                </>
              ) : (
                <><Wand2 className="w-4 h-4" /> Start import</>
              )}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-200 dark:border-emerald-400/30
                          bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm
                          text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-1.5 font-semibold">
              <Check className="w-3.5 h-3.5" /> Created {result.count} chunk{result.count === 1 ? '' : 's'}
            </div>
            <div className="text-xs mt-0.5">
              Each chunk kept the source text and received searchable labels. You can edit any chunk afterwards.
            </div>
          </div>
          {result.warnings?.length ? (
            <div className="rounded-md border border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              {result.warnings[0]}
            </div>
          ) : null}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Chunk titles
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5
                           border border-slate-200 dark:border-white/10 rounded-md">
              {result.titles.map((t, i) => (
                <li key={i} className="px-3 py-2 text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400 w-6 tabular-nums">{i + 1}.</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Test retrieval panel (collapsible)
// ---------------------------------------------------------------------------

function TestRetrievalCard() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(5)
  const [result, setResult] = useState<SearchKBResult | null>(null)
  const search = useMutation({
    mutationFn: () => searchKB({ query, top_k: topK }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Search failed'),
  })

  return (
    <Card hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-emerald-500" /> Test retrieval
          </span>
        }
        subtitle="Sanity-check that the right chunks come back for a query. Doesn't call the LLM."
        right={
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                       text-slate-600 dark:text-slate-300
                       border border-slate-200 dark:border-white/10
                       bg-white dark:bg-white/[0.03]
                       hover:bg-slate-50 dark:hover:bg-white/5"
            aria-expanded={open}
          >
            <motion.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="inline-flex"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </motion.span>
            {open ? 'Hide' : 'Open'}
          </button>
        }
      />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="retrieval-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="What are your hours?"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !search.isPending && query.trim()) search.mutate() }}
                  className="flex-1 min-w-[200px]"
                />
                <label className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
                  top&nbsp;k
                  <input
                    type="number" min="1" max="20" value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value, 10) || 5)}
                    className="w-14 px-2 py-1.5 rounded-md text-sm font-mono
                               bg-white dark:bg-[var(--input-bg)]
                               border border-slate-300 dark:border-[var(--input-border)]
                               text-slate-900 dark:text-slate-100"
                  />
                </label>
                <PrimaryButton onClick={() => search.mutate()} disabled={!query.trim() || search.isPending}>
                  <Search className="w-4 h-4" /> {search.isPending ? 'Searching…' : 'Search'}
                </PrimaryButton>
              </div>
              {search.isError && <ErrorBox msg={(search.error as any)?.response?.data?.error || (search.error as any)?.message || 'Search failed'} />}
              {result && !search.isPending && <SearchResultView result={result} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function SearchResultView({ result }: { result: SearchKBResult }) {
  if (result.chunks.length === 0) {
    return <Empty>No chunks matched.</Empty>
  }
  return (
    <ul className="space-y-2">
      {result.chunks.map((c) => (
        <li key={c.id} className="rounded border border-slate-200 dark:border-white/10
                                bg-white dark:bg-white/[0.02] p-2.5 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
              {c.title || c.source_ref || `Chunk #${c.id}`}
            </span>
            <PillPop className="pill-slate !text-[9px]">{c.source_type}</PillPop>
            <span className="ml-auto font-mono text-slate-500 dark:text-slate-400">
              {c.final_score.toFixed(2)}
            </span>
          </div>
          <div className="text-slate-600 dark:text-slate-300 line-clamp-3">{c.content}</div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
            <ScoreBar label="vector" value={c.vector_sim} />
            <ScoreBar label="keyword" value={c.keyword_sim} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium">{label}</span>
      <span className="relative inline-block w-16 h-1.5 rounded bg-slate-200 dark:bg-white/10">
        <span
          className="absolute inset-y-0 left-0 rounded bg-emerald-500"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </span>
      <span className="font-mono">{value.toFixed(2)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Modal shell (shared by add/edit/url modals)
// ---------------------------------------------------------------------------

function ModalShell({ children, onClose, title }: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-3 sm:p-4
                 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-2xl
                   max-h-[calc(100vh-2rem)] overflow-hidden
                   rounded-lg border border-slate-200 dark:border-white/10
                   bg-white dark:bg-[#0a1124]
                   shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400
                       hover:bg-slate-100 dark:hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5">{children}</div>
      </motion.div>
    </motion.div>
  )
}

function Field({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
      {sub != null && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}
