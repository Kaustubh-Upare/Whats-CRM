import { Link } from 'react-router-dom'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  Activity, ArrowRight, BarChart3, BellRing, Bot, BrainCircuit, Check,
  Clock, Database, FileSpreadsheet, Gauge, Headphones, Inbox, KeyRound, MessageCircle,
  MessageSquareText, MousePointer2, PhoneCall, Sparkles,
  Send, Target, TrendingUp, UploadCloud, Users, Wand2, Zap,
} from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'

type Tone = 'emerald' | 'cyan' | 'violet' | 'amber' | 'rose'

const toneClasses: Record<Tone, string> = {
  emerald: 'from-emerald-500 to-teal-500 shadow-emerald-500/25',
  cyan: 'from-cyan-500 to-sky-500 shadow-cyan-500/25',
  violet: 'from-violet-500 to-fuchsia-500 shadow-violet-500/25',
  amber: 'from-amber-500 to-orange-500 shadow-amber-500/25',
  rose: 'from-rose-500 to-pink-500 shadow-rose-500/25',
}

function PublicNav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -18, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="fixed left-0 right-0 top-3 z-50 px-4"
    >
      <div className={`mx-auto flex h-14 max-w-7xl items-center justify-between rounded-full border px-3 pl-4 transition-all duration-300 ${
        scrolled
          ? 'border-white/70 bg-white/82 shadow-[0_18px_60px_-28px_rgba(15,23,42,0.5)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/78'
          : 'border-white/50 bg-white/48 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45'
      }`}>
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-sm font-black text-white shadow-lg shadow-emerald-500/25">
            W
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-slate-950 dark:text-white">WhatsyITC</span>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">AI sales agent</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-[13px] font-medium text-slate-600 dark:text-slate-300 md:flex">
          <a href="#platform" className="hover:text-slate-950 dark:hover:text-white">Platform</a>
          <a href="#workflow" className="hover:text-slate-950 dark:hover:text-white">Workflow</a>
          <a href="#use-cases" className="hover:text-slate-950 dark:hover:text-white">Use cases</a>
          <Link to="/pricing" className="hover:text-slate-950 dark:hover:text-white">Pricing</Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle variant="pill" />
          <Link
            to="/login"
            className="hidden rounded-full px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-[13px] font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:shadow-xl dark:bg-white dark:text-slate-950"
          >
            Open admin <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </motion.header>
  )
}

