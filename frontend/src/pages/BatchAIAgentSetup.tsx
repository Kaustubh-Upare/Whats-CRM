import { useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Bot, CheckCircle2, ExternalLink, FileText, RefreshCw, Settings2,
  ShieldCheck, Sparkles,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, Empty, ErrorBox, PageHeader, PrimaryButton, SecondaryButton, Spinner } from '@/components/ui'
import { aiKeys, listAIAgents } from '@/lib/ai'
import { batchAIKeys, getBatchAgent, setBatchAgent } from '@/lib/batchAI'
import { batchDisplayName, fmtRelative } from '@/lib/format'
import type { AIAgentConfig, EffectiveAIAgent, UploadBatch } from '@/lib/types'

export default function BatchAIAgentSetup() {
  const { id } = useParams<{ id: string }>()
  const batchID = parseInt(id || '0', 10)
  const qc = useQueryClient()

  const batchQ = useQuery({
    queryKey: ['batch', String(batchID)],
    queryFn: async () => {
      const { data } = await api.get(`/api/batches/${batchID}`)
      return (data?.batch ?? null) as UploadBatch | null
    },
    enabled: batchID > 0,
    retry: false,
  })

  const effectiveQ = useQuery({
    queryKey: batchAIKeys.agent(batchID),
    queryFn: () => getBatchAgent(batchID),
    enabled: batchID > 0,
    retry: false,
  })

  const agentsQ = useQuery({
    queryKey: aiKeys.agents(),
    queryFn: listAIAgents,
    enabled: batchID > 0,
    retry: false,
  })

  const agents = agentsQ.data ?? []
  const defaultAgent = useMemo(() => agents.find((a) => a.is_default) ?? null, [agents])
  const batch = batchQ.data
  const effective = effectiveQ.data ?? null
  const batchName = batch ? batchDisplayName(batch) : `Batch #${batchID}`

  const apply = useMutation({
    mutationFn: (agentID: number | null) => setBatchAgent(batchID, { agent_id: agentID }),
    onSuccess: (next) => {
      toast.success(next.source === 'batch_override'
        ? `Batch now uses ${next.agent?.name || 'selected agent'}`
        : 'Batch now uses the global default')
      qc.invalidateQueries({ queryKey: batchAIKeys.agent(batchID) })
      qc.invalidateQueries({ queryKey: batchAIKeys.followup(batchID) })
      qc.invalidateQueries({ queryKey: ['ai', 'followups'] })
    },
    onError: (e: any) => toast.error(apiError(e, 'Could not update batch agent')),
  })

  if (!Number.isFinite(batchID) || batchID <= 0) {
    return <ErrorBox msg="Bad batch id" />
  }

  return (
    <>
      <PageHeader
        title="Agent setup"
        subtitle={`${batchName} - choose the assistant that should handle this batch.`}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                batchQ.refetch()
                effectiveQ.refetch()
                agentsQ.refetch()
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-[var(--input-bg)] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${batchQ.isFetching || effectiveQ.isFetching || agentsQ.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link to={`/admin/ai/followups/${batchID}`}>
              <SecondaryButton><ArrowLeft className="w-4 h-4" /> Batch control</SecondaryButton>
            </Link>
            <Link to="/admin/ai/agent">
              <SecondaryButton><Settings2 className="w-4 h-4" /> Manage agents</SecondaryButton>
            </Link>
          </div>
        }
      />

      {(batchQ.isError || effectiveQ.isError || agentsQ.isError) && (
        <div className="mb-5">
          <ErrorBox msg={apiError(batchQ.error || effectiveQ.error || agentsQ.error, 'Failed to load agent setup')} />
        </div>
      )}

      {batchQ.isLoading || effectiveQ.isLoading || agentsQ.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <Card hover={false} className="!p-0 overflow-hidden">
              <div className="border-b border-slate-200 bg-gradient-to-br from-white via-emerald-50/65 to-blue-50/55 px-5 py-5 dark:border-white/10 dark:from-white/[0.06] dark:via-emerald-500/10 dark:to-blue-500/10">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <Bot className="w-3.5 h-3.5 text-emerald-500" />
                  Resolved assistant
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
                    {effective?.agent?.name || 'No agent selected'}
                  </h2>
                  <SourceBadge effective={effective} />
                  {effective?.agent && (
                    <SetupPill tone={effective.agent.enabled ? 'emerald' : 'rose'}>
                      {effective.agent.enabled ? 'Enabled' : 'Disabled'}
                    </SetupPill>
                  )}
                </div>
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  {effective?.source === 'batch_override'
                    ? 'This batch has its own agent override.'
                    : effective?.source === 'global_default'
                      ? 'This batch follows whatever agent is marked as the global default.'
                      : 'Create or enable an agent before this batch can reply automatically.'}
                </div>
              </div>

              <div className="p-5 space-y-4">
                <AgentChoiceCard
                  title="Use global default"
                  subtitle={defaultAgent ? `${defaultAgent.name} will handle this batch until you change the default.` : 'No global default exists yet.'}
                  active={effective?.source !== 'batch_override'}
                  disabled={apply.isPending || !defaultAgent}
                  agent={defaultAgent}
                  actionLabel={effective?.source === 'batch_override' ? 'Clear override' : 'Using default'}
                  onClick={() => apply.mutate(null)}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {agents.map((agent) => (
                    <AgentChoiceCard
                      key={agent.id}
                      title={agent.name || `Agent #${agent.id}`}
                      subtitle={agent.system_prompt?.trim() || agent.persona_md?.trim() || 'No instructions saved yet.'}
                      active={effective?.source === 'batch_override' && effective.agent?.id === agent.id}
                      disabled={apply.isPending}
                      agent={agent}
                      actionLabel={effective?.source === 'batch_override' && effective.agent?.id === agent.id ? 'Selected' : 'Use for this batch'}
                      onClick={() => apply.mutate(agent.id)}
                    />
                  ))}
                </div>

                {agents.length === 0 && (
                  <Empty>
                    <span className="inline-flex flex-col items-center gap-2 text-center">
                      <Bot className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      <span>No agents exist yet.</span>
                      <Link to="/admin/ai/agent">
                        <PrimaryButton><Sparkles className="w-4 h-4" /> Create agent</PrimaryButton>
                      </Link>
                    </span>
                  </Empty>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-5 min-w-0">
            <Card hover={false} className="!p-0 overflow-hidden">
              <div className="p-5 border-b border-slate-200 dark:border-white/10">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  Batch
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                  {batchName}
                </div>
                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {batch?.file_name || `Batch #${batchID}`}
                </div>
              </div>
              <div className="p-5 space-y-3 text-sm">
                <InfoRow label="Status" value={batch?.status || 'Unknown'} />
                <InfoRow label="Rows" value={`${batch?.valid_rows ?? 0} valid from ${batch?.total_rows ?? 0}`} />
                <InfoRow label="Uploaded" value={batch?.created_at ? fmtRelative(batch.created_at) : 'Unknown'} />
                <Link to={`/admin/batches/${batchID}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300">
                  Open batch <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </Card>

            <Card hover={false} className="!p-0 overflow-hidden">
              <div className="p-5">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  How this works
                </div>
                <div className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <p>Use global default when this batch should follow your normal assistant.</p>
                  <p>Choose a specific agent when this batch needs different products, pricing, language, or tone.</p>
                  <p>Changing the global default later will not overwrite a batch override.</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

function AgentChoiceCard({
  title, subtitle, active, disabled, agent, actionLabel, onClick,
}: {
  title: string
  subtitle: string
  active: boolean
  disabled: boolean
  agent: AIAgentConfig | null
  actionLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      className={`w-full text-left rounded-lg border p-4 transition-all
                  ${active
                    ? 'border-emerald-400 bg-emerald-50/80 shadow-[0_16px_36px_-28px_rgba(16,185,129,0.95)] dark:border-emerald-400/35 dark:bg-emerald-500/10'
                    : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-blue-400/25 dark:hover:bg-blue-500/10'}
                  disabled:cursor-not-allowed disabled:opacity-70`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold text-slate-950 dark:text-white">{title}</div>
            {agent?.is_default && <SetupPill tone="blue">Default</SetupPill>}
            {agent && <SetupPill tone={agent.enabled ? 'emerald' : 'rose'}>{agent.enabled ? 'Enabled' : 'Disabled'}</SetupPill>}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-3">
            {subtitle}
          </div>
          {agent && (
            <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
              <span>{agent.primary_model || 'No model'}</span>
              <span>{agent.tone || 'friendly'}</span>
            </div>
          )}
        </div>
        <div className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold ${
          active
            ? 'bg-emerald-600 text-white'
            : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
        }`}>
          {active && <CheckCircle2 className="w-3 h-3" />}
          {actionLabel}
        </div>
      </div>
    </button>
  )
}

function SourceBadge({ effective }: { effective: EffectiveAIAgent | null }) {
  if (effective?.source === 'batch_override') return <SetupPill tone="emerald">Batch override</SetupPill>
  if (effective?.source === 'global_default') return <SetupPill tone="slate">Global default</SetupPill>
  return <SetupPill tone="amber">No agent</SetupPill>
}

function SetupPill({ tone, children }: { tone: 'emerald' | 'blue' | 'amber' | 'rose' | 'slate'; children: ReactNode }) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300',
    slate: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300',
  }[tone]
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  )
}

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback
}
