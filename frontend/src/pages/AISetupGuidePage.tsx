import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Bot, BrainCircuit, CheckCircle2, Clock3, Database,
  MessageSquareText, Mouse, ShieldCheck, Sparkles, UserCheck, Zap,
} from 'lucide-react'
import { PageHeader, SecondaryButton } from '@/components/ui'

const sections = [
  {
    id: 'agent',
    n: 1,
    title: 'Set up the AI agent',
    eyebrow: 'Step 01 - Agent',
    accent: 'from-emerald-500 to-teal-500',
    icon: Bot,
    lead: 'Create the sales personality: what the agent sells, how it speaks, when it should stop, and when it should move a phone to human review.',
    bullets: [
      'Persona: short WhatsApp replies, warm tone, no unnecessary questions.',
      'Behaviour: stop for complaints, payment issues, human requests, and low confidence.',
      'Test Playground: ask real buyer questions before enabling follow-ups.',
    ],
    snippet: [
      ['Buyer', 'Can you tell me price for kaju katli boxes?'],
      ['AI', 'Sure. What box size and quantity are you looking for? I can share the best option.'],
      ['Signal', 'Knowledge matched. Confidence high. No human review needed.'],
    ],
    example: {
      title: 'Good persona example',
      body: 'Friendly sales assistant. Reply in 1-3 short WhatsApp lines. Use simple language. Ask one next-step question. Never ask for the phone number because WhatsApp already has it.',
    },
    deepDiveTitle: 'What each Agent tab means',
    deepDive: [
      {
        title: 'Persona tab',
        body: 'Use this for the agent name, language, tone, and main personality. Write what the agent sells and how it should sound. Example: “Friendly sweets sales assistant. Replies in short WhatsApp lines. Helps buyers choose quantity, box size, delivery date, and next step.”',
      },
      {
        title: 'Behaviour tab',
        body: 'Use this for safety and control. Tell the agent when to answer, when to stop, and when to send the phone to Human Review. Example: “If buyer asks for discount approval, payment proof, complaint, or manager, stop automatic reply and ask human.”',
      },
      {
        title: 'Knowledge tab',
        body: 'Pick the knowledge chunks this agent is allowed to use. This is important when one agent sells sweets and another sells sarees, because selected knowledge prevents mixed answers.',
      },
      {
        title: 'Test Playground tab',
        body: 'Ask realistic buyer questions before going live. Test product questions, price questions, complaint messages, and meeting requests. If the answer is weak, fix persona or knowledge first.',
      },
    ],
  },
  {
    id: 'knowledge',
    n: 2,
    title: 'Add knowledge the agent can trust',
    eyebrow: 'Step 02 - Knowledge',
    accent: 'from-blue-500 to-indigo-500',
    icon: Database,
    lead: 'Knowledge is the product catalog, pricing rules, delivery terms, offers, FAQs, and complaint policy that grounds every answer.',
    bullets: [
      'Use one topic per chunk: product, price, delivery, policy, or offer.',
      'For long documents, use Generate so the system creates searchable chunks.',
      'Use Test retrieval to confirm the right knowledge appears for buyer-style questions.',
    ],
    snippet: [
      ['Chunk', 'Kaju katli boxes: 250g, 500g, and 1kg boxes available. Bulk pricing depends on quantity.'],
      ['Buyer', 'What sweets do you have?'],
      ['AI', 'We have kaju katli boxes in 250g, 500g, and 1kg. For bulk quantity I can help get a quote.'],
    ],
    example: {
      title: 'Good knowledge chunk',
      body: 'Title: Delivery rules. Content: Same-city delivery is usually 24-48 hours. Ask for area and quantity before confirming delivery date.',
    },
    deepDiveTitle: 'How to use the Knowledge page',
    deepDive: [
      {
        title: 'Add Knowledge',
        body: 'Use this when you already know the exact answer. Add one clean topic at a time: product list, pricing, delivery, payment, offer, FAQ, or policy.',
      },
      {
        title: 'Generate from text',
        body: 'Use this for long pasted documents. The system splits the document into smaller chunks, keeps context, and makes them searchable for buyer questions.',
      },
      {
        title: 'Ingest URL',
        body: 'Use this when product or policy content lives on a webpage. After ingesting, test retrieval to confirm the correct page content appears.',
      },
      {
        title: 'Test retrieval',
        body: 'Type a buyer-style question like “What is the price for 1kg box?” If the right chunk appears, the agent can use it. If not, improve titles and keywords.',
      },
    ],
  },
  {
    id: 'followups',
    n: 3,
    title: 'Enable AI follow-ups for a batch',
    eyebrow: 'Step 03 - Follow-ups',
    accent: 'from-amber-500 to-orange-500',
    icon: Clock3,
    lead: 'Follow-ups keep retailers warm without forcing the operator to manually chase every number.',
    bullets: [
      'Open AI Follow-ups, choose a batch, then click enable AI.',
      'Review duplicate numbers before starting so one phone is not controlled by the wrong batch.',
      'Use smart mode when you want AI to wait, send sooner, or move to human review based on the chat.',
    ],
    snippet: [
      ['AI', 'Hi Rahul, are you still interested in the catalog we shared?'],
      ['Buyer', 'Yes, tell me price for 1kg boxes.'],
      ['Signal', 'Buyer replied. Cadence pauses. AI answers from knowledge or asks human if confidence is low.'],
    ],
    example: {
      title: 'Simple follow-up setup',
      body: 'Cadence: every 3 days. Max messages: 5. Goal: confirm interest, answer from knowledge, and move toward quantity, delivery date, or human call.',
    },
    deepDiveTitle: 'How to use AI Follow-ups',
    deepDive: [
      {
        title: 'Batches list',
        body: 'This shows uploaded batches and which ones are ready for AI. Open Details when you want to manage one batch and see its recipients.',
      },
      {
        title: 'Enable AI dialog',
        body: 'Choose behaviour mode, cadence, max messages, and duplicate-phone handling. If the same phone exists in another batch, decide to skip or override intentionally.',
      },
      {
        title: 'Batch details page',
        body: 'Use this to see recipients, current state, agent for this batch, timeline, and next planned message. This is where operators understand what AI is doing.',
      },
      {
        title: 'Send next / edit next',
        body: 'Use Send next when you want to manually trigger the next message. Use Edit next when the AI draft is close but needs a human touch.',
      },
    ],
  },
  {
    id: 'human-review',
    n: 4,
    title: 'Use Human Review as the command center',
    eyebrow: 'Step 04 - Human Review',
    accent: 'from-fuchsia-500 to-rose-500',
    icon: UserCheck,
    lead: 'Human Review should stay minimal. It shows only phones where a person can add value: hot leads, complaints, failed sends, price questions, or risky AI decisions.',
    bullets: [
      'Start with critical and high priority phones.',
      'Open the conversation, use AI help for a draft, then answer like a person.',
      'Mark resolved or hand back to AI only after the issue is handled.',
    ],
    snippet: [
      ['Buyer', 'Can someone call me? I want 20 boxes next week.'],
      ['Signal', 'Hot lead and human needed. Suggested action: call and confirm quantity/date.'],
      ['Human', 'Operator opens chat, calls buyer, then marks resolved.'],
    ],
    example: {
      title: 'When to review',
      body: 'Review if buyer asks for a manager, sends payment proof, complains, requests discount approval, asks for meeting, or the AI confidence is low.',
    },
    deepDiveTitle: 'How to use Human Review',
    deepDive: [
      {
        title: 'Urgency queue',
        body: 'Start from the left list. It should show one distinct phone per buyer, ordered by strongest priority: failed send, human needed, complaint, hot lead, then buyer replies.',
      },
      {
        title: 'Why this needs review',
        body: 'Read the reason before replying. It explains whether the buyer replied, asked for price, requested a human, complained, or the AI was not confident.',
      },
      {
        title: 'AI help',
        body: 'Use AI help when you want a concise draft or summary. The help is cached, so the system does not waste tokens every time you reload.',
      },
      {
        title: 'Resolve / hand back',
        body: 'After the human handles the issue, mark it resolved. Let AI continue only when the buyer is no longer angry, blocked, or waiting for human approval.',
      },
    ],
  },
]

