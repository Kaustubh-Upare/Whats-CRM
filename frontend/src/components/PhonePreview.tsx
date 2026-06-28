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
  templateName = '',
  language = '',
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
    enabled: !!batchId && !!templateName && !!language,
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
            {!templateName || !language ? (
              <motion.div
                key="missing-template"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 grid place-items-center p-4"
              >
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center shadow-sm">
                  <div className="text-sm font-semibold text-amber-900">Select an active template</div>
                  <div className="mt-1 text-[11px] leading-snug text-amber-800">
                    Create or activate a WhatsApp template in Templates, then this preview will show the exact message.
                  </div>
                  <a href="/admin/templates" className="mt-2 inline-flex text-[11px] font-semibold text-amber-900 underline">
                    Open Templates
                  </a>
                </div>
              </motion.div>
            ) : q.isLoading ? (
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
                <ErrorBox msg={previewErrorMessage(q.error)} />
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

function previewErrorMessage(error: unknown): string {
  const raw = (error as any)?.response?.data?.error || (error as any)?.message || 'Failed to load preview'
  if (typeof raw === 'string' && raw.startsWith('template not active:')) {
    return 'This selected template is not active for your workspace. Activate it in Templates or choose another active template.'
  }
  if (typeof raw === 'string' && raw.startsWith('template not selected')) {
    return 'Select an active template from your workspace to preview this message.'
  }
  return String(raw)
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
      <div
        // `phone-screen` opts the inner out of the .dark-on safety net
        // so the WhatsApp-styled mockup (light phone, dark text) renders
        // identically in both themes. Without it, dark mode flips the
        // inner to dark slate and the bubble text becomes invisible.
        className="phone-screen relative w-full h-full bg-white rounded-[32px] overflow-hidden flex flex-col"
      >
        {children}
      </div>
      {/* Side buttons */}
      <span className="absolute -left-[2px] top-[110px] w-[3px] h-8 bg-slate-800 rounded-l-sm" />
      <span className="absolute -left-[2px] top-[160px] w-[3px] h-12 bg-slate-800 rounded-l-sm" />
      <span className="absolute -right-[2px] top-[160px] w-[3px] h-16 bg-slate-800 rounded-r-sm" />
    </motion.div>
  )
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
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

export function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360
  }
  return h
}

/* ---------------- PhonePreviewCard ---------------- */

/**
 * PhonePreviewCard — a self-contained phone mockup that takes the message
 * body as a prop (no network fetch). Used wherever we already have the
 * resolved body in React state and want an instant, flicker-free preview —
 * most notably inside the Send Now / Review first-send dialog on BatchDetail
 * so the operator sees exactly what the retailer will receive.
 *
 * Sizes:
 *   - compact: 240×500, fits inside dense dialogs (Send Now)
 *   - default: 280×580, two-up in Templates live-preview
 *   - larger:  340×700, fills a right column at desktop widths
 */
