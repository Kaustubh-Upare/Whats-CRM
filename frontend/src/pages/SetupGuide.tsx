import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, ChevronRight, Sparkles, BookOpen,
  ShieldCheck, Smartphone, Building2, Cpu, Webhook, Phone, Hash, Plus, X, Mouse, Lock,
  Database, Server, KeyRound, MailCheck, AtSign, Hash as HashIcon, Briefcase, Settings2,
  ListChecks, CheckCheck, Loader2, AlertTriangle, KeySquare, Variable,
} from 'lucide-react'
import { PageHeader, PrimaryButton, SecondaryButton } from '@/components/ui'

/* ────────────────────────────────────────────────────────────────────── */
/*  Shared chrome (copied from HowItWorks.tsx for the same look + feel)  */
/* ────────────────────────────────────────────────────────────────────── */

function Eyebrow({
  icon: Icon, text, tone = 'emerald',
}: { icon: any; text: string; tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'slate' }) {
  const tones = {
    emerald: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    violet:  'bg-violet-50/80  text-violet-700  border-violet-200/80  dark:bg-violet-500/15  dark:text-violet-300  dark:border-violet-400/20',
    blue:    'bg-sky-50/80     text-sky-700     border-sky-200/80     dark:bg-sky-500/15     dark:text-sky-300     dark:border-sky-400/20',
    amber:   'bg-amber-50/80   text-amber-800   border-amber-200/80   dark:bg-amber-500/15   dark:text-amber-300   dark:border-amber-400/20',
    slate:   'bg-slate-100/80  text-slate-700   border-slate-200/80   dark:bg-slate-700/40   dark:text-slate-200   dark:border-slate-600/30',
  }[tone]!
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur ${tones}`}>
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
                          bg-[radial-gradient(circle,_rgba(59,130,246,0.40),_transparent_70%)]
                          dark:bg-[radial-gradient(circle,_rgba(59,130,246,0.28),_transparent_70%)] dark:mix-blend-screen" />
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

function MockWindow({
  title, right, children, tone = 'emerald',
}: { title: string; right?: React.ReactNode; children: React.ReactNode; tone?: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' | 'blue' }) {
  const dot = {
    emerald: 'bg-emerald-300',
    sky:     'bg-sky-300',
    blue:    'bg-blue-300',
    violet:  'bg-violet-300',
    amber:   'bg-emerald-300',
    rose:    'bg-emerald-300',
  }[tone]
  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/10
                    bg-white dark:bg-slate-900 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.18)]
                    dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-slate-200/80 dark:border-white/10
                      bg-slate-50/80 dark:bg-slate-950/60">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
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

function Chapter({
  n, accent, eyebrow, title, lead, bullets, mock, reversed = false, id,
}: {
  n: number
  accent: string
  eyebrow: string
  title: string
  lead: React.ReactNode
  bullets?: React.ReactNode[]
  mock: React.ReactNode
  reversed?: boolean
  id: string
}) {
  return (
    <section id={id} className="relative max-w-6xl mx-auto px-0 sm:px-2 mt-20 lg:mt-28 scroll-mt-20">
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
          <h2 className="mt-4 text-2xl lg:text-3xl xl:text-4xl font-semibold tracking-tight
                         text-slate-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-3 text-sm lg:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            {lead}
          </p>
          {bullets && (
            <ul className="mt-5 space-y-2.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Animated cursor — slides in, hovers, clicks, slides out.              */
/*  Respects prefers-reduced-motion.                                     */
/* ────────────────────────────────────────────────────────────────────── */

function AnimatedCursor({
  active,
  x, y,            // 0..100 % target position inside the parent
  delay = 0,
  duration = 0.9,
  reduced = false,
}: { active: boolean; x: number; y: number; delay?: number; duration?: number; reduced?: boolean }) {
  if (reduced) return null
  return (
    <motion.div
      initial={{ left: '110%', top: '110%', opacity: 0, scale: 0.6 }}
      animate={
        active
          ? { left: `${x}%`, top: `${y}%`, opacity: 1, scale: 1 }
          : { left: '110%', top: '110%', opacity: 0, scale: 0.6 }
      }
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      className="absolute pointer-events-none z-20"
      style={{ width: 0, height: 0 }}
    >
      <MousePointer2 className="w-5 h-5 -ml-1 -mt-1 text-slate-900 drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]" />
    </motion.div>
  )
}

// Local MousePointer2 alias so we don't add it to the import list twice
function MousePointer2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="white"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M5 3 L5 18 L9 14 L11.5 21 L14 20 L11.5 13 L17 13 Z" />
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  "Paste into WhatsyITC" field card — appears to the right of every    */
/*  mock and is the visual target of the copy-arrow animation.            */
/* ────────────────────────────────────────────────────────────────────── */

function PasteTargetCard({
  label, value, visible, tone = 'emerald',
}: { label: string; value: string; visible: boolean; tone?: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' }) {
  const toneCls = {
    emerald: 'from-emerald-500/15 to-teal-500/10 border-emerald-300/60 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    sky:     'from-sky-500/15 to-indigo-500/10 border-sky-300/60 dark:border-sky-500/30 text-sky-700 dark:text-sky-300',
    violet:  'from-violet-500/15 to-fuchsia-500/10 border-violet-300/60 dark:border-violet-500/30 text-violet-700 dark:text-violet-300',
    amber:   'from-amber-500/15 to-orange-500/10 border-amber-300/60 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
    rose:    'from-rose-500/15 to-orange-500/10 border-rose-300/60 dark:border-rose-500/30 text-rose-700 dark:text-rose-300',
  }[tone]
  return (
    <motion.div
      initial={{ opacity: 0, x: 12, scale: 0.92 }}
      animate={visible ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 12, scale: 0.92 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute -right-2 lg:-right-6 top-1/2 -translate-y-1/2 z-10
                  w-[170px] lg:w-[200px] rounded-xl p-3
                  bg-gradient-to-br ${toneCls}
                  border backdrop-blur shadow-lg`}
    >
      <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">Paste into</div>
      <div className="text-[11px] font-semibold mt-0.5">WhatsyITC → {label}</div>
      <div className="mt-2 font-mono text-[10px] bg-white/70 dark:bg-black/30 rounded-md px-2 py-1.5 break-all">
        {value}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold">
        <CheckCircle2 className="w-3 h-3" /> Ready to paste
      </div>
    </motion.div>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  HERO                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function Hero() {
  const reduced = useReducedMotion() ?? false
  const steps = [
    { n: 1, label: 'Developer', icon: Cpu,        tone: 'from-blue-500 to-indigo-500' },
    { n: 2, label: 'WhatsApp',   icon: Smartphone, tone: 'from-emerald-500 to-teal-500' },
    { n: 3, label: 'Phone',      icon: Phone,      tone: 'from-violet-500 to-fuchsia-500' },
    { n: 4, label: 'Token',      icon: KeyRound,   tone: 'from-rose-500 to-orange-500' },
  ]
  return (
    <section className="relative overflow-hidden">
      <AuroraBackdrop />
      <NoiseOverlay />
      <div className="max-w-6xl mx-auto px-1 sm:px-2 pt-8 lg:pt-12 pb-6 lg:pb-10">
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
            Animated walkthrough · 4 steps
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-semibold tracking-tight
                     text-slate-900 dark:text-white leading-[1.05] max-w-4xl"
        >
          Connect your{' '}
          <span className="text-gradient-aurora gradient-pan">WhatsApp Business</span>{' '}
          in four steps.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.5 }}
          className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed"
        >
          You'll create a Meta Developer account, register a Business app, add a phone number, and generate a permanent access token.
          Every step ends with a value you paste into the form on{' '}
          <Link to="/admin/credentials" className="text-emerald-600 dark:text-emerald-400 hover:underline">/admin/credentials</Link>{' '}
          — no prior Meta experience needed.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.5 }}
          className="mt-7 flex flex-wrap items-center gap-3"
        >
          <motion.a
            href="#step-1"
            whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                       text-white font-medium
                       bg-gradient-to-r from-brand-600 via-emerald-600 to-teal-600
                       shadow-[0_10px_28px_rgba(16,185,129,0.35)]
                       hover:shadow-[0_14px_36px_rgba(16,185,129,0.5)] transition-shadow"
          >
            Start the walkthrough <Mouse className="w-4 h-4" />
          </motion.a>
          <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/admin/credentials"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                         glass text-slate-800 dark:text-slate-100 font-medium hover:bg-white/80 dark:hover:bg-white/10"
            >
              <ArrowLeft className="w-4 h-4" /> Back to credentials
            </Link>
          </motion.div>
        </motion.div>

        {/* 4-step pill row */}
        <div className="mt-12 lg:mt-16 relative">
          <div className="hidden lg:block absolute top-9 left-[10%] right-[10%] h-px
                          bg-gradient-to-r from-emerald-200/0 via-emerald-400/30 to-emerald-200/0" />
          <motion.div
            aria-hidden
            initial={{ left: '10%' }}
            animate={reduced ? {} : { left: ['10%', '90%', '10%'] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="hidden lg:block absolute top-9 h-1.5 w-14 -translate-y-1/2 rounded-full
                       bg-gradient-to-r from-blue-400 via-emerald-400 to-rose-500 blur-sm"
          />
          <ol className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4">
            {steps.map((s, i) => (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.45 }}
                className="relative flex flex-col items-center text-center"
              >
                <a
                  href={`#step-${s.n}`}
                  className={`relative grid place-items-center w-14 h-14 lg:w-[72px] lg:h-[72px]
                                 rounded-full text-white
                                 bg-gradient-to-br ${s.tone}
                                 shadow-lg shadow-slate-900/10 z-10
                                 transition-transform hover:scale-105`}
                >
                  <s.icon className="w-5 h-5 lg:w-6 h-6" />
                  <span className="absolute -top-1 -right-1 grid place-items-center w-5 h-5 rounded-full
                                   bg-white text-slate-900 text-[10px] font-bold
                                   border-2 border-emerald-400">
                    {s.n}
                  </span>
                </a>
                <div className="mt-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em]">
                  Step {s.n}
                </div>
                <div className="mt-0.5 text-sm lg:text-base font-semibold text-slate-900 dark:text-white">
                  {s.label}
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  STEP 1 — Create a Meta Developer account + App                         */
/* ────────────────────────────────────────────────────────────────────── */

function MetaDevMock() {
  const reduced = useReducedMotion() ?? false
  const [stage, setStage] = useState(0)
  // Stage timeline:
  // 0: empty dashboard with "Create App" button
  // 1: cursor slides to Create App, clicks → modal appears
  // 2: cursor clicks "Business" card, then "Next"
  // 3: form fields appear, cursor clicks "Create App"
  // 4: spinner, then green "App created" success

  useEffect(() => {
    if (reduced) return
    const t = [
      setTimeout(() => setStage(1),  900),
      setTimeout(() => setStage(2),  2400),
      setTimeout(() => setStage(3),  4200),
      setTimeout(() => setStage(4),  5800),
      setTimeout(() => setStage(0),  8200),
    ]
    return () => t.forEach(clearTimeout)
  }, [reduced])

  return (
    <MockWindow
      title="developers.facebook.com · My Apps"
      tone="blue"
      right={
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> live
        </div>
      }
    >
      <div className="relative p-4 sm:p-5 min-h-[440px] bg-slate-50/30 dark:bg-slate-950/30">
        {/* Fake top bar */}
        <div className="flex items-center gap-2 pb-3 border-b border-slate-200/60 dark:border-white/5 text-[10px] text-slate-500 dark:text-slate-400">
          <div className="w-5 h-5 rounded-md bg-blue-600 grid place-items-center text-white text-[9px] font-bold">f</div>
          <span className="font-semibold">My Apps</span>
          <span className="opacity-60">·</span>
          <span className="opacity-60">WhatsyITC</span>
          <span className="ml-auto px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">
            <ShieldCheck className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" /> verified email
          </span>
        </div>

        {/* Empty state OR modal OR success */}
        {stage === 0 && (
          <div className="mt-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-500/20 grid place-items-center mb-3">
              <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">No apps yet</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Create your first app to get started.</div>
            <div className="mt-4 inline-flex relative">
              <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-white text-xs font-semibold
                                 bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm">
                <Plus className="w-3.5 h-3.5" /> Create App
              </button>
            </div>
          </div>
        )}

        {(stage === 1 || stage === 2) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-3 top-12 sm:inset-x-6 sm:top-14
                       rounded-2xl bg-white dark:bg-slate-900
                       border border-slate-200/80 dark:border-white/10
                       shadow-2xl p-5 z-10"
          >
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Choose an app type
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1">What do you want to build?</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { id: 'consumer', label: 'For your community', tone: 'border-slate-200 dark:border-white/10' },
                { id: 'business', label: 'For your business', tone: 'border-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-500/30' },
                { id: 'gaming',   label: 'For games',         tone: 'border-slate-200 dark:border-white/10' },
              ].map((c) => (
                <div
                  key={c.id}
                  className={`relative rounded-lg border-2 p-3 ${c.tone} ${c.id === 'business' ? 'bg-emerald-50/40 dark:bg-emerald-500/10' : 'bg-slate-50/40 dark:bg-slate-800/40'}`}
                >
                  <Building2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                  <div className="text-[10px] font-semibold mt-2 text-slate-800 dark:text-slate-200">{c.label}</div>
                  {c.id === 'business' && (
                    <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider
                                    bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                      <Check className="w-2 h-2" /> pick this
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="px-3 py-1.5 rounded text-xs text-slate-500 dark:text-slate-400">Cancel</button>
              <button className="px-3 py-1.5 rounded text-xs font-semibold text-white
                                 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm">
                Next <ArrowRight className="w-3 h-3 inline -mt-0.5 ml-0.5" />
              </button>
            </div>
          </motion.div>
        )}

        {stage === 3 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-3 top-12 sm:inset-x-6 sm:top-14
                       rounded-2xl bg-white dark:bg-slate-900
                       border border-slate-200/80 dark:border-white/10
                       shadow-2xl p-5 z-10"
          >
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              App details
            </div>
            <div className="mt-3 space-y-2.5">
              <div>
                <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">App Display Name</div>
                <div className="mt-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10
                                bg-white dark:bg-slate-800 text-xs font-mono">
                  WhatsyITC Billing
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">Contact Email</div>
                <div className="mt-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10
                                bg-white dark:bg-slate-800 text-xs font-mono">
                  ops@whatsyitc.example
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="px-3 py-1.5 rounded text-xs text-slate-500 dark:text-slate-400">Back</button>
              <button className="px-3 py-1.5 rounded text-xs font-semibold text-white
                                 bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm">
                Create App
              </button>
            </div>
          </motion.div>
        )}

        {stage === 4 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-x-3 top-12 sm:inset-x-6 sm:top-14
                       rounded-2xl bg-white dark:bg-slate-900
                       border border-slate-200/80 dark:border-white/10
                       shadow-2xl p-5 z-10 text-center"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/20
                         grid place-items-center"
            >
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">App created</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono">WhatsyITC Billing</span> · App ID <span className="font-mono">1025607483965144</span>
            </div>
          </motion.div>
        )}

        {/* animated cursor */}
        <AnimatedCursor active={stage === 0} x={50} y={70} duration={0.7} delay={0.2} reduced={reduced} />
        <AnimatedCursor active={stage === 1} x={66} y={65} duration={0.7} delay={0.1} reduced={reduced} />
        <AnimatedCursor active={stage === 2} x={92} y={88} duration={0.6} delay={0.1} reduced={reduced} />
        <AnimatedCursor active={stage === 3} x={85} y={86} duration={0.6} delay={0.1} reduced={reduced} />
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  STEP 2 — Add WhatsApp product + get WABA ID                            */
/* ────────────────────────────────────────────────────────────────────── */

function WABASetupMock() {
  const reduced = useReducedMotion() ?? false
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (reduced) return
    const t = [
      setTimeout(() => setStage(1),  900),
      setTimeout(() => setStage(2),  2200),
      setTimeout(() => setStage(3),  3600),
      setTimeout(() => setStage(0),  5800),
    ]
    return () => t.forEach(clearTimeout)
  }, [reduced])

  return (
    <MockWindow
      title="developers.facebook.com · App Dashboard"
      tone="emerald"
      right={
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">SET UP</span>
        </div>
      }
    >
      <div className="relative p-4 sm:p-5 min-h-[440px] bg-slate-50/30 dark:bg-slate-950/30">
        {/* fake sidebar + topbar */}
        <div className="flex items-start gap-3">
          <div className="hidden sm:flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400 w-28 shrink-0">
            <span className="px-2 py-1 rounded bg-slate-100 dark:bg-white/5 font-semibold">Dashboard</span>
            <span className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/5">Settings</span>
            <span className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/5">Products</span>
            <span className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/5">Roles</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200/60 dark:border-white/5">
              <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">Add a Product</span>
            </div>

            {/* Product grid */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { name: 'Instagram',   icon: HashIcon,   tone: 'border-slate-200 dark:border-white/10', setUp: false },
                { name: 'Messenger',   icon: MailCheck,  tone: 'border-slate-200 dark:border-white/10', setUp: false },
                { name: 'WhatsApp',    icon: Smartphone, tone: 'border-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-500/30', setUp: true },
                { name: 'Ads',         icon: Briefcase,  tone: 'border-slate-200 dark:border-white/10', setUp: false },
                { name: 'Pages',       icon: Building2,  tone: 'border-slate-200 dark:border-white/10', setUp: false },
                { name: 'Workplace',   icon: Settings2,  tone: 'border-slate-200 dark:border-white/10', setUp: false },
              ].map((p) => (
                <div
                  key={p.name}
                  className={`relative rounded-lg border-2 p-2 ${p.tone} ${p.setUp ? 'bg-emerald-50/40 dark:bg-emerald-500/10' : 'bg-white/50 dark:bg-slate-800/40'}`}
                >
                  <p.icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <div className="text-[10px] font-semibold mt-1.5 text-slate-800 dark:text-slate-200">{p.name}</div>
                  {p.setUp ? (
                    <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider
                                    bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                      <Check className="w-2 h-2" /> Set up
                    </div>
                  ) : (
                    <div className="mt-1 text-[9px] text-slate-400">—</div>
                  )}
                </div>
              ))}
            </div>

            {/* After click: WABA ID display */}
            {stage >= 1 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4 rounded-lg border border-slate-200 dark:border-white/10
                           bg-white dark:bg-slate-800/60 p-3"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-5 h-5 rounded bg-emerald-500 grid place-items-center text-white">
                    <Smartphone className="w-3 h-3" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">WhatsApp Business Account</span>
                  <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
                                   bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="w-2.5 h-2.5" /> active
                  </span>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                  WhatsApp Business Account ID
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 font-mono text-sm font-semibold text-slate-900 dark:text-white
                                  bg-slate-50 dark:bg-slate-950/60 rounded-md px-2.5 py-1.5
                                  ring-2 ring-emerald-400/60 dark:ring-emerald-500/40">
                    123456789012345
                  </div>
                  {stage >= 2 ? (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold
                                 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    >
                      <Check className="w-3 h-3" /> Copied
                    </motion.div>
                  ) : (
                    <div className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold
                                    bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                      <Copy className="w-3 h-3" /> Copy
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* copy arrow → paste target */}
        <PasteTargetCard
          label="WABA ID"
          value="123456789012345"
          visible={stage >= 2}
          tone="emerald"
        />

        <AnimatedCursor active={stage === 0} x={62} y={36} duration={0.7} delay={0.1} reduced={reduced} />
        <AnimatedCursor active={stage === 1} x={70} y={86} duration={0.6} delay={0.1} reduced={reduced} />
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  STEP 3 — Add a phone number + get Phone Number ID                      */
/* ────────────────────────────────────────────────────────────────────── */

function PhoneNumberMock() {
  const reduced = useReducedMotion() ?? false
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (reduced) return
    const t = [
      setTimeout(() => setStage(1),  800),
      setTimeout(() => setStage(2),  2200),
      setTimeout(() => setStage(3),  3800),
      setTimeout(() => setStage(0),  6200),
    ]
    return () => t.forEach(clearTimeout)
  }, [reduced])

  return (
    <MockWindow
      title="developers.facebook.com · WhatsApp · Phone Numbers"
      tone="violet"
      right={
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /> live
        </div>
      }
    >
      <div className="relative p-4 sm:p-5 min-h-[440px] bg-slate-50/30 dark:bg-slate-950/30">
        {/* header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-violet-500" />
            <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Phone Numbers</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">· {stage >= 3 ? 2 : 1} numbers</span>
          </div>
          {stage === 0 && (
            <button className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-white
                               bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-sm">
              <Plus className="w-3 h-3" /> Add phone number
            </button>
          )}
        </div>

        {/* table */}
        <div className="rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider
                          text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-950/60
                          px-2.5 py-1.5 border-b border-slate-200 dark:border-white/10 font-semibold">
            <div className="col-span-4">Display phone</div>
            <div className="col-span-2">Verified</div>
            <div className="col-span-4">Phone Number ID</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {/* existing row — the test number */}
          <div className="grid grid-cols-12 gap-1 items-center px-2.5 py-1.5 text-[11px]
                          text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-white/5">
            <div className="col-span-4 font-mono text-[10px]">+1 555 0100</div>
            <div className="col-span-2">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-semibold
                               bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                <Check className="w-2 h-2" /> yes
              </span>
            </div>
            <div className="col-span-4 font-mono text-[10px] text-slate-500 dark:text-slate-400">123456789012340</div>
            <div className="col-span-2 text-right text-[9px] text-slate-500">test</div>
          </div>

          {/* new row — appears at stage 3, highlighted */}
          {stage >= 3 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-12 gap-1 items-center px-2.5 py-1.5 text-[11px]
                          text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-white/5
                          bg-violet-50/40 dark:bg-violet-500/10"
            >
              <div className="col-span-4 font-mono text-[10px]">+91 98765 43210</div>
              <div className="col-span-2">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-semibold
                                 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  <Check className="w-2 h-2" /> yes
                </span>
              </div>
              <div className="col-span-4 font-mono text-[10px] relative">
                <span className="font-semibold text-slate-900 dark:text-white
                                 bg-white dark:bg-slate-900 rounded-md px-1.5 py-0.5
                                 ring-2 ring-violet-400 dark:ring-violet-500/50
                                 animate-[pulse_2s_ease-in-out_infinite]">
                  1025607483965144
                </span>
              </div>
              <div className="col-span-2 text-right text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">
                <CheckCircle2 className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" /> new
              </div>
            </motion.div>
          )}
        </div>

        {/* typing-in modal at stage 1-2 */}
        {(stage === 1 || stage === 2) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-3 top-16 sm:inset-x-8 sm:top-20
                       rounded-2xl bg-white dark:bg-slate-900
                       border border-slate-200/80 dark:border-white/10
                       shadow-2xl p-4 z-10"
          >
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Add phone number
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-700 dark:text-slate-300">Phone number (with country code)</div>
            <div className="mt-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10
                            bg-white dark:bg-slate-800 text-xs font-mono">
              919876543210
              {stage === 1 && <span className="inline-block w-0.5 h-3 ml-0.5 bg-violet-500 animate-pulse align-middle" />}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button className="px-2.5 py-1 rounded text-[11px] text-slate-500 dark:text-slate-400">Cancel</button>
              {stage === 2 ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold
                                 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  <Check className="w-3 h-3" /> Code sent
                </span>
              ) : (
                <button className="px-2.5 py-1 rounded text-[11px] font-semibold text-white
                                   bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-sm">
                  Send code
                </button>
              )}
            </div>
          </motion.div>
        )}

        <PasteTargetCard
          label="Phone Number ID"
          value="1025607483965144"
          visible={stage >= 3}
          tone="violet"
        />

        <AnimatedCursor active={stage === 0} x={86} y={18} duration={0.7} delay={0.1} reduced={reduced} />
        <AnimatedCursor active={stage === 1} x={83} y={72} duration={0.5} delay={0.1} reduced={reduced} />
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  STEP 4 — Generate Access Token + pick API version                       */
/* ────────────────────────────────────────────────────────────────────── */

function TokenMock() {
  const reduced = useReducedMotion() ?? false
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (reduced) return
    const t = [
      setTimeout(() => setStage(1),  900),
      setTimeout(() => setStage(2),  2200),
      setTimeout(() => setStage(3),  4200),
      setTimeout(() => setStage(0),  7000),
    ]
    return () => t.forEach(clearTimeout)
  }, [reduced])

  return (
    <MockWindow
      title="business.facebook.com · System Users"
      tone="rose"
      right={
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> live
        </div>
      }
    >
      <div className="relative p-4 sm:p-5 min-h-[440px] bg-slate-50/30 dark:bg-slate-950/30">
        {/* header */}
        <div className="flex items-center gap-2 pb-3 border-b border-slate-200/60 dark:border-white/5">
          <Briefcase className="w-3.5 h-3.5 text-rose-500" />
          <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">System Users</span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">· WhatsyITC</span>
        </div>

        {/* system user row */}
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider
                          text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-950/60
                          px-2.5 py-1.5 border-b border-slate-200 dark:border-white/10 font-semibold">
            <div className="col-span-4">Name</div>
            <div className="col-span-3">Role</div>
            <div className="col-span-5 text-right">Action</div>
          </div>
          <div className="grid grid-cols-12 gap-1 items-center px-2.5 py-1.5 text-[11px]
                          text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-white/5
                          bg-rose-50/30 dark:bg-rose-500/5">
            <div className="col-span-4">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-rose-500 to-orange-500 grid place-items-center text-white text-[9px] font-bold">W</div>
                <span className="font-semibold text-slate-900 dark:text-white">whatsyitc-bot</span>
              </div>
            </div>
            <div className="col-span-3">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
                               bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-2 h-2" /> Admin
              </span>
            </div>
            <div className="col-span-5 text-right">
              {stage === 0 ? (
                <button className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold text-white
                                   bg-gradient-to-r from-rose-600 to-orange-600 shadow-sm">
                  <KeyRound className="w-3 h-3" /> Generate New Token
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <Check className="w-3 h-3 text-emerald-500" /> token issued
                </span>
              )}
            </div>
          </div>
        </div>

        {/* token modal OR issued token display */}
        {(stage === 1 || stage === 2) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-3 top-12 sm:inset-x-6 sm:top-16
                       rounded-2xl bg-white dark:bg-slate-900
                       border border-slate-200/80 dark:border-white/10
                       shadow-2xl p-4 z-10"
          >
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Generate Token
            </div>

            <div className="mt-3 space-y-2.5">
              <div>
                <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">App</div>
                <div className="mt-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10
                                bg-white dark:bg-slate-800 text-xs font-mono">
                  WhatsyITC Billing
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">Scopes</div>
                <div className="mt-1 space-y-1">
                  {[
                    'whatsapp_business_management',
                    'whatsapp_business_messaging',
                  ].map((s, i) => (
                    <div key={s} className="flex items-center gap-1.5 text-[10px] font-mono text-slate-700 dark:text-slate-200">
                      {stage === 2 || (stage === 1 && i === 0) ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="w-3 h-3 rounded border-2 border-slate-300 dark:border-slate-600 shrink-0" />
                      )}
                      <span className={stage === 2 || (stage === 1 && i === 0) ? 'text-emerald-700 dark:text-emerald-300' : ''}>
                        {s}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">Token expiration</div>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-600 dark:text-slate-300">
                  <span className="flex items-center gap-1 opacity-60">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-300 dark:border-slate-600" /> 60 days
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-500/30" /> Never
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              <button className="px-2.5 py-1 rounded text-[11px] text-slate-500 dark:text-slate-400">Cancel</button>
              {stage === 2 ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-white
                                 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm">
                  <Loader2 className="w-3 h-3 animate-spin" /> Generating…
                </span>
              ) : (
                <button className="px-2.5 py-1 rounded text-[11px] font-semibold text-white
                                   bg-gradient-to-r from-rose-600 to-orange-600 shadow-sm">
                  Generate Token
                </button>
              )}
            </div>
          </motion.div>
        )}

        {stage === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-4 rounded-lg border border-emerald-300 dark:border-emerald-500/40
                       bg-emerald-50/60 dark:bg-emerald-500/10 p-3"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
                               bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                <Check className="w-2.5 h-2.5" /> Generated
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Copy this token now — you won&apos;t see it again.</span>
            </div>
            <div className="font-mono text-[10px] bg-white dark:bg-slate-950/60 rounded-md px-2 py-1.5 break-all
                            ring-2 ring-rose-400/60 dark:ring-rose-500/40">
              EAAJ9z7XQ2b8K4pL1mNvT0sR3yF6hG9wXcE5vB2nQ8jM4tH7kP1sZ6dY3rL0uA5fB8gC1iE2oD9wS4xR6yU7tA0bC3dE5fG6hI7jK8lM
            </div>
            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">API version:</span>{' '}
              pick <code className="bg-slate-100 dark:bg-white/10 px-1 rounded">v25.0</code> unless you have a specific reason otherwise.
            </div>
          </motion.div>
        )}

        <PasteTargetCard
          label="Access Token"
          value="EAAJ9z7XQ2b8K4pL1mNvT0sR3yF6hG9w…"
          visible={stage >= 3}
          tone="rose"
        />

        <AnimatedCursor active={stage === 0} x={88} y={32} duration={0.7} delay={0.1} reduced={reduced} />
        <AnimatedCursor active={stage === 1} x={87} y={80} duration={0.5} delay={0.1} reduced={reduced} />
      </div>
    </MockWindow>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Final checklist + closing CTA                                          */
/* ────────────────────────────────────────────────────────────────────── */

function FinalChecklist() {
  const fields = [
    { k: 'Phone Number ID', from: 'Step 03', value: '1025607483965144', tone: 'violet' },
    { k: 'WABA ID (optional)', from: 'Step 02', value: '123456789012345', tone: 'emerald' },
    { k: 'Access Token',     from: 'Step 04', value: 'EAAJ9z7XQ2b8K4pL1mNvT0sR3yF…', tone: 'rose' },
    { k: 'Verify Token',     from: 'You make it up', value: 'any-random-string', tone: 'amber' },
    { k: 'API version',      from: 'Step 04', value: 'v25.0', tone: 'sky' },
  ]
  const toneMap: Record<string, string> = {
    emerald: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    sky:     'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
    violet:  'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
    amber:   'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
    rose:    'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300',
  }

  return (
    <section className="relative max-w-6xl mx-auto mt-24 lg:mt-32">
      <div className="relative overflow-hidden rounded-3xl p-8 lg:p-12 text-white shadow-2xl
                      bg-[linear-gradient(120deg,#0f766e_0%,#059669_30%,#10b981_55%,#06b6d4_100%)] gradient-pan">
        <div aria-hidden className="absolute inset-0 opacity-50 mix-blend-screen">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-300/60 blur-3xl aurora-blob aurora-1" />
          <div className="absolute -bottom-32 -left-10 w-80 h-80 rounded-full bg-cyan-300/60 blur-3xl aurora-blob aurora-2" />
          <div className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full bg-violet-400/40 blur-3xl aurora-blob aurora-3" />
        </div>
        <NoiseOverlay />

        <div className="relative grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]
                             bg-white/15 backdrop-blur rounded-full px-2.5 py-1 border border-white/20">
              <ListChecks className="w-3 h-3" /> Final checklist
            </span>
            <h2 className="mt-4 text-3xl lg:text-4xl font-semibold tracking-tight">
              All five fields ready?
            </h2>
            <p className="mt-3 text-emerald-50/95 max-w-md leading-relaxed">
              Head back to the credentials form, paste each value into its matching field, and hit
              <strong className="text-white"> Save &amp; Test connection</strong>. You should see a
              green Verified pill within a second.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
                <Link
                  to="/admin/credentials"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-emerald-700 font-semibold shadow-lg
                             hover:shadow-xl transition-shadow"
                >
                  Back to credentials <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
                <a
                  href="#step-1"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-white/30 hover:bg-white/10 text-white font-medium backdrop-blur"
                >
                  Replay the walkthrough
                </a>
              </motion.div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ul className="space-y-2.5">
              {fields.map((f) => (
                <li
                  key={f.k}
                  className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-4 py-3"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${toneMap[f.tone]}`}>
                      {f.from}
                    </span>
                    <span className="text-[12px] font-semibold text-white">{f.k}</span>
                  </div>
                  <div className="font-mono text-[11px] text-emerald-50/90 break-all bg-black/15 rounded-md px-2 py-1.5">
                    {f.value}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[10px] text-emerald-50/70 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                The <code className="bg-black/20 px-1 rounded">Access Token</code> is shown only once by Meta — copy it before you close that tab. The{' '}
                <code className="bg-black/20 px-1 rounded">Verify Token</code> is any string you invent; just make sure it matches what you set in the Meta webhook.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  THE PAGE                                                               */
/* ────────────────────────────────────────────────────────────────────── */

export default function SetupGuide() {
  useEffect(() => { document.title = 'Setup guide — WhatsyITC' }, [])

  return (
    <div className="space-y-2">
      <PageHeader
        title="Setup guide"
        subtitle="Five minutes from a fresh Meta account to your first verified WhatsApp Business message."
        right={
          <Link to="/admin/credentials">
            <SecondaryButton>
              <ArrowLeft className="w-4 h-4" /> Back to credentials
            </SecondaryButton>
          </Link>
        }
      />

      <Hero />

      <Chapter
        id="step-1"
        n={1}
        accent="from-blue-600 to-indigo-600"
        eyebrow="Step 01 · Account"
        title="Create a Meta Developer account and a new App."
        lead={
          <>
            Go to{' '}
            <a href="https://developers.facebook.com" target="_blank" rel="noreferrer"
               className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
              developers.facebook.com
            </a>
            , sign in with any Facebook account, accept the developer terms, and click{' '}
            <strong className="text-slate-900 dark:text-white">My Apps → Create App</strong>.
            Choose <strong className="text-slate-900 dark:text-white">Business</strong> as the app type —
            that&apos;s the only one that supports WhatsApp.
          </>
        }
        bullets={[
          'Free, no review needed at this stage',
          'Business-type app unlocks the WhatsApp product',
          'You\'ll be asked to verify your email + phone',
        ]}
        mock={<MetaDevMock />}
      />

      <Chapter
        id="step-2"
        n={2}
        accent="from-emerald-500 to-teal-500"
        eyebrow="Step 02 · WhatsApp product"
        title="Add WhatsApp to your app and copy your WABA ID."
        lead={
          <>
            On the App Dashboard, click <strong className="text-slate-900 dark:text-white">Add Product</strong>,
            find the WhatsApp card, and click <strong className="text-slate-900 dark:text-white">Set Up</strong>.
            Meta creates a test WhatsApp Business Account — copy the{' '}
            <strong className="text-slate-900 dark:text-white">WhatsApp Business Account ID</strong>{' '}
            from the top of the WhatsApp setup page. That&apos;s your WABA ID.
          </>
        }
        bullets={[
          'WABA ID is a 15-digit number, e.g. 123456789012345',
          'Paste it into the optional WABA ID field on /credentials',
          'Don\'t pay for anything yet — the test account is free',
        ]}
        mock={<WABASetupMock />}
        reversed
      />

      <Chapter
        id="step-3"
        n={3}
        accent="from-violet-500 to-fuchsia-500"
        eyebrow="Step 03 · Phone number"
        title="Register a phone number and grab its ID."
        lead={
          <>
            In the left sidebar of the WhatsApp setup page, click{' '}
            <strong className="text-slate-900 dark:text-white">Phone Numbers → Add Phone Number</strong>.
            You can add a real number (Meta will text you a verification code) or use Meta&apos;s free test
            number for now. Once added, click the number to see its{' '}
            <strong className="text-slate-900 dark:text-white">Phone Number ID</strong> — paste that into our app.
          </>
        }
        bullets={[
          'Real numbers take ~1 min to verify',
          'Test number is free and works for the first 5 numbers',
          'Phone Number ID is 15-16 digits, different from the phone number itself',
        ]}
        mock={<PhoneNumberMock />}
      />

      <Chapter
        id="step-4"
        n={4}
        accent="from-rose-500 to-orange-500"
        eyebrow="Step 04 · Token"
        title="Generate a permanent system-user token."
        lead={
          <>
            System-user tokens don&apos;t expire in 60 days — they&apos;re what production integrations use.
            In the Meta dashboard, go to{' '}
            <strong className="text-slate-900 dark:text-white">Business Settings → System Users</strong>,
            create a system user with <strong className="text-slate-900 dark:text-white">Admin</strong> role,
            then <strong className="text-slate-900 dark:text-white">Add Assets</strong> to grant access to your
            WhatsApp App. Finally click <strong className="text-slate-900 dark:text-white">Generate New Token</strong>,
            select your app, choose scopes (
            <code className="bg-slate-100 dark:bg-white/10 px-1 rounded text-[11px]">whatsapp_business_management</code>,{' '}
            <code className="bg-slate-100 dark:bg-white/10 px-1 rounded text-[11px]">whatsapp_business_messaging</code>
            ), and set expiration to <strong className="text-slate-900 dark:text-white">Never</strong>.
          </>
        }
        bullets={[
          'Token starts with "EAA…"',
          'Pick API version v25.0 (or whatever the latest stable is)',
          'Copy the token immediately — Meta only shows it once',
        ]}
        mock={<TokenMock />}
        reversed
      />

      <FinalChecklist />

      <div className="h-12" />
    </div>
  )
}
