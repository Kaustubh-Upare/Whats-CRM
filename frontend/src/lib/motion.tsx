import { motion, type HTMLMotionProps, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Subtle, consistent motion primitives used across the admin UI.
 * Keep durations short (120-300ms) and easings soft so nothing feels laggy.
 */

// --- Page transitions ---
// A tiny fade + 6px lift when a route mounts. Wrap each page's <main> content.
export function PageMotion({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// --- Stagger container / item ---
// Used for grids of cards / table rows so they fade in one after another.
export const containerStagger: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
}

export const itemFadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  },
}

export function StaggerList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      variants={containerStagger}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
  ...rest
}: HTMLMotionProps<'div'> & { children: ReactNode }) {
  return (
    <motion.div variants={itemFadeUp} className={className} {...rest}>
      {children}
    </motion.div>
  )
}

// --- Card hover lift ---
// Drop-in replacement for a div that lifts + brightens border on hover.
export function HoverCard({
  children,
  className,
  ...rest
}: HTMLMotionProps<'div'> & { children: ReactNode }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ y: 0, scale: 0.995 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

// --- Pressable button ---
// Soft press feedback for any clickable element.
export function Pressable({
  children,
  className,
  ...rest
}: HTMLMotionProps<'button'> & { children: ReactNode }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className={className}
      {...rest}
    >
      {children}
    </motion.button>
  )
}

// --- Animated number / KPI value ---
// Counts up from 0 to target over ~700ms whenever the value changes.
import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

export function CountUp({
  value,
  duration = 0.7,
  format = (v: number) => Math.round(v).toLocaleString(),
  className,
}: {
  value: number
  duration?: number
  format?: (v: number) => string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    prev.current = value
    return () => controls.stop()
  }, [value, duration])

  return <span className={className}>{format(display)}</span>
}

// --- Status pill pop ---
// Tiny scale-in when a status badge first renders (e.g. live updating log rows).
export function PillPop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={className}
    >
      {children}
    </motion.span>
  )
}
