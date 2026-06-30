import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen, Bot, CheckCircle2, Clock3, Database, HelpCircle, MessageSquareText,
  Sparkles, Users, X, Zap,
} from 'lucide-react'
import { SecondaryButton } from '@/components/ui'

type GuideKind = 'agent' | 'knowledge' | 'followups' | 'human-review'

type GuideContent = {
  eyebrow: string
  title: string
  intro: string
  accent: string
  icon: ReactNode
  steps: Array<{ title: string; body: string }>
  snippetTitle: string
  snippet: Array<{ role: string; text: string; tone: 'customer' | 'ai' | 'system' | 'human' }>
  examples: Array<{ label: string; value: string }>
  checklist: string[]
}

const guides: Record<GuideKind, GuideContent> = {
  agent: {
    eyebrow: 'Agent setup guide',
    title: 'Build an agent that replies like your best sales operator.',
    intro: 'Use Persona, Behaviour, Knowledge, and Test Playground in order. The agent should know what it sells, when to pause, and when a human should step in.',
    accent: 'from-emerald-500 via-teal-500 to-cyan-500',
    icon: <Bot className="h-5 w-5" />,
    steps: [
      { title: 'Persona', body: 'Name the agent, set its tone, and describe how it should sound in WhatsApp: short, warm, clear, and useful.' },
      { title: 'Behaviour', body: 'Define stop rules: human requested, angry buyer, payment issue, low confidence, or topic outside your business.' },
      { title: 'Knowledge', body: 'Attach only the knowledge this agent should use. This prevents one batch from mixing products from another batch.' },
      { title: 'Test', body: 'Ask real buyer questions before going live. If it cannot answer from knowledge, fix knowledge first.' },
    ],
    snippetTitle: 'Live snippet',
    snippet: [
      { role: 'Buyer', text: 'Can you tell me price for kaju katli boxes?', tone: 'customer' },
      { role: 'AI', text: 'Sure 😊 What box size and quantity are you looking for? I can share the best available option.', tone: 'ai' },
      { role: 'System', text: 'Knowledge matched: product catalog + pricing rule. Confidence high. No human review needed.', tone: 'system' },
    ],
    examples: [
      { label: 'Good persona', value: 'Friendly sales assistant. Replies in 1-3 short WhatsApp lines. Uses light emojis. Never asks for phone number.' },
      { label: 'Human review rule', value: 'Move to human when buyer asks for discount approval, complains, shares payment proof, or requests a manager.' },
      { label: 'Do not speak rule', value: 'Do not answer medical, legal, unrelated, or competitor questions. Politely offer a human instead.' },
    ],
    checklist: ['One enabled default agent exists', 'Tone matches the brand', 'Knowledge is attached', 'Playground answer is correct'],
  },
  knowledge: {
    eyebrow: 'Knowledge setup guide',
    title: 'Teach the AI exactly what it is allowed to know.',
    intro: 'Add product lists, pricing rules, delivery notes, FAQs, offers, and complaint policies. Good knowledge makes replies specific instead of generic.',
    accent: 'from-blue-500 via-indigo-500 to-violet-500',
    icon: <Database className="h-5 w-5" />,
    steps: [
      { title: 'Add facts', body: 'Use clear titles like “Kaju katli pricing” or “Delivery rules”. Keep one topic per chunk when possible.' },
      { title: 'Use Generate', body: 'Paste long documents. The importer splits them into source-preserving chunks so retrieval can find the right part later.' },
      { title: 'Test retrieval', body: 'Search like a buyer. If the right chunk does not appear, improve the title or add missing keywords.' },
      { title: 'Keep it current', body: 'Update pricing, stock, offers, and policies when they change. The AI should not guess.' },
    ],
    snippetTitle: 'Knowledge example',
    snippet: [
      { role: 'Chunk', text: 'Title: Kaju katli boxes. Content: 250g, 500g, 1kg boxes available. Bulk orders get quote after quantity.', tone: 'system' },
      { role: 'Buyer', text: 'What sweets do you have?', tone: 'customer' },
      { role: 'AI', text: 'We have kaju katli boxes in 250g, 500g, and 1kg. For bulk quantity I can help you get a quote.', tone: 'ai' },
    ],
    examples: [
      { label: 'Product chunk', value: 'Product name, sizes, price range, minimum order, availability, and what question to ask next.' },
      { label: 'Policy chunk', value: 'Delivery area, payment terms, return policy, complaint process, and human escalation condition.' },
      { label: 'Offer chunk', value: 'Offer name, eligibility, expiry date, exclusions, and exact wording the AI can use.' },
    ],
    checklist: ['Product catalog added', 'Pricing rules added', 'Delivery/payment rules added', 'Retrieval test returns the right chunks'],
  },
  followups: {
    eyebrow: 'Follow-up setup guide',
    title: 'Turn uploaded numbers into a calm AI follow-up workflow.',
    intro: 'Enable AI on a batch, choose the cadence, review duplicate numbers, and let the agent continue conversations without spamming buyers.',
    accent: 'from-amber-500 via-orange-500 to-rose-500',
    icon: <Clock3 className="h-5 w-5" />,
    steps: [
      { title: 'Pick a batch', body: 'Open a batch that has approved recipients. Give it a clear name so operators know what campaign it belongs to.' },
      { title: 'Enable AI', body: 'Choose default, custom, or smart mode. Smart mode lets AI decide whether to send or wait based on conversation state.' },
      { title: 'Resolve duplicates', body: 'If the same phone is in another batch, decide whether to skip it or override it with this batch agent.' },
      { title: 'Monitor timeline', body: 'Use Details to see planned next message, sent messages, buyer replies, and pauses.' },
    ],
    snippetTitle: 'Follow-up flow',
    snippet: [
      { role: 'AI', text: 'Hi Rahul 😊 Are you still interested in the sweets catalog we shared?', tone: 'ai' },
      { role: 'Buyer', text: 'Yes, tell me price for 1kg boxes.', tone: 'customer' },
      { role: 'System', text: 'Buyer replied. Follow-up cadence paused. AI answers from knowledge or moves to human if confidence is low.', tone: 'system' },
    ],
    examples: [
      { label: 'Default cadence', value: 'Every 3 days, max 5 touches. Good for simple batch warming.' },
      { label: 'Smart cadence', value: 'Sooner for warm buyers, slower for cold buyers, stop for complaints or human requests.' },
      { label: 'Draft mode idea', value: 'For sensitive campaigns, generate next message first and send only after operator approval.' },
    ],
    checklist: ['Batch approved', 'Agent selected', 'Duplicates reviewed', 'First message preview checked'],
  },
  'human-review': {
    eyebrow: 'Human review guide',
    title: 'See only the conversations where a person adds real value.',
    intro: 'Human Review is the command center for hot leads, complaints, failed sends, price questions, and low-confidence AI decisions.',
    accent: 'from-fuchsia-500 via-pink-500 to-rose-500',
    icon: <Users className="h-5 w-5" />,
    steps: [
      { title: 'Open the queue', body: 'Start with critical and high severity items. The same phone appears once with the strongest current reason.' },
      { title: 'Read the reason', body: 'Check why it needs review: buyer replied, human requested, failed send, complaint, hot lead, or first touch due.' },
      { title: 'Use AI help', body: 'Generate a concise suggested reply only when needed. Advice is cached so you do not spend tokens on every reload.' },
      { title: 'Resolve or hand back', body: 'After a human handles the issue, mark resolved or hand the conversation back to AI when safe.' },
    ],
    snippetTitle: 'Review signal',
    snippet: [
      { role: 'Buyer', text: 'Can someone call me? I want 20 boxes next week.', tone: 'customer' },
      { role: 'System', text: 'Hot lead + human needed. Priority high. Suggested action: call and confirm quantity/date.', tone: 'system' },
      { role: 'Human', text: 'Open conversation, call buyer, then mark resolved or let AI continue follow-up.', tone: 'human' },
    ],
    examples: [
      { label: 'Urgent', value: 'Complaint, failed send, angry tone, payment proof, or explicit human request.' },
      { label: 'Important', value: 'Price question, meeting request, bulk quantity, delivery date, or buyer asks for quote.' },
      { label: 'Safe for AI', value: 'Simple product questions where knowledge matched and confidence is high.' },
    ],
    checklist: ['Critical queue checked', 'Suggested reply reviewed', 'Conversation opened if needed', 'Resolved after action'],
  },
}

