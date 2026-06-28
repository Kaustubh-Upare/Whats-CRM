import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Save, Bot, TestTube2, Send, ChevronDown, ChevronRight, Sparkles, Settings2, BookOpen,
  Plus, Trash2, Star, Check, AlertTriangle, Database, Search, Layers,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import {
  aiKeys,
  createAIAgent,
  deleteAIAgent,
  getAIAgentKnowledge,
  getAIAgent,
  listKB,
  listAIAgents,
  setDefaultAIAgent,
  testAIAgent,
  updateAIAgent,
  updateAIAgentKnowledge,
} from '@/lib/ai'
import type { AIAgentConfig, KBChunk, RetrievedChunk, TestAgentResult } from '@/lib/types'

/**
 * /admin/ai/agent — multi-agent management page (Phase 8).
 *
 * Two-pane layout:
 *   - LEFT: list of every agent the admin owns, default first. Each
 *     row exposes "Set as default" and "Delete" actions. The "+ Create"
 *     button at the top is disabled once the admin hits the 20-cap.
 *   - RIGHT: editor for the currently selected agent. The existing
 *     IdentityCard / BehaviourCard / TestPlaygroundCard from the
 *     pre-Phase-8 single-agent page are reused verbatim so behavior
 *     is consistent.
 *
 * UX invariants:
 *   - The selected agent's "Global default" pill (or absence of it)
 *     is always visible at the top of the editor pane.
 *   - Deleting the only-or-default agent requires a confirmation
 *     modal that explicitly explains the cascade ("batches using this
 *     agent will fall back to the default").
 *   - Switching the global default is always a deliberate act — it
 *     never silently rewrites per-batch overrides.
 */
export default function Agent() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: aiKeys.agents(),
    queryFn: listAIAgents,
  })

  const agents = list.data ?? []
  const defaultAgent = useMemo(() => agents.find((a) => a.is_default), [agents])
  // Selection state: by default, the global default is selected. When
  // the operator creates a new agent it becomes selected automatically.
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const effectiveSelectedID = selectedID ?? defaultAgent?.id ?? agents[0]?.id ?? null
  const selected = agents.find((a) => a.id === effectiveSelectedID) ?? null

  // Auto-select the default agent on first load and whenever the
  // default changes — so the operator always lands on a valid agent.
  useEffect(() => {
    if (selectedID && agents.some((a) => a.id === selectedID)) return
    setSelectedID(defaultAgent?.id ?? agents[0]?.id ?? null)
  }, [agents, defaultAgent?.id, selectedID])

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Create multiple agents and pick which one handles each batch. The global default is used for live chat and unattached batches."
      />

      {list.isLoading ? <Spinner /> :
       list.isError ? <ErrorBox msg={(list.error as any)?.message || 'Failed to load agents'} /> :
       (
        <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4 items-start">
          <AgentListPane
            agents={agents}
            selectedID={effectiveSelectedID}
            onSelect={setSelectedID}
            onListChange={() => qc.invalidateQueries({ queryKey: aiKeys.agents() })}
          />
          <div className="space-y-4 min-w-0">
            {selected ? (
              <AgentEditor
                agent={selected}
                defaultAgentID={defaultAgent?.id ?? null}
                isDefault={!!selected.is_default}
                onChanged={() => qc.invalidateQueries({ queryKey: aiKeys.agents() })}
              />
            ) : (
              <Card>
                <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  No agent selected. Click <b>+ Create agent</b> on the left to start.
                </div>
              </Card>
            )}
          </div>
        </div>
       )}
    </>
  )
}

// ============================================================================
// Left pane — agent list + create
// ============================================================================

