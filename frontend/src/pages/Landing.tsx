import { Link } from 'react-router-dom'
import {
  motion, useReducedMotion, useScroll, useTransform,
  useMotionValue, useSpring, useInView,
} from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, FileSpreadsheet,
  FileText, MessageSquare, MessagesSquare, ShieldCheck, UploadCloud,
  Sparkles, TrendingUp, Users, Webhook, Zap, BarChart3, Activity,
  CheckCheck, Eye, AlertCircle, Send, Layers, Star, MousePointer2,
  Quote, Lock, Server, KeyRound, Search, Phone, MoreVertical,
} from 'lucide-react'
import { CountUp, PillPop } from '@/lib/motion'
import ThemeToggle from '@/components/ThemeToggle'

// ---------------------------------------------------------------------------
// shared primitives
// ---------------------------------------------------------------------------

function Eyebrow({
  icon: Icon, text, tone = 'emerald',
}: { icon: any; text: string; tone?: 'emerald' | 'violet' | 'blue' | 'amber' }) {
  const tones = {
    emerald: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/20',
    violet:  'bg-violet-50/80  text-violet-700  border-violet-200/80  dark:bg-violet-500/15  dark:text-violet-300  dark:border-violet-400/20',
    blue:    'bg-sky-50/80     text-sky-700     border-sky-200/80     dark:bg-sky-500/15     dark:text-sky-300     dark:border-sky-400/20',
    amber:   'bg-amber-50/80   text-amber-800   border-amber-200/80   dark:bg-amber-500/15   dark:text-amber-300   dark:border-amber-400/20',
  }
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur ${tones[tone]}`}>
      <Icon className="w-3 h-3" /> {text}
    </div>
  )
}

function NoiseOverlay() {
  return <div aria-hidden className="noise-overlay" />
}

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 grid-overlay opacity-60 dark:opacity-100" />
      <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full aurora-blob aurora-1
                      bg-[radial-gradient(circle,_rgba(34,197,94,0.50),_transparent_70%)]
                      dark:bg-[radial-gradient(circle,_rgba(34,197,94,0.32),_transparent_70%)] dark:mix-blend-screen" />
      <div className="absolute top-20 -right-32 w-[32rem] h-[32rem] rounded-full aurora-blob aurora-2
                      bg-[radial-gradient(circle,_rgba(6,182,212,0.40),_transparent_70%)]
                      dark:bg-[radial-gradient(circle,_rgba(6,182,212,0.28),_transparent_70%)] dark:mix-blend-screen" />
      <div className="absolute top-1/2 left-1/3 w-[28rem] h-[28rem] rounded-full aurora-blob aurora-3
                      bg-[radial-gradient(circle,_rgba(139,92,246,0.32),_transparent_70%)]
                      dark:bg-[radial-gradient(circle,_rgba(139,92,246,0.24),_transparent_70%)] dark:mix-blend-screen" />
      <div className="absolute bottom-0 right-1/4 w-[24rem] h-[24rem] rounded-full aurora-blob aurora-4
                      bg-[radial-gradient(circle,_rgba(245,158,11,0.22),_transparent_70%)]
                      dark:bg-[radial-gradient(circle,_rgba(245,158,11,0.18),_transparent_70%)] dark:mix-blend-screen" />
    </div>
  )
}

// helper: derive one motion value from another with a multiplier
function useDerived(mv: any, k: number) {
  const out = useMotionValue(0)
  useEffect(() => mv.on('change', (v: number) => out.set(v * k)), [mv, k, out])
  return out
}

// chrome bar used at the top of every dashboard mock
function MockChrome({ title = 'whatsyitc · dashboard' }: { title?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5">
      <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
      <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
      <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
      <div className="mx-auto flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {title}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// nav — floating glass pill
// ---------------------------------------------------------------------------

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-3 lg:top-4 z-50 px-4"
    >
      <div className={`max-w-6xl mx-auto flex items-center justify-between h-12 lg:h-14 px-3 lg:px-4
        rounded-full border transition-all duration-300
        ${scrolled
          ? 'backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.10)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.45)]'
          : 'backdrop-blur-md shadow-sm'}
        ${scrolled
          ? 'bg-white/80 border-white/60 dark:bg-slate-900/80 dark:border-slate-700/50'
          : 'bg-white/40 border-white/40 dark:bg-slate-900/40 dark:border-slate-700/30'}`}
      >
        <Link to="/" className="flex items-center gap-2 group pl-1">
          <motion.div
            whileHover={{ rotate: 12, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="relative w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center text-white font-bold text-sm shadow-md shadow-emerald-500/30"
          >
            W
            <span className="absolute -inset-1 rounded-full bg-emerald-400/40 blur-md -z-10 opacity-0 group-hover:opacity-100 transition" />
          </motion.div>
          <div className="leading-tight">
            <div className="font-semibold text-slate-900 dark:text-white dark:text-white text-sm">WhatsyITC</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Admin Console</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-[13px] text-slate-700 dark:text-slate-300">
          <a href="#features"  className="hover:text-slate-950 dark:hover:text-white transition">Features</a>
          <a href="#workflow"  className="hover:text-slate-950 dark:hover:text-white transition">How it works</a>
          <a href="#metrics"   className="hover:text-slate-950 dark:hover:text-white transition">Metrics</a>
          <a href="#customers" className="hover:text-slate-950 dark:hover:text-white transition">Customers</a>
          <a href="#faq"       className="hover:text-slate-950 dark:hover:text-white transition">FAQ</a>
        </nav>

        <div className="flex items-center gap-1.5 pr-1">
          <ThemeToggle variant="pill" />
          <Link
            to="/login"
            className="hidden sm:inline-flex items-center px-3 py-1.5 text-[13px] font-medium
                       text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
          >
            Sign in
          </Link>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/login"
              className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                         text-white text-[13px] font-medium
                         bg-gradient-to-r from-brand-600 via-emerald-600 to-teal-600
                         shadow-[0_6px_24px_rgba(16,185,129,0.35)]
                         hover:shadow-[0_8px_32px_rgba(16,185,129,0.5)] transition-shadow"
            >
              Open admin <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.header>
  )
}

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

function Hero() {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const heroY = useTransform(scrollYProgress, [0, 1], [0, -60])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.6])

  // mouse parallax (subtle)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 60, damping: 14 })
  const smy = useSpring(my, { stiffness: 60, damping: 14 })
  const onMove = (e: React.MouseEvent) => {
    if (reduced) return
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 14)
    my.set(((e.clientY - r.top) / r.height - 0.5) * 14)
  }
  const onLeave = () => { mx.set(0); my.set(0) }

  return (
    <section ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className="relative overflow-hidden">
      <AuroraBackdrop />
      <NoiseOverlay />

      <motion.div style={{ y: heroY, opacity: heroOpacity }} className="max-w-7xl mx-auto px-5 lg:px-8 pt-20 lg:pt-28 pb-20 lg:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2"
            >
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 backdrop-blur border border-emerald-200/70 text-emerald-700 text-[11px] font-medium shadow-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                Built for Meta WhatsApp Cloud · v25.0
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 text-display text-[44px] sm:text-6xl lg:text-[72px] xl:text-[80px] text-slate-900 dark:text-white max-w-4xl"
            >
              Send billing reminders
              <br className="hidden sm:block" />{' '}
              <span className="text-gradient-aurora gradient-pan">without lifting a phone.</span>
              <br className="hidden md:block" />{' '}
              <span className="text-slate-900 dark:text-white">Approve a sheet. Done.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.5 }}
              className="mt-6 text-lg text-slate-600 dark:text-slate-400 max-w-xl leading-relaxed"
            >
              WhatsyITC is a self-hosted WhatsApp billing console for distributors.
              Upload your retailer sheet, hit <span className="font-semibold text-slate-800 dark:text-slate-100">Approve</span>,
              and personalised messages go out via Meta Cloud API — with delivered, read and
              failed status flowing back into the same dashboard.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26, duration: 0.5 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
                <Link
                  to="/login"
                  className="relative inline-flex items-center gap-2 px-5 py-3 rounded-xl
                             text-white font-medium
                             bg-gradient-to-r from-brand-600 via-emerald-600 to-teal-600
                             shadow-[0_10px_30px_rgba(16,185,129,0.35)]
                             hover:shadow-[0_16px_40px_rgba(16,185,129,0.5)]
                             transition-shadow overflow-hidden group"
                >
                  <span className="relative z-10">Open admin console</span>
                  <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-0.5 transition" />
                  <span aria-hidden className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                                              bg-gradient-to-r from-transparent via-white/25 to-transparent
                                              transition-transform duration-700" />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
                <Link
                  to="/how-it-works"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                             glass text-slate-800 dark:text-slate-100 font-medium hover:bg-white/80 transition"
                >
                  See how it works <MousePointer2 className="w-4 h-4" />
                </Link>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.36, duration: 0.6 }}
              className="mt-7 flex flex-wrap items-center gap-2"
            >
              {[
                { icon: ShieldCheck, label: 'SOC2-ready' },
                { icon: Lock,        label: 'AES-256 at rest' },
                { icon: Server,      label: 'Self-hosted' },
                { icon: Activity,    label: 'Real-time webhooks' },
              ].map((t, i) => (
                <motion.span
                  key={t.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.06 }}
                  className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300
                             glass rounded-full px-2.5 py-1"
                >
                  <t.icon className="w-3 h-3 text-emerald-600" /> {t.label}
                </motion.span>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="mt-8 inline-flex items-center gap-3 glass rounded-full pl-2 pr-4 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300">
                <span className="flex gap-0.5">
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">Live · 1,248 messages sent today</span>
              </span>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.18, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-5 order-1 lg:order-2"
          >
            <HeroMockup reduced={reduced} smx={smx} smy={smy} />
          </motion.div>
        </div>
      </motion.div>

      <motion.a
        href="#trust"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
        className="hidden lg:flex absolute bottom-5 left-1/2 -translate-x-1/2 flex-col items-center gap-1
                   text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
      >
        scroll
        <motion.span animate={{ y: [0, 4, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </motion.a>
    </section>
  )
}

function HeroMockup({
  reduced, smx, smy,
}: { reduced: boolean; smx: any; smy: any }) {
  return (
    <div className="relative">
      <motion.div
        animate={reduced ? {} : { y: [0, -6, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="relative glass-premium glass-highlight rounded-3xl overflow-hidden"
        style={{ x: smx, y: smy }}
      >
        <MockChrome />
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">Today's delivery</div>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold
                             text-emerald-700 bg-emerald-100/80 backdrop-blur rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniKpi tone="blue"    label="Sent"      value="1,248" />
            <MiniKpi tone="emerald" label="Delivered" value="96%" />
            <MiniKpi tone="violet"  label="Read"      value="71%" />
          </div>
          <div className="rounded-xl bg-white/60 dark:bg-white/5 backdrop-blur border border-white/70 dark:border-white/10 p-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-2">
              <span className="font-medium">Last 7 days</span>
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sent</span>
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Delivered</span>
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Read</span>
              </span>
            </div>
            <MiniSparkline />
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white/60 dark:bg-white/5 border border-white/70 dark:border-white/10 p-2.5">
            <div className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-teal-500 text-white text-[10px] font-bold">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 text-[11px] text-slate-700 dark:text-slate-300">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Suggested action</div>
              <div className="text-slate-500 dark:text-slate-400">5 retailers bounced — auto-remove and reschedule?</div>
            </div>
            <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 rounded-full px-2 py-0.5">Apply</span>
          </div>
        </div>
      </motion.div>

      <motion.div
        animate={reduced ? {} : { y: [0, 8, 0], rotate: [-1, 1, -1] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
        className="absolute -left-8 -bottom-10 w-64 glass glass-highlight rounded-2xl p-3.5 hidden sm:block"
        style={{ x: useDerived(smx, -0.6), y: useDerived(smy, -0.6) }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-xs font-bold shadow">R</div>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">Rakesh Distributors</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">+91 98xxx xxx12</div>
          </div>
          <span className="ml-auto text-[10px] text-emerald-600 inline-flex items-center gap-0.5 font-semibold">
            <CheckCheck className="w-3 h-3" /> Read
          </span>
        </div>
        <div className="text-[11px] text-slate-700 dark:text-slate-300 bg-white/70 dark:bg-white/10 rounded-lg p-2 leading-relaxed">
          Hi Rakesh, your invoice <span className="font-semibold">INV-2418</span> for{' '}
          <span className="font-semibold">₹12,480</span> is due on 25 Jun. Tap to view:{' '}
          <span className="text-brand-600 underline">pay.example.com/inv/2418</span>
        </div>
      </motion.div>

      <motion.div
        animate={reduced ? {} : { y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
        className="absolute -top-4 -right-3 glass rounded-xl px-3 py-2 flex items-center gap-2"
        style={{ x: useDerived(smx, 0.4), y: useDerived(smy, 0.4) }}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs font-medium text-slate-800 dark:text-slate-100">Webhook · delivered</span>
      </motion.div>

      <div className="absolute -top-8 -left-8 w-24 h-24 opacity-60 pointer-events-none">
        <div className="absolute inset-0 ring-dashed-spin" />
        <div className="absolute inset-3 rounded-full border border-dashed border-violet-300/60 ring-spin-rev" />
      </div>
    </div>
  )
}

function MiniKpi({ tone, label, value }: { tone: 'blue' | 'emerald' | 'violet'; label: string; value: string }) {
  const map = {
    blue:    'from-blue-50/90 to-indigo-50/90 text-blue-700',
    emerald: 'from-emerald-50/90 to-teal-50/90 text-emerald-700',
    violet:  'from-violet-50/90 to-fuchsia-50/90 text-violet-700',
  }
  return (
    <div className={`rounded-lg p-2.5 bg-gradient-to-br ${map[tone]} border border-white/60 dark:border-white/10 dark:opacity-90`}>
      <div className="text-[9px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function MiniSparkline() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-50px' })
  const pts = [4, 7, 5, 9, 12, 10, 14, 11, 16, 14, 18, 17, 22]
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const w = 240, h = 48
  const stepX = w / (pts.length - 1)
  const path = pts.map((v, i) => {
    const x = i * stepX
    const y = h - ((v - min) / (max - min || 1)) * h
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
      <defs>
        <linearGradient id="hp-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="url(#hp-grad)" />
      <motion.path
        d={path}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: inView ? 1 : 0 }}
        transition={{ duration: 1.4, ease: 'easeOut' }}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// trust strip
// ---------------------------------------------------------------------------

function TrustStrip() {
  const stats: { value: number; suffix: string; label: string; decimals?: number }[] = [
    { value: 12500, suffix: '+', label: 'Messages sent' },
    { value: 420,   suffix: '',  label: 'Retailers billed' },
    { value: 97.4,  suffix: '%', label: 'Avg. delivery rate', decimals: 1 },
    { value: 184,   suffix: '',  label: 'Batches processed' },
  ]
  return (
    <section id="trust" className="max-w-6xl mx-auto px-5 lg:px-8 -mt-2 lg:-mt-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.5 }}
        className="relative glass glass-highlight rounded-3xl p-6 lg:p-8"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((s) => (
            <TrustStat key={s.label} value={s.value} suffix={s.suffix} label={s.label} decimals={s.decimals ?? 0} />
          ))}
        </div>
      </motion.div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {[
          'Kumar Wholesale', 'Bala Agencies', 'Sri Krishna Stores',
          'Rohit FMCG', 'Zenith Pharma', 'Mehta Distributors',
          'Patel & Sons', 'Verma Trading',
        ].map((n, i) => (
          <span key={n} className="inline-flex items-center gap-3 opacity-70 hover:opacity-100 transition">
            {n}
            {i < 7 && <span className="w-1 h-1 rounded-full bg-slate-300" />}
          </span>
        ))}
      </div>
    </section>
  )
}

function TrustStat({
  value, suffix, label, decimals = 0,
}: { value: number; suffix?: string; label: string; decimals?: number }) {
  return (
    <div className="text-center lg:text-left">
      <div className="text-3xl lg:text-4xl font-semibold text-slate-900 dark:text-white tabular-nums tracking-tight">
        <CountUp value={value} format={(v) => v.toFixed(decimals)} />
        {suffix}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// features (bento)
// ---------------------------------------------------------------------------

function Features() {
  const large = {
    icon: FileSpreadsheet,
    eyebrow: 'Ingest',
    title: 'Excel → WhatsApp in one click',
    body: 'Upload a spreadsheet of retailer bills. The console reads each row, picks the right template, and renders a message preview before you ever hit send.',
    tone: 'from-emerald-500 to-teal-500',
    preview: [
      { code: 'RET-2418', name: 'Rakesh Distributors', amount: '₹12,480' },
      { code: 'RET-2419', name: 'Anita Traders',       amount: '₹ 8,210' },
      { code: 'RET-2420', name: 'Vikram Stores',       amount: '₹23,950' },
    ],
  }
  const medium = {
    icon: FileText,
    eyebrow: 'Compose',
    title: 'Reusable templates with live preview',
    body: 'Build {{name}}-style templates once. Live preview with sample data — no Meta template approval round-trips for utility messages.',
    tone: 'from-sky-500 to-indigo-500',
  }
  const smalls = [
    { icon: Webhook,        eyebrow: 'Realtime',  title: 'Real-time webhooks', body: 'Every sent message flows back as delivered, read, or failed. Filter the log by phone or batch id in seconds.', tone: 'from-amber-500 to-orange-500' },
    { icon: MessagesSquare, eyebrow: 'Inbox',     title: 'Two-way chats',      body: 'Retailers can reply. Incoming chats land in the inbox and stay attached to the original message + retailer profile.', tone: 'from-violet-500 to-fuchsia-500' },
    { icon: ShieldCheck,    eyebrow: 'Governance',title: 'Audit log built-in', body: 'Every admin action — login, upload, approve, delete — timestamped with actor and entity. Export to CSV anytime.', tone: 'from-slate-500 to-slate-700' },
    { icon: BarChart3,      eyebrow: 'Insights',  title: 'Reports that export',body: 'Daily trend, delivery health, opted-out retailers. Drill in, then export the slice you care about to CSV in one click.', tone: 'from-rose-500 to-pink-500' },
  ]

  return (
    <section id="features" className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative">
        <Eyebrow icon={Sparkles} text="Features" tone="emerald" />
        <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white max-w-2xl">
          Everything a billing desk needs,{' '}
          <span className="text-gradient">nothing it doesn’t.</span>
        </h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400 max-w-2xl">
          Six opinionated modules, all wired to the same database and the same audit log.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* large card spans 7 cols on desktop */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
            className="md:col-span-7 glass-card glass-highlight p-6 lg:p-8 group"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`inline-grid place-items-center w-11 h-11 rounded-xl text-white bg-gradient-to-br ${large.tone} shadow-md shadow-slate-900/10`}>
                  <large.icon className="w-5 h-5" />
                </div>
                <div className="mt-4 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 font-semibold">{large.eyebrow}</div>
                <div className="mt-1 text-xl lg:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{large.title}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">{large.body}</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-white/70 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">bills_2026-06-22.xlsx · 3 rows</span>
              </div>
              <div className="divide-y divide-white/60 dark:divide-white/10">
                {large.preview.map((row) => (
                  <div key={row.code} className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px]">
                    <div className="col-span-3 font-mono text-slate-500 dark:text-slate-400">{row.code}</div>
                    <div className="col-span-5 font-medium text-slate-800 dark:text-slate-100 truncate">{row.name}</div>
                    <div className="col-span-3 text-slate-600 dark:text-slate-400 truncate">template: <span className="text-brand-600">due-soon</span></div>
                    <div className="col-span-1 text-right font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{row.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* medium card spans 5 cols */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
            className="md:col-span-5 glass-card glass-highlight p-6 lg:p-8 group"
          >
            <div className={`inline-grid place-items-center w-11 h-11 rounded-xl text-white bg-gradient-to-br ${medium.tone} shadow-md shadow-slate-900/10`}>
              <medium.icon className="w-5 h-5" />
            </div>
            <div className="mt-4 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 font-semibold">{medium.eyebrow}</div>
            <div className="mt-1 text-xl lg:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{medium.title}</div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{medium.body}</p>

            <div className="mt-5 rounded-xl border border-white/70 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur p-3">
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-medium">Template preview</div>
              <div className="text-[11px] text-slate-700 dark:text-slate-300 bg-white/70 dark:bg-white/10 rounded-lg p-2.5 leading-relaxed">
                Hi <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono text-[10px]">{`{{1}}`}</span>,
                your invoice <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono text-[10px]">{`{{3}}`}</span>{' '}
                for <span className="font-semibold">₹</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono text-[10px]">{`{{4}}`}</span> is due
                on <span className="font-semibold">25 Jun</span>.
              </div>
            </div>
          </motion.div>

          {/* 4 small cards across the bottom */}
          {smalls.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -4 }}
              className="md:col-span-3 glass-card glass-highlight p-6 group"
            >
              <div className={`inline-grid place-items-center w-10 h-10 rounded-lg text-white bg-gradient-to-br ${f.tone} shadow-md shadow-slate-900/10`}>
                <f.icon className="w-4.5 h-4.5" />
              </div>
              <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 font-semibold">{f.eyebrow}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white tracking-tight">{f.title}</div>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// product walkthrough 1 — dashboard preview
// ---------------------------------------------------------------------------

function WalkthroughDashboard() {
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div>
          <Eyebrow icon={Layers} text="The console" tone="blue" />
          <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white">
            One screen for{' '}
            <span className="text-gradient">every batch</span> you send.
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            The dashboard keeps KPIs, trend, recent activity and quick actions in a single
            glanceable view — the same screen you’ll land on after signing in.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Animated KPIs with sparklines',
              'Area chart of sent / delivered / read / failed',
              'Per-day delivery health donut',
              'Live activity feed pulled from the audit log',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 mt-0.5 shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
              Try it now <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, rotateX: 8 }}
          whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
          style={{ perspective: 1000 }}
        >
          <div className="glass-premium glass-highlight rounded-3xl overflow-hidden">
            <MockChrome />
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <Tile tone="blue"    icon={Users}       label="Retailers"  value="248" />
                <Tile tone="violet"  icon={Send}        label="Sent today" value="1,248" />
                <Tile tone="emerald" icon={Eye}         label="Read today" value="892" />
                <Tile tone="rose"    icon={AlertCircle} label="Failed"     value="14" />
              </div>
              <div className="rounded-xl border border-white/70 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                  <span className="font-medium">Last 7 days</span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sent</span>
                    <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Delivered</span>
                    <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Read</span>
                  </span>
                </div>
                <PreviewChart />
              </div>
              <div className="grid grid-cols-3 gap-2.5 text-[10px]">
                {[
                  { tone: 'bg-emerald-100 text-emerald-700', label: 'BATCH APPROVED',  who: 'admin · batch #42', when: '2m ago' },
                  { tone: 'bg-blue-100 text-blue-700',        label: 'BATCH UPLOADED',  who: 'admin · batch #42', when: '5m ago' },
                  { tone: 'bg-violet-100 text-violet-700',    label: 'MESSAGE SENT',    who: 'worker · 1,248',    when: '7m ago' },
                ].map((a) => (
                  <div key={a.label} className="rounded-lg border border-white/70 dark:border-white/10 bg-white/60 dark:bg-white/5 p-2">
                    <span className={`pill ${a.tone}`}>{a.label}</span>
                    <div className="mt-1 text-slate-600 dark:text-slate-400 truncate">{a.who}</div>
                    <div className="text-slate-400 dark:text-slate-500">{a.when}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <motion.div
            animate={{ y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-4 -right-4 glass rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
          >
            <Sparkles className="w-3 h-3 text-amber-500" /> live data
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

function Tile({ tone, icon: Icon, label, value }: { tone: string; icon: any; label: string; value: string }) {
  const tones: Record<string, string> = {
    blue:    'from-blue-50 to-indigo-50 text-blue-600',
    violet:  'from-violet-50 to-fuchsia-50 text-violet-600',
    emerald: 'from-emerald-50 to-teal-50 text-emerald-600',
    rose:    'from-rose-50 to-orange-50 text-rose-600',
  }
  return (
    <div className={`rounded-xl p-3 bg-gradient-to-br ${tones[tone]} border border-white/60 dark:border-white/10 dark:opacity-90`}>
      <div className="flex items-center justify-between">
        <Icon className="w-4 h-4" />
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  )
}

function PreviewChart() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-50px' })
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const sent = [420, 510, 380, 660, 720, 540, 880]
  const delivered = sent.map((v) => Math.round(v * 0.96))
  const read = sent.map((v) => Math.round(v * 0.71))
  const w = 460, h = 120
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
        <linearGradient id="pc-em" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="pc-vl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${pathFor(delivered)} L ${w} ${h} L 0 ${h} Z`} fill="url(#pc-em)" />
      <path d={`${pathFor(read)}      L ${w} ${h} L 0 ${h} Z`} fill="url(#pc-vl)" />
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

