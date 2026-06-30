import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Save, RefreshCcw, Trash2, ShieldCheck, AlertTriangle, RotateCcw,
  History, CheckCircle2, ChevronRight, BookOpen, Phone, KeyRound, Clock3,
  Bot, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, ErrorBox, PageHeader, Spinner, GlassCard } from '@/components/ui'
import { PillPop } from '@/lib/motion'
import {
  getWhatsappSettings, putWhatsappSettings, testWhatsappSettings,
  deleteWhatsappSettings, restoreWhatsappSettings, getCredentialsHistory,
} from '@/lib/settings'
import { aiKeys, listAIAgents } from '@/lib/ai'
import type { CredentialsHistoryEntry, WhatsappSettings } from '@/lib/types'
import { fmtRelative } from '@/lib/format'

export default function Credentials() {
  return (
    <>
      <PageHeader
        title="Credentials"
        subtitle="Your WhatsApp Business API connection — phone number, access token, and webhook."
      />

      <div className="grid grid-cols-1 gap-4">
        <WhatsappCredentialsCard />
      </div>
    </>
  )
}

/* ---------------- WABA credentials ---------------- */

function WhatsappCredentialsCard() {
  const qc = useQueryClient()
  const settings = useQuery({
    queryKey: ['settings', 'whatsapp'],
    queryFn: () => getWhatsappSettings(),
  })
  const history = useQuery({
    queryKey: ['settings', 'whatsapp', 'history'],
    queryFn: () => getCredentialsHistory(20),
    refetchOnWindowFocus: false,
  })
  const agents = useQuery({
    queryKey: aiKeys.agents(),
    queryFn: listAIAgents,
    enabled: !!settings.data?.configured && !settings.data?.is_removed,
    staleTime: 30_000,
  })

  const [phone, setPhone] = useState('')
  const [waba, setWaba] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [apiVersion, setApiVersion] = useState('v25.0')
  // Timestamp of the most recent successful save. Used to flash a
  // "Saved · just now" pill next to the secret inputs so the operator
  // can see at a glance that the values they typed are now persisted.
  // We intentionally keep the typed values in the input state so they
  // remain visible — the backend never returns the decrypted secrets,
  // so the only authoritative copy on the client is what the user typed.
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!settings.data) return
    const s = settings.data
    if (s.is_removed) {
      setPhone(s.last_known_phone_number_id || '')
      setWaba(s.last_known_waba_id || '')
      setApiVersion(s.last_known_api_version || 'v25.0')
    } else if (s.configured) {
      setPhone(s.phone_number_id || '')
      setWaba(s.waba_id || '')
      setApiVersion(s.api_version || 'v25.0')
    }
  }, [settings.data?.configured, settings.data?.is_removed, settings.data?.updated_at])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        phone_number_id: phone.trim(),
        access_token: accessToken.trim(),
        verify_token: verifyToken.trim(),
        waba_id: waba.trim(),
        api_version: apiVersion.trim() || 'v25.0',
      }
      if (!payload.phone_number_id || !payload.access_token || !payload.verify_token) {
        throw new Error('phone_number_id, access_token, and verify_token are required')
      }
      return putWhatsappSettings(payload)
    },
    onSuccess: () => {
      toast.success('Settings saved')
      // Keep the typed access/verify tokens in the inputs so the
      // operator can confirm what was saved. The backend never returns
      // the decrypted secrets (encrypted at rest with AES-GCM), so the
      // values they typed are the only plaintext copy on the client.
      // To rotate, they retype; to keep, they leave the inputs alone.
      setSavedAt(Date.now())
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp'] })
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp', 'history'] })
      // useAuth caches ['auth', 'me', ...]; invalidate every variant so the
      // Layout's amber "not configured" banner dismisses immediately.
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Save failed'),
  })

  const test = useMutation({
    mutationFn: () => testWhatsappSettings(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp'] })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      if (res.ok) toast.success(`Connected — ${res.display_phone_number || res.phone_number_id || 'OK'}`)
      else toast.error('Test failed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Test failed'),
  })

  const del = useMutation({
    mutationFn: () => deleteWhatsappSettings(),
    onSuccess: () => {
      toast.success('Credentials removed — you can restore them from the card below.')
      // On remove the encrypted blobs are kept server-side, but we have
      // no plaintext to show, so the inputs must clear. Phone / WABA /
      // API version stay populated from last_known_* in the next query
      // refetch (handled in the useEffect above).
      setAccessToken(''); setVerifyToken(''); setSavedAt(null)
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp'] })
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp', 'history'] })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Delete failed'),
  })

  const restore = useMutation({
    mutationFn: () => restoreWhatsappSettings(),
    onSuccess: () => {
      toast.success('Credentials restored. Re-test the connection to re-verify.')
      // The encrypted tokens are back server-side but we don't have
      // plaintext to show, so the inputs stay blank. The placeholder
      // tells the operator the secrets are stored — typing new values
      // and hitting Save will rotate them.
      setAccessToken(''); setVerifyToken(''); setSavedAt(null)
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp'] })
      qc.invalidateQueries({ queryKey: ['settings', 'whatsapp', 'history'] })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Restore failed'),
  })

  const cfg = settings.data
  const isConfigured = !!cfg?.configured
  const isRemoved = !!cfg?.is_removed

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            WhatsApp Business credentials
          </span>
        }
        subtitle="Connect your WABA so the app can send on your behalf."
        right={
          <div className="flex items-center gap-2">
            <Link
              to="/admin/credentials/setup-guide"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                         text-xs font-medium
                         border border-slate-200 dark:border-white/10
                         bg-white dark:bg-white/[0.03]
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-600 dark:text-slate-300
                         transition-colors"
              title="Step-by-step walkthrough: how to get your Meta credentials"
            >
              <BookOpen className="w-3.5 h-3.5" /> Setup guide
            </Link>
            {isRemoved ? (
              <PillPop className="pill-slate">Previously configured</PillPop>
            ) : isConfigured ? (
              cfg.is_verified ? (
                <PillPop className="pill-green"><ShieldCheck className="w-3 h-3 inline -mt-0.5 mr-0.5" />Verified</PillPop>
              ) : (
                <PillPop className="pill-amber"><AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-0.5" />Unverified</PillPop>
              )
            ) : (
              <PillPop className="pill-red">Not configured</PillPop>
            )}
          </div>
        }
      />
      <div className="p-5 space-y-3 text-sm">
        {settings.isLoading ? <Spinner />
          : settings.isError ? <ErrorBox msg={(settings.error as any)?.message} />
          : isRemoved ? (
            <div className="rounded-md border border-slate-200 dark:border-white/10
                            bg-slate-50/60 dark:bg-white/[0.03] p-3 text-slate-700 dark:text-slate-200 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white">
                <History className="w-3.5 h-3.5" /> You removed these credentials {cfg?.removed_at ? fmtRelative(cfg.removed_at) : 'previously'}
              </div>
              <div>
                The encrypted access token is still on file. Hit <strong>Restore previous</strong> to bring everything back without re-typing the token,
                or update the values below and click <strong>Save</strong> to replace them entirely.
              </div>
            </div>
          ) : !isConfigured ? (
            <div className="rounded-md border border-amber-200 dark:border-amber-500/30
                            bg-amber-50 dark:bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200 text-xs">
              You haven't added your WhatsApp Business credentials yet. Without them, the app can't send any messages on your behalf. Fill in the form below and click <strong>Save</strong>.
            </div>
          ) : null}

        {!settings.isLoading && !settings.isError && (
          <CurrentCredentialsPanel cfg={cfg} />
        )}

        {!settings.isLoading && !settings.isError && isConfigured && !isRemoved && (
          <AgentSetupNudge
            loading={agents.isLoading}
            total={agents.data?.length ?? 0}
            enabledCount={(agents.data || []).filter((a) => a.enabled).length}
          />
        )}

        <Field k="Phone Number ID" v={
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                 placeholder="1025607483965144"
                 className="w-full px-3 py-2 border border-slate-300 dark:border-[var(--input-border)]
                            bg-white dark:bg-[var(--input-bg)]
                            text-slate-900 dark:text-slate-100
                            placeholder:text-slate-400 dark:placeholder:text-slate-500
                            rounded-md font-mono text-xs
                            focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60
                            focus:border-brand-400 dark:focus:border-emerald-500/60"
                 autoComplete="off" />
        } sub="Found in the Meta WhatsApp Manager under Account → Phone Numbers." />

        <Field k="WABA ID (optional)" v={
          <input type="text" value={waba} onChange={(e) => setWaba(e.target.value)}
                 placeholder="123456789012345"
                 className="w-full px-3 py-2 border border-slate-300 dark:border-[var(--input-border)]
                            bg-white dark:bg-[var(--input-bg)]
                            text-slate-900 dark:text-slate-100
                            placeholder:text-slate-400 dark:placeholder:text-slate-500
                            rounded-md font-mono text-xs
                            focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
                 autoComplete="off" />
        } sub="WhatsApp Business Account ID. Used by Meta for webhook subscription." />

        <Field
          k={
            <span className="inline-flex items-center gap-2">
              Access Token
              {accessToken && savedAt && Date.now() - savedAt < 30000 && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                             bg-emerald-100 dark:bg-emerald-500/20
                             text-emerald-700 dark:text-emerald-300
                             text-[10px] font-semibold uppercase tracking-wider"
                >
                  <CheckCircle2 className="w-2.5 h-2.5" /> Saved
                </motion.span>
              )}
            </span>
          }
          v={
            <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
                   placeholder={
                     isRemoved ? 'stored — type new values to re-add' :
                     accessToken ? 'saved — change to rotate, leave as-is to keep' :
                     isConfigured ? 'type a new token to rotate' :
                     'EAA...'
                   }
                   className="w-full px-3 py-2 border border-slate-300 dark:border-[var(--input-border)]
                              bg-white dark:bg-[var(--input-bg)]
                              text-slate-900 dark:text-slate-100
                              placeholder:text-slate-400 dark:placeholder:text-slate-500
                              rounded-md font-mono text-xs
                              focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
                   autoComplete="new-password" />
          }
          sub="System-user or 60-day token from the Meta dashboard. Stored encrypted at rest."
        />

        <Field
          k={
            <span className="inline-flex items-center gap-2">
              Verify Token
              {verifyToken && savedAt && Date.now() - savedAt < 30000 && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                             bg-emerald-100 dark:bg-emerald-500/20
                             text-emerald-700 dark:text-emerald-300
                             text-[10px] font-semibold uppercase tracking-wider"
                >
                  <CheckCircle2 className="w-2.5 h-2.5" /> Saved
                </motion.span>
              )}
            </span>
          }
          v={
            <input type="password" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)}
                   placeholder={
                     isRemoved ? 'stored — type new values to re-add' :
                     verifyToken ? 'saved — change to rotate, leave as-is to keep' :
                     isConfigured ? 'type a new token to rotate' :
                     'any string you set in the Meta webhook config'
                   }
                   className="w-full px-3 py-2 border border-slate-300 dark:border-[var(--input-border)]
                              bg-white dark:bg-[var(--input-bg)]
                              text-slate-900 dark:text-slate-100
                              placeholder:text-slate-400 dark:placeholder:text-slate-500
                              rounded-md font-mono text-xs
                              focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
                   autoComplete="new-password" />
          }
          sub="Must match the token you configure in the Meta webhook settings."
        />

        <Field k="API version" v={
          <input type="text" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)}
                 placeholder="v25.0"
                 className="w-full px-3 py-2 border border-slate-300 dark:border-[var(--input-border)]
                            bg-white dark:bg-[var(--input-bg)]
                            text-slate-900 dark:text-slate-100
                            placeholder:text-slate-400 dark:placeholder:text-slate-500
                            rounded-md font-mono text-xs
                            focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-emerald-500/60"
                 autoComplete="off" />
        } />

        {cfg?.last_error && (
          <div className="rounded-md border border-rose-200 dark:border-rose-500/30
                          bg-rose-50 dark:bg-rose-500/10
                          p-3 text-rose-900 dark:text-rose-200 text-xs whitespace-pre-wrap">
            <div className="font-semibold mb-1">Last test failed:</div>
            {cfg.last_error}
          </div>
        )}

        {cfg?.verified_at && !isRemoved && (
          <div className="text-xs text-slate-500 dark:text-slate-400">Last verified {fmtRelative(cfg.verified_at)}</div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <motion.button type="button" onClick={() => save.mutate()} disabled={save.isPending}
                         whileTap={{ scale: 0.97 }}
                         className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                                    text-white text-sm font-medium
                                    bg-gradient-to-r from-emerald-600 to-teal-600
                                    hover:from-emerald-500 hover:to-teal-500
                                    shadow-[0_4px_14px_rgba(16,185,129,0.25)] dark:shadow-[0_4px_20px_rgba(16,185,129,0.45)]
                                    disabled:opacity-50">
            <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : isRemoved ? 'Re-add' : 'Save'}
          </motion.button>

          <motion.button type="button" onClick={() => test.mutate()} disabled={!isConfigured || test.isPending}
                         whileTap={{ scale: 0.97 }}
                         className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                                    border border-slate-300 dark:border-slate-700
                                    bg-white dark:bg-[var(--input-bg)]
                                    hover:bg-slate-50 dark:hover:bg-white/5
                                    text-slate-700 dark:text-slate-200 text-sm font-medium
                                    disabled:opacity-50">
            <RefreshCcw className="w-4 h-4" /> {test.isPending ? 'Testing…' : 'Test connection'}
          </motion.button>

          {isConfigured && !isRemoved && (
            <motion.button type="button"
                           onClick={() => {
                             if (window.confirm('Remove your WhatsApp Business credentials? The encrypted access token stays on file so you can restore later — no messages will send until you do.')) {
                               del.mutate()
                             }
                           }} disabled={del.isPending}
                           whileTap={{ scale: 0.97 }}
                           className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                                      border border-rose-300 dark:border-rose-500/30
                                      hover:bg-rose-50 dark:hover:bg-rose-500/15
                                      text-rose-700 dark:text-rose-300 text-sm font-medium ml-auto disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> {del.isPending ? 'Removing…' : 'Remove'}
            </motion.button>
          )}

          {isRemoved && (
            <motion.button type="button"
                           onClick={() => {
                             if (window.confirm('Restore your previous credentials? The encrypted access token and verify token will be reactivated, but you should test the connection after restoring to confirm Meta still accepts them.')) {
                               restore.mutate()
                             }
                           }} disabled={restore.isPending}
                           whileTap={{ scale: 0.97 }}
                           className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                                      border border-emerald-300 dark:border-emerald-400/40
                                      bg-emerald-50 dark:bg-emerald-500/15
                                      hover:bg-emerald-100 dark:hover:bg-emerald-500/25
                                      text-emerald-800 dark:text-emerald-200 text-sm font-medium ml-auto disabled:opacity-50">
              <RotateCcw className="w-4 h-4" /> {restore.isPending ? 'Restoring…' : 'Restore previous'}
            </motion.button>
          )}
        </div>

        <CredentialsHistoryPanel items={history.data} loading={history.isLoading} />
      </div>
    </Card>
  )
}

