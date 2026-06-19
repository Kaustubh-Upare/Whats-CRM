import { format, formatDistanceToNow, parseISO } from 'date-fns'

export function fmtDate(s?: string | null, withTime = true) {
  if (!s) return '—'
  try {
    const d = typeof s === 'string' ? parseISO(s) : s
    return format(d, withTime ? 'dd MMM yyyy HH:mm' : 'dd MMM yyyy')
  } catch {
    return s
  }
}

export function fmtRelative(s?: string | null) {
  if (!s) return '—'
  try {
    return formatDistanceToNow(parseISO(s), { addSuffix: true })
  } catch {
    return s
  }
}

export function fmtMoney(n?: number | null) {
  if (n == null) return '—'
  return '₹ ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function pct(n: number) {
  if (!isFinite(n)) return '—'
  return n.toFixed(1) + '%'
}

export function statusPill(s: string) {
  switch (s) {
    case 'queued':   return 'pill-blue'
    case 'sending':  return 'pill-blue'
    case 'sent':     return 'pill-blue'
    case 'delivered':return 'pill-green'
    case 'read':     return 'pill-purple'
    case 'failed':   return 'pill-red'
    case 'uploaded': return 'pill-gray'
    case 'validated':return 'pill-amber'
    case 'approved': return 'pill-green'
    case 'sending_batch': return 'pill-blue'
    case 'completed':return 'pill-green'
    default:         return 'pill-gray'
  }
}
