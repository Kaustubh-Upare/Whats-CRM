import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Save, Trash2, X, Mail, Clock, Zap, Power, Activity, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { fmtRelative } from '@/lib/format'
import { crmKeys, createSequence, deleteSequence, enrollLeadInSequence, getSequenceSteps, listSequenceRuns, listSequences, updateSequence, updateSequenceSteps } from '@/lib/crm'
import type { CRMSequence, CRMSequenceStep } from '@/lib/types'

/**
 * /admin/crm/sequences — build + manage follow-up sequences.
 * Left: list. Right: trigger picker + steps editor.
 * The actual worker that sends messages on schedule is Phase 5.
 * Phase 4 just persists + lists + manual enrollment.
 */
export default function CRMSequences() {
  const qc = useQueryClient()
  const seqs = useQuery({
    queryKey: crmKeys.sequences(),
    queryFn: () => listSequences(),
  })
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTrigger, setNewTrigger] = useState('manual')
  // Phase 7: tab toggle for "My sequences" vs "Smart follow-ups".
  // Smart follow-up sequences are tagged trigger_event='smart_followup'
  // and are auto-created per lead; we hide them from the default list.
  const [view, setView] = useState<'mine' | 'smart'>('mine')

  // Filter the sequence list based on the active tab. The "smart"
  // tab shows only trigger_event='smart_followup' rows; "mine" shows
  // everything else. Memoized so the effect below doesn't loop on a
  // fresh array reference each render.
  const filteredSeqs = useMemo(() => {
    return seqs.data?.items.filter((s) =>
      view === 'smart'
        ? s.trigger_event === 'smart_followup'
        : s.trigger_event !== 'smart_followup',
    ) ?? []
  }, [seqs.data, view])

  // Auto-select: when there's no selection, pick the first visible row.
  // When the selected row is filtered out (tab switch), fall back to the
  // first visible row. useEffect (not inline if) so we don't call
  // setState during render and trip the "Too many re-renders" guard.
  useEffect(() => {
    if (!seqs.data) return
    if (selectedID === null && filteredSeqs.length > 0) {
      setSelectedID(filteredSeqs[0].id)
      return
    }
    if (selectedID !== null && !filteredSeqs.find((s) => s.id === selectedID)) {
      setSelectedID(filteredSeqs[0]?.id ?? null)
    }
  }, [seqs.data, filteredSeqs, selectedID])

  const create = useMutation({
    mutationFn: () => createSequence({ name: newName, trigger_event: newTrigger }),
    onSuccess: (r) => {
      toast.success('Sequence created')
      setShowNew(false); setNewName('')
      qc.invalidateQueries({ queryKey: crmKeys.sequences() })
      setSelectedID(r.id)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Create failed'),
  })

  const del = useMutation({
    mutationFn: (id: number) => deleteSequence(id),
    onSuccess: () => {
      toast.success('Sequence deleted')
      qc.invalidateQueries({ queryKey: crmKeys.sequences() })
      setSelectedID(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Delete failed'),
  })

  const selected = seqs.data?.items.find((s) => s.id === selectedID)

  return (
    <>
      <PageHeader
        title="Sequences"
        subtitle="Follow-up messages the agent will send to enrolled leads on schedule."
        right={
          <PrimaryButton onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> New sequence
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <Card className="!p-0 overflow-hidden">
          {/* Phase 7: tab toggle between My sequences and Smart follow-ups. */}
          <div className="flex border-b border-slate-100 dark:border-white/5">
            <button
              type="button"
              onClick={() => setView('mine')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors
                ${view === 'mine'
                  ? 'text-emerald-700 dark:text-emerald-300 border-b-2 border-emerald-500'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              My sequences
            </button>
            <button
              type="button"
              onClick={() => setView('smart')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1
                ${view === 'smart'
                  ? 'text-violet-700 dark:text-violet-300 border-b-2 border-violet-500'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <Sparkles className="w-3 h-3" /> Smart follow-ups
            </button>
          </div>
          {seqs.isLoading ? <Spinner /> :
           seqs.isError ? <ErrorBox msg={(seqs.error as any)?.message || 'Failed to load'} /> :
           filteredSeqs.length === 0 ? (
             <Empty>
               {view === 'smart'
                 ? 'No smart follow-ups yet. Click "Follow up" on a lead to start one.'
                 : 'No sequences yet.'}
             </Empty>
           ) :
           <ul>
             {filteredSeqs.map((s) => (
               <li key={s.id}>
                 <button
                   type="button"
                   onClick={() => setSelectedID(s.id)}
                   className={`w-full text-left px-3 py-3 border-b border-slate-100 dark:border-white/5
                              ${selectedID === s.id ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}
                 >
                   <div className="flex items-center gap-2">
                     <Mail className="w-4 h-4 text-slate-400" />
                     <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{s.name}</span>
                     {s.enabled
                       ? <PillPop className="pill-green !text-[9px]">on</PillPop>
                       : <PillPop className="pill-slate !text-[9px]">off</PillPop>}
                   </div>
                   <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                     {s.trigger_event} · {s.step_count} step{s.step_count === 1 ? '' : 's'} · {s.enrollment_count} enrolled
                   </div>
                 </button>
               </li>
             ))}
           </ul>}
        </Card>

        {selected ? (
          <SequenceEditor
            key={selected.id}
            seq={selected}
            onDeleted={() => del.mutate(selected.id)}
          />
        ) : (
          <Card className="h-[300px] grid place-items-center">
            <Empty>Select a sequence to edit.</Empty>
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
              <h2 className="font-semibold text-slate-900 dark:text-white">New sequence</h2>
              <button onClick={() => setShowNew(false)} className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <Field k="Name *" v={
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Welcome new lead" />
            } />
            <Field k="Trigger" v={
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 'manual', label: 'Manual' },
                  { v: 'lead_created', label: 'Lead created' },
                  { v: 'stage_changed', label: 'Stage changed' },
                  { v: 'no_reply_3d', label: 'No reply 3d' },
                ].map((t) => (
                  <button key={t.v} type="button" onClick={() => setNewTrigger(t.v)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border
                              ${newTrigger === t.v
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            } />
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

function SequenceEditor({ seq, onDeleted }: { seq: CRMSequence; onDeleted: () => void }) {
  const qc = useQueryClient()
  const stepsQ = useQuery({
    queryKey: crmKeys.sequenceSteps(seq.id),
    queryFn: () => getSequenceSteps(seq.id),
  })
  const [steps, setSteps] = useState<CRMSequenceStep[]>([])
  const [trigger, setTrigger] = useState(seq.trigger_event)
  const [enabled, setEnabled] = useState(seq.enabled)
  const [dirty, setDirty] = useState(false)

  // Hydrate local step state from the query the first time the query
  // returns data. We don't want to re-overwrite user edits, so the
  // effect is gated on `dirty` and the local steps being empty via
  // a ref. useEffect (not inline-if) so setState doesn't run during
  // render and trip the "Too many re-renders" guard.
  useEffect(() => {
    if (stepsQ.data && !dirty && steps.length === 0) {
      setSteps(stepsQ.data)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsQ.data])

  const saveAll = useMutation({
    mutationFn: async () => {
      // Save trigger + enabled in one go.
      await updateSequence(seq.id, { trigger_event: trigger, enabled })
      // Save steps (replace).
      await updateSequenceSteps(seq.id, steps.map((s) => ({
        position: s.position,
        delay_minutes: s.delay_minutes,
        message_template: s.message_template,
      })))
    },
    onSuccess: () => {
      toast.success('Sequence saved')
      setDirty(false)
      qc.invalidateQueries({ queryKey: crmKeys.sequences() })
      qc.invalidateQueries({ queryKey: crmKeys.sequenceSteps(seq.id) })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  const enroll = useMutation({
    mutationFn: (leadID: number) => enrollLeadInSequence(seq.id, { lead_id: leadID }),
    onSuccess: () => toast.success('Enrolled'),
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Enroll failed'),
  })
  const [enrollPhone, setEnrollPhone] = useState('')
  const [enrollLeadID, setEnrollLeadID] = useState<number | null>(null)

  return (
    <Card className="!p-0 overflow-hidden">
      <CardHeader
        title={seq.name}
        subtitle={`${seq.step_count} step${seq.step_count === 1 ? '' : 's'}`}
        right={
          <div className="flex items-center gap-2">
            {dirty && (
              <PrimaryButton onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
                <Save className="w-4 h-4" /> {saveAll.isPending ? 'Saving…' : 'Save'}
              </PrimaryButton>
            )}
            <button
              type="button"
              onClick={() => { if (window.confirm('Delete this sequence? Existing enrollments will be cancelled.')) onDeleted() }}
              className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        }
      />
      <div className="p-3 space-y-3">
        {/* Trigger + enabled */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Trigger</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { v: 'manual', label: 'Manual' },
              { v: 'lead_created', label: 'Lead created' },
              { v: 'stage_changed', label: 'Stage changed' },
              { v: 'no_reply_3d', label: 'No reply 3d' },
              { v: 'tag_added', label: 'Tag added' },
            ].map((t) => (
              <button key={t.v} type="button" onClick={() => { setTrigger(t.v); setDirty(true) }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border
                          ${trigger === t.v
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setEnabled(!enabled); setDirty(true) }}
            className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border
                      ${enabled
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-500'}`}
          >
            <Power className="w-3 h-3" /> {enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {/* Steps */}
        {stepsQ.isLoading ? <Spinner /> : (
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.id || i} className="rounded-md border border-slate-200 dark:border-white/10
                                            bg-white dark:bg-white/[0.03] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 w-12">
                    Step {i + 1}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <input
                      type="number"
                      min="0"
                      value={s.delay_minutes}
                      onChange={(e) => { updateStep(i, { delay_minutes: parseInt(e.target.value, 10) || 0 }); setDirty(true) }}
                      className="w-16 px-2 py-1 rounded text-sm
                                 bg-white dark:bg-[var(--input-bg)]
                                 border border-slate-300 dark:border-[var(--input-border)]
                                 text-slate-900 dark:text-slate-100"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">min after prev</span>
                  </div>
                  <button type="button" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setDirty(true) }}
                    className="ml-auto p-1 rounded text-slate-400 hover:text-rose-500"
                    title="Remove">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <TextArea
                  value={s.message_template}
                  onChange={(e) => { updateStep(i, { message_template: e.target.value }); setDirty(true) }}
                  rows={3}
                  placeholder="Hi {{lead.name}}, just following up on…"
                  className="font-mono text-xs"
                />
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Vars: <span className="font-mono">{'{{lead.name}} {{lead.phone}} {{lead.interest}} {{lead.budget}}'}</span>
                </div>
              </li>
            ))}
            <button
              type="button"
              onClick={() => {
                setSteps([...steps, { id: 0, sequence_id: seq.id, position: steps.length + 1, delay_minutes: 1440, message_template: '' }])
                setDirty(true)
              }}
              className="w-full px-3 py-2 rounded-md border border-dashed border-slate-300 dark:border-white/10
                         text-xs text-slate-500 dark:text-slate-400 hover:border-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-300"
            >
              <Plus className="w-3 h-3 inline mr-1" /> Add step
            </button>
          </ol>
        )}

        {/* Manual enrollment */}
        <div className="rounded-md border border-slate-200 dark:border-white/10
                        bg-slate-50/40 dark:bg-white/[0.02] p-3">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> Manual enrollment
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              value={enrollLeadID || ''}
              onChange={(e) => setEnrollLeadID(parseInt(e.target.value, 10) || null)}
              placeholder="lead_id"
              className="w-32"
            />
            <PrimaryButton onClick={() => enrollLeadID && enroll.mutate(enrollLeadID)} disabled={!enrollLeadID || enroll.isPending}>
              Enroll
            </PrimaryButton>
          </div>
        </div>

        {/* Phase 5: runs panel. Shows the live state of every
            enrollment (active / paused / completed / cancelled) with
            the last failure reason when paused. */}
        <RunsPanel sequenceID={seq.id} />
      </div>
    </Card>
  )

  function updateStep(i: number, patch: Partial<CRMSequenceStep>) {
    setSteps((prev) => prev.map((s, j) => j === i ? { ...s, ...patch } : s))
  }
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Phase 5: per-sequence runs panel.
// ----------------------------------------------------------------------------

function RunsPanel({ sequenceID }: { sequenceID: number }) {
  const runsQ = useQuery({
    queryKey: crmKeys.sequenceRuns(sequenceID),
    queryFn: () => listSequenceRuns(sequenceID),
    refetchInterval: 10_000,
  })
  return (
    <div className="rounded-md border border-slate-200 dark:border-white/10
                    bg-slate-50/40 dark:bg-white/[0.02] p-3">
      <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
        <Activity className="w-3 h-3" /> Runs
        <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">
          (last 50 enrollments, polls every 10s)
        </span>
      </div>
      {runsQ.isLoading ? <Spinner /> :
       runsQ.isError ? <ErrorBox msg={(runsQ.error as any)?.message || 'Failed to load runs'} /> :
       !runsQ.data || runsQ.data.length === 0 ? <Empty>No runs yet. Enroll a lead to start.</Empty> :
       <ul className="space-y-1.5">
         {runsQ.data.map((r) => (
           <li key={r.enrollment_id}
               className="rounded border border-slate-200 dark:border-white/10
                          bg-white dark:bg-white/[0.02] p-2 text-xs">
             <div className="flex items-center gap-2 flex-wrap">
               <Link to={`/admin/crm/leads/${r.lead_id}`}
                     className="font-medium text-slate-800 dark:text-slate-100 hover:underline truncate max-w-[200px]">
                 {r.lead_name || r.lead_phone}
               </Link>
               {/* Phase 7: AI pill when this row is an AI follow-up. */}
               {r.mode === 'ai_followup' && (
                 <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide
                                  px-1.5 py-0.5 rounded
                                  text-violet-700 dark:text-violet-300
                                  bg-violet-50 dark:bg-violet-500/20
                                  border border-violet-200 dark:border-violet-400/30">
                   <Sparkles className="w-2.5 h-2.5" /> AI
                 </span>
               )}
               <PillPop className={runStatusTone(r.status)}>
                 {runStatusIcon(r.status)} {r.status}
               </PillPop>
               {/* Phase 7: per-pause-reason pill (more useful than the
                   generic "paused" pill — admins want to know WHY). */}
               {r.status === 'paused' && r.pause_reason && (
                 <PauseReasonPill reason={r.pause_reason} />
               )}
               <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                 step {r.current_step + 1}
               </span>
               <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto">
                 {r.status === 'active'
                   ? `next ${fmtRelative(r.next_run_at)}`
                   : r.status === 'completed'
                     ? `done ${r.completed_at ? fmtRelative(r.completed_at) : ''}`
                     : `enrolled ${fmtRelative(r.enrolled_at)}`}
               </span>
             </div>
             {r.last_error && (
               <div className="mt-1.5 flex items-start gap-1.5 text-[11px]
                               text-rose-600 dark:text-rose-300">
                 <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                 <span className="line-clamp-2">{r.last_error}</span>
               </div>
             )}
           </li>
         ))}
       </ul>}
    </div>
  )
}

function runStatusTone(s: string): string {
  switch (s) {
    case 'active':    return 'pill-emerald'
    case 'completed': return 'pill-green'
    case 'paused':    return 'pill-amber'
    case 'cancelled': return 'pill-slate'
    default:          return 'pill-slate'
  }
}

function runStatusIcon(s: string) {
  if (s === 'completed') return <CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-0.5" />
  if (s === 'paused')    return <AlertCircle className="w-3 h-3 inline -mt-0.5 mr-0.5" />
  return null
}

// Phase 7: per-pause-reason pill. Renders the human-readable reason
// next to the generic "paused" pill so the runs panel tells the
// admin WHY at a glance without clicking through.
function PauseReasonPill({ reason }: { reason: string }) {
  let label = reason
  let tone = 'pill-slate'
  switch (reason) {
    case 'customer_replied':
      label = 'paused · customer replied'
      tone = 'pill-amber'
      break
    case 'terminal_stage':
      label = 'paused · stage changed'
      tone = 'pill-slate'
      break
    case 'send_failed':
      label = 'paused · send failed'
      tone = 'pill-rose'
      break
    case 'admin_paused':
      label = 'paused · manually'
      tone = 'pill-slate'
      break
    default:
      label = `paused · ${reason}`
      tone = 'pill-slate'
  }
  return <PillPop className={tone}>{label}</PillPop>
}