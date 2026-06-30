import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock3, FileSpreadsheet, Import, Plus, Search, Sparkles,
  Trash2, UploadCloud, UserPlus, Users, X,
} from 'lucide-react'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton, Spinner,
} from '@/components/ui'
import {
  aiKeys, createAIUser, importAIUsers, inspectAIUsersUpload, listAIUsers, startAIUserFollowup,
} from '@/lib/ai'
import { fmtDate, fmtRelative } from '@/lib/format'
import type {
  AIUser, AIUsersImportResult, AIUsersInspectResult, BatchAIFollowupDuplicate,
  BatchFollowupConfig, FollowupBehavior, FollowupTone,
} from '@/lib/types'

type ExtraPair = { key: string; value: string }

export default function AIUsers() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [followupUser, setFollowupUser] = useState<AIUser | null>(null)

  const listQ = useQuery({
    queryKey: aiKeys.users({ q, limit: 200 }),
    queryFn: () => listAIUsers({ q, limit: 200 }),
    staleTime: 8_000,
  })

  const users = listQ.data?.items || []
  const profileCount = users.filter((u) => u.source === 'manual' || u.source === 'import').length
  const extraFieldCount = users.reduce((sum, u) => sum + Object.keys(u.extra_fields || {}).length, 0)

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="AI Users"
        subtitle="Add the people your AI can recognize, search, and use as context. Name and phone stay fixed; extra columns become useful AI context."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => setImportOpen(true)}>
              <UploadCloud className="h-4 w-4" />
              Import CSV / Excel
            </SecondaryButton>
            <PrimaryButton onClick={() => setManualOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Add user
            </PrimaryButton>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <MetricCard icon={Users} label="Users visible to AI" value={listQ.data?.total ?? 0} sub="Same contacts used by conversations and follow-ups" />
        <MetricCard icon={Sparkles} label="AI context profiles" value={profileCount} sub="Manual or imported context attached" tone="emerald" />
        <MetricCard icon={FileSpreadsheet} label="Extra context fields" value={extraFieldCount} sub="Columns available for personalization" tone="blue" />
      </div>

      <Card className="mb-4" hover={false}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--input-bg)]">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, phone, code, or context..."
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Updates existing users by phone, so repeat imports are safe.
          </div>
        </div>
      </Card>

      {listQ.isLoading && <Spinner />}
      {listQ.isError && <ErrorBox msg={(listQ.error as any)?.response?.data?.error || (listQ.error as any)?.message || 'Could not load AI users'} />}

      {listQ.data && (
        <Card hover={false}>
          <CardHeader
            title="User directory"
            subtitle={`${listQ.data.total} total contact${listQ.data.total === 1 ? '' : 's'}`}
          />
          {users.length === 0 ? (
            <Empty>No AI users yet. Import a sheet or add the first user manually.</Empty>
          ) : (
            <>
              <div className="grid gap-3 p-4 md:hidden">
                {users.map((u) => (
                  <UserCard
                    key={`${u.retailer_id}-${u.phone}`}
                    user={u}
                    onStartAI={() => setFollowupUser(u)}
                  />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-white/5 dark:text-slate-300">
                    <tr>
                      <Th>Name</Th>
                      <Th>Phone</Th>
                      <Th>AI context</Th>
                      <Th>Source</Th>
                      <Th>Updated</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <motion.tr
                        key={`${u.retailer_id}-${u.phone}`}
                        layout
                        className="border-t border-slate-100 transition-colors hover:bg-slate-50/70 dark:border-white/10 dark:hover:bg-white/[0.04]"
                      >
                        <Td>
                          <div className="font-semibold text-slate-950 dark:text-white">{u.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{u.retailer_code}</div>
                        </Td>
                        <Td className="font-mono text-xs">{u.phone}</Td>
                        <Td>
                          <ExtraChips fields={u.extra_fields} />
                        </Td>
                        <Td>
                          <SourcePill source={u.source} optedOut={u.is_opted_out} />
                        </Td>
                        <Td>{fmtRelative(u.updated_at)}</Td>
                        <Td>
                          <div className="flex justify-end gap-2">
                            <SecondaryButton
                              type="button"
                              onClick={() => setFollowupUser(u)}
                              disabled={u.is_opted_out || !u.phone}
                              title={u.is_opted_out ? 'This user opted out' : 'Create a one-user AI follow-up control room'}
                              className="px-3 py-1.5"
                            >
                              <Bot className="h-4 w-4" /> Start AI
                            </SecondaryButton>
                            <Link
                              to={`/admin/messages/bulk/retailers/${u.retailer_id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                            >
                              Open <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </Td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      <AnimatePresence>
        {manualOpen && (
          <ManualUserDialog
            onClose={() => setManualOpen(false)}
            onSaved={() => {
              setManualOpen(false)
              qc.invalidateQueries({ queryKey: ['ai', 'users'] })
            }}
          />
        )}
        {importOpen && (
          <ImportUsersDialog
            onClose={() => setImportOpen(false)}
            onImported={() => {
              qc.invalidateQueries({ queryKey: ['ai', 'users'] })
            }}
          />
        )}
        {followupUser && (
          <StartUserAIDialog
            user={followupUser}
            onClose={() => setFollowupUser(null)}
            onStarted={(url) => {
              setFollowupUser(null)
              qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
              qc.invalidateQueries({ queryKey: ['ai', 'human-review'] })
              navigate(url)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function StartUserAIDialog({
  user, onClose, onStarted,
}: {
  user: AIUser
  onClose: () => void
  onStarted: (url: string) => void
}) {
  const [behavior, setBehavior] = useState<FollowupBehavior>('default')
  const [cadenceDays, setCadenceDays] = useState('3')
  const [maxMessages, setMaxMessages] = useState('5')
  const [tone, setTone] = useState<FollowupTone>('friendly')
  const [goal, setGoal] = useState('')
  const [checkin, setCheckin] = useState(false)
  const [conflict, setConflict] = useState<{
    message: string
    conflicts: BatchAIFollowupDuplicate[]
  } | null>(null)

  const startM = useMutation({
    mutationFn: ({ overrideExisting = false }: { overrideExisting?: boolean }) => startAIUserFollowup(
      user.retailer_id,
      buildUserFollowupConfig({
        behavior,
        cadenceDays,
        maxMessages,
        tone,
        goal,
        checkin,
        user,
      }),
      { overrideExisting },
    ),
    onSuccess: (result) => {
      toast.success(result.message || 'AI follow-up started')
      onStarted(result.redirect_url || `/admin/ai/followups/${result.batch_id}`)
    },
    onError: (e: any) => {
      const data = e?.response?.data
      if (e?.response?.status === 409 && data?.error === 'followup_conflict') {
        setConflict({
          message: data?.message || 'This phone already has AI follow-up running in another batch.',
          conflicts: data?.conflicts || [],
        })
        return
      }
      toast.error(data?.error || e?.message || 'Could not start AI for this user')
    },
  })

  const cadence = clampInt(cadenceDays, 1, 30, 3)
  const max = clampInt(maxMessages, 1, 20, 5)
  const canStart = !startM.isPending && !user.is_opted_out && Boolean(user.phone)

  return (
    <DialogFrame
      title={`Start AI for ${user.name}`}
      subtitle="This creates a clean one-user follow-up workspace. The same AI control room, timeline, human review, and conversation history will work for this phone."
      onClose={onClose}
    >
      {conflict ? (
        <UserAIConflictConsent
          user={user}
          message={conflict.message}
          conflicts={conflict.conflicts}
          isSubmitting={startM.isPending}
          onKeepExisting={onClose}
          onOverride={() => startM.mutate({ overrideExisting: true })}
        />
      ) : (
        <>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-950 dark:text-white">{user.name}</div>
            <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">{user.phone}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              If this phone is already handled by another AI batch, this user workspace will safely take over so only one AI follow-up plan stays active.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Behavior</div>
        <div className="grid gap-2 md:grid-cols-3">
          <UserModeCard active={behavior === 'default'} title="Default" body="Short, helpful nudges using the latest chat." onClick={() => setBehavior('default')} />
          <UserModeCard active={behavior === 'custom'} title="Custom" body="Give the AI a specific goal and tone." onClick={() => setBehavior('custom')} />
          <UserModeCard active={behavior === 'agentic'} title="Smart" body="AI decides when a follow-up is useful." onClick={() => setBehavior('agentic')} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Clock3 className="h-3.5 w-3.5" /> Send every
          </div>
          <Input type="number" min={1} max={30} value={cadenceDays} onChange={(e) => setCadenceDays(e.target.value)} />
          <div className="text-xs text-slate-500 dark:text-slate-400">Every {cadence} day{cadence === 1 ? '' : 's'}</div>
        </label>
        <label className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Max messages</div>
          <Input type="number" min={1} max={20} value={maxMessages} onChange={(e) => setMaxMessages(e.target.value)} />
          <div className="text-xs text-slate-500 dark:text-slate-400">Up to {max} AI follow-up message{max === 1 ? '' : 's'}</div>
        </label>
      </div>

      {behavior !== 'agentic' && (
        <label className="mt-4 block space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tone</div>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as FollowupTone)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 dark:border-white/10 dark:bg-[var(--input-bg)] dark:text-slate-100"
          >
            <option value="friendly">friendly</option>
            <option value="professional">professional</option>
            <option value="casual">casual</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
      )}

      {behavior === 'custom' && (
        <label className="mt-4 block space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Goal for this user</div>
          <textarea
            rows={4}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Example: follow up about the meeting request and move toward a confirmed time."
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 dark:border-white/10 dark:bg-[var(--input-bg)] dark:text-slate-100"
          />
        </label>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={checkin}
          onChange={(e) => setCheckin(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        <span>When the buyer replies, keep a gentle check-in available if more follow-ups remain.</span>
      </label>

      <div className="mt-6 flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton type="button" disabled={!canStart} onClick={() => startM.mutate({ overrideExisting: false })}>
          <Bot className="h-4 w-4" />
          {startM.isPending ? 'Starting...' : 'Start AI workspace'}
        </PrimaryButton>
      </div>
        </>
      )}
    </DialogFrame>
  )
}

function UserAIConflictConsent({
  user, message, conflicts, isSubmitting, onKeepExisting, onOverride,
}: {
  user: AIUser
  message: string
  conflicts: BatchAIFollowupDuplicate[]
  isSubmitting: boolean
  onKeepExisting: () => void
  onOverride: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-500/10">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white shadow-lg shadow-amber-500/20">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-slate-950 dark:text-white">This number is already handled by AI</div>
            <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</div>
            <div className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">{user.phone}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {conflicts.length === 0 ? (
          <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
            Existing AI follow-up was detected for this phone.
          </div>
        ) : (
          conflicts.map((c) => (
            <div key={`${c.phone}-${c.enrollment_id}-${c.source_batch_id || 'batch'}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">
                    Batch #{c.source_batch_id || 'unknown'} {c.source_batch_name ? `- ${c.source_batch_name}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Agent: {c.source_agent_name || 'global default'} · next run {fmtRelative(c.next_run_at)}
                  </div>
                </div>
                {c.agent_conflict && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                    Different agent
                  </span>
                )}
              </div>
              {c.step_message_preview && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  {c.step_message_preview}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
        <div className="font-semibold text-slate-900 dark:text-white">Choose what should happen</div>
        <div className="mt-1">
          Keep existing leaves the current batch agent untouched. Override pauses the old active follow-up and moves this phone to the AI Users workspace.
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SecondaryButton type="button" onClick={onKeepExisting} disabled={isSubmitting}>
          Keep existing batch AI
        </SecondaryButton>
        <PrimaryButton type="button" onClick={onOverride} disabled={isSubmitting}>
          <Bot className="h-4 w-4" />
          {isSubmitting ? 'Moving...' : 'Override and start here'}
        </PrimaryButton>
      </div>
    </div>
  )
}

function ManualUserDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pairs, setPairs] = useState<ExtraPair[]>([{ key: '', value: '' }])

  const saveM = useMutation({
    mutationFn: () => createAIUser({ name, phone, extra_fields: pairsToRecord(pairs) }),
    onSuccess: () => {
      toast.success('AI user saved')
      onSaved()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Could not save user'),
  })

  const canSave = name.trim() !== '' && phone.trim() !== ''

  return (
    <DialogFrame title="Add AI user" subtitle="Name and phone are required. Extra fields help the AI personalize answers." onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Test Retailer" autoFocus />
        </label>
        <label className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Phone number</div>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210" />
        </label>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-950 dark:text-white">Extra AI context</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Examples: city, interest, product, budget, source.</div>
          </div>
          <SecondaryButton type="button" onClick={() => setPairs([...pairs, { key: '', value: '' }])}>
            <Plus className="h-4 w-4" /> Field
          </SecondaryButton>
        </div>
        <div className="space-y-2">
          {pairs.map((p, idx) => (
            <div key={idx} className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
              <Input value={p.key} onChange={(e) => setPairs(updatePair(pairs, idx, 'key', e.target.value))} placeholder="Field name" />
              <Input value={p.value} onChange={(e) => setPairs(updatePair(pairs, idx, 'value', e.target.value))} placeholder="Value" />
              <SecondaryButton type="button" onClick={() => setPairs(pairs.filter((_, i) => i !== idx))} className="justify-center px-3">
                <Trash2 className="h-4 w-4" />
              </SecondaryButton>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton type="button" disabled={!canSave || saveM.isPending} onClick={() => saveM.mutate()}>
          <CheckCircle2 className="h-4 w-4" />
          {saveM.isPending ? 'Saving...' : 'Save user'}
        </PrimaryButton>
      </div>
    </DialogFrame>
  )
}

function ImportUsersDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [inspect, setInspect] = useState<AIUsersInspectResult | null>(null)
  const [nameCol, setNameCol] = useState('')
  const [phoneCol, setPhoneCol] = useState('')
  const [extraCols, setExtraCols] = useState<string[]>([])
  const [result, setResult] = useState<AIUsersImportResult | null>(null)

  const inspectM = useMutation({
    mutationFn: inspectAIUsersUpload,
    onSuccess: (data) => {
      setInspect(data)
      setNameCol(data.suggested?.name || data.headers[0] || '')
      setPhoneCol(data.suggested?.phone || data.headers[1] || '')
      setExtraCols(data.suggested?.extra_columns || [])
      setResult(null)
      toast.success(`Found ${data.headers.length} columns and ${data.total_rows} rows`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Could not read file'),
  })

  const importM = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file first')
      return importAIUsers(file, { name: nameCol, phone: phoneCol, extra_columns: extraCols })
    },
    onSuccess: (data) => {
      setResult(data)
      onImported()
      toast.success(`Imported ${data.imported} user${data.imported === 1 ? '' : 's'}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Import failed'),
  })

  const mappedPreview = useMemo(() => {
    if (!inspect) return []
    return inspect.sample_rows.map((row) => ({
      name: rowValue(row, nameCol),
      phone: rowValue(row, phoneCol),
      extras: extraCols.slice(0, 4).map((col) => [col, rowValue(row, col)] as const).filter(([, value]) => value),
    }))
  }, [extraCols, inspect, nameCol, phoneCol])

  const canImport = !!file && !!inspect && nameCol !== '' && phoneCol !== ''

  function pickFile(next: File | null) {
    setFile(next)
    setInspect(null)
    setResult(null)
    if (next) inspectM.mutate(next)
  }

  return (
    <DialogFrame title="Import AI users" subtitle="Upload any CSV or Excel sheet. Map its columns to fixed Name and Phone fields, then keep useful extra columns as AI context." onClose={onClose} wide>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0] || null)}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-6 text-left transition hover:border-emerald-500 hover:bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
              <Import className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-950 dark:text-white">{file ? file.name : 'Choose CSV or Excel file'}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Required after mapping: name and phone. Optional columns become context.
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            {inspectM.isPending ? 'Reading file...' : 'Browse'}
          </div>
        </div>
      </button>

      {inspectM.isPending && <div className="mt-4"><Spinner /></div>}

      {inspect && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="text-sm font-semibold text-slate-950 dark:text-white">Column mapping</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {inspect.total_rows} rows detected. Suggestions are preselected.
            </div>
            <div className="mt-4 space-y-3">
              <ColumnSelect label="Name" value={nameCol} headers={inspect.headers} onChange={setNameCol} required />
              <ColumnSelect label="Phone number" value={phoneCol} headers={inspect.headers} onChange={setPhoneCol} required />
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Extra context columns</div>
                <button
                  type="button"
                  onClick={() => setExtraCols(extraCols.length ? [] : inspect.headers.filter((h) => h !== nameCol && h !== phoneCol))}
                  className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-300"
                >
                  {extraCols.length ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {inspect.headers.filter((h) => h !== nameCol && h !== phoneCol).map((h) => (
                  <label key={h} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-white/[0.05]">
                    <input
                      type="checkbox"
                      checked={extraCols.includes(h)}
                      onChange={(e) => setExtraCols(e.target.checked ? [...extraCols, h] : extraCols.filter((x) => x !== h))}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    <span className="truncate text-slate-700 dark:text-slate-200">{h}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">Sample preview</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">This is how rows will become AI users.</div>
              </div>
              <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {extraCols.length} extra
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {mappedPreview.map((row, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-white">{row.name || 'No name mapped'}</div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{row.phone || 'No phone mapped'}</div>
                    </div>
                    <div className="text-xs text-slate-400">Row {idx + 2}</div>
                  </div>
                  {row.extras.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.extras.map(([k, v]) => (
                        <span key={k} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                          {k}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
          Imported {result.imported} of {result.total} rows. {result.skipped > 0 ? `${result.skipped} row${result.skipped === 1 ? '' : 's'} need fixes.` : 'No row errors.'}
          {result.errors.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-white/70 p-2 dark:bg-black/20">
              {result.errors.slice(0, 12).map((err, idx) => (
                <div key={idx}>Row {err.row}: {err.message}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onClose}>Close</SecondaryButton>
        <PrimaryButton type="button" disabled={!canImport || importM.isPending} onClick={() => importM.mutate()}>
          <UploadCloud className="h-4 w-4" />
          {importM.isPending ? 'Importing...' : 'Import users'}
        </PrimaryButton>
      </div>
    </DialogFrame>
  )
}

function DialogFrame({
  title, subtitle, onClose, children, wide = false,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className={`max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
          <div>
            <div className="text-lg font-semibold text-slate-950 dark:text-white">{title}</div>
            <div className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  )
}

function ColumnSelect({ label, value, headers, required, onChange }: {
  label: string
  value: string
  headers: string[]
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-rose-500">*</span>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 dark:border-white/10 dark:bg-[var(--input-bg)] dark:text-slate-100"
      >
        <option value="">Choose column</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  )
}

function UserCard({ user, onStartAI }: { user: AIUser; onStartAI: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-950 dark:text-white">{user.name}</div>
          <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{user.phone}</div>
        </div>
        <SourcePill source={user.source} optedOut={user.is_opted_out} />
      </div>
      <div className="mt-3">
        <ExtraChips fields={user.extra_fields} />
      </div>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Updated {fmtDate(user.updated_at)}</div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <SecondaryButton
          type="button"
          onClick={onStartAI}
          disabled={user.is_opted_out || !user.phone}
          className="justify-center"
        >
          <Bot className="h-4 w-4" /> Start AI
        </SecondaryButton>
        <Link
          to={`/admin/messages/bulk/retailers/${user.retailer_id}`}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
        >
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function UserModeCard({
  active, title, body, onClick,
}: {
  active: boolean
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition ${
        active
          ? 'border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-500/30 dark:bg-emerald-500/10'
          : 'border-slate-200 bg-white hover:border-emerald-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-emerald-400/40'
      }`}
    >
      <div className={`text-sm font-semibold ${active ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-950 dark:text-white'}`}>
        {title}
      </div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{body}</div>
    </button>
  )
}

function MetricCard({ icon: Icon, label, value, sub, tone = 'slate' }: {
  icon: typeof Users
  label: string
  value: number
  sub: string
  tone?: 'slate' | 'emerald' | 'blue'
}) {
  const toneClass = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  }[tone]
  return (
    <Card className="p-4" hover={false}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{value.toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
        </div>
      </div>
    </Card>
  )
}

function ExtraChips({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields || {}).filter(([, v]) => String(v || '').trim() !== '')
  if (entries.length === 0) {
    return <span className="text-xs text-slate-400">No extra context</span>
  }
  return (
    <div className="flex max-w-xl flex-wrap gap-1.5">
      {entries.slice(0, 4).map(([key, value]) => (
        <span key={key} className="max-w-[180px] truncate rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {key}: {value}
        </span>
      ))}
      {entries.length > 4 && (
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          +{entries.length - 4}
        </span>
      )}
    </div>
  )
}

function SourcePill({ source, optedOut }: { source: string; optedOut: boolean }) {
  if (optedOut) {
    return <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Opted out</span>
  }
  const label = source === 'import' ? 'Imported' : source === 'manual' ? 'Manual' : 'Retailer'
  return <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{label}</span>
}

function pairsToRecord(pairs: ExtraPair[]) {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const key = p.key.trim()
    const value = p.value.trim()
    if (key && value) out[key] = value
  }
  return out
}

function updatePair(pairs: ExtraPair[], idx: number, key: keyof ExtraPair, value: string) {
  return pairs.map((pair, i) => (i === idx ? { ...pair, [key]: value } : pair))
}

function rowValue(row: Record<string, string>, column: string) {
  if (!column) return ''
  if (row[column] != null) return row[column]
  const found = Object.entries(row).find(([key]) => key.trim().toLowerCase() === column.trim().toLowerCase())
  return found?.[1] || ''
}

function buildUserFollowupConfig(input: {
  behavior: FollowupBehavior
  cadenceDays: string
  maxMessages: string
  tone: FollowupTone
  goal: string
  checkin: boolean
  user: AIUser
}): BatchFollowupConfig {
  const cadence = clampInt(input.cadenceDays, 1, 30, 3)
  const max = clampInt(input.maxMessages, 1, 20, 5)
  return {
    behavior: input.behavior,
    cadence_days: cadence,
    max_messages: max,
    tone: input.behavior === 'agentic' ? '' : input.tone,
    goal: input.behavior === 'custom'
      ? input.goal.trim()
      : `Follow up personally with ${input.user.name}. Use their saved AI User context and the latest WhatsApp thread. Keep it short, helpful, and move toward one clear next step.`,
    checkin_enabled: input.checkin,
  }
}

function clampInt(value: string, min: number, max: number, fallback: number) {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">{children}</th>
}

function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}
