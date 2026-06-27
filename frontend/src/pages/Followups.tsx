import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Search, RefreshCw, ExternalLink, Bot, Layers, MessageSquare,
  CheckCircle2, X, FileText, Sparkles, AlertTriangle,
  ArrowRight, Clock3, Users,
} from 'lucide-react'
import {
  Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner,
} from '@/components/ui'
import { batchDisplayName, fmtRelative } from '@/lib/format'
import {
  AIFollowupLastMessage, AIFollowupStatusBadge, AIFollowupStatusCounts,
} from '@/components/AIFollowupParts'
import DuplicatePhonesWarningModal from '@/components/DuplicatePhonesWarningModal'
import {
  approveBatch, putBatchAIFollowup, batchAIKeys, listBatchAIFollowups,
  preflightBatchAIFollowupDuplicates, startBatchAIFollowupSequence,
  type ListFollowupsParams,
} from '@/lib/batchAI'
import { api } from '@/lib/api'
import type {
  BatchAIFollowupDuplicate, BatchAIRecipient, BatchFollowupConfig,
  FollowupBehavior, FollowupTone, StartBatchFollowupOpts,
  StartBatchFollowupResult, Template, UploadBatch,
} from '@/lib/types'

const emptyFollowupOpts: StartBatchFollowupOpts = { excludePhones: [], overridePhones: [] }

// State machine for the Enable-AI modal flow.
//   config     — admin is filling in behavior + cadence + tone.
//   duplicates — admin is reviewing phones that already have an
//                follow-up on another batch and choosing which to
//                exclude. The validated `config` is carried forward
//                so the warning modal can pass it to the confirm
//                POST without re-collecting from the user.
//   null       — no modal.
type EnableStage =
  | { kind: 'checking'; batchId: number }
  | { kind: 'review'; batchId: number; freshCount: number }
  | { kind: 'config'; batchId: number; opts: StartBatchFollowupOpts; freshCount: number }
  | { kind: 'duplicates'; batchId: number; duplicates: BatchAIFollowupDuplicate[]; freshCount: number }
  | { kind: 'no_valid'; batchId: number; message: string }
  | null

type BatchCommandSummary = {
  id: number
  batch?: UploadBatch
  enabled: boolean
  fileName: string
  status: string
  createdAt?: string | null
  enabledAt?: string | null
  validRows: number
  totalRows: number
  recipients: BatchAIRecipient[]
  counts: Record<string, number>
  latestActivity?: string | null
  latestMessage?: BatchAIRecipient
}

/**
 * /admin/ai/followups — operator queue across every batch where the
 * admin has enabled AI follow-up.
 *
 * One full-width table (no split-pane — the user clicks a row to
 * jump to /admin/ai/conversations?phone=… for the thread). Polls
 * every 5s so pending → active transitions feel live.
 *
 * Filters: status pill, batch select (synthesized from currently
 * loaded rows — no separate endpoint), free-text search over
 * retailer name + phone. The server handles status / batch / search
 * via query params; we keep a local 250ms debounce on the search
 * input to avoid hammering the API on every keystroke.
 */
