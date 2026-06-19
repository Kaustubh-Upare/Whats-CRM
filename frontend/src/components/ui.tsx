import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { statusPill } from '@/lib/format'
import { CountUp, HoverCard, PillPop } from '@/lib/motion'

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-end justify-between mb-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {right}
    </motion.div>
  )
}

export function Card({
  children,
  className = '',
  hover = true,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  const baseCls = `bg-white border border-slate-200 rounded-xl shadow-sm ${className}`
  if (!hover) return <div className={baseCls}>{children}</div>
  return (
    <HoverCard className={`${baseCls} transition-shadow duration-200`}>
      {children}
    </HoverCard>
  )
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
      <div>
        <div className="font-semibold">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  return <PillPop className={statusPill(status)}>{status}</PillPop>
}

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
  tone?: 'green' | 'blue' | 'red' | 'amber' | 'slate'
  /** When true, numeric `value`s animate from previous to current. */
  countUp?: boolean
}) {
  const toneClass = {
    green: 'text-emerald-700 bg-emerald-50',
    blue:  'text-blue-700 bg-blue-50',
    red:   'text-rose-700 bg-rose-50',
    amber: 'text-amber-800 bg-amber-50',
    slate: 'text-slate-700 bg-slate-50',
  }[tone || 'slate']
  const numeric = typeof value === 'number'
  return (
    <Card className="p-5">
      <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${toneClass}`}>{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">
        {countUp && numeric ? (
          <CountUp value={value as number} format={(v) => Math.round(v).toLocaleString()} />
        ) : typeof value === 'number' ? (
          value.toLocaleString()
        ) : (
          value
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center gap-2 text-slate-500 text-sm">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
        className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-brand-500 inline-block"
      />
      Loading...
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="text-center py-12 text-slate-500 text-sm"
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
      className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-md p-3"
    >
      {msg}
    </motion.div>
  )
}

// Pressable buttons with subtle scale on hover/tap.
type BtnProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'>

export function PrimaryButton(props: BtnProps) {
  const { className = '', ...rest } = props
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      {...(rest as any)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
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
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  )
}
