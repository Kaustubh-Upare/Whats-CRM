import type { ReactNode } from 'react'
import { Card } from '@/components/ui'

/**
 * ResponsiveTable — renders a full data table on >=md screens and a stacked
 * card list on <md screens, driven by the same row data.
 *
 * Why this exists: every admin page has the same pattern — `<div className=
 * "overflow-x-auto"><table>...</table></div>` — which gives a horizontal
 * scrollbar on phones. Instead of rewriting each table, callers wrap their
 * data in this component and pass:
 *   - `headers`: column titles for the desktop table.
 *   - `rows`: array of data.
 *   - `keyOf(row)`: stable key.
 *   - `renderCard(row)`: the mobile card layout (built with the existing
 *      `Card` primitive + the row's most-important fields).
 *   - `renderCells(row)`: the desktop row cells, as an array of ReactNodes
 *      whose order matches `headers`.
 *
 * No new dependencies. No new design tokens. Reuses `Card` so mobile cards
 * automatically pick up the admin dark-mode safety net.
 *
 * Caveat: this is a deliberate minimum-surface API. If a page's table is
 * too unusual (e.g. inline editing in cells, drag-to-reorder rows, etc.),
 * keep the bare table and add `overflow-x-auto` + a phone-specific
 * instruction. We don't force every page through this.
 */
export function ResponsiveTable<T>({
  headers,
  rows,
  keyOf,
  renderCard,
  renderCells,
  empty,
  className = '',
}: {
  headers: string[]
  rows: T[]
  keyOf: (row: T) => string | number
  renderCard: (row: T) => ReactNode
  renderCells: (row: T) => ReactNode[]
  empty?: ReactNode
  className?: string
}) {
  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>
  }

  return (
    <>
      {/* Desktop / tablet: real table */}
      <div className={`hidden md:block overflow-x-auto ${className}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={keyOf(row)}
                className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50/60 dark:hover:bg-white/5 transition-colors"
              >
                {renderCells(row).map((cell, i) => (
                  <td key={i} className="px-3 py-2 align-middle">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked card list */}
      <div className={`md:hidden space-y-2 ${className}`}>
        {rows.map((row) => (
          <Card key={keyOf(row)} hover={false} className="p-3">
            {renderCard(row)}
          </Card>
        ))}
      </div>
    </>
  )
}
