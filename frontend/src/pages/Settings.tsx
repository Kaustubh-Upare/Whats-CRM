import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  KeyRound,
  LockKeyhole,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, GlassCard, PageHeader, Spinner } from '@/components/ui'
import { PillPop } from '@/lib/motion'
import type { Retailer } from '@/lib/types'
import { fmtRelative } from '@/lib/format'
import { useAuth } from '@/lib/useAuth'
import { getWhatsappSettings, putMyProfile } from '@/lib/settings'

export default function Settings() {
  const whatsapp = useQuery({
    queryKey: ['settings', 'whatsapp'],
    queryFn: () => getWhatsappSettings(),
    refetchOnWindowFocus: false,
  })
  const optedOut = useQuery({
    queryKey: ['optouts'],
    queryFn: async () => (await api.get('/api/retailers?q=&limit=500')).data as { items: Retailer[] },
  })
  const opted = (optedOut.data?.items || []).filter((r) => r.is_opted_out)
  const credentialState = whatsapp.data?.configured
    ? whatsapp.data.is_verified ? 'Verified' : 'Needs test'
    : whatsapp.data?.is_removed ? 'Removed' : 'Not connected'

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Keep the workspace clean: identity, WhatsApp connection, opt-outs, and admin history."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <TopLink to="/admin/credentials" icon={<KeyRound className="h-4 w-4" />}>Credentials</TopLink>
            <TopLink to="/admin/audit-log" icon={<Activity className="h-4 w-4" />}>Audit log</TopLink>
          </div>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-5"
      >
        <GlassCard className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 lg:p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                Workspace control center
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Everything important in one calm place.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                Rename the workspace, check whether WhatsApp is ready, review opt-outs, and jump into admin history without hunting through menus.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <StatusChip tone={credentialState === 'Verified' ? 'green' : credentialState === 'Needs test' ? 'amber' : 'red'}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  WhatsApp {credentialState}
                </StatusChip>
                <StatusChip tone="slate">
                  <Ban className="h-3.5 w-3.5" />
                  {opted.length} opted out
                </StatusChip>
                <StatusChip tone="blue">
                  <LockKeyhole className="h-3.5 w-3.5" />
                  Private workspace
                </StatusChip>
              </div>
            </div>

            <div className="border-t border-[var(--border)] p-5 lg:border-l lg:border-t-0 lg:p-6">
              <div className="grid grid-cols-2 gap-3">
                <MiniMetric
                  icon={<KeyRound className="h-4 w-4" />}
                  label="Connection"
                  value={credentialState}
                  tone={credentialState === 'Verified' ? 'green' : credentialState === 'Needs test' ? 'amber' : 'red'}
                />
                <MiniMetric
                  icon={<Ban className="h-4 w-4" />}
                  label="Opt-outs"
                  value={opted.length.toLocaleString()}
                  tone={opted.length > 0 ? 'amber' : 'green'}
                />
                <MiniMetric
                  icon={<UserRound className="h-4 w-4" />}
                  label="Access"
                  value="Isolated"
                  tone="blue"
                />
                <MiniMetric
                  icon={<Clock3 className="h-4 w-4" />}
                  label="Audit"
                  value="Tracked"
                  tone="slate"
                />
              </div>
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <div className="space-y-5">
            <WorkspaceCard />
            <CredentialsSummaryCard
              loading={whatsapp.isLoading}
              error={(whatsapp.error as any)?.message}
              configured={!!whatsapp.data?.configured}
              verified={!!whatsapp.data?.is_verified}
              removed={!!whatsapp.data?.is_removed}
              phone={whatsapp.data?.phone_number_id || whatsapp.data?.last_known_phone_number_id || ''}
              apiVersion={whatsapp.data?.api_version || whatsapp.data?.last_known_api_version || 'v25.0'}
              updatedAt={whatsapp.data?.updated_at || whatsapp.data?.removed_at || null}
            />
          </div>

          <div className="space-y-5">
            <OptOutCard
              loading={optedOut.isLoading}
              error={(optedOut.error as any)?.message}
              opted={opted}
            />
            <AdminHistoryCard />
          </div>
        </div>
      </motion.div>
    </>
  )
}

function TopLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
    >
      {icon}
      {children}
    </Link>
  )
}

function StatusChip({ children, tone }: { children: ReactNode; tone: 'green' | 'amber' | 'red' | 'blue' | 'slate' }) {
  const classes = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${classes}`}>
      {children}
    </span>
  )
}

function MiniMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate'
}) {
  const classes = {
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    red: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
    slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  }[tone]
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/70 p-4 shadow-sm dark:bg-white/[0.03]">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${classes}`}>
        {icon}
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  )
}

