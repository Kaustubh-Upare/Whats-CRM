import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Layers } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, PrimaryButton, Spinner, StatusPill } from '@/components/ui'
import { fmtDate } from '@/lib/format'
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
          <Link to="/upload">
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <Th>#</Th><Th>File</Th><Th>Status</Th><Th>Rows</Th><Th>Uploaded</Th><Th>Approved</Th><Th></Th>
                  </tr>
                </thead>
                <motion.tbody variants={containerStagger} initial="hidden" animate="show">
                  {q.data.items.map((b) => (
                    <motion.tr
                      key={b.id}
                      variants={itemFadeUp}
                      whileHover={{ backgroundColor: 'rgba(241,245,249,0.7)' }}
                      className="border-t border-slate-100"
                    >
                      <Td>{b.id}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-slate-400" />
                          <span className="truncate max-w-[280px]" title={b.file_name}>{b.file_name}</span>
                        </div>
                      </Td>
                      <Td><StatusPill status={b.status} /></Td>
                      <Td>
                        <span className="text-emerald-700">{b.valid_rows} ok</span>
                        {b.invalid_rows > 0 && <span className="text-rose-700 ml-2">{b.invalid_rows} bad</span>}
                        <span className="text-slate-400 ml-2">/ {b.total_rows}</span>
                      </Td>
                      <Td>{fmtDate(b.created_at)}</Td>
                      <Td>{b.approved_at ? fmtDate(b.approved_at) : '—'}</Td>
                      <Td>
                        <Link to={`/batches/${b.id}`} className="text-brand-700 hover:underline text-sm">
                          Open →
                        </Link>
                      </Td>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="text-left px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td> }
