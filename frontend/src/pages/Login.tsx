import { useEffect, useState } from 'react'
import { useLocation, useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { api, setToken } from '@/lib/api'
import ThemeToggle from '@/components/ThemeToggle'
import { getGoogleStatus } from '@/lib/settings'
import type { AdminUser, GoogleStatus } from '@/lib/types'
import { useAuth } from '@/lib/useAuth'

// Map the short `google_error` codes we attach at /auth/google/callback
// to human-readable messages for the toast + inline error box.
const GOOGLE_ERRORS: Record<string, string> = {
  missing_code_or_state: 'Google did not return a code. Please try again.',
  state_cookie_missing: 'Your session expired during sign-in. Please try again.',
  state_mismatch: 'Sign-in was interrupted. Please try again.',
  exchange_failed: 'Could not verify your Google account. Please try again.',
  profile_failed: 'Could not read your Google profile. Please try again.',
  email_unverified: 'Your Google email is not verified. Verify it first, then try again.',
  upsert_failed: 'Could not create your account. Contact your administrator.',
  account_disabled: 'Your account is disabled. Contact your administrator.',
  token_error: 'Could not issue a session token. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
}

// Brand-friendly Google "G" mark — inline so we don't pull in another icon.
function GoogleMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.712V4.956H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.044l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.956L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  )
}

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { status } = useAuth()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  // Cached whoami for the "welcome back to <workspace>" banner. Filled
  // once the cookie is set after a successful login; cleared on logout
  // so the next user sees a neutral sign-in form.
  const [whoami, setWhoami] = useState<AdminUser | null>(null)

  const redirectTo = safeAdminRedirect((loc.state as { from?: string } | null)?.from)

  // Pull the server-side Google status once. If `enabled=false` the
  // button is rendered in a disabled state with a tooltip explaining
  // why — this keeps a fresh deployment from looking broken.
  useEffect(() => {
    getGoogleStatus()
      .then(setGoogle)
      .catch(() => setGoogle({ enabled: false, start_url: '/auth/google/start' }))
  }, [])

  // Surface any google_error=... query string the callback may have
  // bounced us back with. We also read `detail` for the upsert_failed
  // case so the operator can see the underlying DB error in the UI
  // (and in the URL) without grepping backend logs.
  useEffect(() => {
    const code = params.get('google_error')
    if (code) {
      const detail = params.get('detail')
      const base = GOOGLE_ERRORS[code] || `Google sign-in failed (${code}). Please try again.`
      setErr(detail ? `${base}\n\nServer detail: ${detail}` : base)
    }
  }, [params])

  // useAuth is the single source of truth — if the cookie-based session
  // is already valid (e.g. we just landed here from /auth/google/callback),
  // bounce to /admin. This is the path that fixes the Google OAuth loop:
  // the JWT lives only in the httpOnly cookie, so a localStorage check
  // alone would have stranded the user on /login forever.
  if (status === 'authed') {
    return <Navigate to={redirectTo} replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setToken(data.token)
      setWhoami(data.user)
      // Surface the per-user workspace name in the welcome toast so a
      // shared screen makes it obvious which workspace just signed in.
      const ws = data.user?.workspace_name?.trim()
      toast.success(ws ? `Welcome to ${ws}` : `Welcome, ${data.user.name}`)
      // Invalidate the cached auth probe so Protected re-checks.
      // (react-query's query invalidation is automatic for ['auth','me', …].)
      nav(redirectTo, { replace: true })
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  function startGoogle() {
    if (!google?.enabled) return
    // We redirect the whole window so the OAuth state map + callback
    // round-trip cleanly with the server. next=/admin takes the user
    // back to the originally requested admin page after the callback 302s.
    window.location.href = `/auth/google/start?next=${encodeURIComponent(redirectTo)}`
  }

  return (
    <div className="min-h-screen grid place-items-center
                    bg-gradient-to-br from-slate-50 via-emerald-50 to-slate-100
                    dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                    relative transition-colors">
      {/* top-right floating toggle */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      {/* aurora accents */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full aurora-blob aurora-1
                        bg-[radial-gradient(circle,_rgba(34,197,94,0.35),_transparent_70%)]
                        dark:bg-[radial-gradient(circle,_rgba(34,197,94,0.18),_transparent_70%)] dark:mix-blend-screen" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full aurora-blob aurora-2
                        bg-[radial-gradient(circle,_rgba(6,182,212,0.30),_transparent_70%)]
                        dark:bg-[radial-gradient(circle,_rgba(6,182,212,0.18),_transparent_70%)] dark:mix-blend-screen" />
      </div>

      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm bg-white dark:bg-slate-900
                   border border-slate-200 dark:border-slate-800
                   rounded-xl shadow-sm dark:shadow-black/30
                   p-7"
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
            className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 via-emerald-500 to-teal-500 grid place-items-center text-white font-bold shadow-md shadow-emerald-500/30"
          >
            W
          </motion.div>
          <div>
            <div className="text-lg font-semibold leading-tight text-slate-900 dark:text-white">WhatsyITC</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Admin login</div>
          </div>
        </motion.div>

        <motion.label
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
        >
          Email
        </motion.label>
        <motion.input
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-md
                     border border-slate-300 dark:border-slate-700
                     bg-white dark:bg-slate-950
                     text-slate-900 dark:text-white
                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500"
          autoFocus
          required
        />

        <motion.label
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
        >
          Password
        </motion.label>
        <motion.input
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded-md
                     border border-slate-300 dark:border-slate-700
                     bg-white dark:bg-slate-950
                     text-slate-900 dark:text-white
                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500"
          required
        />

        {/* Divider between password sign-in and the OAuth option. */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24 }}
          className="flex items-center gap-3 my-4"
        >
          <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
            or
          </span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        </motion.div>

        <motion.button
          type="button"
          onClick={startGoogle}
          disabled={!google?.enabled}
          title={
            google?.enabled
              ? 'Continue with Google'
              : 'Google sign-in is not configured on this server. Set BC_GOOGLE_CLIENT_ID and BC_GOOGLE_CLIENT_SECRET in the backend .env to enable it.'
          }
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
          whileHover={google?.enabled ? { scale: 1.02 } : undefined}
          whileTap={google?.enabled ? { scale: 0.97 } : undefined}
          className="w-full inline-flex items-center justify-center gap-2.5
                     px-3 py-2.5 rounded-md
                     border border-slate-300 dark:border-slate-700
                     bg-white dark:bg-slate-900
                     hover:bg-slate-50 dark:hover:bg-slate-800/70
                     text-slate-700 dark:text-slate-100 text-sm font-medium
                     shadow-sm transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-900"
        >
          <GoogleMark className="w-4 h-4" />
          Continue with Google
        </motion.button>

        {!google?.enabled && google !== null && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 text-center"
          >
            Google sign-in is not configured on this server — set
            <code className="mx-1 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">
              BC_GOOGLE_CLIENT_ID
            </code>
            in the backend .env to enable it.
          </motion.p>
        )}

        {err && (
          <motion.div
            initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
            className="mb-3 text-sm rounded-md p-2
                       text-rose-700 dark:text-rose-300
                       bg-rose-50 dark:bg-rose-500/15
                       border border-rose-200 dark:border-rose-500/30"
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
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-md
                     shadow-[0_4px_14px_rgba(16,185,129,0.25)] disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </motion.button>

        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 text-center">
          Use the credentials provided by your administrator.
        </p>
      </motion.form>
    </div>
  )
}

function safeAdminRedirect(from?: string) {
  if (!from) return '/admin'
  if (!from.startsWith('/admin')) return '/admin'
  if (from.startsWith('//')) return '/admin'
  return from
}