export function AISetupGuideButton({ guide, label = 'Setup guide' }: { guide: GuideKind; label?: string }) {
  return (
    <Link
      to={`/admin/ai/setup-guide#${guide}`}
      className="inline-flex shrink-0"
    >
      <SecondaryButton type="button" className="pointer-events-none">
        <BookOpen className="h-4 w-4" /> {label}
      </SecondaryButton>
    </Link>
  )
}

function GuideModal({ content, onClose }: { content: GuideContent; onClose: () => void }) {
  const tone = useMemo(() => content.accent, [content.accent])
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/15 bg-white shadow-2xl dark:bg-slate-950"
      >
        <div className={`relative overflow-hidden bg-gradient-to-br ${tone} p-6 text-white sm:p-8`}>
          <div className="absolute inset-0 opacity-40">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/30 blur-3xl" />
            <div className="absolute -bottom-24 left-16 h-64 w-64 rounded-full bg-slate-950/25 blur-3xl" />
          </div>
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
                {content.icon} {content.eyebrow}
              </div>
              <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{content.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/85">{content.intro}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
              aria-label="Close setup guide"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-210px)] overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {content.steps.map((step, index) => (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white dark:bg-white dark:text-slate-950">
                        {index + 1}
                      </span>
                      <div className="font-semibold text-slate-950 dark:text-white">{step.title}</div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.body}</p>
                  </motion.div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-3 flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                  <Zap className="h-4 w-4 text-emerald-500" /> Example setup
                </div>
                <div className="grid gap-2">
                  {content.examples.map((item) => (
                    <div key={item.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/70">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{item.label}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-xl dark:border-white/10">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquareText className="h-4 w-4 text-emerald-300" /> {content.snippetTitle}
                </div>
                <div className="space-y-2">
                  {content.snippet.map((line, index) => (
                    <motion.div
                      key={`${line.role}-${index}`}
                      initial={{ opacity: 0, x: line.tone === 'customer' ? -12 : 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 + index * 0.08 }}
                      className={`rounded-2xl px-3 py-2 text-sm leading-6 ${snippetTone(line.tone)}`}
                    >
                      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-70">{line.role}</div>
                      {line.text}
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                <div className="flex items-center gap-2 font-semibold text-emerald-950 dark:text-emerald-100">
                  <Sparkles className="h-4 w-4" /> Ready checklist
                </div>
                <div className="mt-3 space-y-2">
                  {content.checklist.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-sm text-emerald-900 dark:text-emerald-100/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                <div className="mb-2 flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                  <HelpCircle className="h-4 w-4 text-blue-500" /> Simple rule
                </div>
                If the AI cannot answer with confidence from the selected agent and knowledge, it should pause, explain the reason, and move the phone to human review instead of guessing.
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function snippetTone(tone: GuideContent['snippet'][number]['tone']) {
  if (tone === 'customer') return 'mr-8 bg-white/10 text-slate-100'
  if (tone === 'ai') return 'ml-8 bg-emerald-400/15 text-emerald-50 ring-1 ring-emerald-300/20'
  if (tone === 'human') return 'ml-8 bg-fuchsia-400/15 text-fuchsia-50 ring-1 ring-fuchsia-300/20'
  return 'bg-sky-400/15 text-sky-50 ring-1 ring-sky-300/20'
}
