import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Layers, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, Spinner, StatusPill } from '@/components/ui'
import { batchDisplayName, fmtDate } from '@/lib/format'
import { containerStagger, itemFadeUp } from '@/lib/motion'
import type { UploadBatch } from '@/lib/types'

export default function Batches() {
  const q = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get('/api/batches?limit=100')).data as { items: UploadBatch[]; total: number },
  })

  return (
    <>
      <PageHeader
        title="Upload batches"
        subtitle={`${q.data?.total ?? 0} total`}
        right={
          <Link to="/admin/upload">
            <PrimaryButton>New upload</PrimaryButton>
          </Link>
        }
      />

      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox msg={(q.error as any)?.message || 'Failed to load'} />}

      {q.data && (
        <Card>
          <CardHeader title="All batches" subtitle="Newest first" />
          {q.data.items.length === 0 ? (
            <Empty>No batches yet. Upload your first Excel to get started.</Empty>
          ) : (
            <>
              {/* Mobile: stacked cards. Each card holds the most important
                  bits (name, status, counts) and a tap target for detail. */}
              <div className="md:hidden p-3 space-y-2">
                {q.data.items.map((b) => (
                  <Link
                    key={b.id}
                    to={`/admin/batches/${b.id}`}
                    className="block rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[var(--bg-elevated)] p-3 hover:border-emerald-400/50 dark:hover:border-emerald-500/40 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <Layers className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate" title={batchDisplayName(b)}>
                          {batchDisplayName(b)}
                        </div>
                        {b.display_name && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={b.file_name}>
                            {b.file_name}
                          </div>
                        )}
                      </div>
                      <StatusPill status={b.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <span>
                        <span className="text-emerald-700 dark:text-emerald-300">{b.valid_rows} ok</span>
                        {b.invalid_rows > 0 && (
                          <span className="text-rose-700 dark:text-rose-300 ml-2">{b.invalid_rows} bad</span>
                        )}
                        <span className="text-slate-400 dark:text-slate-500 ml-2">/ {b.total_rows}</span>
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">{fmtDate(b.created_at)}</span>
                      <span className="ml-auto inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Desktop / tablet: real table. */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                    <tr>
                      <Th>#</Th><Th>Batch</Th><Th>Status</Th><Th>Rows</Th><Th>Uploaded</Th><Th>Approved</Th><Th></Th>
                    </tr>
                  </thead>
                  <motion.tbody variants={containerStagger} initial="hidden" animate="show">
                    {q.data.items.map((b) => (
                      <motion.tr
                        key={b.id}
                        variants={itemFadeUp}
                        whileHover={{ backgroundColor: 'rgba(148,163,184,0.08)' }}
                        className="border-t border-slate-100 dark:border-white/10"
                      >
                        <Td>{b.id}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate max-w-[320px] font-medium text-slate-900 dark:text-slate-100" title={batchDisplayName(b)}>
                                {batchDisplayName(b)}
                              </span>
                              {b.display_name && (
                                <span className="block truncate max-w-[320px] text-xs text-slate-500 dark:text-slate-400" title={b.file_name}>
                                  {b.file_name}
                                </span>
                              )}
                            </span>
                          </div>
                        </Td>
                        <Td><StatusPill status={b.status} /></Td>
                        <Td>
                          <span className="text-emerald-700 dark:text-emerald-300">{b.valid_rows} ok</span>
                          {b.invalid_rows > 0 && <span className="text-rose-700 dark:text-rose-300 ml-2">{b.invalid_rows} bad</span>}
                          <span className="text-slate-400 dark:text-slate-500 ml-2">/ {b.total_rows}</span>
                        </Td>
                        <Td>{fmtDate(b.created_at)}</Td>
                        <Td>{b.approved_at ? fmtDate(b.approved_at) : '—'}</Td>
                        <Td>
                          <Link to={`/admin/batches/${b.id}`} className="text-emerald-700 dark:text-emerald-300 hover:underline text-sm">
                            Open →
                          </Link>
                        </Td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