export function PhonePreviewCard({
  body,
  recipientName,
  size = 'default',
}: {
  body: string
  recipientName: string
  size?: 'compact' | 'default' | 'larger'
}) {
  // Size tokens. The phone frame (bezel) is sized in px, inner content
  // uses flex so it adapts without recalculation.
  const w = size === 'compact' ? 240 : size === 'larger' ? 340 : 280
  const h = size === 'compact' ? 500 : size === 'larger' ? 700 : 580
  const radius = size === 'compact' ? 32 : size === 'larger' ? 44 : 36
  const innerRadius = size === 'compact' ? 26 : size === 'larger' ? 36 : 28
  const pad = size === 'compact' ? 2 : size === 'larger' ? 3 : 2
  const statusFont = size === 'compact' ? 'text-[9px]' : size === 'larger' ? 'text-[11px]' : 'text-[10px]'
  const nameFont = size === 'compact' ? 'text-[11.5px]' : size === 'larger' ? 'text-[14px]' : 'text-[12px]'
  const subFont = size === 'compact' ? 'text-[9px]' : size === 'larger' ? 'text-[11px]' : 'text-[10px]'
  const bodyFont = size === 'compact' ? 'text-[11.5px]' : size === 'larger' ? 'text-[13.5px]' : 'text-[12px]'
  const timeFont = size === 'compact' ? 'text-[8.5px]' : size === 'larger' ? 'text-[10px]' : 'text-[9px]'
  const headerPx = size === 'compact' ? 'px-2.5 py-1.5' : size === 'larger' ? 'px-4 py-2.5' : 'px-3 py-2'
  const bubblePx = size === 'compact' ? 'px-2 py-1.5' : size === 'larger' ? 'px-3 py-2' : 'px-2.5 py-1.5'
  const composerPx = size === 'compact' ? 'px-2 py-1.5' : size === 'larger' ? 'px-3 py-2.5' : 'px-2 py-2'
  const composerFont = size === 'compact' ? 'text-[10px] py-1' : size === 'larger' ? 'text-[12px] py-2' : 'text-[11px] py-1.5'
  const notchW = size === 'compact' ? 88 : size === 'larger' ? 130 : 96
  const composerH = size === 'compact' ? 26 : size === 'larger' ? 36 : 30
  const sendBtn = size === 'compact' ? 26 : size === 'larger' ? 36 : 28
  const sendIcon = size === 'compact' ? 11 : size === 'larger' ? 16 : 13
  const tickSize = size === 'compact' ? 'w-2.5 h-2.5' : size === 'larger' ? 'w-3.5 h-3.5' : 'w-3 h-3'
  const sideBtnR = size === 'compact' ? 40 : size === 'larger' ? 56 : 48
  const sidePower = size === 'compact' ? 56 : size === 'larger' ? 76 : 64

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="relative bg-slate-950 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
      style={{ width: w, height: h, borderRadius: radius, padding: pad }}
    >
      <div
        // `phone-screen` opts the inner out of the .dark-on safety net
        // so the WhatsApp-styled mockup (light phone, dark text) renders
        // identically in both themes.
        className="phone-screen relative w-full h-full bg-white overflow-hidden flex flex-col"
        style={{ borderRadius: innerRadius }}
      >
        {/* Status bar */}
        <div className={`flex items-center justify-between px-5 pt-2.5 pb-1 font-semibold text-slate-800 ${statusFont}`}>
          <span>9:41</span>
          <div className="flex items-center gap-1 text-slate-700">
            <span>•••</span>
            <span>◐</span>
            <span>▮</span>
          </div>
        </div>

        {/* Notch */}
        <div className="relative h-5 flex items-center justify-center">
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 bg-slate-900 rounded-b-2xl"
            style={{ width: notchW, height: 18 }}
          />
        </div>

        {/* App header — WhatsApp dark green */}
        <div className={`bg-[#075E54] text-white flex items-center gap-2 -mt-1 ${headerPx}`}>
          <span className={`opacity-90 ${subFont}`}>‹</span>
          <Avatar name={recipientName} size={size === 'compact' ? 24 : size === 'larger' ? 32 : 28} />
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${nameFont}`}>{recipientName}</div>
            <div className={`opacity-80 ${subFont}`}>online</div>
          </div>
          <span className={`opacity-90 ${subFont}`}>📹</span>
          <span className={`opacity-90 ${subFont}`}>📞</span>
          <span className={`opacity-90 ${subFont}`}>⋮</span>
        </div>

        {/* Chat background + bubble */}
        <div
          className="flex-1 overflow-hidden px-3 py-4"
          style={{
            backgroundColor: '#E5DDD5',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 0h40v40H0z' fill='none'/><path d='M8 6c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM8 32c2 0 2 2 0 2s-2-2 0-2zm24 0c2 0 2 2 0 2s-2-2 0-2zM20 14c1.5 0 1.5 2 0 2s-1.5-2 0-2zm0 14c1.5 0 1.5 2 0 2s-1.5-2 0-2z' fill='%23c9c2b6' opacity='0.4'/></svg>\")",
            backgroundSize: '40px 40px',
          }}
        >
          {/* Keying on body makes AnimatePresence replay the entry animation
              whenever the operator switches templates — the "wow" moment. */}
          <AnimatePresence mode="wait" initial={false}>
            {body ? (
              <motion.div
                key={body}
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.22 }}
                className="flex justify-end"
              >
                <div className="relative max-w-[88%]">
                  <div
                    className={`relative bg-[#DCF8C6] text-slate-900 rounded-lg shadow-sm whitespace-pre-wrap break-words ${bubblePx} ${bodyFont}`}
                    style={{ lineHeight: 1.4 }}
                  >
                    {/* Tail */}
                    <svg
                      className="absolute -right-1 -top-1 w-2 h-2 text-[#DCF8C6]"
                      viewBox="0 0 8 8"
                      fill="currentColor"
                    >
                      <path d="M0 0 L8 0 L0 8 Z" />
                    </svg>
                    {body}
                    <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                      <span className={`text-slate-500 tabular-nums ${timeFont}`}>9:41</span>
                      <svg
                        viewBox="0 0 18 18"
                        className={`text-sky-500 ${tickSize}`}
                        fill="currentColor"
                      >
                        <path d="M17.4 4.2L7.6 14L4.2 10.6L5.2 9.6L7.6 12L16.4 3.2Z" />
                        <path d="M12.4 4.2L2.6 14L1.6 13L11.4 3.2Z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex items-center justify-center"
              >
                <div className={`text-slate-500/80 italic ${subFont}`}>
                  Select a template to preview
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <div className={`bg-[#F0F0F0] flex items-center gap-1.5 ${composerPx}`}>
          <div
            className="flex-1 bg-white rounded-full px-3 text-slate-400 flex items-center"
            style={{ height: composerH }}
          >
            <span className={composerFont}>Type a message</span>
          </div>
          <div
            className="rounded-full bg-[#075E54] grid place-items-center"
            style={{ width: sendBtn, height: sendBtn }}
          >
            <svg
              viewBox="0 0 24 24"
              className="text-white"
              style={{ width: sendIcon, height: sendIcon }}
              fill="currentColor"
            >
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Side buttons */}
      <span
        className="absolute -left-[2px] bg-slate-800 rounded-l-sm"
        style={{ top: 110, width: 3, height: 32 }}
      />
      <span
        className="absolute -left-[2px] bg-slate-800 rounded-l-sm"
        style={{ top: 160, width: 3, height: sideBtnR }}
      />
      <span
        className="absolute -right-[2px] bg-slate-800 rounded-r-sm"
        style={{ top: 160, width: 3, height: sidePower }}
      />
    </motion.div>
  )
}
