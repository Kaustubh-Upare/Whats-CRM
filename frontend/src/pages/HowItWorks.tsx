import { Link } from 'react-router-dom'
import {
  motion, useReducedMotion, useInView, useScroll, useTransform,
} from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, ArrowLeft, ArrowUpRight, Check, CheckCheck, FileSpreadsheet,
  FileText, MessageSquare, MessagesSquare, UploadCloud, Send, Activity,
  Webhook, ShieldCheck, Sparkles, BarChart3, Eye, AlertCircle, Users,
  Building2, Bell, Headphones, Smartphone, Layers, ChevronRight, Zap,
  Plus, Search, X, Download, RefreshCw, MoreVertical, Phone, Hash,
  Database, Lock, Server, Cpu, Globe, Mail, Calendar, Pencil,
  Play, Pause, Filter, Settings2, Inbox, SendHorizonal, AtSign, Clock,
  Variable, Braces, Wand2, Type, ListChecks, Table2, Upload,
  FileUp, Paperclip, ArrowDownToLine, PhoneCall, MessageCircle, Reply,
  RotateCw, ChevronDown, Quote, Star, KeyRound, MousePointer2, Code2,
  TrendingUp, Sparkle, Hash as HashIcon, BookOpen, Mouse,
} from 'lucide-react'
import { CountUp, PillPop } from '@/lib/motion'
import ThemeToggle from '@/components/ThemeToggle'