function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-70" />
      <div className="aurora-blob aurora-1 absolute -left-48 -top-52 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.42),transparent_68%)] dark:bg-[radial-gradient(circle,rgba(16,185,129,0.26),transparent_68%)]" />
      <div className="aurora-blob aurora-2 absolute -right-40 top-12 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.34),transparent_70%)] dark:bg-[radial-gradient(circle,rgba(6,182,212,0.22),transparent_70%)]" />
      <div className="aurora-blob aurora-3 absolute left-1/3 top-[32rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.28),transparent_70%)] dark:bg-[radial-gradient(circle,rgba(139,92,246,0.2),transparent_70%)]" />
    </div>
  )
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false
  const phrases = ['follows up automatically', 'answers from your knowledge', 'flags hot buyers', 'keeps every batch moving']
  const [phraseIndex, setPhraseIndex] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -90])
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.35])

  useEffect(() => {
    if (reduced) return
    const timer = window.setInterval(() => {
      setPhraseIndex((value) => (value + 1) % phrases.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [phrases.length, reduced])

  return (
    <section ref={ref} className="relative overflow-hidden pb-16 pt-28 sm:pt-32 lg:pb-24 lg:pt-40">
      <Aurora />
      <div className="noise-overlay" />
      <motion.div style={{ y, opacity }} className="mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-12 lg:gap-14 lg:px-8">
        <div className="lg:col-span-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            WhatsApp AI follow-ups, built for Indian distributors
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-4xl text-display text-[42px] text-slate-950 dark:text-white sm:text-6xl lg:text-[74px]"
          >
            Your WhatsApp sales desk, running on autopilot.
          </motion.h1>

          <div className="mt-4 flex min-h-[2rem] flex-wrap items-center gap-2 text-xl font-semibold text-slate-800 dark:text-slate-100 sm:text-2xl">
            <span>The agent</span>
            <span className="relative inline-flex min-w-[18rem] overflow-hidden rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              <motion.span
                key={phraseIndex}
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -24, opacity: 0 }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              >
                {phrases[phraseIndex]}
              </motion.span>
            </span>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.17, duration: 0.5 }}
            className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300"
          >
            Upload retailer lists, connect Meta Cloud API, train a knowledge base, and let an AI agent follow up with every buyer. Human review catches the urgent chats before they turn cold.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-3 font-semibold text-white shadow-[0_18px_45px_-18px_rgba(16,185,129,0.8)] transition hover:-translate-y-1 hover:shadow-[0_22px_60px_-18px_rgba(16,185,129,0.95)]"
            >
              Launch the agent <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-5 py-3 font-semibold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:bg-white dark:border-white/10 dark:bg-white/8 dark:text-white dark:hover:bg-white/12"
            >
              View pricing <MousePointer2 className="h-4 w-4" />
            </Link>
          </motion.div>

          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {[
              ['3 min', 'batch setup'],
              ['24/7', 'AI replies'],
              ['1 inbox', 'human review'],
            ].map(([value, label]) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.45 }}
                className="rounded-2xl border border-white/70 bg-white/58 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/70"
              >
                <div className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</div>
                <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, rotateX: 8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ delay: 0.16, duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6"
        >
          <ProductStage />
        </motion.div>
      </motion.div>
    </section>
  )
}