export default function AISetupGuidePage() {
  const reduced = useReducedMotion() ?? false
  const location = useLocation()

  useEffect(() => {
    document.title = 'AI setup guide - WhatsyITC'
  }, [])

  useEffect(() => {
    if (!location.hash) return
    const target = document.querySelector(location.hash)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <div className="space-y-2">
      <PageHeader
        title="AI setup guide"
        subtitle="A complete walkthrough for setting up the sales agent, knowledge base, follow-ups, and human review."
        right={
          <Link to="/admin/ai">
            <SecondaryButton>
              <ArrowLeft className="h-4 w-4" /> Back to AI dashboard
            </SecondaryButton>
          </Link>
        }
      />

      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-slate-950 sm:p-8 lg:p-10">
        <div aria-hidden className="absolute inset-0">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="absolute -right-20 top-20 h-80 w-80 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-fuchsia-400/10 blur-3xl" />
        </div>
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Sparkles className="h-3.5 w-3.5" /> Animated walkthrough
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 dark:text-white lg:text-6xl"
            >
              Build the AI sales workflow without guessing.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300"
            >
              Follow this order: create the agent, teach knowledge, enable follow-ups, and let Human Review catch only the conversations that need a person.
            </motion.p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#agent"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:shadow-xl"
              >
                Start guide <Mouse className="h-4 w-4" />
              </a>
              <Link
                to="/admin/ai/agent"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
              >
                Open agent setup <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <HeroSnippet reduced={reduced} />
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl py-10">
        <div className="hidden lg:block absolute left-[9%] right-[9%] top-[73px] h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
        {!reduced && (
          <motion.div
            aria-hidden
            className="hidden lg:block absolute top-[70px] h-2 w-20 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-rose-400 blur-sm"
            animate={{ left: ['8%', '86%', '8%'] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="relative rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${section.accent} text-white shadow-lg`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">{section.title}</div>
              </a>
            )
          })}
        </div>
      </section>

      <div className="space-y-16">
        {sections.map((section, index) => (
          <GuideSection key={section.id} section={section} reversed={index % 2 === 1} />
        ))}
      </div>

      <FinalFlow />
    </div>
  )
}

function HeroSnippet({ reduced }: { reduced: boolean }) {
  const events = [
    ['Buyer asks', 'What products do you have?'],
    ['Knowledge matched', 'Catalog, price rules, delivery notes'],
    ['AI replies', 'Short answer plus one next-step question'],
    ['Review signal', 'Only risky or urgent phones reach humans'],
  ]
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white shadow-2xl dark:border-white/10"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BrainCircuit className="h-4 w-4 text-emerald-300" /> Live AI workflow
        </div>
        <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-200">smart mode</span>
      </div>
      <div className="space-y-3">
        {events.map(([label, text], index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + index * 0.12 }}
            className="rounded-2xl border border-white/10 bg-white/[0.06] p-3"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="mt-1 text-sm text-slate-100">{text}</div>
          </motion.div>
        ))}
      </div>
      {!reduced && (
        <motion.div
          aria-hidden
          className="absolute bottom-0 left-0 h-1 w-28 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400"
          animate={{ x: ['-20%', '430%', '-20%'] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  )
}

function GuideSection({ section, reversed }: { section: typeof sections[number]; reversed?: boolean }) {
  const Icon = section.icon
  return (
    <section id={section.id} className="scroll-mt-24">
      <div className={`grid gap-6 lg:grid-cols-2 lg:items-center ${reversed ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45 }}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-950 sm:p-8"
        >
          <div className={`inline-flex items-center gap-2 rounded-full bg-gradient-to-r ${section.accent} px-3 py-1 text-xs font-semibold text-white`}>
            <Icon className="h-3.5 w-3.5" /> {section.eyebrow}
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{section.title}</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">{section.lead}</p>
          <div className="mt-5 space-y-3">
            {section.bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{bullet}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{section.example.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{section.example.body}</div>
          </div>
          {'deepDive' in section && section.deepDive && (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                <Zap className="h-4 w-4 text-emerald-500" /> {section.deepDiveTitle}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.deepDive.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">{item.title}</div>
                    <div className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-300">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-2xl dark:border-white/10"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4 text-emerald-300" /> Live snippet
            </div>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-slate-300">example</span>
          </div>
          <div className="space-y-3">
            {section.snippet.map(([role, text], index) => (
              <motion.div
                key={`${section.id}-${role}-${index}`}
                initial={{ opacity: 0, x: role === 'Buyer' ? -14 : 14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={`rounded-2xl px-4 py-3 text-sm leading-6 ${snippetClass(role)}`}
              >
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-70">{role}</div>
                {text}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function snippetClass(role: string) {
  if (role === 'Buyer') return 'mr-10 bg-white/10 text-slate-100'
  if (role === 'AI') return 'ml-10 bg-emerald-400/15 text-emerald-50 ring-1 ring-emerald-300/20'
  if (role === 'Human') return 'ml-10 bg-fuchsia-400/15 text-fuchsia-50 ring-1 ring-fuchsia-300/20'
  return 'bg-sky-400/15 text-sky-50 ring-1 ring-sky-300/20'
}

function FinalFlow() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-950 p-6 text-white shadow-2xl sm:p-8 lg:p-10">
      <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            <ShieldCheck className="h-3.5 w-3.5" /> Final check
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight lg:text-4xl">The safest launch order</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Keep the system controlled: connect credentials, create an enabled agent, add knowledge, test answers, then enable follow-ups for a small batch first.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/admin/ai/agent" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50">
              Start with agent <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/admin/ai/knowledge" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
              Add knowledge
            </Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['1', 'Credentials verified'],
            ['2', 'Agent enabled'],
            ['3', 'Knowledge tested'],
            ['4', 'Follow-up batch reviewed'],
            ['5', 'Human Review monitored'],
            ['6', 'Conversation timeline checked'],
          ].map(([n, text]) => (
            <div key={text} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-400 text-sm font-bold text-slate-950">{n}</div>
                <div className="text-sm font-semibold">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