function AgentListPane({
  agents, selectedID, onSelect, onListChange,
}: {
  agents: AIAgentConfig[]
  selectedID: number | null
  onSelect: (id: number) => void
  onListChange: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState<AIAgentConfig | null>(null)
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () => createAIAgent({
      name: 'New agent',
      enabled: false,
    }),
    onSuccess: (agent) => {
      toast.success(`Agent "${agent.name}" created`)
      qc.invalidateQueries({ queryKey: aiKeys.agents() })
      onListChange()
      onSelect(agent.id)
    },
    onError: (e: any) => {
      const data = e?.response?.data
      if (data?.error === 'agent_limit_reached') {
        toast.error(data.message || 'Agent limit reached')
      } else {
        toast.error(data?.error || e?.message || 'Could not create agent')
      }
    },
  })

  const setDefault = useMutation({
    mutationFn: (id: number) => setDefaultAIAgent(id),
    onSuccess: (agent) => {
      toast.success(`"${agent.name}" is now the global default`)
      qc.invalidateQueries({ queryKey: aiKeys.agents() })
      qc.invalidateQueries({ queryKey: ['batches'] }) // refresh resolved agents
      onListChange()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Could not set default'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteAIAgent(id),
    onSuccess: () => {
      toast.success('Agent deleted')
      qc.invalidateQueries({ queryKey: aiKeys.agents() })
      qc.invalidateQueries({ queryKey: ['batches'] })
      onListChange()
      setConfirmDelete(null)
    },
    onError: (e: any) => {
      const data = e?.response?.data
      if (data?.error === 'cannot_delete_default') {
        toast.error(data.message || 'Set another agent as default first')
      } else {
        toast.error(data?.error || e?.message || 'Could not delete agent')
      }
      setConfirmDelete(null)
    },
  })

  const atLimit = agents.length >= 20

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-500" /> Agents
          </span>
        }
        subtitle={`${agents.length} of 20 used`}
        right={
          <PrimaryButton
            onClick={() => create.mutate()}
            disabled={atLimit || create.isPending}
            title={atLimit ? '20-agent limit reached' : 'Create a new agent'}
          >
            <Plus className="w-4 h-4" /> {create.isPending ? 'Creating…' : 'Create'}
          </PrimaryButton>
        }
      />
      <div className="p-2 space-y-1">
        {agents.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No agents yet. Click <b>Create</b> to start.
          </div>
        ) : agents.map((a) => (
          <AgentListRow
            key={a.id}
            agent={a}
            isSelected={a.id === selectedID}
            onSelect={() => onSelect(a.id)}
            onSetDefault={() => setDefault.mutate(a.id)}
            onDelete={() => setConfirmDelete(a)}
            isSettingDefault={setDefault.isPending && setDefault.variables === a.id}
          />
        ))}
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <DeleteAgentModal
            agent={confirmDelete}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => remove.mutate(confirmDelete.id)}
            isDeleting={remove.isPending}
            totalAgents={agents.length}
          />
        )}
      </AnimatePresence>
    </Card>
  )
}

