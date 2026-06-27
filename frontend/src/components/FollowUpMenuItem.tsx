// FollowUpMenuItem — the shared "Follow up" affordance. Each of the
// three surfaces (chat thread, lead detail, kanban card) embeds one
// of these. It owns the dialog open state + the React Query mutation
// + the per-lead followup-status query so all three surfaces stay in
// sync without each having to duplicate the query wiring.
//
// Variant controls the visual presentation:
//   - "button"   → PrimaryButton-styled action. Used on the chat
//                  thread header + lead detail page.
//   - "menuItem" → clickable row in a popover. Used inside the
//                  kanban card's kebab menu.
//
// The parent owns the popover open/close for the "menuItem" variant
// (we only render the clickable row, not the popover itself, so the
// same component can be embedded inside any popover container).

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Pause, Send } from 'lucide-react'
import {
  crmKeys,
  getLeadFollowupStatus,
  pauseLeadFollowup,
  setupLeadFollowup,
  type SetupFollowupPayload,
} from '@/lib/crm'
import { FollowUpDialog, type FollowUpDialogPayload } from '@/components/FollowUpDialog'
import type { LeadFollowupStatus } from '@/lib/types'

export interface FollowUpMenuItemProps {
  lead: { id: number; name: string; phone: string }
  variant: 'button' | 'menuItem'
  // For menuItem: the parent controls when the popover closes; we
  // call this on click so the popover dismisses.
  onPicked?: () => void
}

export function FollowUpMenuItem({ lead, variant, onPicked }: FollowUpMenuItemProps) {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Single source of truth for "is there a follow-up on this lead?"
  // All three surfaces query this so the disable-if-active state
  // stays consistent.
  const statusQuery = useQuery({
    queryKey: crmKeys.leadFollowup(lead.id),
    queryFn: () => getLeadFollowupStatus(lead.id),
    refetchInterval: 15_000,
  })

  const setupMutation = useMutation({
    mutationFn: (payload: SetupFollowupPayload) => setupLeadFollowup(lead.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.leadFollowup(lead.id) })
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
      qc.invalidateQueries({ queryKey: crmKeys.sequences() })
      qc.invalidateQueries({ queryKey: ['crm', 'sequences'] })
      qc.invalidateQueries({ queryKey: crmKeys.lead(lead.id) })
    },
  })

  const pauseMutation = useMutation({
    mutationFn: () => pauseLeadFollowup(lead.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.leadFollowup(lead.id) })
    },
  })

  const enrollment = statusQuery.data?.enrollment
  const isActive = enrollment?.status === 'active'
  const isPaused = enrollment?.status === 'paused'

  const open = () => {
    onPicked?.()
    setDialogOpen(true)
  }

  if (variant === 'menuItem') {
    return (
      <>
        <button
          onClick={open}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                     text-slate-700 dark:text-slate-200
                     hover:bg-slate-100 dark:hover:bg-slate-800
                     transition-colors rounded-md"
        >
          <Send size={14} />
          {enrollment ? 'Edit follow-up' : 'Follow up'}
        </button>
        {isActive && (
          <button
            onClick={() => { onPicked?.(); pauseMutation.mutate() }}
            disabled={pauseMutation.isPending}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                       text-amber-700 dark:text-amber-300
                       hover:bg-amber-50 dark:hover:bg-amber-900/20
                       transition-colors rounded-md
                       disabled:opacity-50"
          >
            <Pause size={14} />
            Pause follow-up
          </button>
        )}
        {isPaused && (
          <div className="px-3 py-1 text-xs text-slate-500 dark:text-slate-400">
            Paused · {enrollment?.pause_reason || 'paused'}
          </div>
        )}
        <FollowUpDialog
          open={dialogOpen}
          lead={lead}
          status={statusQuery.data as LeadFollowupStatus | null}
          submitting={setupMutation.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(p: FollowUpDialogPayload) => setupMutation.mutate(p)}
        />
      </>
    )
  }

  // variant === 'button'
  return (
    <>
      <button
        onClick={open}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                    border transition-colors
                    ${isActive
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
      >
        <Bell size={14} />
        {isActive ? 'Follow-up active' : isPaused ? 'Resume follow-up' : 'Follow up'}
      </button>
      {isActive && (
        <button
          onClick={() => pauseMutation.mutate()}
          disabled={pauseMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                     text-amber-700 dark:text-amber-300
                     border border-amber-200 dark:border-amber-800
                     hover:bg-amber-50 dark:hover:bg-amber-900/20
                     transition-colors
                     disabled:opacity-50"
          title="Pause follow-up"
        >
          <BellOff size={14} />
        </button>
      )}
      <FollowUpDialog
        open={dialogOpen}
        lead={lead}
        status={statusQuery.data as LeadFollowupStatus | null}
        submitting={setupMutation.isPending}
        onClose={() => setDialogOpen(false)}
        onSubmit={(p: FollowUpDialogPayload) => setupMutation.mutate(p)}
      />
    </>
  )
}