function ProductStage() {
  const messages = [
    ['Buyer', 'What is the price for kaju katli boxes?', '11:32'],
    ['AI', 'We have 250g, 500g, and 1kg packs. For bulk orders I can share the best slab pricing. How many boxes do you need?', '11:32'],
    ['Buyer', 'Need 40 boxes next week', '11:33'],
  ]

  return (
    <div className="relative mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, x: -12, y: 8 }}
        animate={{ opacity: 1, x: 0, y: [0, -8, 0] }}
        transition={{ opacity: { delay: 0.6 }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }}
        className="absolute -left-5 top-16 z-10 hidden rounded-2xl border border-white/70 bg-white/78 px-3 py-2 text-xs font-semibold text-slate-700 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/78 dark:text-slate-200 sm:flex sm:items-center sm:gap-2"
      >
        <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
        Hot lead detected
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: 14, y: 10 }}
        animate={{ opacity: 1, x: 0, y: [0, 8, 0] }}
        transition={{ opacity: { delay: 0.8 }, y: { duration: 5.8, repeat: Infinity, ease: 'easeInOut' } }}
        className="absolute -right-4 bottom-20 z-10 hidden rounded-2xl border border-white/70 bg-white/78 px-3 py-2 text-xs font-semibold text-slate-700 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/78 dark:text-slate-200 sm:flex sm:items-center sm:gap-2"
      >
        <Database className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        KB matched pricing
      </motion.div>
      <motion.div
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
        className="absolute -inset-6 rounded-[2rem] border border-dashed border-emerald-300/60 dark:border-emerald-400/25"
      />
      <div className="glass-premium glass-highlight relative overflow-hidden rounded-[1.75rem] shadow-[0_30px_90px_-36px_rgba(15,23,42,0.55)] dark:shadow-[0_30px_100px_-40px_rgba(16,185,129,0.32)]">
        <div className="landing-scan-line" />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_18%_12%,rgba(16,185,129,0.14),transparent_28%),radial-gradient(circle_at_90%_18%,rgba(6,182,212,0.12),transparent_22%)]" />
        <div className="flex items-center justify-between border-b border-white/60 bg-white/45 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            AI follow-up control room
          </div>
          <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
        </div>

        <div className="relative z-[2] grid gap-0 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="border-b border-white/60 p-4 dark:border-white/10 lg:border-b-0 lg:border-r">
            <div className="rounded-2xl bg-slate-950 p-4 text-white shadow-2xl shadow-slate-950/25">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">Batch #40</div>
                  <div className="mt-1 text-lg font-semibold">Sweets wholesale follow-up</div>
                </div>
                <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-xs font-semibold text-emerald-300">Live</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <MiniStat label="Tracked" value="428" />
                <MiniStat label="Replies" value="116" />
                <MiniStat label="Urgent" value="9" hot />
              </div>
              <div className="mt-5 space-y-2">
                {[
                  ['Human review', 'Price objection detected', 'critical'],
                  ['AI sent', 'Personal quote follow-up', 'sent'],
                  ['Knowledge used', 'Bulk mithai pricing', 'fresh'],
                ].map(([title, desc, state]) => (
                  <div key={title} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/8">
                      {state === 'critical' ? <BellRing className="h-4 w-4 text-rose-300" /> : <Sparkles className="h-4 w-4 text-emerald-300" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{title}</span>
                      <span className="block truncate text-xs text-slate-400">{desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4">
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-950">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3 dark:border-white/10">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">Test Retailer</div>
                  <div className="text-xs text-slate-500">AI agent replying with knowledge</div>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {messages.map(([who, body, time], index) => (
                  <motion.div
                    key={body}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.12 }}
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${
                      who === 'AI'
                        ? 'ml-auto bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                        : 'border border-slate-200 bg-slate-100 text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white'
                    }`}
                  >
                    <div>{body}</div>
                    <div className={`mt-1 text-[10px] ${who === 'AI' ? 'text-emerald-50/80' : 'text-slate-500'}`}>{time}</div>
                  </motion.div>
                ))}
                <motion.div
                  animate={{ opacity: [0.55, 1, 0.55] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200"
                >
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  AI drafting next best reply
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${hot ? 'border-rose-400/25 bg-rose-400/10' : 'border-white/10 bg-white/5'}`}>
      <div className={`text-2xl font-semibold ${hot ? 'text-rose-200' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
    </div>
  )
}

function SignalStrip() {
  const signals = [
    { icon: Send, text: 'AI sent a polite second follow-up', tone: 'text-emerald-600 dark:text-emerald-300' },
    { icon: Target, text: 'High intent buyer asking for bulk pricing', tone: 'text-rose-600 dark:text-rose-300' },
    { icon: Database, text: 'Knowledge matched product catalog', tone: 'text-cyan-600 dark:text-cyan-300' },
    { icon: BellRing, text: 'Human review needed for complaint', tone: 'text-amber-600 dark:text-amber-300' },
    { icon: TrendingUp, text: 'Batch reply rate increased today', tone: 'text-violet-600 dark:text-violet-300' },
    { icon: Clock, text: 'Next touch scheduled automatically', tone: 'text-slate-600 dark:text-slate-300' },
  ]
  const loop = [...signals, ...signals, ...signals]

  return (
    <section className="relative -mt-4 overflow-hidden border-y border-slate-200/70 bg-slate-950 py-5 text-white shadow-[0_22px_70px_-45px_rgba(15,23,42,0.8)] dark:border-white/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(16,185,129,0.22),transparent_28%),radial-gradient(circle_at_80%_50%,rgba(6,182,212,0.18),transparent_26%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-slate-950 via-slate-950/88 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-slate-950 via-slate-950/88 to-transparent" />
      <div className="relative mb-3 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        <span className="h-px w-10 bg-gradient-to-r from-transparent to-emerald-400" />
        live signals moving through the agent
        <span className="h-px w-10 bg-gradient-to-l from-transparent to-cyan-400" />
      </div>
      <div className="landing-signal-rail relative">
        <div className="landing-marquee flex w-max gap-3 pr-3">
          {loop.map((item, index) => (
            <div
              key={`${item.text}-${index}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 shadow-lg shadow-slate-950/20 backdrop-blur"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/8">
                <item.icon className={`h-4 w-4 ${item.tone}`} />
              </span>
              {item.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SectionHeader({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string
  title: string
  text: string
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
        <Sparkles className="h-3.5 w-3.5" /> {eyebrow}
      </div>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">{text}</p>
    </div>
  )
}

function Platform() {
  const cards = [
    {
      icon: BrainCircuit,
      title: 'Agent with memory',
      text: 'Answers from your knowledge base, remembers buyer context, and follows a clear sales objective.',
      tone: 'emerald' as Tone,
    },
    {
      icon: FileSpreadsheet,
      title: 'Batch-first workflow',
      text: 'Upload a sheet, rename the batch, enable AI, and track every retailer without manual list work.',
      tone: 'cyan' as Tone,
    },
    {
      icon: Headphones,
      title: 'Human review queue',
      text: 'Urgent, angry, confused, and high-intent numbers surface in one clean operator inbox.',
      tone: 'rose' as Tone,
    },
    {
      icon: BarChart3,
      title: 'AI CRM summary',
      text: 'Batch dashboards show buyer replies, action required, next touches, and generated summaries.',
      tone: 'violet' as Tone,
    },
  ]

  return (
    <section id="platform" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
      <SectionHeader
        eyebrow="Everything in one console"
        title="A sales assistant that feels operational, not experimental."
        text="The product is designed for teams that need a practical WhatsApp workflow: setup, knowledge, follow-ups, review, and reporting in the same admin."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: index * 0.06 }}
            whileHover={{ y: -6 }}
            className="glass-card glass-highlight p-5"
          >
            <div className={`inline-grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${toneClasses[card.tone]} text-white shadow-lg`}>
              <card.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-slate-950 dark:text-white">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{card.text}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function AutomationShowcase() {
  const scenes = [
    {
      icon: UploadCloud,
      label: 'Batch',
      title: 'Drop the spreadsheet and approve once.',
      text: 'WhatsyITC normalizes phones, attaches each retailer to a batch, and prepares the follow-up plan before the agent starts.',
      metric: '428',
      metricLabel: 'retailers queued',
      tone: 'emerald' as Tone,
      bullets: ['Valid phones found', 'Duplicate numbers warned', 'Template preview ready'],
    },
    {
      icon: BrainCircuit,
      label: 'Agent',
      title: 'Agent replies with memory and knowledge.',
      text: 'Every answer can use the latest chat history plus your knowledge base, so the response feels specific instead of generic.',
      metric: '92%',
      metricLabel: 'answered without handoff',
      tone: 'cyan' as Tone,
      bullets: ['Last messages read', 'Product knowledge used', 'Human tone preserved'],
    },
    {
      icon: Headphones,
      label: 'Review',
      title: 'Only urgent numbers interrupt the human.',
      text: 'Failed sends, angry replies, hot leads, pricing confusion, and human-needed requests land in one clean review queue.',
      metric: '9',
      metricLabel: 'need action now',
      tone: 'rose' as Tone,
      bullets: ['Priority ranked', 'AI advice cached', 'Open timeline instantly'],
    },
  ]
  const [active, setActive] = useState(0)
  const scene = scenes[active]
  const Icon = scene.icon

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((value) => (value + 1) % scenes.length)
    }, 4200)
    return () => window.clearInterval(timer)
  }, [scenes.length])

  return (
    <section className="relative overflow-hidden py-20">
      <Aurora />
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-300">
              <Gauge className="h-3.5 w-3.5" /> Interactive command center
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              One operating system for the whole AI follow-up loop.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">
              The landing page now mirrors the product promise: operators see batches, agent thinking, and human review as one connected flow.
            </p>

            <div className="mt-7 grid gap-2">
              {scenes.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`group flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    active === index
                      ? 'border-emerald-300 bg-white shadow-lg shadow-emerald-900/5 dark:border-emerald-400/30 dark:bg-white/10'
                      : 'border-slate-200 bg-white/50 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/8'
                  }`}
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${toneClasses[item.tone]} text-white shadow-lg`}>
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-950 dark:text-white">{item.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{item.title}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <motion.div
            key={active}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-2xl shadow-slate-950/25 dark:border-white/10"
          >
            <div className="landing-scan-line opacity-60" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${toneClasses[scene.tone]} text-white shadow-lg`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{scene.label} mode</div>
                  <div className="mt-1 text-xl font-semibold">{scene.title}</div>
                </div>
              </div>
              <span className="hidden rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-semibold text-emerald-200 sm:inline-flex">
                Live preview
              </span>
            </div>

            <div className="relative mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-2xl border border-white/10 bg-white/8 p-5">
                <div className="text-5xl font-semibold tracking-tight">{scene.metric}</div>
                <div className="mt-1 text-sm text-slate-400">{scene.metricLabel}</div>
                <div className="mt-6 space-y-3">
                  {scene.bullets.map((bullet, index) => (
                    <motion.div
                      key={bullet}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.08 }}
                      className="flex items-center gap-2 text-sm text-slate-200"
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-400/15 text-emerald-200">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      {bullet}
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="text-sm font-semibold">Automation timeline</div>
                  <div className="flex items-center gap-1 text-xs text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    active
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    ['Read context', 'Last 20 messages + batch state'],
                    ['Think', scene.text],
                    ['Act', active === 2 ? 'Queue human review with AI advice' : 'Send or schedule the next best message'],
                  ].map(([title, text], index) => (
                    <motion.div
                      key={title}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 + index * 0.08 }}
                      className="rounded-xl bg-white/8 p-3"
                    >
                      <div className="text-sm font-semibold">{title}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">{text}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function Workflow() {
  const steps = [
    { icon: KeyRound, title: 'Connect Meta', text: 'Add phone number ID, access token, and webhook verify token.' },
    { icon: Wand2, title: 'Train knowledge', text: 'Paste product catalog, policies, pricing rules, and objection answers.' },
    { icon: UploadCloud, title: 'Enable follow-ups', text: 'Choose the batch, agent, cadence, and template preview before sending.' },
    { icon: Inbox, title: 'Review only what matters', text: 'AI replies automatically. Humans handle urgent or sensitive numbers.' },
  ]

  return (
    <section id="workflow" className="relative overflow-hidden py-20">
      <Aurora />
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-300">
              <Zap className="h-3.5 w-3.5" /> Live flow
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              From spreadsheet to reply-ready pipeline.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">
              The interface keeps every major action obvious. Setup lives in the agent pages, batch controls live in follow-ups, and human escalation lives in review.
            </p>
            <Link to="/how-it-works" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              See the full walkthrough <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative">
            <div className="absolute left-7 top-8 hidden h-[calc(100%-4rem)] w-px bg-gradient-to-b from-emerald-300 via-cyan-300 to-violet-300 sm:block" />
            <div className="space-y-4">
              {steps.map((step, index) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: 18 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ delay: index * 0.08 }}
                  className="relative flex gap-4 rounded-2xl border border-white/70 bg-white/68 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/75"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-xl shadow-slate-950/15 dark:bg-white dark:text-slate-950">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step {index + 1}</div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.text}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function OutcomesBand() {
  const outcomes = [
    { icon: Activity, label: 'Replies tracked', value: '100%', width: '100%', tone: 'bg-emerald-400' },
    { icon: Bot, label: 'Routine questions handled by AI', value: '92%', width: '92%', tone: 'bg-cyan-400' },
    { icon: Headphones, label: 'Urgent chats routed to humans', value: '<1 min', width: '78%', tone: 'bg-rose-400' },
    { icon: TrendingUp, label: 'Follow-ups kept on cadence', value: '24/7', width: '88%', tone: 'bg-violet-400' },
  ]

  return (
    <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/25 lg:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(16,185,129,0.28),transparent_28%),radial-gradient(circle_at_92%_10%,rgba(139,92,246,0.20),transparent_24%),radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.18),transparent_38%)]" />
        <div className="landing-scan-line opacity-40" />
        <div className="relative grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-semibold text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" /> Sales operations, upgraded
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Less manual chasing. More timely replies. Clear control when a buyer needs a human.
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Every signal becomes visible: who replied, who needs help, what the agent did, and what should happen next.
            </p>
          </div>
          <div className="grid gap-3">
            {outcomes.map((outcome, index) => (
              <motion.div
                key={outcome.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ delay: index * 0.06 }}
                className="rounded-2xl border border-white/10 bg-white/7 p-4 backdrop-blur"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-slate-100 shadow-sm">
                      <outcome.icon className="h-4 w-4" />
                    </span>
                    <div className="text-sm font-semibold text-slate-100">{outcome.label}</div>
                  </div>
                  <div className="text-lg font-semibold tracking-tight text-white">{outcome.value}</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: outcome.width }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.18 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className={`h-full rounded-full ${outcome.tone}`}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function UseCases() {
  const items = [
    { icon: PhoneCall, title: 'Answer price questions instantly', text: 'The agent uses your catalog and pricing rules, then asks for quantity, delivery timing, or the next sales step.' },
    { icon: Users, title: 'Keep every retailer warm', text: 'Follow-ups stay on cadence for each batch, so interested buyers are not forgotten and quiet buyers are nudged politely.' },
    { icon: BellRing, title: 'Escalate the right conversations', text: 'Hot leads, complaints, failed sends, and handoff requests move into human review with the context already attached.' },
    { icon: MessageSquareText, title: 'See the full buyer thread', text: 'Bulk messages, AI replies, inbound chats, and follow-up history stay together so the operator never loses context.' },
  ]

  return (
    <section id="use-cases" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
      <SectionHeader
        eyebrow="Real sales moments"
        title="Built around the conversations that win orders."
        text="The AI agent does not just send messages. It understands buyer intent, keeps follow-ups timely, and tells your team exactly when a human should step in."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {items.map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: index * 0.06 }}
            className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-slate-900/80 dark:shadow-slate-950/30"
          >
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-600 group-hover:text-white dark:bg-emerald-500/10 dark:text-emerald-300">
                <item.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-lg font-semibold text-slate-950 dark:text-white">{item.title}</span>
                <span className="mt-2 block text-sm leading-6 text-slate-600 dark:text-slate-300">{item.text}</span>
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-8 text-white shadow-2xl shadow-emerald-900/20 lg:p-14">
        <div className="noise-overlay" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> Ready when your next batch is
            </div>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              Give every retailer a timely reply without hiring another full-time operator.
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link to="/login" className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 font-semibold text-emerald-700 transition hover:-translate-y-1">
              Open admin <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/pricing" className="inline-flex items-center gap-2 rounded-2xl border border-white/30 px-5 py-3 font-semibold text-white transition hover:-translate-y-1 hover:bg-white/10">
              Pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200/70 py-10 dark:border-white/10">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 text-sm text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 text-xs font-black text-white">W</span>
          <span>© {new Date().getFullYear()} WhatsyITC. WhatsApp sales automation.</span>
        </div>
        <div className="flex gap-5">
          <Link to="/how-it-works" className="hover:text-slate-950 dark:hover:text-white">How it works</Link>
          <Link to="/pricing" className="hover:text-slate-950 dark:hover:text-white">Pricing</Link>
          <Link to="/login" className="hover:text-slate-950 dark:hover:text-white">Sign in</Link>
        </div>
      </div>
    </footer>
  )
}

export default function Landing() {
  useEffect(() => {
    document.title = 'WhatsyITC - AI WhatsApp sales agent'
  }, [])

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.10),transparent_45%),radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.09),transparent_42%),linear-gradient(to_bottom,#ffffff,#f8fafc_42%,#f1f5f9)] text-slate-950 dark:bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.14),transparent_45%),radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.13),transparent_42%),linear-gradient(to_bottom,#020617,#07111f_45%,#020617)] dark:text-white">
      <PublicNav />
      <main>
        <Hero />
        <SignalStrip />
        <Platform />
        <AutomationShowcase />
        <Workflow />
        <OutcomesBand />
        <UseCases />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