function CredentialsSummaryCard({
  loading,
  error,
  configured,
  verified,
  removed,
  phone,
  apiVersion,
  updatedAt,
}: {
  loading: boolean
  error?: string
  configured: boolean
  verified: boolean
  removed: boolean
  phone: string
  apiVersion: string
  updatedAt?: string | null
}) {
  return (
    <Card hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-500" />
            WhatsApp connection
          </span>
        }
        subtitle="Credentials live on their own page so secrets stay easy to manage."
        right={
          <Link
            to="/admin/credentials"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Manage <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="p-5">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox msg={error} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {removed ? (
                <PillPop className="pill-slate">previously configured</PillPop>
              ) : configured && verified ? (
                <PillPop className="pill-green"><CheckCircle2 className="mr-1 inline h-3 w-3" />verified</PillPop>
              ) : configured ? (
                <PillPop className="pill-amber">needs test</PillPop>
              ) : (
                <PillPop className="pill-red">not connected</PillPop>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {updatedAt ? `Updated ${fmtRelative(updatedAt)}` : 'No saved connection yet'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoLine label="Phone number ID" value={phone || 'Not set'} />
              <InfoLine label="API version" value={apiVersion || 'v25.0'} />
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              Use Credentials when rotating tokens, testing Meta access, or following the setup guide. Settings only shows the safe connection status.
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-slate-50/70 px-3 py-2 dark:bg-white/[0.03]">
      <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 truncate font-mono text-sm text-slate-900 dark:text-white">{value}</div>
    </div>
  )
}

function OptOutCard({ loading, error, opted }: { loading: boolean; error?: string; opted: Retailer[] }) {
  return (
    <Card hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Ban className="h-4 w-4 text-rose-500" />
            Opted-out retailers
          </span>
        }
        subtitle="Numbers blocked from future bulk billing messages."
        right={<PillPop className={opted.length ? 'pill-amber' : 'pill-green'}>{opted.length}</PillPop>}
      />
      <div className="p-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox msg={error} />
        ) : opted.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            No opt-outs yet. Every active retailer is still eligible for messaging.
          </div>
        ) : (
          <ul className="max-h-[340px] space-y-2 overflow-auto pr-1">
            {opted.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--border)] bg-white/70 p-3 text-sm transition-colors hover:bg-slate-50 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/messages/bulk/retailers/${r.id}`}
                      className="block truncate font-semibold text-slate-900 hover:underline dark:text-white"
                    >
                      {r.retailer_name || 'Unnamed retailer'}
                    </Link>
                    <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{r.whatsapp_number}</div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtRelative(r.opted_out_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function AdminHistoryCard() {
  return (
    <Card hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            Admin history
          </span>
        }
        subtitle="A clean trail of sign-ins, batch approvals, templates, credentials, and opt-outs."
        right={
          <Link
            to="/admin/audit-log"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="p-5">
        <div className="space-y-3 text-sm">
          {[
            ['Credential changes', 'Who saved, removed, restored, or tested WhatsApp access.'],
            ['Message operations', 'Batch approvals, template actions, sends, and failed events.'],
            ['Retailer safety', 'Opt-outs and admin actions that affect who receives messages.'],
          ].map(([title, sub]) => (
            <div key={title} className="flex gap-3 rounded-lg border border-[var(--border)] bg-slate-50/70 p-3 dark:bg-white/[0.03]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <div className="font-medium text-slate-900 dark:text-white">{title}</div>
                <div className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function WorkspaceCard() {
  const qc = useQueryClient()
  const { user, status } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setDraft(user?.workspace_name ?? '')
  }, [user?.workspace_name])

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = draft.trim()
      if (trimmed.length === 0) throw new Error('Workspace name cannot be empty')
      if (trimmed.length > 80) throw new Error('Workspace name too long (max 80 chars)')
      return putMyProfile({ workspace_name: trimmed, name: user?.name })
    },
    onSuccess: (updated) => {
      toast.success('Workspace renamed')
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      setDraft(updated.workspace_name ?? '')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Rename failed'),
  })

  return (
    <Card hover={false}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-500" />
            Workspace identity
          </span>
        }
        subtitle="Shown in the sidebar and login screen so operators know where they are."
        right={
          !editing ? (
            <motion.button
              type="button"
              onClick={() => setEditing(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </motion.button>
          ) : null
        }
      />
      <div className="p-5">
        {status === 'loading' ? (
          <Spinner />
        ) : editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); save.mutate() }}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. North Zone Sales"
              className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 dark:border-[var(--input-border)] dark:bg-[var(--input-bg)] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/40"
            />
            <motion.button
              type="submit"
              disabled={save.isPending || draft.trim().length === 0}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm font-medium text-white shadow-[0_8px_24px_rgba(16,185,129,0.24)] transition-all hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving...' : 'Save'}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => {
                setDraft(user?.workspace_name || '')
                setEditing(false)
              }}
              disabled={save.isPending}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-[var(--input-bg)] dark:text-slate-200 dark:hover:bg-white/5"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </motion.button>
          </form>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <div className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {user?.workspace_name?.trim() || 'My Workspace'}
              </div>
              <div className="mt-2 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
                Retailers, batches, chats, templates, credentials, and audit history are isolated to this signed-in admin.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <PillPop className="pill-emerald">private</PillPop>
              <span className="max-w-[280px] truncate text-xs text-slate-500 dark:text-slate-400">
                {user?.email}
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
