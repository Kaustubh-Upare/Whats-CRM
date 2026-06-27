import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Briefcase, Search, Plus, Settings2, Mail, ListChecks,
  Phone, X, GripVertical, TrendingUp, Check, MoreHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { FollowUpMenuItem } from '@/components/FollowUpMenuItem'
import { fmtRelative } from '@/lib/format'
import { CRMBulkBar } from '@/components/CRMBulkBar'
import {
  crmKeys, createDeal, createLead, deleteLead, listDealsByPipeline, listLeads,
  listPipelines, moveDealStage, updateLead,
} from '@/lib/crm'
import type {
  CRMDealListItem, CRMLead, CRMPipeline,
} from '@/lib/types'

/**
 * /admin/crm/leads — the flagship CRM view (Phase 5).
 *
 * Layout:
 *   Top toolbar: search + status filter + select-all + "+ New lead".
 *   Below: deal-by-stage kanban board. One column per stage, deal
 *   cards inside. Drag a deal card to another column → moveDealStage.
 *   Drag a lead (from the "no deal yet" strip at the bottom) into a
 *   column → createDeal in that stage.
 *   Bulk bar: when ≥1 lead is selected, a floating action bar appears
 *   with "Move to" / "Set status" / "Delete" / "Clear".
 */
export default function CRMLeads() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showNew, setShowNew] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  // Multi-select state for the bulk bar.
  const [selectedIDs, setSelectedIDs] = useState<Set<number>>(new Set())

  const pipelines = useQuery({
    queryKey: crmKeys.pipelines(),
    queryFn: () => listPipelines(),
  })
  const leads = useQuery({
    queryKey: crmKeys.leads({ search, status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }),
    queryFn: () => listLeads({ search: search || undefined, status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }),
    refetchInterval: 15_000,
  })

  const defaultPipeline: CRMPipeline | undefined = useMemo(
    () => pipelines.data?.items.find((p) => p.is_default) ?? pipelines.data?.items[0],
    [pipelines.data],
  )

  // Live-fetch the deals for the default pipeline so the bulk-move
  // handler can check "does this lead already have a deal in the
  // pipeline?" without an extra round-trip.
  const dealsQ = useQuery({
    queryKey: crmKeys.dealsByPipeline(defaultPipeline?.id ?? 0),
    queryFn: () => listDealsByPipeline(defaultPipeline!.id),
    enabled: !!defaultPipeline,
    refetchInterval: 10_000,
  })

  const dealsByLead = useMemo(() => {
    const m = new Map<number, CRMDealListItem>()
    for (const d of dealsQ.data?.items || []) {
      m.set(d.lead_id, d)
    }
    return m
  }, [dealsQ.data])

  const createLeadMut = useMutation({
    mutationFn: () => createLead({ name: newName, phone: newPhone, email: newEmail }),
    onSuccess: (r) => {
      toast.success('Lead created')
      setShowNew(false)
      setNewName(''); setNewPhone(''); setNewEmail('')
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
      qc.invalidateQueries({ queryKey: crmKeys.pipelines() })
      if (defaultPipeline) {
        qc.invalidateQueries({ queryKey: crmKeys.dealsByPipeline(defaultPipeline.id) })
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Create failed'),
  })

  // -------------------------------------------------------------------------
  // Bulk-action handlers
  // -------------------------------------------------------------------------

  const bulkMoveToStage = useMutation({
    mutationFn: async (stageID: number) => {
      if (!defaultPipeline) return
      const ids = Array.from(selectedIDs)
      let okCount = 0
      let failCount = 0
      for (const leadID of ids) {
        try {
          const deal = dealsByLead.get(leadID)
          if (deal) {
            if (deal.stage_id !== stageID) {
              await moveDealStage(deal.id, { stage_id: stageID })
            }
          } else {
            await createDeal({
              lead_id: leadID,
              pipeline_id: defaultPipeline.id,
              stage_id: stageID,
            })
          }
          okCount++
        } catch {
          failCount++
        }
      }
      if (failCount === 0) {
        toast.success(`Moved ${okCount} lead${okCount === 1 ? '' : 's'}`)
      } else {
        toast.error(`Moved ${okCount}, failed ${failCount}`)
      }
      setSelectedIDs(new Set())
      qc.invalidateQueries({ queryKey: crmKeys.dealsByPipeline(defaultPipeline.id) })
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
    },
  })

  const bulkSetStatus = useMutation({
    mutationFn: async (status: string) => {
      const ids = Array.from(selectedIDs)
      let okCount = 0
      for (const leadID of ids) {
        try {
          await updateLead(leadID, { status })
          okCount++
        } catch {
          // best-effort
        }
      }
      toast.success(`Status updated on ${okCount} lead${okCount === 1 ? '' : 's'}`)
      setSelectedIDs(new Set())
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
    },
  })

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIDs)
      let okCount = 0
      for (const leadID of ids) {
        try {
          await deleteLead(leadID)
          okCount++
        } catch {
          // best-effort
        }
      }
      toast.success(`Deleted ${okCount} lead${okCount === 1 ? '' : 's'}`)
      setSelectedIDs(new Set())
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
      if (defaultPipeline) {
        qc.invalidateQueries({ queryKey: crmKeys.dealsByPipeline(defaultPipeline.id) })
      }
    },
  })

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Pipeline kanban — capture, qualify, and close leads from your WhatsApp chats."
        right={
          <div className="flex items-center gap-2">
            <Link
              to="/admin/crm/pipelines"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         text-sm font-medium border border-slate-300 dark:border-slate-700
                         bg-white dark:bg-[var(--input-bg)]
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-700 dark:text-slate-200"
            >
              <Settings2 className="w-3.5 h-3.5" /> Pipelines
            </Link>
            <Link
              to="/admin/crm/sequences"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         text-sm font-medium border border-slate-300 dark:border-slate-700
                         bg-white dark:bg-[var(--input-bg)]
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-700 dark:text-slate-200"
            >
              <Mail className="w-3.5 h-3.5" /> Sequences
            </Link>
            <PrimaryButton onClick={() => setShowNew(true)}>
              <Plus className="w-4 h-4" /> New lead
            </PrimaryButton>
          </div>
        }
      />

      {/* Toolbar */}
      <Card className="mb-4">
        <div className="p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { v: 'all', label: 'All' },
              { v: 'new', label: 'New' },
              { v: 'contacted', label: 'Contacted' },
              { v: 'qualified', label: 'Qualified' },
              { v: 'converted', label: 'Won' },
              { v: 'lost', label: 'Lost' },
            ].map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setStatusFilter(f.v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                           border transition-colors
                           ${statusFilter === f.v
                             ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                             : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Kanban */}
      {pipelines.isLoading || leads.isLoading ? <Spinner /> :
       pipelines.isError ? <ErrorBox msg={(pipelines.error as any)?.message || 'Failed to load pipelines'} /> :
       leads.isError ? <ErrorBox msg={(leads.error as any)?.message || 'Failed to load leads'} /> :
       !defaultPipeline ? <Empty>No pipeline yet. Click "Pipelines" to create one.</Empty> :
       <KanbanBoard
         pipeline={defaultPipeline}
         leads={leads.data?.items || []}
         dealsByLead={dealsByLead}
         selectedIDs={selectedIDs}
         onToggleSelect={(id) => setSelectedIDs((prev) => {
           const next = new Set(prev)
           if (next.has(id)) next.delete(id); else next.add(id)
           return next
         })}
         onSelectAll={(ids) => setSelectedIDs(new Set(ids))}
         onClearSelection={() => setSelectedIDs(new Set())}
       />}

      {/* Bulk action bar */}
      {defaultPipeline && (
        <CRMBulkBar
          count={selectedIDs.size}
          stages={defaultPipeline.stages}
          pipelineID={defaultPipeline.id}
          onMoveToStage={async (stageID) => { await bulkMoveToStage.mutateAsync(stageID) }}
          onSetStatus={async (status) => { await bulkSetStatus.mutateAsync(status) }}
          onDelete={async () => { await bulkDelete.mutateAsync() }}
          onClear={() => setSelectedIDs(new Set())}
        />
      )}

      {/* New lead modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
             onClick={() => setShowNew(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-md rounded-lg border border-slate-200 dark:border-white/10
                       bg-white dark:bg-[#0a1124] shadow-xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">New lead</h2>
              <button onClick={() => setShowNew(false)}
                className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <Field k="Phone *" v={
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="919876543210" />
            } />
            <Field k="Name" v={
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Rohit Sharma" />
            } />
            <Field k="Email" v={
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="r@example.com" />
            } />
            <div className="flex items-center justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setShowNew(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => createLeadMut.mutate()} disabled={!newPhone || createLeadMut.isPending}>
                {createLeadMut.isPending ? 'Creating…' : 'Create'}
              </PrimaryButton>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}

// ----------------------------------------------------------------------------
// Kanban board — real deal-by-stage
// ----------------------------------------------------------------------------

function KanbanBoard({
  pipeline, leads, dealsByLead, selectedIDs, onToggleSelect, onSelectAll, onClearSelection,
}: {
  pipeline: CRMPipeline
  leads: CRMLead[]
  dealsByLead: Map<number, CRMDealListItem>
  selectedIDs: Set<number>
  onToggleSelect: (leadID: number) => void
  onSelectAll: (leadIDs: number[]) => void
  onClearSelection: () => void
}) {
  const qc = useQueryClient()
  // Local query for grouping by stage (so we don't depend on the
  // parent's Map).
  const dealsQ = useQuery({
    queryKey: crmKeys.dealsByPipeline(pipeline.id),
    queryFn: () => listDealsByPipeline(pipeline.id),
    refetchInterval: 10_000,
  })

  // Group deals by stage_id for the columns.
  const dealsByStage = useMemo(() => {
    const m = new Map<number, CRMDealListItem[]>()
    for (const d of dealsQ.data?.items || []) {
      const arr = m.get(d.stage_id) || []
      arr.push(d)
      m.set(d.stage_id, arr)
    }
    return m
  }, [dealsQ.data])

  // IDs of leads visible across the kanban + the no-deal strip.
  const visibleLeadIDs = useMemo(() => {
    const s = new Set<number>()
    for (const d of dealsQ.data?.items || []) s.add(d.lead_id)
    for (const l of leads) s.add(l.id)
    return Array.from(s)
  }, [dealsQ.data, leads])

  // Drag-drop: drag a lead (whether it has a deal or not) into a
  // column. If the lead already has a deal, move it; otherwise
  // create one in the destination stage.
  const [draggingLeadID, setDraggingLeadID] = useState<number | null>(null)
  async function handleDrop(stageID: number) {
    if (draggingLeadID == null) return
    setDraggingLeadID(null)
    try {
      const existing = dealsByLead.get(draggingLeadID)
      if (existing) {
        if (existing.stage_id === stageID) return
        await moveDealStage(existing.id, { stage_id: stageID })
        toast.success(`Moved to ${pipeline.stages.find((s) => s.id === stageID)?.name}`)
      } else {
        await createDeal({ lead_id: draggingLeadID, pipeline_id: pipeline.id, stage_id: stageID })
        toast.success('Created deal in stage')
      }
      qc.invalidateQueries({ queryKey: crmKeys.dealsByPipeline(pipeline.id) })
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Move failed')
    }
  }

  return (
    <div>
      {/* Select-all / clear toolbar */}
      <div className="flex items-center justify-end gap-2 mb-2 text-xs">
        {selectedIDs.size > 0 ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          >
            Clear selection
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSelectAll(visibleLeadIDs)}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          >
            Select all visible ({visibleLeadIDs.length})
          </button>
        )}
      </div>

      {dealsQ.isLoading ? <Spinner /> :
       dealsQ.isError ? <ErrorBox msg={(dealsQ.error as any)?.message || 'Failed to load deals'} /> :
       <div className="flex gap-3 overflow-x-auto pb-4">
         {pipeline.stages.map((stage) => {
           const cards = dealsByStage.get(stage.id) || []
           return (
             <div
               key={stage.id}
               className="shrink-0 w-72 rounded-lg border border-slate-200 dark:border-white/10
                          bg-slate-50/40 dark:bg-white/[0.02] p-3"
               onDragOver={(e) => e.preventDefault()}
               onDrop={() => handleDrop(stage.id)}
             >
               <div className="flex items-center gap-2 mb-3">
                 <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color || '#94a3b8' }} />
                 <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{stage.name}</span>
                 <PillPop className="pill-slate !text-[9px] ml-auto">
                   {cards.length} deal{cards.length === 1 ? '' : 's'}
                 </PillPop>
               </div>
               <ul className="space-y-2 min-h-[60px]">
                 {cards.map((d) => (
                   <DealCard
                     key={d.id}
                     deal={d}
                     selected={selectedIDs.has(d.lead_id)}
                     onToggle={() => onToggleSelect(d.lead_id)}
                     onDragStart={() => setDraggingLeadID(d.lead_id)}
                     onDragEnd={() => setDraggingLeadID(null)}
                   />
                 ))}
                 {cards.length === 0 && (
                   <li className="text-[11px] text-slate-400 dark:text-slate-500 italic text-center py-3">
                     Drop a lead here
                   </li>
                 )}
               </ul>
             </div>
           )
         })}
       </div>}

      {/* Leads without a deal — draggable into any column */}
      {leads.length > 0 && (
        <LeadsWithoutDealStrip
          leads={leads}
          dealsByLead={dealsByLead}
          selectedIDs={selectedIDs}
          onToggleSelect={onToggleSelect}
          onDragStart={(id) => setDraggingLeadID(id)}
          onDragEnd={() => setDraggingLeadID(null)}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Deal card
// ----------------------------------------------------------------------------

function DealCard({
  deal, selected, onToggle, onDragStart, onDragEnd,
}: {
  deal: CRMDealListItem
  selected: boolean
  onToggle: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative rounded-md border ${selected
        ? 'border-emerald-400 dark:border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10'
        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03]'}
        p-2.5 text-xs hover:shadow-sm cursor-grab active:cursor-grabbing transition-shadow`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="w-3 h-3 mt-0.5 text-slate-300 dark:text-slate-600 shrink-0" />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className={`shrink-0 w-4 h-4 rounded border ${selected
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-slate-300 dark:border-white/20 bg-white dark:bg-transparent'}
            grid place-items-center`}
          title={selected ? 'Unselect' : 'Select'}
        >
          {selected && <Check className="w-3 h-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Link to={`/admin/crm/leads/${deal.lead_id}`}
                  className="font-semibold text-slate-900 dark:text-white truncate hover:underline">
              {deal.lead_name || deal.lead_phone}
            </Link>
            {deal.lead_score > 0 && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-mono text-emerald-700 dark:text-emerald-300">
                <TrendingUp className="w-2.5 h-2.5" />{deal.lead_score}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                         transition-colors p-0.5 -mr-0.5 rounded"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Phone className="w-2.5 h-2.5" />{deal.lead_phone}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
            {deal.value != null && (
              <span className="font-mono text-emerald-700 dark:text-emerald-300">
                {deal.currency} {deal.value.toLocaleString()}
              </span>
            )}
            <span className="ml-auto">{fmtAge(deal.age_seconds)}</span>
          </div>
        </div>
      </div>
      {menuOpen && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-7 z-10 min-w-[180px] rounded-md
                     bg-white dark:bg-slate-800
                     border border-slate-200 dark:border-slate-700
                     shadow-lg py-1"
        >
          <Link
            to={`/admin/crm/leads/${deal.lead_id}`}
            onClick={() => setMenuOpen(false)}
            className="block w-full text-left px-3 py-1.5 text-xs
                       text-slate-700 dark:text-slate-200
                       hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            View lead
          </Link>
          <FollowUpMenuItem
            lead={{ id: deal.lead_id, name: deal.lead_name || '', phone: deal.lead_phone || '' }}
            variant="menuItem"
            onPicked={() => setMenuOpen(false)}
          />
        </div>
      )}
    </li>
  )
}

// ----------------------------------------------------------------------------
// Leads without a deal — draggable into any column
// ----------------------------------------------------------------------------

function LeadsWithoutDealStrip({
  leads, dealsByLead, selectedIDs, onToggleSelect, onDragStart, onDragEnd,
}: {
  leads: CRMLead[]
  dealsByLead: Map<number, CRMDealListItem>
  selectedIDs: Set<number>
  onToggleSelect: (id: number) => void
  onDragStart: (id: number) => void
  onDragEnd: () => void
}) {
  const without = leads.filter((l) => !dealsByLead.has(l.id))
  if (without.length === 0) return null
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-200 dark:border-white/10
                    bg-slate-50/30 dark:bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
        Leads without a deal · drag into a column
      </div>
      <ul className="flex flex-wrap gap-2">
        {without.map((l) => (
          <li
            key={l.id}
            draggable
            onDragStart={() => onDragStart(l.id)}
            onDragEnd={onDragEnd}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs
                       border ${selectedIDs.has(l.id)
                         ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                         : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03]'}
                       cursor-grab active:cursor-grabbing`}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleSelect(l.id) }}
              className={`shrink-0 w-3.5 h-3.5 rounded border ${selectedIDs.has(l.id)
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-slate-300 dark:border-white/20 bg-white dark:bg-transparent'}
                grid place-items-center`}
              title={selectedIDs.has(l.id) ? 'Unselect' : 'Select'}
            >
              {selectedIDs.has(l.id) && <Check className="w-2.5 h-2.5" />}
            </button>
            <GripVertical className="w-3 h-3 text-slate-300 dark:text-slate-600" />
            <Link to={`/admin/crm/leads/${l.id}`} className="text-slate-800 dark:text-slate-100 hover:underline truncate max-w-[180px]">
              {l.name || l.phone}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// fmtAge renders a "days in stage" string. 3600s = 1h, 86400s = 1d.
function fmtAge(seconds: number): string {
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m in stage`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h in stage`
  return `${Math.floor(seconds / 86400)}d in stage`
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
    </div>
  )
}

// unused-import guard so the linter stays quiet.
const _ = { Briefcase, TextArea, CardHeader: true, SecondaryButton: true, PageHeader: true, Input: true, Card: true, Empty: true, ErrorBox: true, Spinner: true, fmtRelative: true, useQuery: true, useMutation: true, toast: true, motion: true }
void _