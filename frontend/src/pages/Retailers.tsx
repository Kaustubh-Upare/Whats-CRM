import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, UserX, UserCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { containerStagger, itemFadeUp, PillPop } from '@/lib/motion'
import type { Retailer } from '@/lib/types'

export default function Retailers() {
  const [q, setQ] = useState('')
  const list = useQuery({
    queryKey: ['retailers', q],
    queryFn: async () => (await api.get(`/api/retailers?q=${encodeURIComponent(q)}&limit=200`)).data as { items: Retailer[]; total: number },
  })

  return (
    <>
      <PageHeader title="Retailers" subtitle={`${list.data?.total ?? 0} total`} />
      <Card className="mb-4" hover={false}>
        <div className="p-3 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by code, name, or phone…"
            className="flex-1 px-2 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </Card>

      {list.isLoading && <Spinner />}
      {list.isError && <ErrorBox msg={(list.error as any)?.message} />}
      {list.data && (
        <Card hover={false}>
          <CardHeader title="Retailer directory" />
          {list.data.items.length === 0 ? <Empty>No retailers. Upload an Excel to onboard them.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600"><tr>
                  <Th>#</Th><Th>Code</Th><Th>Name</Th><Th>WhatsApp</Th><Th>City</Th><Th>Status</Th><Th>Updated</Th><Th></Th>
                </tr></thead>
                <AnimatePresence initial={false}>
                  <motion.tbody variants={containerStagger} initial="hidden" animate="show" key={q}>
                    {list.data.items.map((r) => (
                      <motion.tr
                        key={r.id}
                        variants={itemFadeUp}
                        layout
                        whileHover={{ backgroundColor: '#f8fafc' }}
                        className="border-t border-slate-100"
                      >
                        <Td>{r.id}</Td>
                        <Td className="font-mono text-xs">{r.retailer_code}</Td>
                        <Td>{r.retailer_name}</Td>
                        <Td className="font-mono text-xs">{r.whatsapp_number}</Td>
                        <Td>{r.city || '—'}</Td>
                        <Td>
                          {r.is_opted_out ? (
                            <PillPop className="pill-red"><UserX className="w-3 h-3" />Opted out</PillPop>
                          ) : (
                            <PillPop className="pill-green"><UserCheck className="w-3 h-3" />Active</PillPop>
                          )}
                        </Td>
                        <Td>{fmtDate(r.updated_at)}</Td>
                        <Td><Link to={`/retailers/${r.id}`} className="text-brand-700 hover:underline text-sm">Open →</Link></Td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                </AnimatePresence>
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