function AgentListRow({
  agent, isSelected, onSelect, onSetDefault, onDelete, isSettingDefault,
}: {
  agent: AIAgentConfig
  isSelected: boolean
  onSelect: () => void
  onSetDefault: () => void
  onDelete: () => void
  isSettingDefault: boolean
}) {
  return (
    <div
      onClick={onSelect}
      className={[
        'group cursor-pointer rounded-md px-3 py-2.5 transition-colors',
        isSelected
          ? 'bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-300 dark:ring-emerald-500/40'
          : 'hover:bg-slate-50 dark:hover:bg-white/5',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <div className={[
          'w-2 h-2 rounded-full shrink-0',
          agent.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        ].join(' ')} />
        <div className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate flex-1">
          {agent.name || 'Unnamed'}
        </div>
        {agent.is_default && (
          <PillPop className="pill-emerald !text-[9px]">
            <Star className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />Default
          </PillPop>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-end">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!agent.is_default && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSetDefault() }}
              disabled={isSettingDefault}
              className="p-1 rounded hover:bg-white dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"
              title="Set as global default"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded hover:bg-white dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Delete confirmation modal — explains the cascade in plain English.
// ============================================================================

function DeleteAgentModal({
  agent, totalAgents, onCancel, onConfirm, isDeleting,
}: {
  agent: AIAgentConfig
  totalAgents: number
  onCancel: () => void
  onConfirm: () => void
  isDeleting: boolean
}) {
  const isOnlyAgent = totalAgents === 1
  const isDefault = !!agent.is_default

  let body: { title: string; message: string; confirmLabel: string; danger: boolean }
  if (isOnlyAgent) {
    body = {
      title: `Delete "${agent.name}"?`,
      message: `This is your only agent. Deleting it disables AI for every batch until you create a new agent.`,
      confirmLabel: 'Delete',
      danger: true,
    }
  } else if (isDefault) {
    body = {
      title: `Cannot delete "${agent.name}"`,
      message: `It's the global default. Set another agent as default first, then come back to delete this one.`,
      confirmLabel: 'Close',
      danger: false,
    }
  } else {
    body = {
      title: `Delete "${agent.name}"?`,
      message: `Any batches using this agent will fall back to the global default on their next send. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className={[
              'shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
              body.danger ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300'
                          : 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300',
            ].join(' ')}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {body.title}
              </div>
              <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                {body.message}
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={onCancel}>
              {body.confirmLabel === 'Close' ? 'Close' : 'Cancel'}
            </SecondaryButton>
            {body.danger && (
              <PrimaryButton
                onClick={onConfirm}
                disabled={isDeleting}
                className="!bg-rose-600 hover:!bg-rose-700 dark:!bg-rose-500 dark:hover:!bg-rose-600"
              >
                {isDeleting ? 'Deleting…' : body.confirmLabel}
              </PrimaryButton>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============================================================================
// Right pane — editor for the selected agent.
// Reuses the three cards from the pre-Phase-8 Agent.tsx verbatim.
// ============================================================================

function AgentEditor({
  agent, defaultAgentID, isDefault, onChanged,
}: {
  agent: AIAgentConfig
  defaultAgentID: number | null
  isDefault: boolean
  onChanged: () => void
}) {
  return (
    <>
      <Card>
        <div className="p-4 flex items-center gap-3 border-b border-slate-200 dark:border-white/10">
          <div className="text-sm text-slate-500 dark:text-slate-400">Editing</div>
          <div className="font-semibold text-slate-800 dark:text-slate-100">
            {agent.name || 'Unnamed'}
          </div>
          {isDefault ? (
            <PillPop className="pill-emerald">
              <Star className="w-3 h-3 inline -mt-0.5 mr-0.5" />Global default
            </PillPop>
          ) : defaultAgentID ? (
            <PillPop className="pill-slate">
              Another agent is the default
            </PillPop>
          ) : null}
          <span className="ml-auto text-[11px] font-mono text-slate-400 dark:text-slate-500">
            id #{agent.id}
          </span>
        </div>
      </Card>
      <IdentityCard agent={agent} onSaved={onChanged} />
      <BehaviourCard agent={agent} onSaved={onChanged} />
      <KnowledgeScopeCard agent={agent} />
      <TestPlaygroundCard agent={agent} />
    </>
  )
}

function IdentityCard({
  agent, onSaved,
}: {
  agent: AIAgentConfig
  onSaved: () => void
}) {
  const [name, setName] = useState(agent.name)
  const [personaMd, setPersonaMd] = useState(agent.persona_md)
  const [tone, setTone] = useState(agent.tone)
  const [languagesText, setLanguagesText] = useState(agent.languages.join(', '))
  const [enabled, setEnabled] = useState(agent.enabled)

  useEffect(() => {
    setName(agent.name)
    setPersonaMd(agent.persona_md)
    setTone(agent.tone)
    setLanguagesText(agent.languages.join(', '))
    setEnabled(agent.enabled)
  }, [agent.id, agent.name, agent.persona_md, agent.tone, agent.languages.join(','), agent.enabled])

  const save = useMutation({
    mutationFn: async () => {
      const langs = languagesText.split(',').map((s) => s.trim()).filter(Boolean)
      if (langs.length === 0) throw new Error('Pick at least one language (e.g. "en")')
      if (!name.trim()) throw new Error('Name is required')
      return updateAIAgent(agent.id, {
        name, persona_md: personaMd, tone, languages: langs, enabled,
      })
    },
    onSuccess: () => {
      toast.success('Identity saved')
      onSaved()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" /> Identity & persona
          </span>
        }
        subtitle="How the agent presents itself. Plain markdown in the persona field is fine."
        right={
          <div className="flex items-center gap-2">
            <PillPop className={enabled ? 'pill-green' : 'pill-slate'}>
              {enabled ? 'enabled' : 'disabled'}
            </PillPop>
            <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
        }
      />
      <div className="p-5 space-y-3">
        <Field k="Display name" v={
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Riya" />
        } sub="The name the agent introduces itself with." />

        <Field k="Persona (markdown)" v={
          <TextArea
            value={personaMd}
            onChange={(e) => setPersonaMd(e.target.value)}
            rows={8}
            placeholder={"You're Riya from Sharma Sweets. You speak warmly in Hindi and English.\nYou know our menu inside out and you take orders when asked."}
            className="font-mono text-xs"
          />
        } sub="Free-form persona. Headings, bullets, links all work." />

        <div className="grid grid-cols-2 gap-3">
          <Field k="Tone" v={
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm
                         bg-white dark:bg-[var(--input-bg)]
                         border border-slate-300 dark:border-[var(--input-border)]
                         text-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
            >
              <option value="friendly">friendly</option>
              <option value="professional">professional</option>
              <option value="concise">concise</option>
              <option value="enthusiastic">enthusiastic</option>
            </select>
          } sub="Affect the LLM's voice." />

          <Field k="Languages (comma-separated BCP-47)" v={
            <Input
              value={languagesText}
              onChange={(e) => setLanguagesText(e.target.value)}
              placeholder="en, hi"
            />
          } sub="Auto-detect kicks in; this is the list of supported languages." />
        </div>

        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable the AI assistant"
          hint="Off = the agent is configured but doesn't fire (useful for staging)."
        />
      </div>
    </Card>
  )
}

function BehaviourCard({
  agent, onSaved,
}: {
  agent: AIAgentConfig
  onSaved: () => void
}) {
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt)
  const [workingHours, setWorkingHours] = useState(() => prettyJSON(agent.working_hours))
  const [handoffRules, setHandoffRules] = useState(() => prettyJSON(agent.handoff_rules))
  const [qualCriteria, setQualCriteria] = useState(() => prettyJSON(agent.qualification_criteria))
  const [faqThresh, setFaqThresh] = useState(agent.faq_confidence_threshold)

  useEffect(() => {
    setSystemPrompt(agent.system_prompt)
    setWorkingHours(prettyJSON(agent.working_hours))
    setHandoffRules(prettyJSON(agent.handoff_rules))
    setQualCriteria(prettyJSON(agent.qualification_criteria))
    setFaqThresh(agent.faq_confidence_threshold)
  }, [agent.id, agent.system_prompt, agent.updated_at])

  const [errHours] = useState<string | null>(null)
  const [errHandoff] = useState<string | null>(null)
  const [errQual] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      if (faqThresh < 0 || faqThresh > 1) throw new Error('FAQ confidence threshold must be 0-1')
      return updateAIAgent(agent.id, {
        system_prompt: systemPrompt,
        faq_confidence_threshold: faqThresh,
      })
    },
    onSuccess: () => {
      toast.success('Behaviour saved')
      onSaved()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-emerald-500" /> Behaviour
          </span>
        }
        subtitle="Core instructions and confidence tuning. Knowledge is selected in the next card."
        right={
          <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
          </PrimaryButton>
        }
      />
      <div className="p-5 space-y-3">
        <Field k="System prompt" v={
          <TextArea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            placeholder="You are a helpful assistant for {{business_name}}…"
            className="font-mono text-xs"
          />
        } sub="The master prompt. Retrieval-augmented context (with [N] citations) is appended to this automatically." />

        <div className="hidden">
          <Field k="Working hours (JSON)" v={
            <TextArea
              value={workingHours}
              onChange={(e) => setWorkingHours(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder={`{\n  "mon": "09:00-18:00",\n  "tue": "09:00-18:00"\n}`}
            />
          } sub={errHours ? <span className="text-rose-600 dark:text-rose-300">{errHours}</span> : "Map weekday → 'HH:MM-HH:MM' or empty for off."} />

          <Field k="Handoff rules (JSON)" v={
            <TextArea
              value={handoffRules}
              onChange={(e) => setHandoffRules(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          } sub={errHandoff ? <span className="text-rose-600 dark:text-rose-300">{errHandoff}</span> : "sentiment_negative, low_confidence_below, customer_requested, outside_hours."} />
        </div>

        <Field k="Qualification criteria (JSON)" v={
          <TextArea
            value={qualCriteria}
            onChange={(e) => setQualCriteria(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            placeholder={`{\n  "qualified_budget_min": 10000\n}`}
          />
        } sub={errQual ? <span className="text-rose-600 dark:text-rose-300">{errQual}</span> : "Free-form — used by the lead-capture tool in Phase 2."} />

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300 w-56 shrink-0">
            FAQ confidence threshold
          </label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={faqThresh}
            onChange={(e) => setFaqThresh(parseFloat(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs font-mono text-slate-600 dark:text-slate-300 w-12 text-right">
            {faqThresh.toFixed(2)}
          </span>
        </div>
      </div>
    </Card>
  )
}

function KnowledgeScopeCard({ agent }: { agent: AIAgentConfig }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'all' | 'selected'>('all')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const scopeQ = useQuery({
    queryKey: aiKeys.agentKnowledge(agent.id),
    queryFn: () => getAIAgentKnowledge(agent.id),
  })

  const kbQ = useQuery({
    queryKey: aiKeys.kb({ limit: 500, offset: 0 }),
    queryFn: () => listKB({ limit: 500, offset: 0 }),
  })

  useEffect(() => {
    const scope = scopeQ.data
    if (!scope) return
    setMode(scope.mode === 'selected' ? 'selected' : 'all')
    setSelectedIds(scope.selected_ids ?? [])
  }, [agent.id, scopeQ.data?.mode, scopeQ.data?.selected_ids?.join(',')])

  const save = useMutation({
    mutationFn: () => updateAIAgentKnowledge(agent.id, {
      selected_ids: mode === 'all' ? [] : selectedIds,
    }),
    onSuccess: (scope) => {
      toast.success(scope.mode === 'selected'
        ? `Agent knowledge saved (${scope.selected_ids.length} selected)`
        : 'Agent now uses all knowledge')
      qc.invalidateQueries({ queryKey: aiKeys.agentKnowledge(agent.id) })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Could not save agent knowledge'),
  })

  const chunks = kbQ.data?.items ?? []
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chunks
    return chunks.filter((c) => [
      c.title || '',
      c.content || '',
      c.source_type || '',
      c.source_ref || '',
    ].join(' ').toLowerCase().includes(q))
  }, [chunks, search])

  const dirty = scopeQ.data
    ? (mode === 'all'
      ? scopeQ.data.mode === 'selected'
      : scopeQ.data.mode !== 'selected' || !sameNumberSet(selectedIds, scopeQ.data.selected_ids ?? []))
    : false

  function toggleChunk(id: number) {
    setMode('selected')
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-500" /> Knowledge
          </span>
        }
        subtitle="Choose what this agent is allowed to use when answering."
        right={
          <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
          </PrimaryButton>
        }
      />
      <div className="p-5 space-y-4">
        {scopeQ.isError && <ErrorBox msg={(scopeQ.error as any)?.response?.data?.error || (scopeQ.error as any)?.message || 'Failed to load agent knowledge'} />}
        {kbQ.isError && <ErrorBox msg={(kbQ.error as any)?.response?.data?.error || (kbQ.error as any)?.message || 'Failed to load knowledge'} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode('all')}
            className={`text-left rounded-lg border p-4 transition-colors ${
              mode === 'all'
                ? 'border-emerald-400 bg-emerald-50/80 dark:border-emerald-400/35 dark:bg-emerald-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
              <BookOpen className="w-4 h-4 text-emerald-500" />
              Use all knowledge
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {scopeQ.data?.total_kb ?? kbQ.data?.total ?? 0} chunks available to this agent.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode('selected')}
            className={`text-left rounded-lg border p-4 transition-colors ${
              mode === 'selected'
                ? 'border-blue-400 bg-blue-50/80 dark:border-blue-400/35 dark:bg-blue-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
              <Layers className="w-4 h-4 text-blue-500" />
              Pick specific knowledge
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {selectedIds.length} selected for focused answers.
            </div>
          </button>
        </div>

        {mode === 'selected' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search knowledge..."
                  className="pl-9"
                />
              </div>
              <SecondaryButton
                type="button"
                onClick={() => setSelectedIds(filtered.map((c) => c.id))}
                disabled={filtered.length === 0}
              >
                Select shown
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => setSelectedIds([])}>
                Clear
              </SecondaryButton>
            </div>

            {kbQ.isLoading ? <Spinner /> : filtered.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-5 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                No knowledge chunks match this search.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10">
                {filtered.map((chunk) => (
                  <KnowledgePickRow
                    key={chunk.id}
                    chunk={chunk}
                    selected={selectedSet.has(chunk.id)}
                    onToggle={() => toggleChunk(chunk.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function KnowledgePickRow({ chunk, selected, onToggle }: { chunk: KBChunk; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 dark:border-white/10 ${
        selected
          ? 'bg-emerald-50/80 dark:bg-emerald-500/10'
          : 'bg-white hover:bg-slate-50 dark:bg-white/[0.02] dark:hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${
          selected
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-slate-300 bg-white dark:border-white/20 dark:bg-white/5'
        }`}>
          {selected && <Check className="w-3.5 h-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {chunk.title || chunk.source_ref || `Knowledge #${chunk.id}`}
            </div>
            <PillPop className="pill-slate !text-[9px]">{chunk.source_type}</PillPop>
          </div>
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {chunk.content}
          </div>
        </div>
      </div>
    </button>
  )
}

function sameNumberSet(a: number[], b: number[]) {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

const PRESETS: { label: string; message: string }[] = [
  { label: 'Curious buyer', message: 'Hi! I saw your ad. What kinds of sweets do you have?' },
  { label: 'Price-sensitive', message: 'Kitna padega ek plate?' },
  { label: 'Angry / complaint', message: 'Where is my order? I placed it 2 days ago and NOTHING.' },
  { label: 'Just browsing', message: 'Do you deliver on Sundays?' },
  { label: 'Wants a human', message: 'Can I talk to a real person please?' },
]

function TestPlaygroundCard({ agent }: { agent: AIAgentConfig }) {
  const [message, setMessage] = useState(PRESETS[0].message)
  const [showOverride, setShowOverride] = useState(false)
  const [override, setOverride] = useState('')

  const [result, setResult] = useState<TestAgentResult | null>(null)
  const test = useMutation({
    mutationFn: () => testAIAgent({
      message,
      system_prompt_override: showOverride ? override : '',
      agent_id: agent.id,
    }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Test failed'),
  })

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <TestTube2 className="w-4 h-4 text-emerald-500" /> Test playground
          </span>
        }
        subtitle={`Send a message through the full retrieval + LLM pipeline using "${agent.name}".`}
        right={
          <PillPop className="pill-slate">
            <BookOpen className="w-3 h-3 inline -mt-0.5 mr-0.5" />
            uses live KB + this agent's config
          </PillPop>
        }
      />
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setMessage(p.message)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full
                         text-xs font-medium
                         border border-slate-200 dark:border-white/10
                         bg-white dark:bg-white/[0.03]
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-600 dark:text-slate-300
                         transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a test message…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !test.isPending && message.trim()) test.mutate() }}
            className="flex-1"
          />
          <PrimaryButton onClick={() => test.mutate()} disabled={!message.trim() || test.isPending}>
            <Send className="w-4 h-4" /> {test.isPending ? 'Sending…' : 'Send'}
          </PrimaryButton>
        </div>

        <button
          type="button"
          onClick={() => setShowOverride((s) => !s)}
          className="text-xs text-slate-500 dark:text-slate-400
                     hover:text-slate-700 dark:hover:text-slate-200
                     inline-flex items-center gap-1"
        >
          {showOverride ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          System-prompt override
        </button>

        <AnimatePresence>
          {showOverride && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <TextArea
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                rows={4}
                placeholder="Leave blank to use this agent's saved system prompt."
                className="font-mono text-xs"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {test.isPending && (
          <div className="rounded-md border border-slate-200 dark:border-white/10
                          bg-slate-50 dark:bg-white/[0.03] p-4">
            <Spinner />
          </div>
        )}

        {test.isError && (
          <ErrorBox msg={(test.error as any)?.response?.data?.error || (test.error as any)?.message || 'Test failed'} />
        )}

        {result && !test.isPending && (
          <TestResultView result={result} />
        )}
      </div>
    </Card>
  )
}

function TestResultView({ result }: { result: TestAgentResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-3"
    >
      <div className="rounded-md border border-slate-200 dark:border-white/10
                      bg-white dark:bg-white/[0.03] p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
          <Bot className="w-3 h-3" /> Reply
        </div>
        <div className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
          {result.reply || <span className="italic text-slate-400">(empty reply)</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Tier" value={result.tier} />
        <Metric label="Tokens" value={`${result.tokens_in} / ${result.tokens_out}`} mono />
        <Metric label="Cost" value={`$${result.cost_usd.toFixed(6)}`} mono />
        <Metric label="Latency" value={`${result.latency_ms} ms`} mono />
      </div>

      {result.retrieved_chunks && result.retrieved_chunks.length > 0 && (
        <div className="rounded-md border border-slate-200 dark:border-white/10
                        bg-slate-50 dark:bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 font-semibold">
            Retrieved chunks ({result.retrieved_chunks.length})
          </div>
          <ul className="space-y-2">
            {result.retrieved_chunks.map((c) => (
              <ChunkRow key={c.id} chunk={c} />
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

function ChunkRow({ chunk }: { chunk: RetrievedChunk }) {
  return (
    <li className="rounded border border-slate-200 dark:border-white/10
                   bg-white dark:bg-white/[0.02] p-2.5 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
          {chunk.title || chunk.source_ref || `Chunk #${chunk.id}`}
        </span>
        <PillPop className="pill-slate !text-[9px]">{chunk.source_type}</PillPop>
        <span className="ml-auto font-mono text-slate-500 dark:text-slate-400">
          {chunk.final_score.toFixed(2)}
        </span>
      </div>
      <div className="text-slate-600 dark:text-slate-300 line-clamp-3">
        {chunk.content}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
        <ScoreBar label="vector" value={chunk.vector_sim} />
        <ScoreBar label="keyword" value={chunk.keyword_sim} />
      </div>
    </li>
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

function Field({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  if (k === 'Working hours (JSON)' || k === 'Handoff rules (JSON)' || k === 'Qualification criteria (JSON)') {
    return null
  }
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
      {sub != null && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors shrink-0
                    ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                      transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </button>
      <div>
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</div>
        {hint && <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
      </div>
    </label>
  )
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-slate-200 dark:border-white/10
                    bg-white dark:bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-sm text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''} truncate`}
           title={value}>
        {value}
      </div>
    </div>
  )
}

function prettyJSON(v: Record<string, any>): string {
  if (!v || Object.keys(v).length === 0) return '{}'
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return '{}'
  }
}

function validateJSON(s: string, name: string): { val: Record<string, any>; err: string | null } {
  const trimmed = s.trim()
  if (trimmed === '' || trimmed === '{}') return { val: {}, err: null }
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      return { val: {}, err: `${name} must be a JSON object` }
    }
    return { val: parsed, err: null }
  } catch (e: any) {
    return { val: {}, err: `${name} is not valid JSON: ${e?.message || ''}` }
  }
}

// Touch getAIAgent so the import isn't unused in this file; the agent
// list cache invalidation is what matters for now.
const _g = getAIAgent
void _g