function AgentSetupNudge({
  loading,
  total,
  enabledCount,
}: {
  loading: boolean
  total: number
  enabledCount: number
}) {
  const ready = enabledCount > 0
  return (
    <GlassCard className={`!p-0 overflow-hidden ${ready ? '' : 'ring-1 ring-amber-200 dark:ring-amber-400/25'}`}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="p-4 lg:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`grid h-10 w-10 place-items-center rounded-xl ${
              ready
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
            }`}>
              {ready ? <Sparkles className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Next step
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-950 dark:text-white">
                  {ready ? 'AI agent is ready' : 'Set up an AI agent before auto-replies'}
                </div>
                <PillPop className={ready ? 'pill-green' : 'pill-amber'}>
                  {loading ? 'checking' : ready ? `${enabledCount} enabled` : total > 0 ? 'disabled' : 'required'}
                </PillPop>
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {ready
              ? 'Inbound WhatsApp messages can be handled by an enabled agent. Disable every agent if you want messages to be stored without any LLM request or automatic reply.'
              : 'Credentials receive WhatsApp messages, but WhatsyITC will not call the LLM or reply until you create and enable an agent.'}
          </p>
        </div>
        <div className="flex items-center border-t border-[var(--border)] p-4 lg:border-l lg:border-t-0">
          <Link
            to="/admin/ai/agent"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              ready
                ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.07]'
                : 'bg-emerald-600 text-white shadow-[0_8px_24px_rgba(16,185,129,0.25)] hover:bg-emerald-500'
            }`}
          >
            {ready ? 'Manage agent' : 'Setup agent'}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </GlassCard>
  )
}

