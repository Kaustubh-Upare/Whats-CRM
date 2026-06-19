import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { api, setToken, getToken } from '@/lib/api'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('admin@whatsyitc.local')
  const [password, setPassword] = useState('admin123')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (getToken()) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setToken(data.token)
      toast.success(`Welcome, ${data.user.name}`)
      nav('/', { replace: true })
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-50 via-emerald-50 to-slate-100">
      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-7"
      >
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, duration: 0.25 }}
          className="flex items-center gap-3 mb-6"
        >
          <motion.div
            whileHover={{ rotate: 10, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="w-10 h-10 rounded-full bg-brand-500 grid place-items-center text-white font-bold"
          >
            W
          </motion.div>
          <div>
            <div className="text-lg font-semibold leading-tight">WhatsyITC</div>
            <div className="text-xs text-slate-500">Admin login</div>
          </div>
        </motion.div>

        <motion.label
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          Email
        </motion.label>
        <motion.input
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
          autoFocus
          required
        />

        <motion.label
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          Password
        </motion.label>
        <motion.input
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400"
          required
        />

        {err && (
          <motion.div
            initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
            className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2"
          >
            {err}
          </motion.div>
        )}

        <motion.button
          type="submit"
          disabled={busy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-md disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </motion.button>

        <p className="mt-4 text-xs text-slate-500 text-center">
          Default seed: <span className="font-mono">admin@whatsyitc.local</span> / <span className="font-mono">admin123</span>
        </p>
      </motion.form>
    </div>
  )
}
