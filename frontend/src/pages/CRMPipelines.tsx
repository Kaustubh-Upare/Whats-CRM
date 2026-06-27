import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Plus, Save, Trash2, X, GripVertical, Settings2, Zap, Mail, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { crmKeys, createPipeline, deletePipeline, listPipelines, listSequences, updatePipeline, updatePipelineStages } from '@/lib/crm'
import type { CRMPipeline, CRMPipelineStage, CRMSequence, StageAutomation } from '@/lib/types'

/**
 * /admin/crm/pipelines — manage the sales pipeline + stages.
 * Left: list of pipelines. Right: stages of the selected pipeline.
 */
export default function CRMPipelines() {
  const qc = useQueryClient()
  const pipelines = useQuery({
    queryKey: crmKeys.pipelines(),
    queryFn: () => listPipelines(),
  })
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTemplate, setNewTemplate] = useState<'sales' | 'support' | 'blank'>('sales')

  // Auto-select default pipeline when data loads.
  if (pipelines.data && selectedID === null) {
    const def = pipelines.data.items.find((p) => p.is_default) ?? pipelines.data.items[0]
    if (def) setSelectedID(def.id)
  }

  const create = useMutation({
    mutationFn: () => createPipeline({ name: newName, template: newTemplate }),
    onSuccess: (r) => {
      toast.success('Pipeline created')
      setShowNew(false); setNewName('')
      qc.invalidateQueries({ queryKey: crmKeys.pipelines() })
      setSelectedID(r.id)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Create failed'),
  })

  const del = useMutation({
    mutationFn: (id: number) => deletePipeline(id),
    onSuccess: () => {
      toast.success('Pipeline deleted')
      qc.invalidateQueries({ queryKey: crmKeys.pipelines() })
      setSelectedID(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Delete failed'),
  })

  const selected = pipelines.data?.items.find((p) => p.id === selectedID)

  return (
    <>
      <PageHeader
        title="Pipelines"
        subtitle="The stages every lead flows through. One default per business."
        right={
          <PrimaryButton onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> New pipeline
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <Card className="!p-0 overflow-hidden">
          {pipelines.isLoading ? <Spinner /> :
           pipelines.isError ? <ErrorBox msg={(pipelines.error as any)?.message || 'Failed to load'} /> :
           (pipelines.data?.items.length ?? 0) === 0 ? <Empty>No pipelines yet.</Empty> :
           <ul>
             {pipelines.data!.items.map((p) => (
               <li key={p.id}>
                 <button
                   type="button"
                   onClick={() => setSelectedID(p.id)}
                   className={`w-full text-left px-3 py-3 border-b border-slate-100 dark:border-white/5
                              ${selectedID === p.id ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
                 >
                   <div className="flex items-center gap-2">
                     <Settings2 className="w-4 h-4 text-slate-400" />
                     <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{p.name}</span>
                     {p.is_default && <PillPop className="pill-green !text-[9px]">default</PillPop>}
                   </div>
                   <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                     {p.stages.length} stage{p.stages.length === 1 ? '' : 's'}
                   </div>
                 </button>
               </li>
             ))}
           </ul>}
        </Card>

        {selected ? (
          <PipelineEditor
            key={selected.id}
            pipeline={selected}
            onDeleted={() => del.mutate(selected.id)}
          />
        ) : (
          <Card className="h-[300px] grid place-items-center">
            <Empty>Select a pipeline to edit its stages.</Empty>
          </Card>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
             onClick={() => setShowNew(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-md rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a1124] shadow-xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">New pipeline</h2>
              <button onClick={() => setShowNew(false)} className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <Field k="Name *" v={
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Sales pipeline" />
            } />
            <Field k="Template" v={
              <div className="flex gap-2">
                {(['sales', 'support', 'blank'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setNewTemplate(t)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors
                              ${newTemplate === t
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300'}`}>
                    {t}
                  </button>
                ))}
              </div>
            } sub="Pre-fills the stage list. 'blank' starts empty." />
            <div className="flex items-center justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setShowNew(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => create.mutate()} disabled={!newName || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </PrimaryButton>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}

function PipelineEditor({ pipeline, onDeleted }: { pipeline: CRMPipeline; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [stages, setStages] = useState<CRMPipelineStage[]>(pipeline.stages)
  const [dirty, setDirty] = useState(false)
  // Local view of the automations map: stage_id -> StageAutomation.
  // Built from `stage.automations` (whatever shape the server returns)
  // and converted to a normalised form on save.
  const [automations, setAutomations] = useState<Record<number, StageAutomation>>(() => {
    const m: Record<number, StageAutomation> = {}
    for (const s of pipeline.stages) {
      m[s.id] = normaliseAutomations(s.automations)
    }
    return m
  })

  // All available sequences for the automations picker. We let admins
  // enrol leads in any sequence, regardless of its trigger_event
  // (the backend checks `enabled` and ownership before enrolling).
  const seqs = useQuery({
    queryKey: crmKeys.sequences(),
    queryFn: () => listSequences(),
  })

  // Re-sync if pipeline changes (e.g. another tab).
  if (!dirty && JSON.stringify(stages) !== JSON.stringify(pipeline.stages)) {
    setStages(pipeline.stages)
    const m: Record<number, StageAutomation> = {}
    for (const s of pipeline.stages) {
      m[s.id] = normaliseAutomations(s.automations)
    }
    setAutomations(m)
  }

  const save = useMutation({
    mutationFn: () => updatePipelineStages(pipeline.id, stages.map((s) => ({
      name: s.name,
      color: s.color,
      position: s.position,
      automations: automations[s.id] || {},
    }))),
    onSuccess: () => {
      toast.success('Stages saved')
      setDirty(false)
      qc.invalidateQueries({ queryKey: crmKeys.pipelines() })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  const rename = useMutation({
    mutationFn: (name: string) => updatePipeline(pipeline.id, { name }),
    onSuccess: () => { toast.success('Renamed'); qc.invalidateQueries({ queryKey: crmKeys.pipelines() }) },
  })

  return (
    <Card className="!p-0 overflow-hidden">
      <CardHeader
        title={
          <input
            defaultValue={pipeline.name}
            onBlur={(e) => { if (e.target.value && e.target.value !== pipeline.name) rename.mutate(e.target.value) }}
            className="bg-transparent border-0 font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60 rounded px-1"
          />
        }
        subtitle={`${stages.length} stage${stages.length === 1 ? '' : 's'}${pipeline.is_default ? ' · default pipeline' : ''}`}
        right={
          <div className="flex items-center gap-2">
            {dirty && (
              <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
              </PrimaryButton>
            )}
            {!pipeline.is_default && (
              <button
                type="button"
                onClick={() => { if (window.confirm('Delete this pipeline? Existing deals stay in their stages.')) onDeleted() }}
                className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        }
      />
      <div className="p-3 space-y-2">
        {stages.map((s, i) => (
          <div key={s.id} className="rounded-md border border-slate-200 dark:border-white/10
                                       bg-white dark:bg-white/[0.03] p-2">
            <div className="flex items-center gap-2">
              <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
              <input
                type="color"
                value={s.color || '#94a3b8'}
                onChange={(e) => { updateStage(i, { color: e.target.value }); setDirty(true) }}
                className="w-8 h-7 rounded border-0 bg-transparent cursor-pointer"
              />
              <Input
                value={s.name}
                onChange={(e) => { updateStage(i, { name: e.target.value }); setDirty(true) }}
                className="flex-1"
              />
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 w-12 text-right">
                {s.deal_count} deal{s.deal_count === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => { setStages(stages.filter((_, j) => j !== i)); setDirty(true) }}
                className="p-1 rounded text-slate-400 hover:text-rose-500"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {s.id > 0 && (
              <AutomationsPicker
                stageID={s.id}
                automations={automations[s.id] || {}}
                sequences={seqs.data?.items || []}
                onToggle={(sequenceID, checked) => {
                  setAutomations((prev) => ({
                    ...prev,
                    [s.id]: toggleAutomationsSequence(prev[s.id] || {}, sequenceID, checked),
                  }))
                  setDirty(true)
                }}
                disabled={false}
              />
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const newStage: CRMPipelineStage = {
              id: 0, name: 'New stage', color: '#94a3b8',
              position: stages.length + 1, deal_count: 0,
            }
            setStages([...stages, newStage])
            setDirty(true)
          }}
          className="w-full px-3 py-2 rounded-md border border-dashed border-slate-300 dark:border-white/10
                     text-xs text-slate-500 dark:text-slate-400 hover:border-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-300"
        >
          <Plus className="w-3 h-3 inline mr-1" /> Add stage
        </button>
      </div>
    </Card>
  )

  function updateStage(i: number, patch: Partial<CRMPipelineStage>) {
    setStages((prev) => prev.map((s, j) => j === i ? { ...s, ...patch } : s))
  }
}

function Field({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
      {sub && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

// normaliseAutomations coerces whatever the server stored in the
// `automations` JSONB column into the canonical shape we render in
// the picker. Defensive: the server might return null, an empty
// object, or a partial shape from older versions.
function normaliseAutomations(raw: any): StageAutomation {
  if (!raw || typeof raw !== 'object') return {}
  const auto = raw as StageAutomation
  if (!auto.on_stage_entered) return {}
  if (!auto.on_stage_entered.enroll_sequences) {
    auto.on_stage_entered.enroll_sequences = []
  }
  return auto
}

// AutomationsPicker is the per-stage expandable section. Admin can
// pick which sequences should auto-enroll when a deal enters this
// stage. Saves back to the parent state on toggle.
function AutomationsPicker({
  stageID, automations, sequences, onToggle, disabled,
}: {
  stageID: number
  automations: StageAutomation
  sequences: CRMSequence[]
  onToggle: (sequenceID: number, checked: boolean) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = automations.on_stage_entered?.enroll_sequences || []
  const selectedIDs = new Set(selected.map((s) => s.sequence_id))

  return (
    <div className="mt-1.5 ml-9">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled || sequences.length === 0}
        className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400
                   hover:text-emerald-600 dark:hover:text-emerald-300 disabled:opacity-50"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Zap className="w-3 h-3" /> Automations
        {selected.length > 0 && (
          <PillPop className="pill-emerald !text-[9px] ml-1">{selected.length}</PillPop>
        )}
      </button>
      {open && (
        <div className="mt-2 ml-4 space-y-1">
          {sequences.length === 0 ? (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
              No sequences yet. Create one in /admin/crm/sequences.
            </div>
          ) : sequences.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[11px] cursor-pointer
                                        text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={selectedIDs.has(s.id)}
                onChange={(e) => onToggle(s.id, e.target.checked)}
                className="rounded border-slate-300 dark:border-white/20 text-emerald-500
                           focus:ring-emerald-400"
              />
              <Mail className="w-3 h-3 text-slate-400" />
              <span className="truncate flex-1">{s.name}</span>
              {!s.enabled && (
                <PillPop className="pill-slate !text-[8px]">disabled</PillPop>
              )}
            </label>
          ))}
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 italic">
            Deals entering this stage will auto-enroll in the selected sequences.
          </div>
        </div>
      )}
    </div>
  )
}

// toggleAutomationsSequence flips a sequence_id in the stage's
// on_stage_entered.enroll_sequences list.
function toggleAutomationsSequence(
  automations: StageAutomation, sequenceID: number, checked: boolean,
): StageAutomation {
  const next: StageAutomation = {
    ...automations,
    on_stage_entered: {
      ...(automations.on_stage_entered || {}),
      enroll_sequences: automations.on_stage_entered?.enroll_sequences || [],
    },
  }
  const list = next.on_stage_entered!.enroll_sequences!
  if (checked) {
    if (!list.find((s) => s.sequence_id === sequenceID)) {
      list.push({ sequence_id: sequenceID })
    }
  } else {
    next.on_stage_entered!.enroll_sequences = list.filter((s) => s.sequence_id !== sequenceID)
  }
  return next
}