export default function Followups() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [batchFilter, setBatchFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // Modal state for the per-row "Approve batch" flow. We keep the
  // target batch id here so the modal can render its own header.
  const [approveFor, setApproveFor] = useState<{ id: number; label: string } | null>(null)
  // Enable-AI modal state machine. See EnableStage above. The
  // parent hoists the startBatchAIFollowupSequence mutation so the
  // config modal and the duplicate-phones warning modal can share
  // it — the warning modal confirms with the same mutation but
  // passes an `excludes` list alongside the config.
  const [enableStage, setEnableStage] = useState<EnableStage>(null)

  // Debounce the search input. 250ms is the sweet spot: long enough
  // to skip mid-word typing, short enough that the UI feels live.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const params: ListFollowupsParams = useMemo(() => {
    const p: ListFollowupsParams = { limit: 200 }
    if (statusFilter !== 'all') p.status = statusFilter
    if (batchFilter !== 'all') p.batch_id = Number(batchFilter)
    if (debouncedSearch) p.search = debouncedSearch
    return p
  }, [statusFilter, batchFilter, debouncedSearch])

  const list = useQuery({
    queryKey: batchAIKeys.followups(params),
    queryFn: () => listBatchAIFollowups(params),
    refetchInterval: 5_000,
  })

  const batchesQ = useQuery({
    queryKey: ['batches', 'ai-followup-hub'],
    queryFn: async () => {
      const { data } = await api.get('/api/batches', { params: { limit: 500 } })
      const rows = Array.isArray(data) ? data : (data?.items || [])
      return rows as UploadBatch[]
    },
    refetchInterval: 15_000,
  })

  const items: BatchAIRecipient[] = list.data?.items || []
  const total = list.data?.total ?? items.length
  const summaries = useMemo(
    () => buildBatchSummaries(batchesQ.data || [], items),
    [batchesQ.data, items],
  )
  const batchLookup = useMemo(() => {
    const map = new Map<number, BatchCommandSummary>()
    for (const s of summaries) map.set(s.id, s)
    return map
  }, [summaries])

  const filteredSummaries = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return summaries.filter((s) => {
      if (batchFilter !== 'all' && s.id !== Number(batchFilter)) return false
      if (statusFilter === 'disabled' && s.enabled && (s.counts.disabled || 0) === 0) return false
      if (statusFilter !== 'all' && statusFilter !== 'disabled' && (s.counts[statusFilter] || 0) === 0) return false
      if (!q) return true
      const sample = s.recipients
        .slice(0, 6)
        .map((r) => `${r.retailer_name || ''} ${r.whatsapp_number} ${r.last_message_preview || ''}`)
        .join(' ')
      return [
        s.id,
        s.fileName,
        s.status,
        sample,
      ].join(' ').toLowerCase().includes(q)
    })
  }, [summaries, debouncedSearch, batchFilter, statusFilter])

  // Synthesize the per-batch filter options from the currently
  // loaded data. We merge the active filter (even if no row matches
  // it anymore) so the dropdown doesn't reset to "all" the moment
  // the user picks a batch that returns zero rows. This avoids a
  // jarring reset when filtering narrows to empty.
  const batchOptions = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of summaries) {
      if (!map.has(s.id)) map.set(s.id, s.fileName || `Batch #${s.id}`)
    }
    if (batchFilter !== 'all' && !map.has(Number(batchFilter))) {
      map.set(Number(batchFilter), `Batch #${batchFilter}`)
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, label]) => ({ id, label }))
  }, [summaries, batchFilter])

  // Roll-up status counts. Computed from the current page (not the
  // total) — good enough for an "at a glance" header chip; the
  // server side still does the authoritative filter.
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of items) {
      out[r.ai_status] = (out[r.ai_status] || 0) + 1
    }
    return out
  }, [items])

  const filterActive =
    statusFilter !== 'all' || batchFilter !== 'all' || debouncedSearch.length > 0

  function reset() {
    setStatusFilter('all')
    setBatchFilter('all')
    setSearch('')
    setDebouncedSearch('')
  }

  // Shared start-sequence mutation. Both the Enable-AI config modal
  // and the DuplicatePhonesWarningModal trigger this — the config
  // modal calls it directly with an empty excludes list (when no
  // duplicates exist), and the warning modal calls it with the
  // admin's per-phone exclusion set.
  const qc = useQueryClient()
  const startMut = useMutation<
    StartBatchFollowupResult,
    any,
    { batchId: number; cfg: BatchFollowupConfig; opts: StartBatchFollowupOpts }
  >({
    mutationFn: async ({ batchId, cfg, opts }) => {
      return await startBatchAIFollowupSequence(batchId, cfg, opts)
    },
    onSuccess: (d, vars) => {
      const parts: string[] = []
      parts.push(`AI follow-up enabled for batch #${vars.batchId}`)
      if (d.count > 0) {
        parts.push(`started ${d.count} follow-up${d.count === 1 ? '' : 's'}`)
      }
      const totalOps = vars.opts.excludePhones.length + vars.opts.overridePhones.length
      if (totalOps > 0) {
        const bits: string[] = []
        if (vars.opts.excludePhones.length > 0) bits.push(`excluded ${vars.opts.excludePhones.length}`)
        if (vars.opts.overridePhones.length > 0) bits.push(`overrode ${vars.opts.overridePhones.length}`)
        parts.push(`${bits.join(', ')} phone${totalOps === 1 ? '' : 's'}`)
      }
      toast.success(parts.join(' — '))
      qc.invalidateQueries({ queryKey: batchAIKeys.followups() })
      qc.invalidateQueries({ queryKey: batchAIKeys.followup(vars.batchId) })
      qc.invalidateQueries({ queryKey: ['batches', 'eligible-for-ai'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['crm', 'sequences', 'runs'] })
      setEnableStage(null)
    },
    onError: (e: any, vars) => {
      const status = e?.response?.status
      const code = e?.response?.data?.error
      if (status === 422 && code === 'no_valid_recipients') {
        setEnableStage({
          kind: 'no_valid',
          batchId: vars?.batchId ?? 0,
          message: e?.response?.data?.message || 'This batch has no valid WhatsApp numbers to track.',
        })
        return
      }
      toast.error(
        e?.response?.data?.message || e?.response?.data?.error || 'Failed to start follow-up sequence',
      )
    },
  })

  async function openEnableFlow(batchId: number) {
    setEnableStage({ kind: 'checking', batchId })
    try {
      const dups = await preflightBatchAIFollowupDuplicates(batchId)
      if (dups.total > 0) {
        setEnableStage({
          kind: 'duplicates',
          batchId,
          duplicates: dups.duplicates,
          freshCount: dups.fresh_count,
        })
      } else if (dups.fresh_count <= 0) {
        setEnableStage({
          kind: 'no_valid',
          batchId,
          message: 'This batch has no valid WhatsApp numbers to track, so the AI agent will not see any recipients.',
        })
      } else {
        setEnableStage({ kind: 'review', batchId, freshCount: dups.fresh_count })
      }
    } catch (e: any) {
      setEnableStage(null)
      toast.error(
        e?.response?.data?.message || e?.response?.data?.error || 'Failed to check for duplicate phones',
      )
    }
  }

  function handleEnableConfirm(batchId: number, cfg: BatchFollowupConfig, opts: StartBatchFollowupOpts) {
    startMut.mutate({ batchId, cfg, opts })
  }

  function batchLabelFor(batchId: number) {
    return batchLookup.get(batchId)?.fileName || `Batch #${batchId}`
  }

  return (
    <>
      <PageHeader
        title="AI Follow-up Batches"
        subtitle="Open a batch to manage its AI assistant, knowledge, recipients, timeline, and next follow-up plan."
        right={
          <div className="flex items-center gap-2">
            <AIFollowupStatusCounts counts={counts} />
            <button
              type="button"
              onClick={() => {
                list.refetch()
                batchesQ.refetch()
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="Refresh now"
            >
              <RefreshCw className={`w-4 h-4 ${list.isFetching || batchesQ.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <Card hover={false} className="!p-0 mb-5">
        <div className="flex items-center gap-3 flex-wrap px-4 py-3">
          <StatusPills value={statusFilter} onChange={setStatusFilter} />

          <div className="h-5 w-px bg-slate-200 dark:bg-white/10" />

          <label className="inline-flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
            <Layers className="w-3.5 h-3.5" />
            <span>Batch</span>
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md px-2 py-1 text-[12px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            >
              <option value="all">All batches</option>
              {batchOptions.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </label>

          <div className="h-5 w-px bg-slate-200 dark:bg-white/10" />

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search batch, retailer, phone..."
              className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </div>

          {filterActive && (
            <SecondaryButton onClick={reset}>
              Reset
            </SecondaryButton>
          )}

          <div className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">
            {list.isSuccess ? (
              <>Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{items.length}</span> of {total}</>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Body */}
      <BatchCommandList
        batches={filteredSummaries}
        loading={batchesQ.isLoading || list.isLoading}
        error={
          batchesQ.isError
            ? ((batchesQ.error as any)?.response?.data?.error || 'Failed to load batches')
            : list.isError
              ? ((list.error as any)?.response?.data?.error || 'Failed to load follow-ups')
              : ''
        }
        filterActive={filterActive}
        onEnable={openEnableFlow}
      />

      <Card hover={false}>
        <CardHeader
          title="Recipient activity feed"
          subtitle={
            filterActive
              ? 'Filtered. Reset to see everything.'
              : 'Live recipient-level activity across all AI follow-up batches. Polls every 5s.'
          }
        />
        {list.isLoading && <div className="p-6"><Spinner /></div>}
        {list.isError && (
          <div className="p-5 pt-0">
            <ErrorBox msg={(list.error as any)?.response?.data?.error || 'Failed to load follow-ups'} />
          </div>
        )}
        {list.isSuccess && items.length === 0 && (
          <div className="p-6">
            <Empty>
              {filterActive
                ? 'No recipients match these filters.'
                : (
                  <span className="inline-flex flex-col items-center gap-2 text-center">
                    <Bot className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <span>No AI follow-ups yet.</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      Toggle AI follow-up on a batch from the{' '}
                      <Link to="/admin/upload" className="text-emerald-600 dark:text-emerald-400 hover:underline">Upload</Link>
                      {' '}page.
                    </span>
                  </span>
                )
              }
            </Empty>
          </div>
        )}
        {list.isSuccess && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                <tr>
                  <Th>Retailer</Th>
                  <Th>WhatsApp</Th>
                  <Th>Batch</Th>
                  <Th>Status</Th>
                  <Th>AI details</Th>
                  <Th>Last message</Th>
                  <Th>Last event</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.2 }}
                    whileHover={{ backgroundColor: 'rgba(148,163,184,0.08)' }}
                    className="border-t border-slate-100 dark:border-white/10"
                  >
                    <Td>{r.retailer_name || '—'}</Td>
                    <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/admin/ai/followups/batches/${r.batch_id}`}
                          className="max-w-[220px] truncate text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1"
                          title={`${batchLabelFor(r.batch_id)} (Batch #${r.batch_id})`}
                        >
                          {batchLabelFor(r.batch_id)}
                        </Link>
                        <Link
                          to={`/admin/ai/followups/batches/${r.batch_id}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md
                                     border border-slate-200 dark:border-white/10
                                     text-slate-600 dark:text-slate-300
                                     hover:bg-slate-50 dark:hover:bg-white/5
                                     transition-colors"
                          title="Open the batch AI control center"
                        >
                          <Bot className="w-3 h-3" /> Control
                        </Link>
                        {/* Per-row "Approve batch" trigger. The server
                            returns 409 with a clear message if the
                            batch is already approved/sending/etc., so
                            the button is safe to show on every row. */}
                        <button
                          type="button"
                          onClick={() => setApproveFor({ id: r.batch_id, label: batchLabelFor(r.batch_id) })}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md
                                     border border-emerald-200/80 dark:border-emerald-400/30
                                     text-emerald-700 dark:text-emerald-300
                                     hover:bg-emerald-50 dark:hover:bg-emerald-500/10
                                     transition-colors"
                          title="Approve this batch — picks an active template, then queues the messages and unlocks AI follow-up"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Approve batch
                        </button>
                      </div>
                    </Td>
                    <Td><AIFollowupStatusBadge status={r.ai_status} /></Td>
                    <Td>
                      <Link
                        to={`/admin/ai/followups/recipients/${r.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        <Bot className="w-3 h-3" /> AI timeline <ExternalLink className="w-3 h-3" />
                      </Link>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Agent, retailer, schedule
                      </div>
                    </Td>
                    <Td><AIFollowupLastMessage r={r} /></Td>
                    <Td><LastEventCell r={r} /></Td>
                    <Td>
                      <Link
                        to={`/admin/ai/conversations?phone=${encodeURIComponent(r.whatsapp_number)}`}
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        <MessageSquare className="w-3 h-3" /> Open chat <ExternalLink className="w-3 h-3" />
                      </Link>
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {approveFor !== null && (
        <ApproveBatchModal
          batchId={approveFor.id}
          batchLabel={approveFor.label}
          onClose={() => setApproveFor(null)}
        />
      )}
      {enableStage?.kind === 'checking' && (
        <EnableFlowStatusModal
          title={`Checking batch #${enableStage.batchId}`}
          body="Looking for phone numbers that already have AI follow-up in another batch."
          onClose={() => setEnableStage(null)}
        />
      )}
      {enableStage?.kind === 'review' && (
        <EnablePreflightReadyModal
          batchId={enableStage.batchId}
          freshCount={enableStage.freshCount}
          onClose={() => setEnableStage(null)}
          onContinue={() => setEnableStage({
            kind: 'config',
            batchId: enableStage.batchId,
            freshCount: enableStage.freshCount,
            opts: emptyFollowupOpts,
          })}
        />
      )}
      {enableStage?.kind === 'config' && (
        <EnableAIWithScheduleModal
          batchId={enableStage.batchId}
          isSubmitting={startMut.isPending}
          onClose={() => setEnableStage(null)}
          onConfirm={(cfg) => handleEnableConfirm(enableStage.batchId, cfg, enableStage.opts)}
        />
      )}
      {enableStage?.kind === 'duplicates' && (
        <DuplicatePhonesWarningModal
          batchId={enableStage.batchId}
          duplicates={enableStage.duplicates}
          freshCount={enableStage.freshCount}
          isSubmitting={false}
          onClose={() => setEnableStage(null)}
          confirmActionLabel="Continue to setup"
          onConfirm={(excludes, overrides) => setEnableStage({
            kind: 'config',
            batchId: enableStage.batchId,
            freshCount: enableStage.freshCount,
            opts: { excludePhones: excludes, overridePhones: overrides },
          })}
        />
      )}
      {enableStage?.kind === 'no_valid' && (
        <NoValidRecipientsModal
          batchId={enableStage.batchId}
          message={enableStage.message}
          onClose={() => setEnableStage(null)}
        />
      )}
    </>
  )
}

function EnableFlowStatusModal({
  title,
  body,
  onClose,
}: {
  title: string
  body: string
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-md admin-card rounded-2xl p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Spinner />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-white">{title}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function EnablePreflightReadyModal({
  batchId,
  freshCount,
  onClose,
  onContinue,
}: {
  batchId: number
  freshCount: number
  onClose: () => void
  onContinue: () => void
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-lg admin-card rounded-2xl p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                Ready to enable AI for batch #{batchId}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                No phone numbers in this batch are currently owned by another active batch AI follow-up.
              </div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <Users className="w-4 h-4" />
                {freshCount} valid recipient{freshCount === 1 ? '' : 's'} will be considered
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton onClick={onContinue}>
              <ArrowRight className="w-4 h-4" /> Continue to setup
            </PrimaryButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function NoValidRecipientsModal({
  batchId,
  message,
  onClose,
}: {
  batchId: number
  message: string
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-lg admin-card rounded-2xl p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                No valid WhatsApp numbers in batch #{batchId}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {message}
              </div>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Upload rows with valid WhatsApp numbers, or fix the invalid rows in the batch before enabling AI follow-up.
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <PrimaryButton onClick={onClose}>Got it</PrimaryButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function BatchCommandList({
  batches, loading, error, filterActive, onEnable,
}: {
  batches: BatchCommandSummary[]
  loading: boolean
  error: string
  filterActive: boolean
  onEnable: (batchId: number) => void
}) {
  return (
    <Card hover={false} className="!p-0 mb-5 overflow-hidden">
      {loading && <div className="p-6"><Spinner /></div>}
      {error && <div className="p-5 pt-0"><ErrorBox msg={error} /></div>}
      {!loading && !error && batches.length === 0 && (
        <div className="p-6">
          <Empty>
            {filterActive
              ? 'No batches match these filters.'
              : (
                <span className="inline-flex flex-col items-center gap-2 text-center">
                  <Bot className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  <span>No batches are ready for AI follow-up yet.</span>
                  <span className="text-slate-500 dark:text-slate-400">Upload and approve a batch, then enable AI follow-up from here.</span>
                </span>
              )
            }
          </Empty>
        </div>
      )}
      {!loading && !error && batches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
              <tr>
                <Th>Batch</Th>
                <Th>AI state</Th>
                <Th>Recipients</Th>
                <Th>Latest message</Th>
                <Th>Last activity</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <motion.tr
                  key={b.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.2 }}
                  className="border-t border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <Td>
                    <div className="min-w-[220px]">
                      <Link
                        to={`/admin/ai/followups/${b.id}`}
                        className="font-semibold text-slate-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-300"
                        title={`${b.fileName} (Batch #${b.id})`}
                      >
                        {b.fileName}
                      </Link>
                      <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate max-w-[320px]">
                        Batch #{b.id}
                      </div>
                      <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <FileText className="w-3 h-3" />
                        <span className="capitalize">{b.status || 'unknown'}</span>
                        {b.createdAt && <span>{fmtRelative(b.createdAt)}</span>}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="space-y-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wider
                        ${b.enabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20'
                          : 'bg-slate-50 text-slate-600 border-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:border-white/15'}`}
                      >
                        {b.enabled ? 'Enabled' : 'Off'}
                      </span>
                      {b.enabledAt && <div className="text-[10px] text-slate-400 dark:text-slate-500">since {fmtRelative(b.enabledAt)}</div>}
                    </div>
                  </Td>
                  <Td>
                    <div className="min-w-[180px] space-y-1.5">
                      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                        <Users className="w-4 h-4 text-slate-400" />
                        {b.recipients.length || b.validRows || 0}
                        <span className="font-normal text-xs text-slate-500 dark:text-slate-400">tracked / valid</span>
                      </div>
                      <AIFollowupStatusCounts counts={b.counts} />
                    </div>
                  </Td>
                  <Td>
                    {b.latestMessage ? (
                      <AIFollowupLastMessage r={b.latestMessage} maxWidth={300} />
                    ) : (
                      <span className="text-[12px] text-slate-400 dark:text-slate-500">No conversation yet</span>
                    )}
                  </Td>
                  <Td>
                    <div className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                      <Clock3 className="w-3.5 h-3.5 text-slate-400" />
                      {b.latestActivity ? fmtRelative(b.latestActivity) : 'No activity'}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {b.enabled ? (
                        <Link to={`/admin/ai/followups/${b.id}`}>
                          <PrimaryButton>
                            Details <ArrowRight className="w-4 h-4" />
                          </PrimaryButton>
                        </Link>
                      ) : (
                        <SecondaryButton onClick={() => onEnable(b.id)}>
                          <Bot className="w-4 h-4" /> Enable AI
                        </SecondaryButton>
                      )}
                    </div>
                  </Td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function buildBatchSummaries(batches: UploadBatch[], recipients: BatchAIRecipient[]): BatchCommandSummary[] {
  const map = new Map<number, BatchCommandSummary>()

  for (const b of batches) {
    const shouldShow =
      b.ai_followup_enabled ||
      ['approved', 'sending', 'sent', 'completed'].includes(b.status)
    if (!shouldShow) continue
    map.set(b.id, {
      id: b.id,
      batch: b,
      enabled: !!b.ai_followup_enabled,
      fileName: batchDisplayName(b),
      status: b.status || 'unknown',
      createdAt: b.created_at,
      enabledAt: b.ai_followup_enabled_at,
      validRows: b.valid_rows || 0,
      totalRows: b.total_rows || 0,
      recipients: [],
      counts: {},
    })
  }

  for (const r of recipients) {
    let s = map.get(r.batch_id)
    if (!s) {
      s = {
        id: r.batch_id,
        enabled: true,
        fileName: `Batch #${r.batch_id}`,
        status: 'ai follow-up',
        validRows: 0,
        totalRows: 0,
        recipients: [],
        counts: {},
      }
      map.set(r.batch_id, s)
    }
    s.recipients.push(r)
    s.counts[r.ai_status] = (s.counts[r.ai_status] || 0) + 1
    const eventAt = r.last_message_at || r.last_event_at || r.updated_at
    if (eventAt && timeValue(eventAt) > timeValue(s.latestActivity)) {
      s.latestActivity = eventAt
    }
    if (r.last_message_preview && timeValue(r.last_message_at) > timeValue(s.latestMessage?.last_message_at)) {
      s.latestMessage = r
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const aTime = timeValue(a.latestActivity || a.enabledAt || a.createdAt)
    const bTime = timeValue(b.latestActivity || b.enabledAt || b.createdAt)
    return bTime - aTime || b.id - a.id
  })
}

function timeValue(s?: string | null): number {
  if (!s) return 0
  const n = new Date(s).getTime()
  return Number.isFinite(n) ? n : 0
}

// StatusPills — the same pattern used by Conversations.tsx.
// `all` is a special case; the rest are ai_status values.
function StatusPills({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pills: { key: string; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'pending',   label: 'Pending' },
    { key: 'active',    label: 'Active' },
    { key: 'handed_off',label: 'Handed off' },
    { key: 'opted_out', label: 'Opted out' },
    { key: 'failed',    label: 'Failed' },
    { key: 'excluded',  label: 'Excluded' },
    { key: 'disabled',  label: 'Disabled' },
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {pills.map((p) => {
        const active = value === p.key
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={`px-2.5 py-1 text-[12px] font-medium rounded-full border transition-colors
                        ${active
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'}`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function LastEventCell({ r }: { r: BatchAIRecipient }) {
  if (!r.last_event_at && !r.last_event) {
    return <span className="text-[12px] text-slate-400 dark:text-slate-500">—</span>
  }
  return (
    <div className="max-w-[200px]">
      {r.last_event && (
        <div className="text-[12px] text-slate-700 dark:text-slate-200 truncate" title={r.last_event}>
          {r.last_event}
        </div>
      )}
      {r.last_event_at && (
        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          {fmtRelative(r.last_event_at)}
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }

// ApproveBatchModal — a small template-picker modal opened from each
// row's "Approve batch" button. The user picks one of their active
// templates (name + language is encoded as "name|language" so the
// pick and the language stay in sync), confirms, and we POST to the
// existing /api/batches/{id}/approve endpoint. On success we
// invalidate the messages + followups queries so the table updates.
function ApproveBatchModal({ batchId, batchLabel, onClose }: { batchId: number; batchLabel: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState<string>('')

  // Fetch templates once. We only show is_active ones in the picker —
  // inactive templates would be rejected by the server anyway.
  const templates = useQuery({
    queryKey: ['templates', 'list'],
    queryFn: async () => (await api.get('/api/templates')).data as Template[],
  })
  const activeTemplates = useMemo(
    () => (templates.data || []).filter((t) => t.is_active),
    [templates.data],
  )

  // Auto-pick the first active template as soon as the list arrives.
  useEffect(() => {
    if (!pick && activeTemplates.length > 0) {
      setPick(`${activeTemplates[0].name}|${activeTemplates[0].language_code}`)
    }
  }, [pick, activeTemplates])

  const approve = useMutation({
    mutationFn: async () => {
      const [name, lang] = pick.split('|')
      // Two-step: first approve (queues WhatsApp sends), then enable
      // the per-batch AI follow-up flag (back-fills recipient rows).
      // Without the second step, the user's intent ("approve + start
      // AI follow-up") leaves the cross-batch queue empty because
      // SetBatchAIFollowup is the only code path that populates
      // bc_batch_ai_recipients. The follow-up PUT is idempotent.
      const result = await approveBatch(batchId, name, lang)
      try {
        await putBatchAIFollowup(batchId, true)
      } catch (e: any) {
        // Don't fail the whole approval if the follow-up toggle
        // errors — the batch IS approved. The toast below names
        // both outcomes.
        console.error('approve modal: follow-up toggle failed', e)
      }
      return result
    },
    onSuccess: (d) => {
      toast.success(`Batch #${batchId} approved — queued ${d.queued} messages, AI follow-up enabled`)
      // Invalidate everything that could be affected.
      qc.invalidateQueries({ queryKey: ['batch'] })
      qc.invalidateQueries({ queryKey: ['messages'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: batchAIKeys.followups() })
      qc.invalidateQueries({ queryKey: batchAIKeys.followup(batchId) })
      onClose()
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || 'Approve failed'
      // 409 is a benign "already approved" case — the user might
      // have approved in another tab. We still try to enable the
      // AI follow-up so the row appears in the queue.
      if (e?.response?.status === 409) {
        putBatchAIFollowup(batchId, true)
          .then(() => {
            toast.success('Batch already approved — AI follow-up enabled')
            qc.invalidateQueries({ queryKey: batchAIKeys.followups() })
            qc.invalidateQueries({ queryKey: batchAIKeys.followup(batchId) })
            onClose()
          })
          .catch(() => {
            toast(msg, { icon: 'ℹ️' })
            onClose()
          })
        return
      }
      toast.error(msg)
    },
  })

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-md admin-card rounded-2xl p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                Approve {batchLabel}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pick an active template, then queue the messages for batch #{batchId}. This also unlocks the per-batch AI follow-up toggle.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4">
            <label className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              <FileText className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Template
            </label>
            {templates.isLoading ? (
              <div className="py-3"><Spinner /></div>
            ) : activeTemplates.length === 0 ? (
              <div className="rounded-md border border-amber-200/70 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200">
                No active templates. Add one at{' '}
                <Link to="/admin/templates" className="underline font-medium">/admin/templates</Link>{' '}
                first.
              </div>
            ) : (
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="w-full px-3 py-2 text-[13px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              >
                {activeTemplates.map((t) => (
                  <option key={`${t.name}|${t.language_code}`} value={`${t.name}|${t.language_code}`}>
                    {t.name} ({t.language_code}) — {t.category}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton
              onClick={() => approve.mutate()}
              disabled={!pick || activeTemplates.length === 0 || approve.isPending}
            >
              {approve.isPending ? <><Spinner /> Approving…</> : <><CheckCircle2 className="w-4 h-4" /> Approve &amp; queue</>}
            </PrimaryButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// EnableAIWithScheduleModal — the configuration dialog opened
// from the main batch table's "Enable AI" button. Lets the
// admin pick:
//
//   1. A behavior mode:
//        - default: today's behavior (one short AI nudge per tick)
//        - custom:  admin supplies a goal + tone
//        - agentic: the LLM decides whether a follow-up is
//                   appropriate right now and may return ""
//                   (= skip this tick, advance to next)
//
//   2. A schedule (cadence + max messages, both clamped).
//
//   3. Custom-only extras: tone, goal text, checkin toggle.
//
// On Confirm, calls onConfirm(cfg). The parent owns the
// startBatchAIFollowupSequence mutation (hoisted so both this
// modal and the DuplicatePhonesWarningModal can share it). The
// parent also runs the preflight + opens the warning modal if any
// duplicate phones are detected before the actual sequence-start.
function EnableAIWithScheduleModal({
  batchId, onClose, onConfirm, isSubmitting,
}: {
  batchId: number
  onClose: () => void
  onConfirm: (cfg: BatchFollowupConfig) => void
  isSubmitting: boolean
}) {
  // Form state. Defaults match what an admin would pick 80% of
  // the time so the modal is one-click for the common case.
  const [behavior, setBehavior] = useState<FollowupBehavior>('default')
  const [cadence, setCadence] = useState<number>(3)
  const [maxMessages, setMaxMessages] = useState<number>(5)
  const [tone, setTone] = useState<FollowupTone>('friendly')
  const [goal, setGoal] = useState<string>('')
  const [checkin, setCheckin] = useState<boolean>(false)

  // Local input string for cadence (so the user can type freely).
  // We only clamp on submit.
  const [cadenceInput, setCadenceInput] = useState<string>('3')
  const [maxInput, setMaxInput] = useState<string>('5')

  function commitCadence(v: string) {
    setCadenceInput(v)
    const n = parseInt(v, 10)
    if (!Number.isNaN(n)) setCadence(Math.max(1, Math.min(30, n)))
  }
  function commitMax(v: string) {
    setMaxInput(v)
    const n = parseInt(v, 10)
    if (!Number.isNaN(n)) setMaxMessages(Math.max(1, Math.min(20, n)))
  }

  const canSubmit = cadence >= 1 && cadence <= 30 && maxMessages >= 1 && maxMessages <= 20 && !isSubmitting

  function handleConfirm() {
    if (!canSubmit) return
    const cfg: BatchFollowupConfig = {
      cadence_days: cadence,
      max_messages: maxMessages,
      tone: behavior === 'agentic' ? '' : tone,
      goal: behavior === 'custom' ? goal : '',
      behavior,
      checkin_enabled: checkin,
    }
    onConfirm(cfg)
  }

  // Build a short human summary of the timeline for the confirm
  // button label so the user sees the cadence / max inline.
  const confirmLabel = isSubmitting
    ? 'Starting…'
    : `Enable & start — every ${cadence} day${cadence === 1 ? '' : 's'}, up to ${maxMessages} message${maxMessages === 1 ? '' : 's'}`

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="w-full max-w-xl admin-card rounded-2xl p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-500" />
                Enable AI for batch #{batchId}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pick a behavior mode and a timeline. The agent will follow up with each retailer in the batch.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Behavior mode picker — 3 option cards */}
          <div className="mt-4">
            <div className="text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">Behavior mode</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <BehaviorCard
                active={behavior === 'default'}
                onClick={() => setBehavior('default')}
                icon={<Sparkles className="w-4 h-4" />}
                title="Default"
                desc="One short AI nudge per tick referencing the last topic."
              />
              <BehaviorCard
                active={behavior === 'custom'}
                onClick={() => setBehavior('custom')}
                icon={<FileText className="w-4 h-4" />}
                title="Custom"
                desc="You set the goal + tone. The agent follows your brief."
              />
              <BehaviorCard
                active={behavior === 'agentic'}
                onClick={() => setBehavior('agentic')}
                icon={<Bot className="w-4 h-4" />}
                title="Use your intelligence"
                desc="Agent decides whether to follow up. May skip ticks to avoid spam."
              />
            </div>
          </div>

          {/* Timeline — cadence + max messages */}
          <div className="mt-4">
            <div className="text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5 inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Timeline
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Send every (days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={cadenceInput}
                  onChange={(e) => commitCadence(e.target.value)}
                  className="w-full px-3 py-1.5 text-[13px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Max messages total
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxInput}
                  onChange={(e) => commitMax(e.target.value)}
                  className="w-full px-3 py-1.5 text-[13px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>
            </div>
          </div>

          {/* Custom-only fields */}
          {behavior === 'custom' && (
            <div className="mt-4 p-3 rounded-lg border border-emerald-200/60 dark:border-emerald-400/20 bg-emerald-50/40 dark:bg-emerald-500/5 space-y-3">
              <div className="text-[12px] font-medium text-slate-700 dark:text-slate-300">Custom brief</div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as FollowupTone)}
                  className="w-full px-3 py-1.5 text-[13px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                >
                  <option value="friendly">friendly</option>
                  <option value="professional">professional</option>
                  <option value="urgent">urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Goal of this follow-up
                </label>
                <textarea
                  rows={3}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. re-engage a warm lead who has gone quiet"
                  className="w-full px-3 py-1.5 text-[13px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-md text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>
            </div>
          )}

          {/* Agentic hint */}
          {behavior === 'agentic' && (
            <div className="mt-4 p-3 rounded-lg border border-violet-200/60 dark:border-violet-400/20 bg-violet-50/40 dark:bg-violet-500/5 text-[12px] text-slate-700 dark:text-slate-300">
              The agent will decide on every tick whether a follow-up is appropriate
              (skips if the customer just paid, asked us to stop, or we messaged
              recently). No goal / tone needed — it will figure it out.
            </div>
          )}

          {/* Checkin toggle — always visible */}
          <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checkin}
              onChange={(e) => setCheckin(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500/40"
            />
            <span className="text-[12px] text-slate-700 dark:text-slate-300">
              Send a "still interested?" check-in if the customer replies but the
              follow-up sequence has more steps queued.{' '}
              <span className="text-slate-500 dark:text-slate-400">(recommended)</span>
            </span>
          </label>

          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton
              onClick={handleConfirm}
              disabled={!canSubmit}
              title={canSubmit ? undefined : 'Cadence and max must be within their ranges'}
            >
              {isSubmitting ? <><Spinner /> Starting…</> : <><CheckCircle2 className="w-4 h-4" /> {confirmLabel}</>}
            </PrimaryButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// BehaviorCard — a single option card inside the behavior-mode
// picker. Active state uses the emerald accent to match the rest
// of the AI follow-up UI.
function BehaviorCard({
  active, onClick, icon, title, desc,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors
                  ${active
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-500/40'
                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-emerald-300 dark:hover:border-emerald-400/30'}`}
    >
      <div className={`flex items-center gap-2 text-[13px] font-semibold
                       ${active ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-800 dark:text-slate-200'}`}>
        {icon} {title}
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
        {desc}
      </div>
    </button>
  )
}

// DuplicatePhonesWarningModal is the second step of the Enable AI flow.
// It opens automatically after preflight when the new batch contains
// phones that already have active AI follow-up elsewhere. Each phone
// can be skipped here or overridden into the current batch agent.