function CurrentCredentialsPanel({ cfg }: { cfg?: WhatsappSettings }) {
  const state = getCredentialState(cfg)
  const phone = cfg?.is_removed
    ? cfg.last_known_phone_number_id
    : cfg?.phone_number_id
  const waba = cfg?.is_removed
    ? cfg.last_known_waba_id
    : cfg?.waba_id
  const apiVersion = cfg?.is_removed
    ? cfg.last_known_api_version
    : cfg?.api_version
  const lastTime = cfg?.is_removed
    ? cfg.removed_at
    : cfg?.verified_at || cfg?.updated_at || cfg?.created_at

  return (
    <GlassCard className="!p-0">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <div className="p-4 lg:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Current WhatsApp sender
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold text-slate-950 dark:text-white">
                  {state.title}
                </div>
                <PillPop className={state.pillClass}>{state.pill}</PillPop>
              </div>
            </div>
            <div className={`grid h-11 w-11 place-items-center rounded-xl ${state.iconClass}`}>
              <state.icon className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {state.description}
          </p>
          {cfg?.last_error && !cfg.is_removed && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="font-semibold">Last connection test failed</div>
              <div className="mt-1 line-clamp-2 whitespace-pre-wrap">{cfg.last_error}</div>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] p-4 lg:border-l lg:border-t-0 lg:p-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <SafeCredentialLine icon={Phone} label="Phone Number ID" value={phone || 'Not set'} strong={!!phone} />
            <SafeCredentialLine icon={KeyRound} label="WABA ID" value={waba || 'Optional / not set'} />
            <SafeCredentialLine icon={ShieldCheck} label="API version" value={apiVersion || 'v25.0'} />
            <SafeCredentialLine
              icon={Clock3}
              label={cfg?.is_removed ? 'Removed' : cfg?.is_verified ? 'Verified' : 'Last updated'}
              value={lastTime ? fmtRelative(lastTime) : 'No activity yet'}
            />
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
            <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Secrets are never shown here
            </div>
            <div className="mt-1">
              Access token and verify token are stored encrypted. Type new values only when you want to rotate them.
            </div>
          </div>
        </div>
      </div>

      <Link
        to="/admin/credentials/setup-guide"
        className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]"
      >
        <span className="inline-flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5" />
          Need Meta setup steps or webhook details?
        </span>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </GlassCard>
  )
}

