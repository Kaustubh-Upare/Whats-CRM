import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Battery, Signal, Wifi, Smartphone, MoreVertical,
  Phone, Video, ArrowLeft,
} from 'lucide-react'
import { api } from '@/lib/api'
import { ErrorBox, Spinner } from './ui'

/**
 * PhonePreview renders a faithful phone-mockup that shows the exact
 * WhatsApp message body a recipient will see for a given batch row.
 *
 * Uses the same /api/batches/{id}/preview-message endpoint that the
 * worker uses for substitution, so the bubble text matches what the
 * retailer actually receives — pixel-for-pixel.
 */
export default function PhonePreview({
  batchId,
  initialRow,
  templateName = 'billing_summary_v1',
  language = 'en',
  onRowChange,
  className = '',
}: {
  batchId: number | null
  initialRow?: number | null
  templateName?: string
  language?: string
  onRowChange?: (row: number | null) => void
  className?: string
}) {
  const [row, setRow] = useState<number | null>(initialRow ?? null)

  useEffect(() => { setRow(initialRow ?? null) }, [initialRow, batchId])

  const q = useQuery({
    queryKey: ['preview-message', batchId, templateName, language, row],
    queryFn: async () => {
      const params: Record<string, string> = { template: templateName, lang: language }
      if (row != null) params.row = String(row)
      const { data } = await api.get(`/api/batches/${batchId}/preview-message`, { params })
      return data as {
        body: string
        template_name: string
        language_code: string
        row_number: number
        retailer_name: string
        whatsapp_number: string
        template_params: string[]
      }
    },
    enabled: !!batchId,
    refetchOnWindowFocus: false,
  })

  function setRowAndNotify(n: number | null) {
    setRow(n)
    onRowChange?.(n)
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* Phone frame */}
      <PhoneFrame>
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 pt-2 pb-1 text-[10px] font-semibold text-slate-800">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <Signal className="w-3 h-3" />
            <Wifi className="w-3 h-3" />
            <Battery className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Notch */}
        <div className="relative h-5 flex items-center justify-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-4 bg-slate-900 rounded-b-2xl" />
        </div>

        {/* App header */}
        <div className="bg-[#075E54] text-white px-3 py-2 flex items-center gap-2 -mt-1">
          <ArrowLeft className="w-4 h-4 opacity-90" />
          <Avatar name={q.data?.retailer_name || 'Retailer'} size={28} />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium truncate leading-tight">
              {q.data?.retailer_name || '—'}
            </div>
            <div className="text-[10px] opacity-80 leading-tight">
              {q.data?.whatsapp_number ? `+${q.data.whatsapp_number}` : 'online'}
            </div>
          </div>
          <Video className="w-4 h-4 opacity-90" />
          <Phone className="w-4 h-4 opacity-90" />
          <MoreVertical className="w-4 h-4 opacity-90" />
        </div>

        {/* Chat background + bubble */}
        <div
          className="flex-1 overflow-hidden px-3 py-4 relative"
          style={{
            backgroundColor: '#E5DDD5',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 0h40v40H0z' fill='none'/><path d='M8 6c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM8 32c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM20 14c1.5 0 1.5 2 0 2s-1.5-2 0-2zm0 14c1.5 0 1.5 2 0 2s-1.5-2 0-2z' fill='%23c9c2b6' opacity='0.4'/></svg>\")",
            backgroundSize: '40px 40px',
          }}
        >
          <AnimatePresence mode="wait">
            {q.isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 grid place-items-center"
              >
                <Spinner />
              </motion.div>
            ) : q.isError ? (
              <motion.div
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="p-3"
              >
                <ErrorBox msg={(q.error as any)?.response?.data?.error || (q.error as any)?.message || 'Failed to load preview'} />
              </motion.div>
            ) : q.data ? (
              <motion.div
                key={`msg-${q.data.row_number}-${q.data.body.length}`}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 360, damping: 26 }}
                className="flex justify-end"
              >
                <div className="relative max-w-[88%]">
                  <div
                    className="relative bg-[#DCF8C6] text-slate-900 rounded-lg shadow-sm
                               px-2.5 py-1.5 text-[12.5px] leading-snug whitespace-pre-wrap break-words"
                  >
                    {/* Tail */}
                    <svg
                      className="absolute -right-1 -top-1 w-2 h-2 text-[#DCF8C6]"
                      viewBox="0 0 8 8"
                      fill="currentColor"
                    >
                      <path d="M0 0 L8 0 L0 8 Z" />
                    </svg>
                    {q.data.body}
                    <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                      <span className="text-[9px] text-slate-500 tabular-nums">9:41</span>
                      <svg viewBox="0 0 18 18" className="w-3 h-3 text-sky-500" fill="currentColor">
                        <path d="M17.4 4.2L7.6 14L4.2 10.6L5.2 9.6L7.6 12L16.4 3.2Z" />
                        <path d="M12.4 4.2L2.6 14L1.6 13L11.4 3.2Z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <div className="bg-[#F0F0F0] px-2 py-2 flex items-center gap-1.5">
          <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[11px] text-slate-400">
            Type a message
          </div>
          <div className="w-7 h-7 rounded-full bg-[#075E54] grid place-items-center">
            <Smartphone className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </PhoneFrame>

      {/* Meta below phone */}
      {q.data && (
        <div className="mt-4 text-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Preview · row {q.data.row_number}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{q.data.template_name}</span> · {q.data.language_code}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Frame + atoms ---------------- */

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="relative w-[300px] h-[600px] bg-slate-950 rounded-[40px] p-2 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
    >
      <div className="relative w-full h-full bg-white rounded-[32px] overflow-hidden flex flex-col">
        {children}
      </div>
      {/* Side buttons */}
      <span className="absolute -left-[2px] top-[110px] w-[3px] h-8 bg-slate-800 rounded-l-sm" />
      <span className="absolute -left-[2px] top-[160px] w-[3px] h-12 bg-slate-800 rounded-l-sm" />
      <span className="absolute -right-[2px] top-[160px] w-[3px] h-16 bg-slate-800 rounded-r-sm" />
    </motion.div>
  )
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials =
    name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const hue = hashHue(name)
  return (
    <div
      className="rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0"
      style={{
        width: size, height: size,
        backgroundColor: `hsl(${hue} 55% 48%)`,
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${(hue + 30) % 360} 55% 42%))`,
      }}
    >
      {initials}
    </div>
  )
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return h
}
