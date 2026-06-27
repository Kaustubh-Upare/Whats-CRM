import type { ReactNode } from 'react'

/**
 * StackedCardList — minimal mobile-friendly list wrapper for pages that
 * already render divide-y card rows instead of tables (WebhookLogs,
 * AuditLog, Followups, etc.). Adds consistent vertical spacing and
 * tighter horizontal padding on phones so rows don't waste space.
 *
 * On >=md screens, behaves like a plain stacked container with normal
 * padding — no extra chrome.
 */
export function StackedCardList({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`space-y-2 md:space-y-3 ${className}`}>{children}</div>
}
