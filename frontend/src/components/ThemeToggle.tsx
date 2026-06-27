import { motion, AnimatePresence } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'

type Variant = 'icon' | 'pill'

/**
 * Animated theme toggle.
 *
 * - `icon` (default): 36×36 glass pill with a sun/moon crossfade + rotate.
 *   Use in tight spaces (admin topbar, login form).
 *
 * - `pill`: wider glass pill with both icons and a sliding thumb — for the
 *   marketing nav.
 */
export default function ThemeToggle({
  variant = 'icon',
  className = '',
}: { variant?: Variant; className?: string }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  if (variant === 'pill') {
    return (
      <motion.button
        type="button"
        onClick={toggle}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        className={`relative inline-flex items-center w-[68px] h-8 rounded-full
                    glass overflow-hidden ${className}`}
      >
        {/* track icons (subtle) */}
        <span className="absolute inset-0 flex items-center justify-between px-2 text-slate-400 dark:text-slate-500">
          <Sun className="w-3.5 h-3.5" />
          <Moon className="w-3.5 h-3.5" />
        </span>
        {/* thumb */}
        <motion.span
          layout
          aria-hidden
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-1 left-1 w-6 h-6 rounded-full
                     bg-gradient-to-br from-amber-300 to-orange-400
                     dark:from-indigo-400 dark:to-violet-500
                     shadow-md shadow-amber-500/30 dark:shadow-violet-500/30
                     flex items-center justify-center"
          style={{ x: isDark ? 36 : 0 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isDark ? (
              <motion.span
                key="moon"
                initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Moon className="w-3.5 h-3.5 text-white" />
              </motion.span>
            ) : (
              <motion.span
                key="sun"
                initial={{ rotate: 90, opacity: 0, scale: 0.6 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: -90, opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Sun className="w-3.5 h-3.5 text-amber-900" />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      </motion.button>
    )
  }

  // icon variant
  return (
    <motion.button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      whileHover={{ scale: 1.06, rotate: 8 }}
      whileTap={{ scale: 0.92, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={`relative grid place-items-center w-9 h-9 rounded-full
                  glass text-slate-700 dark:text-slate-200 ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="moon"
            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 grid place-items-center"
          >
            <Moon className="w-4 h-4" />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 grid place-items-center"
          >
            <Sun className="w-4 h-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}
