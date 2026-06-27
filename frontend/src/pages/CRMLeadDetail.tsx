import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import {
  Briefcase, Phone, Mail, MapPin, DollarSign, Clock, Tag, TrendingUp,
  Plus, Save, X, MessagesSquare, Activity as ActivityIcon, ListTodo, FileText,
  CheckCircle2, MessageSquare, PhoneCall, AtSign,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Card, CardHeader, Empty, ErrorBox, Input, PageHeader, PrimaryButton, SecondaryButton,
  Spinner, TextArea,
} from '@/components/ui'
import { PillPop } from '@/lib/motion'
import { FollowUpMenuItem } from '@/components/FollowUpMenuItem'
import { fmtRelative } from '@/lib/format'
import {
  addLeadActivity, addLeadTask, crmKeys, getLead, listLeadActivities,
  listLeadConversations, listLeadDeals, listLeadTasks, updateLeadTask,
} from '@/lib/crm'
import type { CRMLead, CRMLeadActivity, CRMTask } from '@/lib/types'

/**
 * /admin/crm/leads/:id — single lead view.
 * Six tabs: Overview · Conversations · Activities · Deals · Tasks · Notes.
 */
export default function CRMLeadDetail() {
  const { id } = useParams<{ id: string }>()
  const leadID = parseInt(id || '0', 10)
  const qc = useQueryClient()

  const lead = useQuery({
    queryKey: crmKeys.lead(leadID),
    queryFn: () => getLead(leadID),
    enabled: leadID > 0,
    refetchInterval: 10_000,
  })

  const [tab, setTab] = useState<'overview' | 'conversations' | 'activities' | 'deals' | 'tasks' | 'notes'>('overview')

  return (
    <>
      {lead.isLoading ? <Spinner /> :
       lead.isError ? <ErrorBox msg={(lead.error as any)?.message || 'Failed to load'} /> :
       !lead.data ? <Empty>Lead not found.</Empty> :
       <>
        <PageHeader
          title={lead.data.name || lead.data.phone || `Lead #${leadID}`}
          subtitle={`${lead.data.phone}${lead.data.email ? ` · ${lead.data.email}` : ''}`}
          right={
            <div className="flex items-center gap-2">
              <FollowUpMenuItem
                lead={{ id: leadID!, name: lead.data.name || '', phone: lead.data.phone }}
                variant="button"
              />
              <PillPop className={statusToTone(lead.data.status)}>{lead.data.status}</PillPop>
              {lead.data.score > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono
                                 border border-emerald-200 dark:border-emerald-500/30
                                 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="w-3 h-3" /> {lead.data.score}
                </span>
              )}
            </div>
          }
        />

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-slate-200 dark:border-white/10">
          {(['overview', 'conversations', 'activities', 'deals', 'tasks', 'notes'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium capitalize border-b-2 -mb-px
                         ${tab === t
                           ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                           : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab lead={lead.data} />}
        {tab === 'conversations' && <ConversationsTab leadID={leadID} />}
        {tab === 'activities' && <ActivitiesTab leadID={leadID} />}
        {tab === 'deals' && <DealsTab leadID={leadID} />}
        {tab === 'tasks' && <TasksTab leadID={leadID} qc={qc} />}
        {tab === 'notes' && <NotesTab leadID={leadID} qc={qc} />}
       </>}
    </>
  )
}

// ============================================================================
// Tabs
// ============================================================================

function OverviewTab({ lead }: { lead: CRMLead }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader title="Facts" subtitle="What the AI has learned about this lead." />
        <div className="p-4 space-y-2 text-sm">
          {(!lead.facts || lead.facts.length === 0) ? (
            <Empty>No facts captured yet. The AI learns from the conversation.</Empty>
          ) : lead.facts.map((f) => (
            <div key={f.fact_key} className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 w-20">
                {f.fact_key}
              </span>
              <span className="text-slate-800 dark:text-slate-100">{f.fact_value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <Detail icon={Phone} label="Phone" value={lead.phone} mono />
          {lead.email && <Detail icon={Mail} label="Email" value={lead.email} />}
          {lead.interest && <Detail icon={Briefcase} label="Interest" value={lead.interest} />}
          {lead.budget && <Detail icon={DollarSign} label="Budget" value={lead.budget} />}
          {lead.timeline && <Detail icon={Clock} label="Timeline" value={lead.timeline} />}
          {lead.location && <Detail icon={MapPin} label="Location" value={lead.location} />}
          {lead.source && <Detail icon={Tag} label="Source" value={lead.source} />}
          <Detail icon={CheckCircle2} label="Status" value={lead.status} />
          {lead.tags && lead.tags.length > 0 && (
            <div className="col-span-2 flex flex-wrap items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Tags</span>
              {lead.tags.map((t) => (
                <PillPop key={t} className="pill-violet !text-[9px]">{t}</PillPop>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader title="Activity" subtitle="Last 5 events on this lead." />
        <div className="p-4">
          <RecentActivityInline leadID={lead.id} />
        </div>
      </Card>
    </div>
  )
}

function RecentActivityInline({ leadID }: { leadID: number }) {
  const acts = useQuery({
    queryKey: crmKeys.leadActivities(leadID),
    queryFn: () => listLeadActivities(leadID, 5),
  })
  if (acts.isLoading) return <Spinner />;
  if (!acts.data || acts.data.length === 0) return <Empty>No activity yet.</Empty>;
  return (
    <ul className="space-y-2 text-sm">
      {acts.data.map((a) => (
        <li key={a.id} className="flex items-start gap-2">
          <ActivityIcon className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
          <div className="flex-1">
            <div className="text-slate-800 dark:text-slate-100">{a.content}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {fmtRelative(a.created_at)} · {a.type}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function ConversationsTab({ leadID }: { leadID: number }) {
  const convs = useQuery({
    queryKey: crmKeys.leadConversations(leadID),
    queryFn: () => listLeadConversations(leadID),
    refetchInterval: 10_000,
  })
  if (convs.isLoading) return <Spinner />;
  if (!convs.data || convs.data.length === 0) {
    return <Empty>No WhatsApp conversations linked to this lead yet.</Empty>;
  }
  return (
    <ul className="space-y-2">
      {convs.data.map((c: any) => (
        <li key={c.id}>
          <Link to={`/admin/ai/conversations/${c.id}`}
                className="block rounded-md border border-slate-200 dark:border-white/10
                           bg-white dark:bg-white/[0.03] p-3 hover:border-emerald-400/60">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-500" />
              <span className="font-mono text-sm text-slate-800 dark:text-slate-100">{c.phone}</span>
              <PillPop className={c.status === 'handed_off' ? 'pill-amber' : 'pill-green'}>
                {c.status}
              </PillPop>
              <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
                {fmtRelative(c.last_message_at)}
              </span>
            </div>
            {c.last_message_preview && (
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-1">
                {c.last_message_preview}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ActivitiesTab({ leadID }: { leadID: number }) {
  const acts = useQuery({
    queryKey: crmKeys.leadActivities(leadID),
    queryFn: () => listLeadActivities(leadID, 200),
  })
  if (acts.isLoading) return <Spinner />;
  if (!acts.data || acts.data.length === 0) {
    return <Empty>No activity yet. Stage moves, status changes, and notes will appear here.</Empty>;
  }
  return (
    <ol className="relative border-l-2 border-slate-200 dark:border-white/10 ml-3 space-y-4 pl-5">
      {acts.data.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[26px] top-1.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-[#0a1124]" />
          <div className="text-sm text-slate-800 dark:text-slate-100">{a.content}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {fmtRelative(a.created_at)} · <span className="font-mono">{a.type}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function DealsTab({ leadID }: { leadID: number }) {
  const deals = useQuery({
    queryKey: crmKeys.leadDeals(leadID),
    queryFn: () => listLeadDeals(leadID),
  })
  if (deals.isLoading) return <Spinner />;
  if (!deals.data || deals.data.length === 0) {
    return <Empty>No deals yet. The AI can create one when the lead shows intent.</Empty>;
  }
  return (
    <ul className="space-y-2">
      {deals.data.map((d) => (
        <li key={d.id} className="rounded-md border border-slate-200 dark:border-white/10
                                  bg-white dark:bg-white/[0.03] p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{d.name}</span>
            <PillPop className="pill-slate">{d.stage_name}</PillPop>
            {d.value != null && (
              <span className="ml-auto font-mono text-emerald-700 dark:text-emerald-300">
                {d.currency} {d.value.toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
            {d.pipeline_name} · prob {d.probability}%
            {d.expected_close_date && ` · close by ${d.expected_close_date}`}
          </div>
        </li>
      ))}
    </ul>
  )
}

function TasksTab({ leadID, qc }: { leadID: number; qc: ReturnType<typeof useQueryClient> }) {
  const tasks = useQuery({
    queryKey: crmKeys.leadTasks(leadID),
    queryFn: () => listLeadTasks(leadID),
  })
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  const add = useMutation({
    mutationFn: () => addLeadTask(leadID, { title, due_at: due || undefined }),
    onSuccess: () => {
      setTitle(''); setDue('')
      toast.success('Task added')
      qc.invalidateQueries({ queryKey: crmKeys.leadTasks(leadID) })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Add failed'),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'pending' | 'in_progress' | 'done' | 'cancelled' }) =>
      updateLeadTask(leadID, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.leadTasks(leadID) }),
  })

  return (
    <div className="space-y-3">
      <Card>
        <div className="p-3 flex flex-wrap gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title…"
            className="flex-1 min-w-[200px]"
          />
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-44"
          />
          <PrimaryButton onClick={() => add.mutate()} disabled={!title || add.isPending}>
            <Plus className="w-4 h-4" /> Add
          </PrimaryButton>
        </div>
      </Card>
      {tasks.isLoading ? <Spinner /> :
       !tasks.data || tasks.data.length === 0 ? <Empty>No tasks yet.</Empty> :
       <ul className="space-y-2">
         {tasks.data.map((t) => (
           <li key={t.id} className="rounded-md border border-slate-200 dark:border-white/10
                                     bg-white dark:bg-white/[0.03] p-3 text-sm flex items-center gap-2">
             <ListTodo className="w-4 h-4 text-slate-400" />
             <span className={`flex-1 ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
               {t.title}
             </span>
             {t.due_at && (
               <span className="text-[10px] text-slate-500 dark:text-slate-400">
                 due {fmtRelative(t.due_at)}
               </span>
             )}
             <select
               value={t.status}
               onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value as any })}
               className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-white/10
                          bg-white dark:bg-[var(--input-bg)] text-slate-700 dark:text-slate-200"
             >
               <option value="pending">pending</option>
               <option value="in_progress">in progress</option>
               <option value="done">done</option>
               <option value="cancelled">cancelled</option>
             </select>
           </li>
         ))}
       </ul>}
    </div>
  )
}

function NotesTab({ leadID, qc }: { leadID: number; qc: ReturnType<typeof useQueryClient> }) {
  const acts = useQuery({
    queryKey: crmKeys.leadActivities(leadID),
    queryFn: () => listLeadActivities(leadID, 200),
  })
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: () => addLeadActivity(leadID, { type: 'note', content: text }),
    onSuccess: () => { setText(''); toast.success('Note added'); qc.invalidateQueries({ queryKey: crmKeys.leadActivities(leadID) }) },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Add failed'),
  })

  const notes = (acts.data || []).filter((a) => a.type === 'note')

  return (
    <div className="space-y-3">
      <Card>
        <div className="p-3 space-y-2">
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Write a note about this lead…"
          />
          <div className="flex justify-end">
            <PrimaryButton onClick={() => add.mutate()} disabled={!text || add.isPending}>
              <Save className="w-4 h-4" /> {add.isPending ? 'Saving…' : 'Save note'}
            </PrimaryButton>
          </div>
        </div>
      </Card>
      {acts.isLoading ? <Spinner /> :
       notes.length === 0 ? <Empty>No notes yet.</Empty> :
       <ul className="space-y-2">
         {notes.map((n) => (
           <li key={n.id} className="rounded-md border border-slate-200 dark:border-white/10
                                     bg-white dark:bg-white/[0.03] p-3 text-sm">
             <div className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap">{n.content}</div>
             <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
               {fmtRelative(n.created_at)}
             </div>
           </li>
         ))}
       </ul>}
    </div>
  )
}

// ============================================================================
// shared
// ============================================================================

function Detail({ icon: Icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''} truncate`}>{value}</div>
      </div>
    </div>
  )
}

function statusToTone(s: string): string {
  switch (s) {
    case 'converted': return 'pill-green'
    case 'qualified': return 'pill-emerald'
    case 'lost': return 'pill-red'
    case 'unqualified': return 'pill-slate'
    case 'contacted': return 'pill-blue'
    default: return 'pill-amber'
  }
}

// unused-import guards
const _ = { motion: true, X: true, MessagesSquare: true, AtSign: true, PhoneCall: true, FileText: true, CheckCircle2: true, CardHeader: true, SecondaryButton: true, listLeadConversations2: true, CRMLeadActivity: true, CRMTask: true, fmtRelative: true, Card: true, Input: true, Spinner: true, Empty: true, ErrorBox: true, TextArea: true, PageHeader: true }
void _