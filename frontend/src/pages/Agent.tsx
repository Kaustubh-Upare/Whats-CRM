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
  const [activeTab, setActiveTab] = useState<AgentEditorTab>('persona')
  const tabs: Array<{ id: AgentEditorTab; label: string; desc: string; icon: typeof Sparkles }> = [
    { id: 'persona', label: 'Persona', desc: 'Name, tone, language', icon: Sparkles },
    { id: 'behaviour', label: 'Behaviour', desc: 'Reply rules and review gates', icon: Settings2 },
    { id: 'knowledge', label: 'Knowledge', desc: 'What this agent can use', icon: Database },
    { id: 'test', label: 'Test Playground', desc: 'Try it before live use', icon: TestTube2 },
  ]

  return (
    <>
      <Card hover={false} className="overflow-hidden">
        <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-emerald-50/40 to-cyan-50/40 p-5 dark:border-white/10 dark:from-white/[0.06] dark:via-emerald-500/10 dark:to-cyan-500/10">
          <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-200 bg-white text-emerald-600 shadow-sm dark:border-emerald-400/20 dark:bg-white/10 dark:text-emerald-300">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Editing agent</div>
                {isDefault ? (
                  <PillPop className="pill-emerald">
                    <Star className="w-3 h-3 inline -mt-0.5 mr-0.5" />Global default
                  </PillPop>
                ) : defaultAgentID ? (
                  <PillPop className="pill-slate">
                    Another agent is the default
                  </PillPop>
                ) : null}
                <PillPop className={agent.enabled ? 'pill-green' : 'pill-slate'}>
                  {agent.enabled ? 'enabled' : 'disabled'}
                </PillPop>
              </div>
              <div className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {agent.name || 'Unnamed'}
              </div>
              <div className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                Build one focused assistant: personality, speaking rules, knowledge access, then test it against real retrieval before it handles buyers.
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-mono text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-400">
              id #{agent.id}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-2 lg:grid-cols-4">
          {tabs.map((tab) => (
            <AgentTabButton
              key={tab.id}
              tab={tab}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>
      </Card>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${agent.id}-${activeTab}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'persona' && <IdentityCard agent={agent} onSaved={onChanged} />}
          {activeTab === 'behaviour' && <BehaviourCard agent={agent} onSaved={onChanged} />}
          {activeTab === 'knowledge' && <KnowledgeScopeCard agent={agent} />}
          {activeTab === 'test' && <TestPlaygroundCard agent={agent} />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

type AgentEditorTab = 'persona' | 'behaviour' | 'knowledge' | 'test'

function AgentTabButton({
  tab, active, onClick,
}: {
  tab: { id: AgentEditorTab; label: string; desc: string; icon: typeof Sparkles }
  active: boolean
  onClick: () => void
}) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group flex min-h-[74px] items-start gap-3 rounded-lg border px-3 py-3 text-left transition-all',
        active
          ? 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/12 dark:text-white'
          : 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/[0.04]',
      ].join(' ')}
    >
      <span className={[
        'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors',
        active
          ? 'border-emerald-300 bg-white text-emerald-600 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'border-slate-200 bg-white text-slate-500 group-hover:text-emerald-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:group-hover:text-emerald-300',
      ].join(' ')}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{tab.label}</span>
        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{tab.desc}</span>
      </span>
    </button>
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
  const initialRules = getManagedBehaviourRules(agent)
  const [systemPrompt, setSystemPrompt] = useState(() => stripManagedAgentRules(agent.system_prompt))
  const [reviewTriggers, setReviewTriggers] = useState(() => textFromList(initialRules.human_review_triggers))
  const [stopRules, setStopRules] = useState(() => textFromList(initialRules.stop_ai_when))
  const [quietRules, setQuietRules] = useState(() => textFromList(initialRules.do_not_speak_when))
  const [importantSignals, setImportantSignals] = useState(() => textFromList(initialRules.important_lead_signals))
  const [reviewLowConfidence, setReviewLowConfidence] = useState(initialRules.review_low_confidence)
  const [draftHighRisk, setDraftHighRisk] = useState(initialRules.draft_high_risk)
  const [faqThresh, setFaqThresh] = useState(agent.faq_confidence_threshold)
  const [workingHours, setWorkingHours] = useState(() => prettyJSON(agent.working_hours))
  const [handoffRules, setHandoffRules] = useState(() => prettyJSON(agent.handoff_rules))
  const [qualCriteria, setQualCriteria] = useState(() => prettyJSON(agent.qualification_criteria))
  const [errHours] = useState<string | null>(null)
  const [errHandoff] = useState<string | null>(null)
  const [errQual] = useState<string | null>(null)

  useEffect(() => {
    const rules = getManagedBehaviourRules(agent)
    setSystemPrompt(stripManagedAgentRules(agent.system_prompt))
    setReviewTriggers(textFromList(rules.human_review_triggers))
    setStopRules(textFromList(rules.stop_ai_when))
    setQuietRules(textFromList(rules.do_not_speak_when))
    setImportantSignals(textFromList(rules.important_lead_signals))
    setReviewLowConfidence(rules.review_low_confidence)
    setDraftHighRisk(rules.draft_high_risk)
    setFaqThresh(agent.faq_confidence_threshold)
    setWorkingHours(prettyJSON(agent.working_hours))
    setHandoffRules(prettyJSON(agent.handoff_rules))
    setQualCriteria(prettyJSON(agent.qualification_criteria))
  }, [agent.id, agent.system_prompt, agent.handoff_rules, agent.qualification_criteria, agent.faq_confidence_threshold])

  const save = useMutation({
    mutationFn: async () => {
      if (faqThresh < 0 || faqThresh > 1) throw new Error('FAQ confidence threshold must be 0-1')
      const behaviourRules: ManagedBehaviourRules = {
        review_low_confidence: reviewLowConfidence,
        draft_high_risk: draftHighRisk,
        human_review_triggers: listFromText(reviewTriggers),
        stop_ai_when: listFromText(stopRules),
        do_not_speak_when: listFromText(quietRules),
        important_lead_signals: listFromText(importantSignals),
      }
      return updateAIAgent(agent.id, {
        system_prompt: mergeManagedAgentRules(systemPrompt, behaviourRules, faqThresh),
        handoff_rules: {
          ...(agent.handoff_rules || {}),
          ui_managed: true,
          review_low_confidence: behaviourRules.review_low_confidence,
          draft_high_risk: behaviourRules.draft_high_risk,
          human_review_triggers: behaviourRules.human_review_triggers,
          stop_ai_when: behaviourRules.stop_ai_when,
          do_not_speak_when: behaviourRules.do_not_speak_when,
        },
        qualification_criteria: {
          ...(agent.qualification_criteria || {}),
          important_lead_signals: behaviourRules.important_lead_signals,
        },
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
        subtitle="Set how the agent speaks, when it should pause, and when a person should review."
        right={
          <PrimaryButton onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
          </PrimaryButton>
        }
      />
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr),minmax(320px,0.85fr)] gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">Core instruction</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Write the normal operating style. The rules below are attached automatically when you save.
                </div>
              </div>
              <PillPop className="pill-slate">live prompt</PillPop>
            </div>
            <TextArea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              placeholder="You are a helpful WhatsApp sales assistant. Answer from knowledge, stay concise, sound human, and ask one clear next question."
              className="mt-4 font-mono text-xs"
            />
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                <Check className="w-4 h-4" /> Safe automation
              </div>
              <div className="mt-3 space-y-3">
                <Toggle
                  checked={reviewLowConfidence}
                  onChange={setReviewLowConfidence}
                  label="Move low-confidence replies to human review"
                  hint="Best for trust: AI still helps, but risky answers wait for a person."
                />
                <Toggle
                  checked={draftHighRisk}
                  onChange={setDraftHighRisk}
                  label="Draft first for sensitive messages"
                  hint="Complaints, money disputes, or confused buyers should get an editable draft."
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">Confidence gate</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Higher means safer but more human review.
                  </div>
                </div>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-sm text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-100">
                  {faqThresh.toFixed(2)}
                </span>
              </div>
              <input
                type="range" min="0" max="1" step="0.01"
                value={faqThresh}
                onChange={(e) => setFaqThresh(parseFloat(e.target.value))}
                className="mt-4 w-full accent-emerald-600"
              />
              <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-wider text-slate-400">
                <span>More automatic</span>
                <span>More careful</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <RuleBox
            tone="rose"
            icon={<AlertTriangle className="w-4 h-4" />}
            title="Send to human review when..."
            subtitle="One condition per line. These become urgency signals."
            value={reviewTriggers}
            onChange={setReviewTriggers}
            placeholder={"buyer asks for human\nbuyer is angry or complains\npayment/refund/legal issue\nAI confidence is low"}
          />
          <RuleBox
            tone="amber"
            icon={<ChevronRight className="w-4 h-4" />}
            title="Stop AI when..."
            subtitle="The agent pauses and waits instead of continuing."
            value={stopRules}
            onChange={setStopRules}
            placeholder={"buyer says stop/don't message\nbuyer says already purchased\nbuyer requests callback/meeting\nconversation is closed"}
          />
          <RuleBox
            tone="blue"
            icon={<Bot className="w-4 h-4" />}
            title="Do not speak when..."
            subtitle="Hard boundaries for risky or unwanted replies."
            value={quietRules}
            onChange={setQuietRules}
            placeholder={"message is only a delivery status update\nbuyer sent only emoji/sticker\noutside product/business scope\nanswer is not in knowledge"}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-white">Important lead signals</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                These phrases help mark hot leads and priority numbers in human review.
              </div>
            </div>
            <PillPop className="pill-emerald">priority logic</PillPop>
          </div>
          <TextArea
            value={importantSignals}
            onChange={(e) => setImportantSignals(e.target.value)}
            rows={3}
            placeholder={"asks price or quote\nasks meeting/callback\nmentions bulk quantity\nsays ready to order"}
            className="mt-4 text-xs"
          />
        </div>

        <div className="hidden">
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
      </div>
    </Card>
  )
}

function RuleBox({
  title, subtitle, value, onChange, placeholder, icon, tone,
}: {
  title: string
  subtitle: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  icon: React.ReactNode
  tone: 'rose' | 'amber' | 'blue'
}) {
  const toneClass = {
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300',
    blue: 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950 dark:text-white">{title}</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</div>
        </div>
      </div>
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        placeholder={placeholder}
        className="mt-4 text-xs"
      />
    </div>
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

type ManagedBehaviourRules = {
  review_low_confidence: boolean
  draft_high_risk: boolean
  human_review_triggers: string[]
  stop_ai_when: string[]
  do_not_speak_when: string[]
  important_lead_signals: string[]
}

const MANAGED_RULES_START = '<!-- WHATSYITC_AGENT_RULES_START -->'
const MANAGED_RULES_END = '<!-- WHATSYITC_AGENT_RULES_END -->'

const DEFAULT_MANAGED_RULES: ManagedBehaviourRules = {
  review_low_confidence: true,
  draft_high_risk: true,
  human_review_triggers: [
    'buyer asks for a human or says they want to talk to a person',
    'buyer is angry, disappointed, abusive, or making a complaint',
    'refund, payment dispute, legal, credit, or sensitive personal issue',
    'AI is not confident or the answer is not supported by knowledge',
  ],
  stop_ai_when: [
    'buyer says stop, unsubscribe, do not message, or not interested',
    'buyer says they already purchased or the issue is resolved',
    'buyer asks for callback, meeting, or a specific human commitment',
    'conversation reaches a clear close or no further sales step is useful',
  ],
  do_not_speak_when: [
    'message is only a delivery/read/status update',
    'buyer sends only emoji, sticker, media without text, or unclear one-word text',
    'question is outside this business, product, pricing, delivery, or support scope',
    'answer cannot be grounded in the selected knowledge base',
  ],
  important_lead_signals: [
    'asks for price, quote, discount, catalog, stock, delivery date, or payment terms',
    'mentions bulk quantity, urgent need, repeat order, or ready to buy',
    'asks for meeting, callback, sample, invoice, or final confirmation',
  ],
}

function getManagedBehaviourRules(agent: AIAgentConfig): ManagedBehaviourRules {
  const handoff = agent.handoff_rules || {}
  const qual = agent.qualification_criteria || {}
  return {
    review_low_confidence: boolFromAny(handoff.review_low_confidence, DEFAULT_MANAGED_RULES.review_low_confidence),
    draft_high_risk: boolFromAny(handoff.draft_high_risk, DEFAULT_MANAGED_RULES.draft_high_risk),
    human_review_triggers: listFromAny(handoff.human_review_triggers, DEFAULT_MANAGED_RULES.human_review_triggers),
    stop_ai_when: listFromAny(handoff.stop_ai_when, DEFAULT_MANAGED_RULES.stop_ai_when),
    do_not_speak_when: listFromAny(handoff.do_not_speak_when, DEFAULT_MANAGED_RULES.do_not_speak_when),
    important_lead_signals: listFromAny(qual.important_lead_signals, DEFAULT_MANAGED_RULES.important_lead_signals),
  }
}

function stripManagedAgentRules(prompt: string): string {
  const start = prompt.indexOf(MANAGED_RULES_START)
  const end = prompt.indexOf(MANAGED_RULES_END)
  if (start === -1 || end === -1 || end < start) return prompt
  return `${prompt.slice(0, start)}${prompt.slice(end + MANAGED_RULES_END.length)}`.trim()
}

function mergeManagedAgentRules(prompt: string, rules: ManagedBehaviourRules, threshold: number): string {
  const base = stripManagedAgentRules(prompt).trim()
  const managed = [
    MANAGED_RULES_START,
    'Operating rules for live WhatsApp conversations:',
    '- Sound like a helpful human sales assistant. Keep replies short, warm, and specific.',
    '- Use the selected knowledge base. If knowledge is missing, do not invent facts.',
    `- Confidence gate: when confidence is below ${threshold.toFixed(2)}, do not auto-send a risky answer.`,
    rules.review_low_confidence ? '- Low-confidence or unsupported answers should move to human review.' : '- Low-confidence answers may still be answered if the response is clearly safe and honest.',
    rules.draft_high_risk ? '- For sensitive situations, prepare a draft and ask for human review instead of sending automatically.' : '- Sensitive situations may be answered only when the rule list below allows it.',
    '',
    'Send to human review when:',
    ...rules.human_review_triggers.map((x) => `- ${x}`),
    '',
    'Stop AI and wait when:',
    ...rules.stop_ai_when.map((x) => `- ${x}`),
    '',
    'Do not speak when:',
    ...rules.do_not_speak_when.map((x) => `- ${x}`),
    '',
    'Important lead signals to tag/watch:',
    ...rules.important_lead_signals.map((x) => `- ${x}`),
    MANAGED_RULES_END,
  ].join('\n')
  return [base, managed].filter(Boolean).join('\n\n')
}

function listFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

function textFromList(items: string[]): string {
  return items.join('\n')
}

function listFromAny(value: any, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.map((x) => String(x || '').trim()).filter(Boolean)
    return items.length > 0 ? items : fallback
  }
  if (typeof value === 'string') {
    const items = listFromText(value)
    return items.length > 0 ? items : fallback
  }
  return fallback
}

function boolFromAny(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  return fallback
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
