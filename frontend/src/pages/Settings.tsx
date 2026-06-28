import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Pencil, Save, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { Card, CardHeader, ErrorBox, PageHeader, Spinner } from '@/components/ui'
import { PillPop } from '@/lib/motion'
import type { Retailer } from '@/lib/types'
import { fmtRelative } from '@/lib/format'
import { useAuth } from '@/lib/useAuth'
import { putMyProfile } from '@/lib/settings'

/**
 * /admin/settings — overview page now that WABA credentials have moved
 * to their own /admin/credentials section. We keep:
 *   - The Workspace card (rename this admin's per-user workspace label)
 *   - A pointer card to the Credentials page (so anyone who lands here
 *     via an old bookmark still finds their way)
 *   - The opted-out retailers list (still belongs here, not on Credentials)
 *   - The audit-log shortcut (still belongs here)
 */
export default function Settings() {
  const optedOut = useQuery({
    queryKey: ['optouts'],
    queryFn: async () => (await api.get('/api/retailers?q=&limit=500')).data as { items: Retailer[] },
  })
  const opted = (optedOut.data?.items || []).filter((r) => r.is_opted_out)

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Workspace identity, retail opt-outs, audit log, and the link to your credentials."
      />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <WorkspaceCard />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-emerald-500" />
                  Credentials
                </span>
              }
              subtitle="WhatsApp Business credentials, restore, and sign-in method"
              right={
                <Link
                  to="/admin/credentials"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                             border border-slate-300 dark:border-slate-700
                             hover:bg-slate-50 dark:hover:bg-white/5
                             text-slate-700 dark:text-slate-200 text-sm"
                >
                  Open Credentials <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              }
            />
            <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
              Manage your WABA connection (phone number id, access token, verify token, API version)
              and the sign-in method (email/password or Google OAuth) on the
              <Link to="/admin/credentials" className="text-emerald-700 dark:text-emerald-300 hover:underline mx-1 font-medium">Credentials</Link>
              page. Removed credentials stay on disk so you can restore them without re-typing.
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardHeader title="Opted-out retailers" subtitle="These won't receive billing messages." />
            {optedOut.isLoading ? <Spinner /> : optedOut.isError ? <ErrorBox msg={(optedOut.error as any)?.message} /> :
              opted.length === 0 ? <div className="p-5 text-sm text-slate-500 dark:text-slate-400">No opt-outs yet. Great!</div> : (
                <ul className="p-3 max-h-96 overflow-auto divide-y divide-slate-100 dark:divide-white/5">
                  {opted.map((r) => (
                    <li key={r.id} className="px-2 py-2 text-sm flex items-center gap-3">
                      <PillPop className="pill-red">opted out</PillPop>
                      <Link to={`/admin/messages/bulk/retailers/${r.id}`} className="font-medium hover:underline text-slate-900 dark:text-white">{r.retailer_name}</Link>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.whatsapp_number}</span>
                      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{fmtRelative(r.opted_out_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="lg:col-span-2">
          <Card hover={false}>
            <CardHeader
              title="Audit log"
              subtitle="Every admin action — logins, batch approvals, template changes, retailer opt-outs."
              right={
                <Link
                  to="/admin/audit-log"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                             border border-slate-300 dark:border-slate-700
                             hover:bg-slate-50 dark:hover:bg-white/5
                             text-slate-700 dark:text-slate-200 text-sm"
                >
                  Open full log →
                </Link>
              }
            />
            <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
              The audit log is its own page with filters by action type (login, batches, templates, webhooks, retailers), live polling, and a search box. Click <span className="font-medium text-slate-800 dark:text-white">Open full log</span> to view it.
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </>
  )
}

/* ---------------- Workspace card ----------------
 * Lets the signed-in admin rename their per-user workspace label. The
 * label is shown in the sidebar header + Login toast so two admins
 * sharing a screen immediately know which workspace they're in. */
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
      // useAuth caches ['auth','me', …] — invalidate so Layout + every
      // page re-renders with the new label.
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      // Also reflect immediately in our local copy so the input shows
      // the persisted value even before the query refetches.
      setDraft(updated.workspace_name ?? '')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Rename failed'),
  })

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-500" />
            Workspace
          </span>
        }
        subtitle="Your per-user workspace label — shown in the sidebar and on the login screen."
        right={
          !editing ? (
            <motion.button
              type="button"
              onClick={() => setEditing(true)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         border border-slate-300 dark:border-slate-700
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-700 dark:text-slate-200 text-sm"
            >
              <Pencil className="w-3.5 h-3.5" /> Rename
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
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Acme Billing"
              className="flex-1 px-3 py-2 text-sm
                         bg-white dark:bg-[var(--input-bg)]
                         border border-slate-300 dark:border-[var(--input-border)]
                         text-slate-900 dark:text-slate-100
                         placeholder:text-slate-400 dark:placeholder:text-slate-500
                         rounded-md
                         focus:outline-none focus:ring-2 focus:ring-emerald-400/50 dark:focus:ring-emerald-500/40
                         focus:border-emerald-400 dark:focus:border-emerald-500/60"
            />
            <motion.button
              type="submit"
              disabled={save.isPending || draft.trim().length === 0}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                         text-white text-sm font-medium
                         bg-gradient-to-r from-emerald-600 to-teal-600
                         hover:from-emerald-500 hover:to-teal-500
                         disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => {
                setDraft(user?.workspace_name || '')
                setEditing(false)
              }}
              disabled={save.isPending}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                         border border-slate-300 dark:border-slate-700
                         bg-white dark:bg-[var(--input-bg)]
                         hover:bg-slate-50 dark:hover:bg-white/5
                         text-slate-700 dark:text-slate-200 text-sm"
            >
              Cancel
            </motion.button>
          </form>
        ) : (
          <div className="space-y-1.5">
            <div className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              {user?.workspace_name?.trim() || 'My Workspace'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Each Google / email sign-in is its own isolated workspace. Your retailers, batches, chats,
              webhook events, templates, audit log, and WABA credentials are visible only to you — no other
              admin can see them, and you can't see theirs.
            </div>
            <div className="pt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <PillPop className="pill-emerald">private</PillPop>
              <span>Signed in as <span className="font-medium text-slate-700 dark:text-slate-200">{user?.email}</span></span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