// ---------------------------------------------------------------------------
// product walkthrough 2 — chat / inbox
// ---------------------------------------------------------------------------

function WalkthroughChat() {
  const messages = [
    { from: 'them', avatar: 'R', text: 'Hi, did you send the invoice for this month?' },
    { from: 'us',   text: 'Hi Rakesh — invoice INV-2418 for ₹12,480 was sent on 18 Jun. Due 25 Jun. Tap to view: pay.example.com/inv/2418' },
    { from: 'them', avatar: 'R', text: 'Got it, will pay by 26th. Thanks!' },
    { from: 'us',   text: 'Thanks Rakesh — confirming receipt. Reply STOP to opt out anytime.' },
  ]

  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        {/* chat mock on LEFT for visual rhythm */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="order-2 lg:order-1"
        >
          <div className="relative glass-premium glass-highlight rounded-3xl overflow-hidden max-w-md mx-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/60 bg-white/40">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-xs font-bold">R</div>
              <div className="flex-1 leading-tight">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">Rakesh Distributors</div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> online · +91 98xxx xxx12
                </div>
              </div>
              <Phone className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <MoreVertical className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </div>

            <div className="p-4 space-y-2.5 bg-gradient-to-b from-white/40 dark:from-white/5 to-white/20 dark:to-white/0 min-h-[280px]">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.35, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex items-end gap-2 ${m.from === 'us' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.from === 'them' && m.avatar && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold shrink-0">
                      {m.avatar}
                    </div>
                  )}
                  <div className={`max-w-[80%] text-[12px] px-3 py-2 rounded-2xl leading-relaxed
                    ${m.from === 'us'
                      ? 'bg-gradient-to-br from-brand-500 to-emerald-600 text-white rounded-br-sm'
                      : 'bg-white/80 dark:bg-white/10 border border-white/70 dark:border-white/10 text-slate-800 dark:text-slate-100 rounded-bl-sm'}`}
                  >
                    {m.text}
                  </div>
                </motion.div>
              ))}

              {/* typing indicator */}
              <motion.div
                initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
                transition={{ delay: messages.length * 0.12 + 0.1 }}
                className="flex items-end gap-2 justify-start"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-[10px] font-bold shrink-0">R</div>
                <div className="px-3 py-2.5 rounded-2xl bg-white/80 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center gap-1">
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
                </div>
              </motion.div>
            </div>

            <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5">
              <div className="flex-1 rounded-full bg-white/70 dark:bg-white/5 border border-white/60 dark:border-white/10 px-3 py-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                Type a reply…
              </div>
              <button className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-white">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="absolute -top-3 -right-3 w-14 h-14 opacity-50 pointer-events-none">
              <div className="absolute inset-0 ring-dashed-spin" />
            </div>
          </div>
        </motion.div>

        <div className="order-1 lg:order-2">
          <Eyebrow icon={MessagesSquare} text="Conversations" tone="violet" />
          <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white">
            Two-way chats,{' '}
            <span className="text-gradient">attached to every retailer.</span>
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            When a retailer replies, the message lands in the inbox with the full context —
            the original bill, the template used, and the prior history. No hunting across
            WhatsApp on the team phone.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Reply in the same thread, with the retailer pinned to the right',
              'Auto-tie every incoming message to the retailer profile',
              'Inline quick replies from your saved templates',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 mt-0.5 shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
              Open the chats view <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// product walkthrough 3 — webhook log
