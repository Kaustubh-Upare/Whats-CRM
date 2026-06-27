import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { statusPill } from '@/lib/format'
import { CountUp, HoverCard, PillPop } from '@/lib/motion'

/* ----------------------------------------------------------------------- */
/* Headings / chrome                                                        */
/* ----------------------------------------------------------------------- */

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-end justify-between mb-6 gap-4 flex-wrap"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </motion.div>
  )
}

/* ----------------------------------------------------------------------- */
/* Card — the workhorse of every admin page. Reads CSS variables so it     */
/* auto-flips light/dark and gets a richer gradient + inner glow in dark.   */
/* ----------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  hover = true,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  const baseCls = `admin-card transition-shadow duration-200 ${className}`
  if (!hover) return <div className={baseCls}>{children}</div>
  return (
    <HoverCard className={baseCls}>
      {children}
    </HoverCard>
  )
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
      <div>
        <div className="font-semibold text-slate-900 dark:text-slate-100">{title}</div>
        {subtitle && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* StatusPill — wraps the format.ts status colours and pop-animates.        */
/* ----------------------------------------------------------------------- */

export function StatusPill({ status }: { status: string }) {
  return <PillPop className={statusPill(status)}>{status}</PillPop>
}

/* ----------------------------------------------------------------------- */
/* KpiCard — coloured label pill + animated number + sub text.              */
/* Dark variants use translucent tinted fills (semantic-500/15) instead of  */
/* flat pastels, which read as cheap on a deep canvas.                     */
/* ----------------------------------------------------------------------- */

export function KpiCard({
  label,
  value,
  sub,
  tone,
  countUp = false,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'green' | 'blue' | 'red' | 'amber' | 'slate' | 'violet'
  /** When true, numeric `value`s animate from previous to current. */
  countUp?: boolean
}) {
  const toneClass = {
    green: 'text-emerald-700 bg-emerald-50 border-emerald-200/70 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-400/20',
    blue:  'text-blue-700 bg-blue-50 border-blue-200/70 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-400/20',
    red:   'text-rose-700 bg-rose-50 border-rose-200/70 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-400/20',
    amber: 'text-amber-800 bg-amber-50 border-amber-200/70 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-400/20',
    violet:'text-violet-700 bg-violet-50 border-violet-200/70 dark:text-violet-300 dark:bg-violet-500/15 dark:border-violet-400/20',
    slate: 'text-slate-700 bg-slate-50 border-slate-200/70 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-400/20',
  }[tone || 'slate']
  const numeric = typeof value === 'number'
  return (
    <Card className="p-5">
      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider
                       px-2 py-0.5 rounded border ${toneClass}`}>
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {countUp && numeric ? (
          <CountUp value={value as number} format={(v) => Math.round(v).toLocaleString()} />
        ) : typeof value === 'number' ? (
          value.toLocaleString()
        ) : (
          value
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </Card>
  )
}

/* ----------------------------------------------------------------------- */
/* Spinner / Empty / ErrorBox                                                */
/* ----------------------------------------------------------------------- */

export function Spinner() {
  return (
    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
        className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700
                   border-t-emerald-500 dark:border-t-emerald-400 inline-block"
      />
      Loading…
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm"
    >
      {children}
    </motion.div>
  )
}

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22 }}
      className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30
                 text-rose-800 dark:text-rose-200 text-sm rounded-lg p-3
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      {msg}
    </motion.div>
  )
}

/* ----------------------------------------------------------------------- */
/* Inputs — share the same shell so every form looks consistent.            */
/* ----------------------------------------------------------------------- */

export function Input({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full px-3 py-2 rounded-md text-sm
                  bg-white dark:bg-[var(--input-bg)]
                  border border-slate-300 dark:border-[var(--input-border)]
                  text-slate-900 dark:text-slate-100
                  placeholder:text-slate-400 dark:placeholder:text-slate-500
                  focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60
                  focus:border-brand-400 dark:focus:border-emerald-500/60
                  transition-colors
                  ${className}`}
    />
  )
}

export function TextArea({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={`w-full px-3 py-2 rounded-md text-sm
                  bg-white dark:bg-[var(--input-bg)]
                  border border-slate-300 dark:border-[var(--input-border)]
                  text-slate-900 dark:text-slate-100
                  placeholder:text-slate-400 dark:placeholder:text-slate-500
                  focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60
                  focus:border-brand-400 dark:focus:border-emerald-500/60
                  transition-colors
                  ${className}`}
    />
  )
}

/* ----------------------------------------------------------------------- */
/* Pressable buttons                                                        */
/* ----------------------------------------------------------------------- */

type BtnProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'>

export function PrimaryButton(props: BtnProps) {
  const { className = '', ...rest } = props
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      {...(rest as any)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md
                  text-white text-sm font-medium
                  bg-gradient-to-r from-emerald-600 to-teal-600
                  hover:from-emerald-500 hover:to-teal-500
                  shadow-[0_4px_14px_rgba(16,185,129,0.25)]
                  dark:shadow-[0_4px_20px_rgba(16,185,129,0.45)]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all
                  ${className}`}
    />
  )
}

export function SecondaryButton(props: BtnProps) {
  const { className = '', ...rest } = props
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      {...(rest as any)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
                  border border-slate-300 dark:border-[var(--input-border)]
                  bg-white dark:bg-[var(--input-bg)]
                  hover:bg-slate-50 dark:hover:bg-slate-800/60
                  text-slate-700 dark:text-slate-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors
                  ${className}`}
    />
  )
}

/* ----------------------------------------------------------------------- */
/* GlassCard — premium admin surface with inner glow + animated highlight.  */
/* Use sparingly for hero cards, dashboard greeting, settings headers.      */
/* ----------------------------------------------------------------------- */

export function GlassCard({
  children,
  className = '',
}: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative admin-card glass-highlight overflow-hidden p-6 lg:p-8 ${className}`}
    >
      {children}
    </div>
  )
}