/* ────────────────────────────────────────────────────────────────────────── */
/*  Shared chrome                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function TopBar() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 dark:bg-slate-950/80 border-b border-slate-200/70 dark:border-slate-800/70">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <motion.div
            whileHover={{ rotate: 10, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center text-white font-bold text-sm shadow-md shadow-emerald-500/30"
          >
            W
          </motion.div>
          <div className="leading-tight">
            <div className="font-semibold text-slate-900 dark:text-white text-sm">WhatsyITC</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">How it works</div>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 text-sm">
          <Link
            to="/"
            className="hidden sm:inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <ThemeToggle />
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                         text-white text-[13px] font-medium
                         bg-gradient-to-r from-brand-600 via-emerald-600 to-teal-600
                         shadow-[0_6px_20px_rgba(16,185,129,0.30)]
                         hover:shadow-[0_8px_24px_rgba(16,185,129,0.45)] transition-shadow"
            >
              Open admin <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </motion.div>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 mt-24">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center text-white font-bold text-xs shadow-md shadow-emerald-500/30">W</div>
          <span>© {new Date().getFullYear()} WhatsyITC.</span>
        </div>
        <div className="flex items-center gap-5 text-slate-500 dark:text-slate-400">
          <Link to="/" className="hover:text-slate-900 dark:hover:text-white">Home</Link>
          <Link to="/login" className="hover:text-slate-900 dark:hover:text-white">Sign in</Link>
          <a href="#faq" className="hover:text-slate-900 dark:hover:text-white">FAQ</a>
        </div>
      </div>
    </footer>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Eyebrow + Aurora + glass helpers                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function Eyebrow({
  icon: Icon, text, tone = 'emerald',
}: { icon: any; text: string; tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'slate' }) {
  const tones = {
    emerald: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    violet:  'bg-violet-50/80  text-violet-700  border-violet-200/80  dark:bg-violet-500/15  dark:text-violet-300  dark:border-violet-400/20',
    blue:    'bg-sky-50/80     text-sky-700     border-sky-200/80     dark:bg-sky-500/15     dark:text-sky-300     dark:border-sky-400/20',
    amber:   'bg-amber-50/80   text-amber-800   border-amber-200/80   dark:bg-amber-500/15   dark:text-amber-300   dark:border-amber-400/20',
    slate:   'bg-slate-100/80  text-slate-700   border-slate-200/80   dark:bg-slate-700/40   dark:text-slate-200   dark:border-slate-600/30',
  }
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur ${tones[tone]}`}>
      <Icon className="w-3 h-3" /> {text}
    </div>
  )
}

function AuroraBackdrop({ variant = 'default' }: { variant?: 'default' | 'left' | 'right' | 'split' }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-60 dark:opacity-100" />
      {variant === 'default' && (
        <>
          <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full aurora-blob aurora-1
                          bg-[radial-gradient(circle,_rgba(34,197,94,0.45),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(34,197,94,0.30),_transparent_70%)] dark:mix-blend-screen" />
          <div className="absolute top-20 -right-32 w-[32rem] h-[32rem] rounded-full aurora-blob aurora-2
                          bg-[radial-gradient(circle,_rgba(6,182,212,0.36),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(6,182,212,0.24),_transparent_70%)] dark:mix-blend-screen" />
          <div className="absolute bottom-0 right-1/4 w-[24rem] h-[24rem] rounded-full aurora-blob aurora-4
                          bg-[radial-gradient(circle,_rgba(245,158,11,0.20),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(245,158,11,0.16),_transparent_70%)] dark:mix-blend-screen" />
        </>
      )}
      {variant === 'left' && (
        <>
          <div className="absolute -top-32 -left-32 w-[32rem] h-[32rem] rounded-full aurora-blob aurora-1
                          bg-[radial-gradient(circle,_rgba(16,185,129,0.40),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(16,185,129,0.28),_transparent_70%)] dark:mix-blend-screen" />
          <div className="absolute bottom-0 -left-20 w-[24rem] h-[24rem] rounded-full aurora-blob aurora-2
                          bg-[radial-gradient(circle,_rgba(139,92,246,0.28),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(139,92,246,0.20),_transparent_70%)] dark:mix-blend-screen" />
        </>
      )}
      {variant === 'right' && (
        <>
          <div className="absolute -top-32 -right-32 w-[32rem] h-[32rem] rounded-full aurora-blob aurora-2
                          bg-[radial-gradient(circle,_rgba(6,182,212,0.40),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(6,182,212,0.28),_transparent_70%)] dark:mix-blend-screen" />
          <div className="absolute bottom-0 -right-20 w-[24rem] h-[24rem] rounded-full aurora-blob aurora-3
                          bg-[radial-gradient(circle,_rgba(139,92,246,0.30),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(139,92,246,0.22),_transparent_70%)] dark:mix-blend-screen" />
        </>
      )}
      {variant === 'split' && (
        <>
          <div className="absolute top-10 left-[15%] w-[28rem] h-[28rem] rounded-full aurora-blob aurora-1
                          bg-[radial-gradient(circle,_rgba(34,197,94,0.40),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(34,197,94,0.26),_transparent_70%)] dark:mix-blend-screen" />
          <div className="absolute bottom-10 right-[15%] w-[28rem] h-[28rem] rounded-full aurora-blob aurora-2
                          bg-[radial-gradient(circle,_rgba(139,92,246,0.32),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(139,92,246,0.22),_transparent_70%)] dark:mix-blend-screen" />
        </>
      )}
    </div>
  )
}

function NoiseOverlay() {
  return <div aria-hidden className="noise-overlay" />
}

/* Mock window chrome used at the top of every "screenshot" mock */
function MockWindow({
  title, right, children, tone = 'neutral',
}: { title: string; right?: React.ReactNode; children: React.ReactNode; tone?: 'neutral' | 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' }) {
  const dot = {
    neutral: ['bg-rose-300', 'bg-amber-300', 'bg-emerald-300'],
    emerald: ['bg-rose-300', 'bg-amber-300', 'bg-emerald-300'],
    sky:     ['bg-rose-300', 'bg-amber-300', 'bg-sky-300'],
    violet:  ['bg-rose-300', 'bg-amber-300', 'bg-violet-300'],
    amber:   ['bg-rose-300', 'bg-amber-300', 'bg-emerald-300'],
    rose:    ['bg-rose-300', 'bg-amber-300', 'bg-emerald-300'],
  }[tone]
  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/10
                    bg-white dark:bg-slate-900 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.18)]
                    dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-slate-200/80 dark:border-white/10
                      bg-slate-50/80 dark:bg-slate-950/60">
        <span className={`w-2.5 h-2.5 rounded-full ${dot[0]}`} />
        <span className={`w-2.5 h-2.5 rounded-full ${dot[1]}`} />
        <span className={`w-2.5 h-2.5 rounded-full ${dot[2]}`} />
        <div className="mx-auto flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  HERO — animated flow diagram                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function Hero() {
  const reduced = useReducedMotion() ?? false
  const stages = [
    { n: 1, label: 'Upload',  icon: UploadCloud, tone: 'from-emerald-500 to-teal-500' },
    { n: 2, label: 'Template',icon: FileText,    tone: 'from-sky-500 to-indigo-500' },
    { n: 3, label: 'Batch',   icon: Layers,      tone: 'from-violet-500 to-fuchsia-500' },
    { n: 4, label: 'Send',    icon: Send,        tone: 'from-rose-500 to-orange-500' },
    { n: 5, label: 'Track',   icon: Activity,    tone: 'from-amber-500 to-yellow-500' },
  ]
  return (
    <section className="relative overflow-hidden">
      <AuroraBackdrop />
      <NoiseOverlay />
      <div className="max-w-6xl mx-auto px-5 lg:px-8 pt-16 lg:pt-24 pb-10 lg:pb-16">
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-2"
        >
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                           bg-white/70 dark:bg-white/5 backdrop-blur border border-emerald-200/70
                           dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300
                           text-[11px] font-medium shadow-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Interactive walkthrough · 5 chapters
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight
                     text-slate-900 dark:text-white leading-[1.05] max-w-4xl"
        >
          From a retailer spreadsheet to{' '}
          <span className="text-gradient-aurora gradient-pan">a delivered WhatsApp</span>{' '}
          in five minutes.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.5 }}
          className="mt-5 text-lg text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed"
        >
          Scroll down and watch the whole flow play out — drop an Excel, render against a template,
          watch workers fan out via the Meta Cloud API, then see the status webhooks stream back.
          No real messages are sent, but every screen is the real one from the admin console.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.5 }}
          className="mt-7 flex flex-wrap items-center gap-3"
        >
          <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
            <a
              href="#chapter-1"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                         text-white font-medium
                         bg-gradient-to-r from-brand-600 via-emerald-600 to-teal-600
                         shadow-[0_10px_28px_rgba(16,185,129,0.35)]
                         hover:shadow-[0_14px_36px_rgba(16,185,129,0.5)] transition-shadow"
            >
              Start the walkthrough <Mouse className="w-4 h-4" />
            </a>
          </motion.div>
          <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                         glass text-slate-800 dark:text-slate-100 font-medium hover:bg-white/80 dark:hover:bg-white/10"
            >
              Open the real console <ArrowUpRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </motion.div>

        {/* flow diagram */}
        <div className="mt-14 lg:mt-20 relative">
          <div className="hidden lg:block absolute top-9 left-[8%] right-[8%] h-px
                          bg-gradient-to-r from-emerald-200/0 via-emerald-400/30 to-emerald-200/0" />
          <motion.div
            aria-hidden
            initial={{ left: '8%' }}
            animate={reduced ? {} : { left: ['8%', '92%', '8%'] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="hidden lg:block absolute top-9 h-1.5 w-14 -translate-y-1/2 rounded-full
                       bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-500 blur-sm"
          />
          <ol className="grid grid-cols-2 lg:grid-cols-5 gap-6 lg:gap-4">
            {stages.map((s, i) => (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.45 }}
                className="relative flex flex-col items-center text-center"
              >
                <div className={`relative grid place-items-center w-14 h-14 lg:w-[72px] lg:h-[72px]
                                 rounded-full text-white
                                 bg-gradient-to-br ${s.tone}
                                 shadow-lg shadow-slate-900/10 z-10`}>
                  <s.icon className="w-5 h-5 lg:w-6 lg:h-6" />
                  <span className="absolute -top-1 -right-1 grid place-items-center w-5 h-5 rounded-full
                                   bg-white text-slate-900 text-[10px] font-bold
                                   border-2 border-emerald-400">
                    {s.n}
                  </span>
                </div>
                <div className="mt-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em]">
                  Chapter {s.n}
                </div>
                <div className="mt-0.5 text-sm lg:text-base font-semibold text-slate-900 dark:text-white">
                  {s.label}
                </div>
              </motion.li>
            ))}
          </ol>

          {/* metric band */}
          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { v: 1248, s: 'msgs/day',   l: 'Sent through the console' },
              { v: 97.4, s: '%',         l: 'Avg. delivery rate',     d: 1 },
              { v: 4.6,  s: 's',         l: 'Median end-to-end',      d: 1 },
              { v: 0.4,  s: '%',         l: 'Opt-out rate',           d: 1 },
            ].map((m) => (
              <div key={m.l} className="glass glass-highlight rounded-2xl px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{m.l}</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
                  <CountUp value={m.v} format={(v) => v.toFixed(m.d ?? 0)} />
                  <span className="text-base text-slate-500 dark:text-slate-400 ml-0.5">{m.s}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Chapter wrapper                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function Chapter({
  n, accent, eyebrow, title, lead, bullets, mock, reversed = false, id,
}: {
  n: number
  accent: string
  eyebrow: string
  title: string
  lead: string
  bullets?: string[]
  mock: React.ReactNode
  reversed?: boolean
  id: string
}) {
  return (
    <section id={id} className="relative max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-32 scroll-mt-20">
      <AuroraBackdrop variant={reversed ? 'right' : 'left'} />
      <div className={`relative grid lg:grid-cols-12 gap-10 lg:gap-16 items-center ${reversed ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-5"
        >
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                           bg-gradient-to-r ${accent} text-white text-xs font-semibold shadow-sm`}>
            <span className="grid place-items-center w-4 h-4 rounded-full bg-white/25 text-[10px] font-bold">
              {n}
            </span>
            {eyebrow}
          </div>
          <h2 className="mt-4 text-3xl lg:text-4xl font-semibold tracking-tight
                         text-slate-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
            {lead}
          </p>
          {bullets && (
            <ul className="mt-5 space-y-2.5">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                  <span className="mt-0.5 grid place-items-center w-5 h-5 rounded-full
                                   bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0">
                    <Check className="w-3 h-3" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-7 relative"
        >
          {mock}
        </motion.div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CHAPTER 1 — UPLOAD MOCK                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function UploadMock() {
  const [dropped, setDropped] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [done, setDone] = useState(true)
  // simulate parse on mount
  useEffect(() => {
    setDropped(true)
    setParsing(true)
    const t = setTimeout(() => { setParsing(false); setDone(true) }, 1200)
    return () => clearTimeout(t)
  }, [])

  return (
    <MockWindow title="whatsyitc · upload" tone="emerald" right={
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> connected
      </div>
    }>
      <div className="p-4 sm:p-5 space-y-4">
        {/* drop zone */}
        <motion.div
          initial={{ borderColor: 'rgba(16,185,129,0.3)' }}
          animate={parsing ? { borderColor: 'rgba(16,185,129,0.8)' } : { borderColor: 'rgba(16,185,129,0.3)' }}
          transition={{ duration: 0.6 }}
          className={`relative rounded-2xl border-2 border-dashed p-6 text-center overflow-hidden
                      ${done
                        ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/10'
                        : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-white/5'}`}
        >
          {parsing && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent"
            />
          )}
          <motion.div
            initial={{ y: -8, opacity: 0 }}
            animate={dropped ? { y: 0, opacity: 1 } : { y: -8, opacity: 0 }}
            className="grid place-items-center w-12 h-12 rounded-xl bg-white dark:bg-slate-800
                       border border-emerald-200 dark:border-emerald-500/40 mx-auto shadow-sm"
          >
            <FileSpreadsheet className="w-6 h-6 text-emerald-600 dark:text-emerald-300" />
          </motion.div>
          <div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            april-bills.xlsx
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            128 retailers · 4.2 KB · 6 columns
          </div>
          <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium
                          text-emerald-700 dark:text-emerald-300
                          bg-emerald-100 dark:bg-emerald-500/20 rounded-full px-2.5 py-0.5">
            {parsing ? (
              <>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                  className="inline-block"
                >
                  <RefreshCw className="w-3 h-3" />
                </motion.span>
                Parsing rows…
              </>
            ) : (
              <>
                <Check className="w-3 h-3" /> Parsed 128 rows · 0 errors
              </>
            )}
          </div>
        </motion.div>

        {/* column mapping preview */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5
                          bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              Column mapping
            </div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> auto-detected
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {[
              { from: 'Retailer Name', to: 'name',   ok: true },
              { from: 'Mobile',        to: 'phone',  ok: true },
              { from: 'Bill Amount',   to: 'amount', ok: true },
              { from: 'Due Date',      to: 'due',    ok: true },
              { from: 'Inv #',         to: 'invoice',ok: true },
            ].map((r) => (
              <div key={r.from} className="grid grid-cols-12 gap-2 items-center px-3 py-1.5 text-[11px]">
                <div className="col-span-5 text-slate-700 dark:text-slate-200 truncate font-medium">{r.from}</div>
                <ArrowRight className="col-span-1 w-3 h-3 text-slate-300" />
                <div className="col-span-5 font-mono text-emerald-700 dark:text-emerald-300">
                  {`{{${r.to}}}`}
                </div>
                <div className="col-span-1 text-right">
                  <span className="inline-grid place-items-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* row preview */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="grid grid-cols-12 gap-1 text-[10px] uppercase tracking-wider
                          text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60
                          px-3 py-1.5 border-b border-slate-200 dark:border-white/10 font-semibold">
            <div className="col-span-5">Name</div>
            <div className="col-span-4">Phone</div>
            <div className="col-span-3 text-right">Amount</div>
          </div>
          {[
            ['Rakesh Distributors', '+91 98xxx xxx12', '₹12,480'],
            ['Sahu Traders',         '+91 94xxx xxx91', '₹ 8,920'],
            ['Mehta & Sons',         '+91 97xxx xxx33', '₹21,005'],
            ['Anita Trading Co.',    '+91 90xxx xxx77', '₹ 6,340'],
          ].map((row, i) => (
            <motion.div
              key={row[0]}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
              className="grid grid-cols-12 gap-1 text-[11px]
                         text-slate-700 dark:text-slate-300 px-3 py-1.5
                         border-t border-slate-100 dark:border-white/5"
            >
              <div className="col-span-5 truncate">{row[0]}</div>
              <div className="col-span-4 font-mono text-[10px] text-slate-500 dark:text-slate-400">{row[1]}</div>
              <div className="col-span-3 text-right font-semibold tabular-nums">{row[2]}</div>
            </motion.div>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>Showing first 4 of 128 rows</span>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                               bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-sm">
              Continue to template <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CHAPTER 2 — TEMPLATE BUILDER MOCK                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function TemplateBuilderMock() {
  const segments = [
    { type: 'text', value: 'Hi ' },
    { type: 'var',  name: 'name', chip: '1' },
    { type: 'text', value: ', your invoice ' },
    { type: 'var',  name: 'invoice', chip: '2' },
    { type: 'text', value: ' for ₹' },
    { type: 'var',  name: 'amount', chip: '3' },
    { type: 'text', value: ' is due on ' },
    { type: 'var',  name: 'due', chip: '4' },
    { type: 'text', value: '. Tap: ' },
    { type: 'url',  value: 'pay.example.com/inv/2' },
  ]
  return (
    <MockWindow title="whatsyitc · templates" tone="sky" right={
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-semibold">
          UTILITY
        </span>
      </div>
    }>
      <div className="grid md:grid-cols-2">
        {/* editor */}
        <div className="p-4 space-y-3 border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <div className="grid place-items-center w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">due-soon-en</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">utility · approved by Meta</div>
            </div>
            <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 font-semibold">
              <Check className="w-3 h-3" /> saved
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/10
                          bg-slate-50/60 dark:bg-slate-950/60 p-3 min-h-[120px]">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 font-semibold flex items-center gap-1">
              <Braces className="w-3 h-3" /> body
            </div>
            <div className="text-[12px] text-slate-800 dark:text-slate-200 leading-relaxed font-mono">
              {segments.map((s, i) => {
                if (s.type === 'var') return (
                  <motion.span
                    key={i}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1 + i * 0.04 }}
                    className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded
                               bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300
                               border border-emerald-300/50 dark:border-emerald-400/30"
                  >
                    <Variable className="w-2.5 h-2.5" />
                    {`{{${s.chip}}}`}
                  </motion.span>
                )
                if (s.type === 'url') return (
                  <span key={i} className="text-brand-600 dark:text-brand-400 underline">{s.value}</span>
                )
                return <span key={i}>{s.value}</span>
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 font-semibold">
              Variables
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { n: 1, k: 'name' },
                { n: 2, k: 'invoice' },
                { n: 3, k: 'amount' },
                { n: 4, k: 'due' },
              ].map((v) => (
                <motion.button
                  key={v.n}
                  whileHover={{ scale: 1.04, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                             bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10
                             text-[11px] text-slate-700 dark:text-slate-200 shadow-sm"
                >
                  <span className="grid place-items-center w-3.5 h-3.5 rounded
                                   bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300
                                   text-[9px] font-bold">{v.n}</span>
                  {v.k}
                </motion.button>
              ))}
              <button className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                                 border border-dashed border-slate-300 dark:border-slate-700
                                 text-[11px] text-slate-500 dark:text-slate-400">
                <Plus className="w-3 h-3" /> add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            {[
              { k: 'category', v: 'utility' },
              { k: 'language', v: 'en_US' },
              { k: 'header',   v: 'invoice-due' },
              { k: 'footer',   v: 'optout: STOP' },
            ].map((kv) => (
              <div key={kv.k} className="rounded-md bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 px-2 py-1.5">
                <div className="text-[9px] uppercase text-slate-400">{kv.k}</div>
                <div className="text-slate-700 dark:text-slate-200 font-mono">{kv.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* live preview */}
        <div className="p-4 bg-slate-50/60 dark:bg-slate-950/40">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 font-semibold flex items-center gap-1">
            <Eye className="w-3 h-3" /> live preview · sample retailer
          </div>
          <div className="rounded-2xl bg-emerald-50/60 dark:bg-emerald-500/5 border border-emerald-200/60 dark:border-emerald-500/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold">R</div>
              <div className="leading-tight">
                <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Rakesh Distributors</div>
                <div className="text-[9px] text-slate-500 dark:text-slate-400">just now</div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl rounded-tl-sm p-3 text-[12px]
                            text-slate-800 dark:text-slate-200 leading-relaxed shadow-sm">
              Hi Rakesh, your invoice{' '}
              <span className="font-semibold">INV-2418</span> for ₹
              <span className="font-semibold">12,480</span> is due on{' '}
              <span className="font-semibold">25 Jun</span>. Tap:{' '}
              <span className="text-brand-600 dark:text-brand-400 underline">pay.example.com/inv/2</span>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-sky-600 dark:text-sky-400">
              <CheckCheck className="w-3 h-3" /> delivered · read
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
            <Wand2 className="w-3 h-3" />
            Renders against current row. Switch rows in the table to see other names/amounts.
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CHAPTER 3 — BATCH DETAIL MOCK (with progress)                            */
/* ────────────────────────────────────────────────────────────────────────── */

function BatchMock() {
  const rows = [
    { name: 'Rakesh Distributors', phone: '+91 98xxx 12', status: 'sent',      tone: 'blue' },
    { name: 'Sahu Traders',        phone: '+91 94xxx 91', status: 'delivered', tone: 'emerald' },
    { name: 'Mehta & Sons',        phone: '+91 97xxx 33', status: 'read',      tone: 'violet' },
    { name: 'Anita Trading Co.',   phone: '+91 90xxx 77', status: 'sent',      tone: 'blue' },
    { name: 'Vikram Stores',       phone: '+91 96xxx 08', status: 'failed',    tone: 'rose' },
    { name: 'Patel & Sons',        phone: '+91 99xxx 21', status: 'queued',    tone: 'slate' },
  ]
  const tone = {
    blue:    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    violet:  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    rose:    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    slate:   'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300',
  }
  return (
    <MockWindow title="whatsyitc · batch #42" tone="violet" right={
      <div className="hidden sm:flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /> live
        </span>
        <span>·</span>
        <RefreshCw className="w-3 h-3" />
      </div>
    }>
      <div className="p-4 space-y-3">
        {/* header stats */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Batch #42</span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">·</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">template: <span className="text-emerald-600 dark:text-emerald-400 font-mono">due-soon-en</span></span>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                           bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[10px] font-semibold">
            <Layers className="w-3 h-3" /> 128 recipients
          </span>
        </div>

        {/* progress */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">
            <span>97 / 128 delivered · 4 failed · 27 queued</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">76%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: '76%' }}
              viewport={{ once: true }}
              transition={{ duration: 1.3, ease: 'easeOut' }}
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 rounded-full"
            />
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: '3%' }}
              viewport={{ once: true }}
              transition={{ duration: 1.3, delay: 0.2, ease: 'easeOut' }}
              className="absolute inset-y-0 left-[76%] bg-rose-400 rounded-full"
            />
          </div>
        </div>

        {/* worker strip */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'W-01', load: 92, alive: true },
            { id: 'W-02', load: 88, alive: true },
            { id: 'W-03', load: 95, alive: true },
            { id: 'W-04', load: 71, alive: true },
          ].map((w) => (
            <div key={w.id} className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800/40 p-2">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">{w.id}</span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${w.load}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: 0.1 }}
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                />
              </div>
              <div className="mt-1 text-[10px] text-slate-600 dark:text-slate-300 tabular-nums">{w.load}%</div>
            </div>
          ))}
        </div>

        {/* rows */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="grid grid-cols-12 gap-1 text-[10px] uppercase tracking-wider
                          text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60
                          px-3 py-1.5 border-b border-slate-200 dark:border-white/10 font-semibold">
            <div className="col-span-5">Recipient</div>
            <div className="col-span-4">Phone</div>
            <div className="col-span-3 text-right">Status</div>
          </div>
          {rows.map((r, i) => (
            <motion.div
              key={r.name}
              initial={{ opacity: 0, x: -4 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="grid grid-cols-12 gap-1 items-center text-[11px]
                         text-slate-700 dark:text-slate-300 px-3 py-2
                         border-t border-slate-100 dark:border-white/5"
            >
              <div className="col-span-5 truncate font-medium">{r.name}</div>
              <div className="col-span-4 font-mono text-[10px] text-slate-500 dark:text-slate-400">{r.phone}</div>
              <div className="col-span-3 text-right">
                <PillPop className={`${tone[r.tone as keyof typeof tone]} inline-block text-[10px] px-1.5 py-0.5 rounded-full font-semibold`}>
                  {r.status}
                </PillPop>
              </div>
            </motion.div>
          ))}
        </div>

        {/* controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
            <Clock className="w-3 h-3" /> avg latency 0.8s · 2 retries on transient errors
          </div>
          <div className="flex items-center gap-1.5">
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                         border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800
                         text-[11px] text-slate-600 dark:text-slate-300"
            >
              <Pause className="w-3 h-3" /> pause
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                         border border-rose-200 dark:border-rose-500/30
                         bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300
                         text-[11px] font-medium"
            >
              <RotateCw className="w-3 h-3" /> retry failed (4)
            </motion.button>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CHAPTER 4 — DELIVERY (phone mocks)                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function PhoneMock({
  name, phone, time, body, status = 'read', align = 'right',
}: { name: string; phone: string; time: string; body: React.ReactNode; status?: 'sent' | 'delivered' | 'read' | 'failed'; align?: 'left' | 'right' }) {
  return (
    <div className={`w-[230px] sm:w-[260px] rounded-[2rem] p-2
                    bg-slate-900 dark:bg-slate-950 shadow-2xl
                    shadow-slate-900/30 dark:shadow-black/60
                    ring-1 ring-slate-800 dark:ring-slate-800
                    ${align === 'left' ? '-rotate-2' : 'rotate-2'}`}>
      <div className="rounded-[1.6rem] overflow-hidden bg-gradient-to-b from-emerald-50 to-emerald-100/40 dark:from-slate-900 dark:to-slate-950">
        {/* status bar */}
        <div className="flex items-center justify-between px-4 pt-2 pb-1 text-[9px] text-slate-700 dark:text-slate-300">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-slate-700 dark:bg-slate-300" />
            <span className="w-1 h-1 rounded-full bg-slate-700 dark:bg-slate-300" />
            <span className="w-1 h-1 rounded-full bg-slate-700 dark:bg-slate-300" />
          </div>
        </div>
        {/* chat header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-100/80 dark:bg-slate-900 border-b border-emerald-200 dark:border-slate-800">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold">
            {name.split(' ').map(p => p[0]).slice(0, 2).join('')}
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">{name}</div>
            <div className="text-[9px] text-emerald-700 dark:text-emerald-400">online · {phone}</div>
          </div>
        </div>
        {/* body */}
        <div className="p-3 space-y-2 min-h-[180px] bg-[radial-gradient(circle_at_30%_20%,_rgba(16,185,129,0.10),_transparent_60%)]">
          <div className="flex justify-end">
            <div className="max-w-[80%] text-[11px] px-2.5 py-1.5 rounded-2xl rounded-br-sm
                            bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm leading-relaxed">
              {body}
              <div className="mt-1 flex items-center justify-end gap-0.5 text-[8px] text-emerald-50">
                <span>{time}</span>
                {status === 'sent' && <Check className="w-2.5 h-2.5" />}
                {status === 'delivered' && <CheckCheck className="w-2.5 h-2.5" />}
                {status === 'read' && <CheckCheck className="w-2.5 h-2.5 text-sky-200" />}
                {status === 'failed' && <AlertCircle className="w-2.5 h-2.5 text-rose-200" />}
              </div>
            </div>
          </div>
          {/* typing */}
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center gap-0.5">
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
            </div>
          </div>
        </div>
        {/* input */}
        <div className="flex items-center gap-1.5 px-2 py-2 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="flex-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[10px] text-slate-400">
            Type a message…
          </div>
          <div className="grid place-items-center w-6 h-6 rounded-full bg-emerald-500 text-white">
            <Send className="w-3 h-3" />
          </div>
        </div>
      </div>
    </div>
  )
}

function DeliveryMock() {
  return (
    <div className="relative">
      <div className="flex items-end justify-center gap-4 sm:gap-6 min-h-[440px]">
        <motion.div
          initial={{ opacity: 0, y: 30, rotate: -8 }}
          whileInView={{ opacity: 1, y: 0, rotate: -2 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.05 }}
        >
          <PhoneMock
            name="Rakesh Distributors"
            phone="+91 98xxx 12"
            time="9:41"
            align="left"
            body={<>Hi Rakesh, your invoice <span className="font-semibold">INV-2418</span> for ₹12,480 is due on 25 Jun.</>}
            status="read"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 30, rotate: 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: 2 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="z-10"
        >
          <PhoneMock
            name="Mehta & Sons"
            phone="+91 97xxx 33"
            time="9:42"
            align="right"
            body={<>Hi Mehta, your invoice <span className="font-semibold">INV-2419</span> for ₹21,005 is due on 26 Jun.</>}
            status="delivered"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 30, rotate: 8 }}
          whileInView={{ opacity: 1, y: 0, rotate: 6 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.25 }}
        >
          <PhoneMock
            name="Vikram Stores"
            phone="+91 96xxx 08"
            time="9:42"
            align="left"
            body={<>Hi Vikram, your invoice <span className="font-semibold">INV-2420</span> for ₹23,950 is due on 27 Jun.</>}
            status="failed"
          />
        </motion.div>
      </div>

      {/* floating annotations */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="absolute -top-2 left-4 sm:left-10 glass glass-highlight rounded-xl px-3 py-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
      >
        <div className="flex items-center gap-1.5">
          <span className="grid place-items-center w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
            <CheckCheck className="w-2.5 h-2.5" />
          </span>
          Read in 14s
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.7, duration: 0.4 }}
        className="absolute bottom-2 right-2 sm:right-8 glass glass-highlight rounded-xl px-3 py-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
      >
        <div className="flex items-center gap-1.5">
          <span className="grid place-items-center w-4 h-4 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300">
            <AlertCircle className="w-2.5 h-2.5" />
          </span>
          Auto-retry queued
        </div>
      </motion.div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CHAPTER 5 — WEBHOOK LOG                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function WebhookMock() {
  const events = [
    { ts: '12:48:02', event: 'sent',      phone: '+91 98xxx 12', id: 'msg_a1b2…', tone: 'blue' },
    { ts: '12:48:03', event: 'delivered', phone: '+91 98xxx 12', id: 'msg_a1b2…', tone: 'emerald', fresh: true },
    { ts: '12:48:14', event: 'delivered', phone: '+91 94xxx 91', id: 'msg_b2c3…', tone: 'emerald' },
    { ts: '12:48:15', event: 'failed',    phone: '+91 96xxx 08', id: 'msg_c3d4…', tone: 'rose', fail: true },
    { ts: '12:48:33', event: 'read',      phone: '+91 94xxx 91', id: 'msg_b2c3…', tone: 'violet', fresh: true },
    { ts: '12:48:45', event: 'read',      phone: '+91 98xxx 12', id: 'msg_a1b2…', tone: 'violet' },
  ]
  const statusPill: Record<string, string> = {
    blue:    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    violet:  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    rose:    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  }
  return (
    <MockWindow title="whatsyitc · webhook log" tone="amber" right={
      <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> live
        <Download className="w-3 h-3 ml-1" />
      </div>
    }>
      <div className="p-4 space-y-3">
        {/* filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-semibold">
            All · 248
          </span>
          {[
            { l: 'Sent',      n: 128, c: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
            { l: 'Delivered', n: 121, c: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
            { l: 'Read',      n: 87,  c: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
            { l: 'Failed',    n: 4,   c: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
          ].map((f) => (
            <span key={f.l} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${f.c}`}>
              {f.l} · {f.n}
            </span>
          ))}
          <div className="ml-auto inline-flex items-center gap-1.5 rounded-full
                          bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10
                          px-2.5 py-1 text-[10px] text-slate-500 dark:text-slate-400">
            <Search className="w-3 h-3" /> <span>phone or msg id…</span>
          </div>
        </div>

        {/* rows */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider
                          text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60
                          px-3 py-1.5 border-b border-slate-200 dark:border-white/10 font-semibold">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Event</div>
            <div className="col-span-3">Msg id</div>
            <div className="col-span-3">Phone</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          {events.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className={`grid grid-cols-12 gap-2 items-center px-3 py-1.5 text-[11px]
                          text-slate-700 dark:text-slate-300
                          border-t border-slate-100 dark:border-white/5
                          ${r.fail ? 'border-l-2 border-l-rose-400 bg-rose-50/30 dark:bg-rose-500/5' : ''}`}
            >
              <div className="col-span-2 font-mono text-slate-500 dark:text-slate-400">{r.ts}</div>
              <div className="col-span-2">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${statusPill[r.tone]}`}>
                  {r.event}
                </span>
              </div>
              <div className="col-span-3 font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">{r.id}</div>
              <div className="col-span-3 font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">{r.phone}</div>
              <div className="col-span-2 text-right">
                {r.fresh ? (
                  <PillPop className={`${statusPill[r.tone]} inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold`}>
                    new
                  </PillPop>
                ) : r.fail ? (
                  <button className="text-[9px] font-semibold text-rose-600 dark:text-rose-300 hover:underline">
                    retry →
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400">·</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <span>+ 24 more in the last minute</span>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3" />
            <span>Filters: last 24h, batch #42</span>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  TWO-WAY CHAT MOCK                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function ConversationMock() {
  const messages = [
    { from: 'us',   text: 'Hi Rakesh, your invoice INV-2418 for ₹12,480 is due on 25 Jun. Tap to view: pay.example.com/inv/2418', time: '14:01' },
    { from: 'them', text: 'Got it. Will pay by 26th.', time: '14:08' },
    { from: 'us',   text: 'Thanks Rakesh — confirming. Reply STOP to opt out.', time: '14:08' },
    { from: 'them', text: 'Done ✅', time: '14:09' },
  ]
  return (
    <div className="relative max-w-md mx-auto">
      <div className="relative glass-premium glass-highlight rounded-3xl overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/40 dark:border-white/10 bg-white/40 dark:bg-white/5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-xs font-bold">R</div>
          <div className="flex-1 leading-tight">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">Rakesh Distributors</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> online · +91 98xxx xxx12
            </div>
          </div>
          <MessageCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <MoreVertical className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        </div>

        {/* messages */}
        <div className="p-4 space-y-2.5 min-h-[260px] bg-[radial-gradient(circle_at_30%_20%,_rgba(16,185,129,0.10),_transparent_60%)]">
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.35, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              className={`flex items-end gap-2 ${m.from === 'us' ? 'justify-end' : 'justify-start'}`}
            >
              {m.from === 'them' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold shrink-0">R</div>
              )}
              <div className={`max-w-[78%] text-[12px] px-3 py-2 rounded-2xl leading-relaxed shadow-sm
                ${m.from === 'us'
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-br-sm'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-100 rounded-bl-sm'}`}
              >
                {m.text}
                <div className={`mt-1 text-[9px] ${m.from === 'us' ? 'text-emerald-50/80' : 'text-slate-400'}`}>
                  {m.time}
                </div>
              </div>
            </motion.div>
          ))}

          {/* typing */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: messages.length * 0.12 + 0.1 }}
            className="flex items-end gap-2 justify-start"
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold shrink-0">R</div>
            <div className="px-3 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center gap-1">
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
            </div>
          </motion.div>
        </div>

        {/* input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/40 dark:border-white/10 bg-white/40 dark:bg-white/5">
          <div className="flex-1 rounded-full bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-1.5 text-[12px] text-slate-400 dark:text-slate-500">
            Type a reply…
          </div>
          <button className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* reply templates */}
        <div className="px-3 py-2 border-t border-slate-200/60 dark:border-white/10 bg-slate-50/50 dark:bg-slate-950/30 flex items-center gap-1.5 overflow-hidden">
          <Reply className="w-3 h-3 text-slate-400 shrink-0" />
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {['Thanks, will pay soon', 'Receipt confirmed', 'Escalate to manager', 'Send invoice copy'].map((t) => (
              <span key={t} className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                                        bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10
                                        text-[10px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                <Plus className="w-2.5 h-2.5" /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* floating context card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="absolute -top-3 -right-3 w-14 h-14 opacity-50 pointer-events-none"
      >
        <div className="absolute inset-0 ring-dashed-spin" />
      </motion.div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  DASHBOARD MOCK (for the "after" overview)                               */
/* ────────────────────────────────────────────────────────────────────────── */

function DashboardMock() {
  const tiles = [
    { icon: Users,       label: 'Retailers',  value: '248',   tone: 'from-sky-50 to-indigo-50 text-sky-700 dark:from-sky-500/15 dark:to-indigo-500/15 dark:text-sky-300' },
    { icon: Send,        label: 'Sent today', value: '1,248', tone: 'from-violet-50 to-fuchsia-50 text-violet-700 dark:from-violet-500/15 dark:to-fuchsia-500/15 dark:text-violet-300' },
    { icon: Eye,         label: 'Read today', value: '892',   tone: 'from-emerald-50 to-teal-50 text-emerald-700 dark:from-emerald-500/15 dark:to-teal-500/15 dark:text-emerald-300' },
    { icon: AlertCircle, label: 'Failed',     value: '14',    tone: 'from-rose-50 to-orange-50 text-rose-700 dark:from-rose-500/15 dark:to-orange-500/15 dark:text-rose-300' },
  ]
  return (
    <MockWindow title="whatsyitc · dashboard" tone="emerald">
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-xl p-2.5 bg-gradient-to-br ${t.tone} border border-white/60 dark:border-white/10`}>
              <t.icon className="w-4 h-4" />
              <div className="mt-1.5 text-lg font-semibold tabular-nums">{t.value}</div>
              <div className="text-[9px] opacity-80">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3">
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="font-medium">Last 7 days</span>
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sent</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Delivered</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Read</span>
            </span>
          </div>
          <MiniChart />
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          {[
            { l: 'BATCH APPROVED', w: 'admin · #42', t: '2m ago',  c: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
            { l: 'BATCH UPLOADED', w: 'admin · #43', t: '14m ago', c: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
            { l: 'TEMPLATE EDIT',  w: 'admin · due-soon-en', t: '1h ago', c: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
          ].map((a) => (
            <div key={a.l} className="rounded-lg border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-2">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${a.c}`}>{a.l}</span>
              <div className="mt-1 text-slate-600 dark:text-slate-400 truncate text-[10px]">{a.w}</div>
              <div className="text-slate-400 dark:text-slate-500 text-[9px]">{a.t}</div>
            </div>
          ))}
        </div>
      </div>
    </MockWindow>
  )
}

function MiniChart() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-50px' })
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const sent = [420, 510, 380, 660, 720, 540, 880]
  const delivered = sent.map((v) => Math.round(v * 0.96))
  const read = sent.map((v) => Math.round(v * 0.71))
  const w = 460, h = 110
  const stepX = w / (days.length - 1)
  const maxV = Math.max(...sent)
  function pathFor(arr: number[]) {
    return arr.map((v, i) => {
      const x = i * stepX
      const y = h - (v / maxV) * h
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
  }
  return (
    <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
      <defs>
        <linearGradient id="mc-em" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="mc-vl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${pathFor(delivered)} L ${w} ${h} L 0 ${h} Z`} fill="url(#mc-em)" />
      <path d={`${pathFor(read)}      L ${w} ${h} L 0 ${h} Z`} fill="url(#mc-vl)" />
      {[
        { d: pathFor(sent),      stroke: '#3b82f6' },
        { d: pathFor(delivered), stroke: '#10b981' },
        { d: pathFor(read),      stroke: '#8b5cf6' },
      ].map((p, i) => (
        <motion.path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.stroke}
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: inView ? 1 : 0 }}
          transition={{ duration: 1.4, delay: i * 0.15, ease: 'easeOut' }}
        />
      ))}
      {days.map((d, i) => (
        <text key={d} x={i * stepX} y={h + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{d}</text>
      ))}
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  USE-CASE TABS                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function UseCases() {
  const [active, setActive] = useState(0)
  const cases = [
    {
      icon: Building2,
      title: 'Distributor billing reminders',
      desc: 'A regional FMCG distributor uploads a monthly Excel of 1,200+ retailers with their phone numbers and outstanding balances. WhatsyITC renders a personalized WhatsApp message per row with the invoice number, amount and a payment link.',
      bullets: ['Bulk Excel → WhatsApp in one pass', 'Auto-skip opted-out retailers', 'Track who read, who paid'],
      tone: 'from-emerald-500 to-teal-500',
    },
    {
      icon: Bell,
      title: 'New stock & offer announcements',
      desc: 'Push a new-product teaser or a seasonal discount to your top 500 retailers in under a minute. Use the templates editor to build the message once, then send it again next quarter without rewriting.',
      bullets: ['Reusable templates', 'Targeted retailer segments', 'Read-rate analytics'],
      tone: 'from-sky-500 to-indigo-500',
    },
    {
      icon: Headphones,
      title: 'Two-way customer support',
      desc: 'Retailers reply to billing messages with questions, complaints or order changes. Incoming chats land in the Chats tab tied back to the original message and retailer profile — so nothing falls through the cracks.',
      bullets: ['Inbound chats inbox', 'Full conversation history', 'Reply from the admin console'],
      tone: 'from-violet-500 to-fuchsia-500',
    },
  ]
  const Active = cases[active]
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-28 lg:mt-36 relative">
      <AuroraBackdrop variant="split" />
      <div className="relative">
        <Eyebrow icon={Zap} text="Use cases" tone="violet" />
        <h2 className="mt-3 text-3xl lg:text-5xl font-semibold tracking-tight
                       text-slate-900 dark:text-white max-w-3xl">
          Built for the workflows billing desks{' '}
          <span className="text-gradient-aurora">already run.</span>
        </h2>

        <div className="mt-10 grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-2">
            {cases.map((c, i) => (
              <motion.button
                key={c.title}
                type="button"
                onClick={() => setActive(i)}
                whileHover={{ x: 2 }}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  active === i
                    ? 'bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-500/40 shadow-sm ring-1 ring-emerald-200 dark:ring-emerald-500/20'
                    : 'bg-white/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid place-items-center w-10 h-10 rounded-lg text-white bg-gradient-to-br ${c.tone}`}>
                    <c.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-white text-sm">{c.title}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Chapter {i + 1} of 3</div>
                  </div>
                  <ChevronRight className={`w-4 h-4 transition ${active === i ? 'text-emerald-500 translate-x-0.5' : 'text-slate-300 dark:text-slate-600'}`} />
                </div>
              </motion.button>
            ))}
          </div>
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="lg:col-span-8 glass-card glass-highlight rounded-2xl p-6 lg:p-8 relative"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`grid place-items-center w-12 h-12 rounded-xl text-white bg-gradient-to-br ${Active.tone} shadow-md`}>
                <Active.icon className="w-5 h-5" />
              </div>
              <div className="text-xl font-semibold text-slate-900 dark:text-white">{Active.title}</div>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{Active.desc}</p>
            <ul className="mt-5 grid sm:grid-cols-3 gap-3">
              {Active.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200
                                       bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  SECURITY / FAQ                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function SecurityBand() {
  const items = [
    { icon: Lock,        l: 'AES-256 at rest' },
    { icon: KeyRound,    l: 'bcrypt + JWT' },
    { icon: ShieldCheck, l: 'Full audit trail' },
    { icon: Server,      l: 'Self-hosted' },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-32">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.4 }}
        className="relative glass glass-highlight rounded-2xl p-5 lg:p-6 grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        {items.map((it) => (
          <div key={it.l} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <it.icon className="w-4 h-4" />
            </span>
            <span className="font-medium">{it.l}</span>
          </div>
        ))}
      </motion.div>
    </section>
  )
}

function FAQ() {
  const items = [
    { q: 'Do I need a Meta WhatsApp Business account?', a: 'Yes. You connect your WhatsApp Cloud API credentials (phone number id + access token) inside Settings. WhatsyITC talks to the official Meta endpoints — it never uses unofficial scrapers.' },
    { q: 'Can retailers reply to the messages?', a: 'Absolutely. Incoming messages hit your webhook, get persisted to the database, and surface in the Chats tab of the admin console. Replies keep the original message + retailer context attached.' },
    { q: 'What happens if a number is wrong or opted out?', a: 'Failed deliveries come back through the webhook log with the Meta error code. Opt-outs are auto-flagged on the retailer profile so subsequent batches skip them — you can also opt a retailer out manually.' },
    { q: 'Is this self-hosted? Do I need Docker?', a: 'Self-hosted, no Docker required. The backend is a single Go binary; the frontend is a static Vite build. Drop them behind any reverse proxy (Nginx / Caddy) for HTTPS and you’re live.' },
    { q: 'How are admin credentials stored?', a: 'bcrypt-hashed at cost 12 in Postgres. Sessions are JWT (HS256) with audience and 8-hour expiry, stored as an httpOnly cookie. Login is rate-limited per IP.' },
    { q: 'Can I export reports?', a: 'Every report view supports a one-click CSV export. The audit log also exports to CSV so you can hand it to your accountant.' },
  ]
  return (
    <section id="faq" className="max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-32">
      <Eyebrow icon={MessageSquare} text="FAQ" tone="blue" />
      <h2 className="mt-3 text-3xl lg:text-5xl font-semibold tracking-tight text-slate-900 dark:text-white">
        Common questions
      </h2>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((it) => <FAQItem key={it.q} q={it.q} a={it.a} />)}
      </div>
    </section>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.3 }}
      className="glass-card glass-highlight overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="font-medium text-slate-900 dark:text-white text-sm">{q}</span>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shrink-0 text-sm leading-none"
        >
          +
        </motion.span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <div className="px-5 pb-5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{a}</div>
      </motion.div>
    </motion.div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  CTA                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function Cta() {
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-32">
      <div className="relative overflow-hidden rounded-3xl p-8 lg:p-14 text-white shadow-2xl
                      bg-[linear-gradient(120deg,#0f766e_0%,#059669_30%,#10b981_55%,#06b6d4_100%)] gradient-pan">
        <div aria-hidden className="absolute inset-0 opacity-50 mix-blend-screen">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-300/60 blur-3xl aurora-blob aurora-1" />
          <div className="absolute -bottom-32 -left-10 w-80 h-80 rounded-full bg-cyan-300/60 blur-3xl aurora-blob aurora-2" />
          <div className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full bg-violet-400/40 blur-3xl aurora-blob aurora-3" />
        </div>
        <NoiseOverlay />

        <div className="relative grid lg:grid-cols-2 gap-6 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]
                             bg-white/15 backdrop-blur rounded-full px-2.5 py-1 border border-white/20">
              <Sparkles className="w-3 h-3" /> Start in 5 minutes
            </span>
            <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tight">
              See it on your data.
            </h2>
            <p className="mt-3 text-emerald-50/95 max-w-xl">
              Sign in, drop in your own Excel, and watch a batch go out in under five minutes.
            </p>
          </div>
          <div className="flex flex-wrap lg:justify-end gap-3">
            <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-emerald-700 font-semibold shadow-lg
                           hover:shadow-xl transition-shadow"
              >
                Open admin <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-white/30 hover:bg-white/10 text-white font-medium backdrop-blur"
              >
                Back to home
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  THE PAGE                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export default function HowItWorks() {
  useEffect(() => { document.title = 'How it works — WhatsyITC' }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-emerald-50/20 to-slate-50
                    dark:from-slate-950 dark:via-slate-950 dark:to-slate-900
                    text-slate-900 dark:text-white transition-colors">
      <TopBar />
      <main>
        <Hero />

        <Chapter
          id="chapter-1"
          n={1}
          accent="from-emerald-500 to-teal-500"
          eyebrow="Step 01 · Ingest"
          title="Drop an Excel. We do the parsing."
          lead="A familiar workflow. Drag your .xlsx or .csv onto the upload page, pick a template, and the console parses, normalizes phone numbers to E.164, skips opted-out retailers, and shows you exactly what it found before you commit to anything."
          bullets={[
            'Accepts .xlsx, .csv, .xls',
            'Auto-detects column names (retailer / phone / amount / due)',
            'Skips opted-out and duplicate numbers automatically',
          ]}
          mock={<UploadMock />}
        />

        <Chapter
          id="chapter-2"
          n={2}
          accent="from-sky-500 to-indigo-500"
          eyebrow="Step 02 · Compose"
          title="Reusable templates with live preview."
          lead="Build the message once, with named variables like {{name}} and {{amount}}. The live preview shows the rendered output against the current row — so you see typos before they ship. Approve a template, get a Meta utility approval, and reuse it forever."
          bullets={[
            'Drag-and-drop {{1}}, {{2}}, {{3}} variables',
            'Sample preview updates as you type',
            'Approval + version history per template',
          ]}
          mock={<TemplateBuilderMock />}
          reversed
        />

        <Chapter
          id="chapter-3"
          n={3}
          accent="from-violet-500 to-fuchsia-500"
          eyebrow="Step 03 · Dispatch"
          title="A batch with progress, per-recipient rows, and worker fans."
          lead="Once you click Approve, the batch becomes a queue of messages handed to a configurable pool of background workers. You see per-recipient status, per-worker load, the overall progress bar, and pause / retry controls in real time."
          bullets={[
            'Configurable worker concurrency from .env',
            'Per-recipient idempotency key — no double-sends',
            'Pause or retry just the failed recipients',
          ]}
          mock={<BatchMock />}
        />

        <Chapter
          id="chapter-4"
          n={4}
          accent="from-rose-500 to-orange-500"
          eyebrow="Step 04 · Deliver"
          title="Messages land on real WhatsApp. Looks just like the one you have."
          lead="Each message goes out via the official Meta WhatsApp Cloud API. From the retailer's phone it looks like a normal chat: read receipts, typing indicators, brand avatar, and a deep link to the payment page you provided."
          bullets={[
            'Meta Cloud API v25.0 — never unofficial scrapers',
            'Real read receipts and typing state',
            'Deep links route to your payment page',
          ]}
          mock={<DeliveryMock />}
          reversed
        />

        <Chapter
          id="chapter-5"
          n={5}
          accent="from-amber-500 to-yellow-500"
          eyebrow="Step 05 · Track"
          title="Every status flows back to the same console."
          lead="Meta posts back delivered, read, and failed events to your webhook. The same admin console becomes the single source of truth — filter by phone, batch id, or status, retry transient failures inline, and export to CSV for your accountant."
          bullets={[
            'Filter chips + search by phone or message id',
            'Inline retry for transient Meta errors',
            'One-click CSV export of any filtered slice',
          ]}
          mock={<WebhookMock />}
        />

        <Chapter
          id="chapter-6"
          n={6}
          accent="from-emerald-500 to-cyan-500"
          eyebrow="Step 06 · Reply"
          title="Retailers reply. You respond without leaving the console."
          lead="Two-way chats land in the inbox tied to the original message and the retailer profile. Reply with quick templates, escalate, or just look up the prior history — all from one screen, with the retailer pinned to the side."
          bullets={[
            'Full conversation history per retailer',
            'Quick replies from your saved templates',
            'Auto-tie replies back to the originating batch',
          ]}
          mock={<ConversationMock />}
          reversed
        />

        {/* summary dashboard */}
        <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-32 relative">
          <AuroraBackdrop />
          <div className="relative grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-5"
            >
              <Eyebrow icon={BarChart3} text="The bigger picture" tone="emerald" />
              <h2 className="mt-4 text-3xl lg:text-4xl font-semibold tracking-tight
                             text-slate-900 dark:text-white">
                And it all rolls up into one dashboard.
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                The same screen you land on after signing in. Animated KPIs, a 7-day trend
                chart, and a live activity feed pulled from the audit log. The whole story
                fits on a single fold.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  'Live KPIs that animate as new statuses arrive',
                  'Sent / delivered / read / failed area chart',
                  'Recent activity feed from the audit log',
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <span className="mt-0.5 grid place-items-center w-5 h-5 rounded-full
                                     bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0">
                      <Check className="w-3 h-3" />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700">
                  Open the dashboard <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.6, delay: 0.08 }}
              className="lg:col-span-7"
            >
              <DashboardMock />
            </motion.div>
          </div>
        </section>

        <UseCases />
        <SecurityBand />
        <FAQ />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