// ---------------------------------------------------------------------------

function WalkthroughWebhook() {
  const rows = [
    { ts: '12:48:02', tag: 'delivery', id: 'msg_a1b2…', phone: '+91 98xxx xxx12', status: 'delivered', tone: 'emerald' },
    { ts: '12:48:03', tag: 'read',      id: 'msg_a1b2…', phone: '+91 98xxx xxx12', status: 'read',      tone: 'sky' },
    { ts: '12:48:14', tag: 'delivery', id: 'msg_b2c3…', phone: '+91 98xxx xxx12', status: 'delivered', tone: 'emerald' },
    { ts: '12:48:15', tag: 'delivery', id: 'msg_c3d4…', phone: '+91 98xxx xxx12', status: 'failed',    tone: 'rose', fail: true },
    { ts: '12:48:33', tag: 'read',      id: 'msg_b2c3…', phone: '+91 98xxx xxx12', status: 'read',      tone: 'sky' },
    { ts: '12:48:45', tag: 'delivery', id: 'msg_d4e5…', phone: '+91 98xxx xxx12', status: 'delivered', tone: 'emerald', pop: true },
  ]
  const statusPill: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    sky:     'bg-sky-100 text-sky-700',
    rose:    'bg-rose-100 text-rose-700',
  }
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div>
          <Eyebrow icon={Activity} text="Webhook log" tone="amber" />
          <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white">
            Every status,{' '}
            <span className="text-gradient">timestamped and filterable.</span>
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            Meta’s webhook events come back in seconds — delivered, read, failed — and land
            in a queryable log tied to the originating message. Filter by batch id, phone
            number, status, or time window.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Filter chips at the top — one click to scope',
              'Inline retry for transient failures',
              'One-click CSV export of any filtered slice',
            ].map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 mt-0.5 shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
              See the webhook log <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <div className="glass-premium glass-highlight rounded-3xl overflow-hidden">
            <MockChrome title="whatsyitc · webhook log" />
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="pill-gray">All</span>
                <span className="pill-green">Delivered</span>
                <span className="pill-blue">Read</span>
                <span className="pill-gray">Failed</span>
                <div className="ml-auto flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-white/5 border border-white/60 dark:border-white/10 px-2.5 py-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <Search className="w-3 h-3" /> <span>Search by phone or msg id…</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/70 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur divide-y divide-white/60 dark:divide-white/10 overflow-hidden">
                {rows.map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -4 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{ duration: 0.3, delay: i * 0.06 }}
                    className={`grid grid-cols-12 gap-2 items-center px-3 py-2 text-[11px]
                      ${r.fail ? 'border-l-2 border-rose-400 animate-pulse' : ''}`}
                  >
                    <div className="col-span-3 font-mono text-slate-500 dark:text-slate-400">{r.ts}</div>
                    <div className="col-span-2">
                      <span className={`pill ${statusPill[r.tone]} text-[9px]`}>{r.tag}</span>
                    </div>
                    <div className="col-span-3 font-mono text-slate-500 dark:text-slate-400 truncate">{r.id}</div>
                    <div className="col-span-2 font-mono text-slate-500 dark:text-slate-400 truncate">{r.phone}</div>
                    <div className="col-span-2 text-right">
                      {r.pop ? (
                        <PillPop className={statusPill[r.tone] + ' pill'}>{r.status}</PillPop>
                      ) : (
                        <span className={statusPill[r.tone] + ' pill'}>{r.status}</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 text-center">+ 24 more in the last minute</div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// how it works
// ---------------------------------------------------------------------------

function WorkflowSummary() {
  const steps = [
    { n: 1, title: 'Upload',  desc: 'Drop an Excel or CSV with retailer billing rows.', icon: UploadCloud, tone: 'from-emerald-500 to-teal-500' },
    { n: 2, title: 'Approve', desc: 'Review the rendered preview, then click Approve.',   icon: Check,       tone: 'from-sky-500 to-blue-500' },
    { n: 3, title: 'Deliver', desc: 'Workers send via Meta WhatsApp Cloud in seconds.',   icon: Send,        tone: 'from-violet-500 to-fuchsia-500' },
    { n: 4, title: 'Track',   desc: 'Status flows back as webhooks. Filter anytime.',     icon: Activity,    tone: 'from-amber-500 to-orange-500' },
  ]
  return (
    <section id="workflow" className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <Eyebrow icon={Zap} text="Workflow" tone="violet" />
          <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white">
            Four steps. <span className="text-gradient">No code.</span>
          </h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400 max-w-2xl">
            From the spreadsheet you already have to a delivered WhatsApp message and a
            clean audit trail — without leaving the admin console.
          </p>
        </div>
        <Link to="/how-it-works" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
          Full walkthrough <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="relative mt-10">
        <div className="hidden md:block absolute top-9 left-[12%] right-[12%] h-px
                        bg-gradient-to-r from-emerald-300/0 via-emerald-400/40 to-emerald-300/0" />
        <motion.div
          aria-hidden
          initial={{ left: '12%' }} whileInView={{ left: '88%' }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 1.6, ease: 'easeInOut' }}
          className="hidden md:block absolute top-9 h-1 w-12 -translate-y-1/2
                     bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-500 rounded-full blur-sm"
        />
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {steps.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              whileHover={{ y: -3 }}
              className="relative glass-card glass-highlight p-5"
            >
              <div className={`grid place-items-center w-12 h-12 rounded-full text-white
                               bg-gradient-to-br ${s.tone}
                               shadow-lg shadow-slate-900/10 relative z-10`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div className="mt-4 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em]">Step {s.n.toString().padStart(2, '0')}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{s.title}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{s.desc}</div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// metrics band
// ---------------------------------------------------------------------------

function Metrics() {
  const items = [
    { value: 99.2,  suffix: '%', label: 'Delivery success',  decimals: 1, tone: 'from-emerald-50 to-teal-50 text-emerald-700' },
    { value: 4.6,   suffix: 's', label: 'Median latency',     decimals: 1, tone: 'from-sky-50 to-indigo-50 text-sky-700' },
    { value: 0.4,   suffix: '%', label: 'Opt-out rate',       decimals: 1, tone: 'from-violet-50 to-fuchsia-50 text-violet-700' },
    { value: 100,   suffix: '%', label: 'Audit coverage',     decimals: 0, tone: 'from-amber-50 to-orange-50 text-amber-700' },
  ]
  return (
    <section id="metrics" className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative">
        <Eyebrow icon={TrendingUp} text="By the numbers" tone="blue" />
        <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white max-w-2xl">
          The numbers that <span className="text-gradient">move the needle.</span>
        </h2>

        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="glass-card glass-highlight p-5"
            >
              <div className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.18em]
                               bg-gradient-to-br ${m.tone} rounded-full px-2 py-0.5`}>
                {m.label}
              </div>
              <div className="mt-3 text-4xl font-semibold text-slate-900 dark:text-white tabular-nums tracking-tight">
                <CountUp value={m.value} format={(v) => v.toFixed(m.decimals)} />
                {m.suffix}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">across all batches last quarter</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// testimonials
// ---------------------------------------------------------------------------

function Testimonials() {
  const items = [
    { name: 'Rakesh Mehta',  role: 'Operations · Kumar Wholesale',    quote: 'We cut our monthly billing cycle from 4 days to 4 hours. The webhooks make chasing payments almost fun.' },
    { name: 'Anita Sharma',  role: 'Director · Bala Agencies',         quote: 'Setup took an afternoon. Our retailers actually reply now — the read rate is double what email ever got.' },
    { name: 'Vikram Iyer',   role: 'Founder · Sri Krishna Stores',     quote: 'The audit log alone is worth it. Our accountant stopped asking for screenshots the day we deployed it.' },
  ]
  return (
    <section id="customers" className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40 relative">
      <AuroraBackdrop />
      <div className="relative">
        <Eyebrow icon={Sparkles} text="Loved by distributors" tone="emerald" />
        <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white max-w-2xl">
          The billing desk <span className="text-gradient">breathes a sigh</span> of relief.
        </h2>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              whileHover={{ y: -3 }}
              className="glass-card glass-highlight p-6 relative"
            >
              <Quote className="absolute top-4 right-4 w-5 h-5 text-emerald-300/60" />
              <div className="flex gap-0.5 text-amber-500">
                {[0, 1, 2, 3, 4].map((s) => <Star key={s} className="w-3.5 h-3.5 fill-current" />)}
              </div>
              <p className="mt-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">"{t.quote}"</p>
              <div className="mt-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 grid place-items-center text-white text-xs font-bold">
                  {t.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// security / trust band
// ---------------------------------------------------------------------------

function SecurityBand() {
  const items = [
    { icon: Lock,     label: 'AES-256 at rest' },
    { icon: KeyRound, label: 'bcrypt + JWT sessions' },
    { icon: ShieldCheck, label: 'Full audit trail' },
    { icon: Server,   label: 'Self-hosted, your data stays' },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-24 lg:mt-28">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.4 }}
        className="glass glass-highlight rounded-2xl p-5 lg:p-6 grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <it.icon className="w-4 h-4" />
            </span>
            <span className="font-medium">{it.label}</span>
          </div>
        ))}
      </motion.div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

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
    <section id="faq" className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40">
      <Eyebrow icon={MessageSquare} text="FAQ" tone="blue" />
      <h2 className="mt-3 text-3xl lg:text-5xl text-display text-slate-900 dark:text-white">
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
        <span className="font-medium text-slate-900 dark:text-white">{q}</span>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 shrink-0"
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
        <div className="px-5 pb-5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{a}</div>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// final CTA banner
// ---------------------------------------------------------------------------

function CtaBanner() {
  return (
    <section className="max-w-6xl mx-auto px-5 lg:px-8 mt-32 lg:mt-40">
      <div className="relative overflow-hidden rounded-3xl p-10 lg:p-20 text-white shadow-2xl shadow-emerald-900/20 dark:shadow-emerald-900/40
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
            <h2 className="mt-4 text-3xl lg:text-5xl text-display">
              Ready to send your first batch?
            </h2>
            <p className="mt-3 text-emerald-50/95 max-w-xl">
              Sign in with the credentials your administrator provided. The first batch
              can go out in under five minutes.
            </p>
          </div>
          <div className="flex flex-wrap lg:justify-end gap-3">
            <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-brand-700 font-semibold shadow-lg
                           hover:shadow-xl transition-shadow"
              >
                Open admin console <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/how-it-works"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-white/30 hover:bg-white/10 text-white font-medium backdrop-blur"
              >
                How it works
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-slate-200/70 dark:border-slate-800/70 mt-28">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center text-white font-bold text-xs shadow-md shadow-emerald-500/30">W</div>
          <span>© {new Date().getFullYear()} WhatsyITC. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-5 text-slate-500 dark:text-slate-400">
          <Link to="/how-it-works" className="hover:text-slate-900 dark:hover:text-white dark:text-white">How it works</Link>
          <Link to="/login" className="hover:text-slate-900 dark:hover:text-white dark:text-white">Sign in</Link>
          <a href="#faq" className="hover:text-slate-900 dark:hover:text-white dark:text-white">FAQ</a>
        </div>
      </div>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export default function Landing() {
  useEffect(() => {
    document.title = 'WhatsyITC — WhatsApp billing console'
  }, [])

  return (
    <div className="relative min-h-screen overflow-x-hidden
                    bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.10),_transparent_50%),radial-gradient(ellipse_at_top_right,_rgba(139,92,246,0.08),_transparent_50%),radial-gradient(ellipse_at_bottom_left,_rgba(6,182,212,0.08),_transparent_50%),linear-gradient(to_bottom,_#ffffff,_#f8fafc_30%,_#f1f5f9_100%)]
                    dark:bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.14),transparent_50%),radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.14),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.12),transparent_50%),linear-gradient(to_bottom,#020617,#0a0f1c_30%,#050a14_100%)]
                    text-slate-900 dark:text-white">
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <WalkthroughDashboard />
        <WalkthroughChat />
        <WalkthroughWebhook />
        <WorkflowSummary />
        <Metrics />
        <Testimonials />
        <SecurityBand />
        <FAQ />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  )
}