function SafeCredentialLine({
  icon: Icon,
  label,
  value,
  strong = false,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
        <div className={`mt-0.5 truncate text-xs ${strong ? 'font-mono font-semibold text-slate-950 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
          {value}
        </div>
      </div>
    </div>
  )
}

function getCredentialState(cfg?: WhatsappSettings): {
  title: string
  pill: string
  pillClass: string
  description: string
  icon: ComponentType<{ className?: string }>
  iconClass: string
} {
  if (cfg?.is_removed) {
    return {
      title: 'No active sender',
      pill: 'Removed',
      pillClass: 'pill-slate',
      description: 'Previous credentials are safely kept on file, but they are not active. Restore them or save new values before sending messages.',
      icon: History,
      iconClass: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
    }
  }
  if (cfg?.configured && cfg.is_verified) {
    return {
      title: 'Active and verified',
      pill: 'Live',
      pillClass: 'pill-green',
      description: 'This is the WhatsApp sender currently used for bulk messages, AI replies, follow-ups, and manual conversation sends.',
      icon: ShieldCheck,
      iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    }
  }
  if (cfg?.configured) {
    return {
      title: 'Stored, needs test',
      pill: 'Needs test',
      pillClass: 'pill-amber',
      description: 'Credentials are saved, but the connection has not been verified yet. Run Test connection before depending on outbound sends.',
      icon: AlertTriangle,
      iconClass: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    }
  }
  return {
    title: 'Not connected',
    pill: 'Inactive',
    pillClass: 'pill-red',
    description: 'No WhatsApp sender is active for this workspace. Add your Meta phone number ID, access token, and verify token to enable sending.',
    icon: AlertTriangle,
    iconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  }
}

function Field({ k, v, sub }: { k: ReactNode; v: any; sub?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{k}</label>
      {v}
      {sub && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

function CredentialsHistoryPanel({ items, loading }: { items: CredentialsHistoryEntry[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="pt-3 border-t border-slate-200 dark:border-white/10">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1.5 flex items-center gap-1">
          <History className="w-3 h-3" /> Activity
        </div>
        <Spinner />
      </div>
    )
  }
  if (!items || items.length === 0) return null
  return (
    <div className="pt-3 border-t border-slate-200 dark:border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1.5 flex items-center gap-1">
        <History className="w-3 h-3" /> Activity
      </div>
      <ul className="space-y-1.5">
        {items.slice(0, 8).map((h) => (
          <HistoryRow key={h.id} entry={h} />
        ))}
      </ul>
    </div>
  )
}

function HistoryRow({ entry }: { entry: CredentialsHistoryEntry }) {
  const tone = {
    created:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    updated:  'bg-blue-100    text-blue-700    dark:bg-blue-500/20    dark:text-blue-300',
    removed:  'bg-rose-100    text-rose-700    dark:bg-rose-500/20    dark:text-rose-300',
    restored: 'bg-amber-100   text-amber-800   dark:bg-amber-500/20   dark:text-amber-300',
  }[entry.action] || 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300'
  const Icon = entry.action === 'restored' ? RotateCcw : entry.action === 'removed' ? Trash2 : CheckCircle2
  return (
    <li className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${tone}`}>
        <Icon className="w-2.5 h-2.5" /> {entry.action}
      </span>
      {entry.phone_number_id && (
        <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{entry.phone_number_id}</span>
      )}
      <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">{fmtRelative(entry.created_at)}</span>
    </li>
  )
}
