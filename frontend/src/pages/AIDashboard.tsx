import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Bot, BookOpen, MessagesSquare, ArrowRight, CheckCircle2, AlertTriangle, Mic } from 'lucide-react'
import { Card, CardHeader, PageHeader, Spinner, ErrorBox, GlassCard } from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { aiKeys, getAIStatus } from '@/lib/ai'

/**
 * /admin/ai — landing page for the AI assistant.
 *
 * Three big clickable cards (Agent, Knowledge, Conversations) plus a
 * status row at the top so the admin can see at a glance whether the
 * LLM stack is wired up.
 */
export default function AIDashboard() {
  const status = useQuery({
    queryKey: aiKeys.status(),
    queryFn: () => getAIStatus(),
    staleTime: 30_000,
  })

  return (
    <>
      <PageHeader
        title="AI Assistant"
        subtitle="Train, test, and deploy your WhatsApp AI agent."
      />

      {/* Status pills — the only piece that always renders. */}
      <Card className="mb-6">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-500" />
              Stack status
            </span>
          }
          subtitle="These come from GET /api/ai/status. Refresh to re-check."
          right={
            status.isLoading ? <Spinner /> : status.isError ? (
              <PillPop className="pill-red">unavailable</PillPop>
            ) : status.data ? (
              <div className="flex items-center gap-2">
                {status.data.llm_enabled ? (
                  <PillPop className="pill-green"><CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-0.5" />LLM</PillPop>
                ) : (
                  <PillPop className="pill-amber"><AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-0.5" />No LLM</PillPop>
                )}
                {status.data.embeddings_enabled && (
                  <PillPop className="pill-green">embeddings</PillPop>
                )}
                {status.data.transcriber_enabled && (
                  <PillPop className="pill-green"><Mic className="w-3 h-3 inline -mt-0.5 mr-0.5" />voice</PillPop>
                )}
              </div>
            ) : null
          }
        />
        <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
          {status.isLoading ? (
            <Spinner />
          ) : status.isError ? (
            <ErrorBox msg={(status.error as any)?.message || 'Failed to load status'} />
          ) : !status.data?.llm_enabled ? (
            <div className="rounded-md border border-amber-200 dark:border-amber-500/30
                            bg-amber-50 dark:bg-amber-500/10
                            p-3 text-amber-900 dark:text-amber-200">
              <strong>LLM is not configured.</strong> Add <code>AWS_BEARER_TOKEN_BEDROCK</code>,
              <code>AWS_REGION</code>, and <code>BEDROCK_MODEL</code> or an OpenAI API key in
              <code>backend/.env</code>, then restart the server. The agent config below still
              works, but live replies wait for an LLM.
            </div>
          ) : !status.data.embeddings_enabled ? (
            <div className="rounded-md border border-amber-200 dark:border-amber-500/30
                            bg-amber-50 dark:bg-amber-500/10
                            p-3 text-amber-900 dark:text-amber-200">
              <strong>Embeddings are not configured.</strong> Add an OpenAI API key
              in <code>backend/.env</code> so the knowledge base can be indexed.
              LLM auto-replies still work.
            </div>
          ) : (
            <div className="text-slate-700 dark:text-slate-300">
              All systems go. Configure the agent below, add some knowledge, and
              test the playground before plugging it into the WhatsApp webhook.
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <NavCard
          to="/admin/ai/agent"
          icon={Bot}
          title="Agent"
          desc="Persona, system prompt, working hours, handoff rules. Plus a test playground."
        />
        <NavCard
          to="/admin/ai/knowledge"
          icon={BookOpen}
          title="Knowledge base"
          desc="Add content the AI can ground its answers in. Manual paste, URL ingest, or both."
        />
        <NavCard
          to="/admin/ai/conversations"
          icon={MessagesSquare}
          title="Conversations"
          desc="Live inbox of AI-handled WhatsApp threads. Take over any conversation or hand it back."
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mt-6"
      >
        <GlassCard className="!p-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">How this works</h3>
          <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-1 list-decimal pl-5">
            <li><strong>Configure the agent</strong> — name, persona, system prompt, working hours, handoff rules.</li>
            <li><strong>Add knowledge</strong> — paste FAQs, ingest a URL, or upload a PDF. The AI uses these to answer customer questions.</li>
            <li><strong>Test the playground</strong> — ask the agent questions, see which KB chunks fire, see the cost.</li>
            <li><strong>Hook into WhatsApp</strong> — Phase 2 wires this config into the live WhatsApp webhook so the agent auto-replies 24/7.</li>
          </ol>
        </GlassCard>
      </motion.div>
    </>
  )
}

function NavCard({
  to, icon: Icon, title, desc, disabled = false,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  disabled?: boolean
}) {
  const inner = (
    <Card hover={!disabled} className={disabled ? 'opacity-50' : ''}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-500/15
                          text-emerald-700 dark:text-emerald-300
                          grid place-items-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
          </div>
        </div>
        {!disabled && (
          <div className="mt-3 inline-flex items-center gap-1 text-sm
                          text-emerald-700 dark:text-emerald-300 font-medium">
            Open <ArrowRight className="w-3.5 h-3.5" />
          </div>
        )}
        {disabled && (
          <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">Coming soon</div>
        )}
      </div>
    </Card>
  )
  if (disabled) return inner
  return <Link to={to}>{inner}</Link>
}
