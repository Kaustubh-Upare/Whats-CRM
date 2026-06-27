// AI follow-up (per batch + cross-batch) — API client for the Upload
// page's "AI agent activity" panel AND the cross-batch operator
// queue at /admin/ai/followups. Kept separate from lib/ai.ts to keep
// the agent-config-only concerns of that file focused.
//
// All endpoints here are admin-scoped on the server side; we just
// hit the same /api prefix as everywhere else.

import { api } from '@/lib/api'
import type {
  AIHumanReviewItem, AIHumanReviewList, AuditLog, BatchAIFollowup, BatchAIFollowupDuplicate, BatchAIRecipient,
  BatchAIRecipientDetail, BatchFollowupConfig, EffectiveAIAgent,
  FollowupEnrollmentRow, SetBatchAgentPayload, StartBatchFollowupOpts,
  StartBatchFollowupResult, UploadBatch,
} from '@/lib/types'

// GET /api/batches/{id}/ai-followup — fetch the per-batch toggle and
// the per-recipient AI status list.
export async function getBatchAIFollowup(batchId: number): Promise<BatchAIFollowup> {
  const { data } = await api.get(`/api/batches/${batchId}/ai-followup`)
  return data as BatchAIFollowup
}

// PUT /api/batches/{id}/ai-followup — toggle the per-batch flag.
// On enable, the server back-fills one 'pending' row per valid
// recipient in the batch (idempotent).
export async function putBatchAIFollowup(batchId: number, enabled: boolean): Promise<BatchAIFollowup> {
  const { data } = await api.put(`/api/batches/${batchId}/ai-followup`, { enabled })
  return data as BatchAIFollowup
}

// ListFollowupsParams are the query string for
// GET /api/ai/followups — the cross-batch queue used by the
// /admin/ai/followups sidebar page. All fields optional.
export interface ListFollowupsParams {
  status?: string
  batch_id?: number
  search?: string
  limit?: number
  offset?: number
}

// FollowupsList is the response shape: items + total, mirroring the
// existing AI list endpoints' convention.
export interface FollowupsList {
  items: BatchAIRecipient[]
  total: number
}

// GET /api/ai/followups — cross-batch operator queue.
export interface BatchAICRMSummary {
  id?: number
  batch_id?: number
  summary: string
  mood: string
  buyer_intent: string
  action_required?: boolean
  action_reason?: string
  priority_score?: number
  recommended_action?: string
  what_happened: string[]
  risks: string[]
  next_actions: string[]
  warm_leads: Array<{ phone: string; name: string; reason: string }>
  labels?: string[]
  history_limit: number
  history_used: number
  generated_at: string
  last_analyzed_at?: string
  last_message_at?: string
  model: string
  provider: string
  generation_error?: string
  created_at?: string
  updated_at?: string
}

export interface BatchAICRMInsightsList {
  items: BatchAICRMSummary[]
  total: number
}

export async function listBatchAIFollowups(params: ListFollowupsParams = {}): Promise<FollowupsList> {
  const { data } = await api.get('/api/ai/followups', { params })
  return data as FollowupsList
}

export async function listBatchAICRMInsights(limit = 200): Promise<BatchAICRMInsightsList> {
  const { data } = await api.get('/api/ai/followups/insights', { params: { limit } })
  return data as BatchAICRMInsightsList
}

export async function generateBatchAICRMSummary(
  batchId: number,
  historyLimit: 10 | 20 = 20,
): Promise<BatchAICRMSummary> {
  const { data } = await api.get(`/api/batches/${batchId}/ai-followup/summary`, {
    params: { history_limit: historyLimit },
  })
  return data as BatchAICRMSummary
}

// query key helpers so callers don't repeat the strings
export const batchAIKeys = {
  followup: (batchId: number) => ['batches', batchId, 'ai-followup'] as const,
  followups: (params: ListFollowupsParams = {}) => ['ai', 'followups', params] as const,
  crmInsights: (limit = 200) => ['ai', 'followups', 'crm-insights', limit] as const,
  crmSummary: (batchId: number, historyLimit: number) => ['batches', batchId, 'ai-followup', 'crm-summary', historyLimit] as const,
  humanReview: (params: ListHumanReviewParams = {}) => ['ai', 'human-review', params] as const,
  // Per-batch agent override (Phase 8 — multi-agent). Resolves to the
  // live agent for a batch (override OR global default) plus a
  // source discriminator so the UI can render "(overrides default)"
  // vs "(using global default)" with confidence.
  agent: (batchId: number) => ['batches', batchId, 'agent'] as const,
  // Per-recipient detail. Used by /admin/ai/followups/:recipientId.
  // The recipient's batch_id is part of the key so an invalidation
  // scoped to one batch still cascades when the admin edits AI state
  // from the per-batch page.
  recipient: (recipientId: number) => ['batch-ai-recipient', recipientId] as const,
  recipientByBatch: (batchId: number) => ['batch-ai-recipient', 'by-batch', batchId] as const,
  // History panel — audit entries scoped to one recipient.
  audit: (recipientId: number) => ['batch-ai-recipient', recipientId, 'audit'] as const,
}

// ---------------------------------------------------------------------------
// Human review queue
// ---------------------------------------------------------------------------

export interface ListHumanReviewParams {
  status?: 'open' | 'resolved' | 'snoozed' | 'all' | string
  reason?: string
  severity?: string
  search?: string
  limit?: number
  offset?: number
}

export async function listAIHumanReview(params: ListHumanReviewParams = {}): Promise<AIHumanReviewList> {
  const { data } = await api.get('/api/ai/human-review', { params })
  return data as AIHumanReviewList
}

export async function resolveAIHumanReview(id: number): Promise<AIHumanReviewItem> {
  const { data } = await api.post(`/api/ai/human-review/${id}/resolve`, {})
  return data as AIHumanReviewItem
}

export interface GenerateHumanReviewHelpBody {
  prompt?: string
  history_limit?: 10 | 20
}

export async function generateAIHumanReviewHelp(
  id: number,
  body: GenerateHumanReviewHelpBody = {},
): Promise<AIHumanReviewItem> {
  const { data } = await api.post(`/api/ai/human-review/${id}/ai-help`, {
    prompt: body.prompt || '',
    history_limit: body.history_limit || 20,
  })
  return data as AIHumanReviewItem
}

// ---------------------------------------------------------------------------
// Per-batch agent assignment (Phase 8 — multi-agent)
// ---------------------------------------------------------------------------

// getBatchAgent — GET /api/batches/{id}/agent
// Returns the resolved agent for the batch plus the source so the UI
// can render "this batch uses X (overrides default Y)" without a
// second round-trip.
export async function getBatchAgent(batchId: number): Promise<EffectiveAIAgent> {
  const { data } = await api.get(`/api/batches/${batchId}/agent`)
  return data as EffectiveAIAgent
}

// setBatchAgent — PUT /api/batches/{id}/agent
// Pass agent_id: null to clear the override and revert to the global
// default. Returns the freshly-resolved effective agent + source.
export async function setBatchAgent(
  batchId: number,
  payload: SetBatchAgentPayload,
): Promise<EffectiveAIAgent> {
  const { data } = await api.put(`/api/batches/${batchId}/agent`, payload)
  return data as EffectiveAIAgent
}

// getBatchAIRecipient — GET /api/batch-ai-recipients/:id. Returns
// the recipient + linked conversation + lead + active follow-up
// enrollment + batch header in one round-trip. Powers the
// per-recipient workflow page.
export async function getBatchAIRecipient(recipientId: number): Promise<BatchAIRecipientDetail> {
  const { data } = await api.get(`/api/batch-ai-recipients/${recipientId}`)
  return data as BatchAIRecipientDetail
}

// excludeBatchAIRecipient — POST /api/batch-ai-recipients/:id/exclude.
// Flips the recipient's ai_status to 'excluded'. The cross-batch
// queue hides the row (filter: status != excluded) and the per-batch
// panel still shows it with an "Excluded" badge.
export async function excludeBatchAIRecipient(recipientId: number): Promise<{ ok: boolean; ai_status: string }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/exclude`)
  return data
}

// includeBatchAIRecipient — POST /api/batch-ai-recipients/:id/include.
// Flips the recipient's ai_status back to 'pending'. Reverses
// excludeBatchAIRecipient.
export async function includeBatchAIRecipient(recipientId: number): Promise<{ ok: boolean; ai_status: string }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/include`)
  return data
}

// approveBatch posts to POST /api/batches/{id}/approve with the
// template + language encoded as query string params, matching the
// server contract (see backend/internal/handlers/upload.go
// ApproveBatch). Returns the { ok, queued } payload; the caller is
// responsible for invalidating relevant React Query caches.
export interface ApproveBatchResult {
  ok: boolean
  queued: number
}
export async function approveBatch(batchId: number, template: string, lang: string): Promise<ApproveBatchResult> {
  const { data } = await api.post(
    `/api/batches/${batchId}/approve?template=${encodeURIComponent(template)}&lang=${encodeURIComponent(lang)}`,
  )
  return data as ApproveBatchResult
}

// approveBatchOnly posts to POST /api/batches/{id}/approve-only —
// flips the batch status to 'approved' WITHOUT queueing any message
// jobs. Use this to stage a batch for AI follow-up tracking without
// committing to the WhatsApp send.
export async function approveBatchOnly(batchId: number): Promise<ApproveBatchResult> {
  const { data } = await api.post(`/api/batches/${batchId}/approve-only`)
  return data as ApproveBatchResult
}

// patchBatch posts to PATCH /api/batches/{id}. Today only
// `display_name` is supported; the backend will normalise empty
// strings to null and trim whitespace. Returns the updated batch
// envelope { batch: UploadBatch }.
export interface PatchBatchBody {
  display_name?: string | null
}
export async function patchBatch(batchId: number, body: PatchBatchBody): Promise<UploadBatch> {
  const { data } = await api.patch(`/api/batches/${batchId}`, body)
  return (data as { batch: UploadBatch }).batch
}

// resendBatch posts to POST /api/batches/{id}/resend with the
// chosen template + language and an optional recipient scope. The
// server creates a fresh round of message jobs for the matching
// rows without flipping the batch status. Returns { queued, skipped }.
//
// Scope rules (all optional, default = all valid rows in the batch):
//   - only_failed: limit to rows whose most recent job is 'failed'
//   - row_numbers: explicit list of row_number values to include
// (When both are supplied the row_numbers list wins — only_failed
//  is ignored for rows that are explicitly listed.)
export interface ResendBatchBody {
  template: string
  lang: string
  only_failed?: boolean
  row_numbers?: number[]
}
export interface ResendBatchResult {
  ok: boolean
  queued: number
  skipped: number
}
export async function resendBatch(batchId: number, body: ResendBatchBody): Promise<ResendBatchResult> {
  const { data } = await api.post(
    `/api/batches/${batchId}/resend?template=${encodeURIComponent(body.template)}&lang=${encodeURIComponent(body.lang)}`,
    {
      only_failed: body.only_failed ?? false,
      row_numbers: body.row_numbers ?? [],
    },
  )
  return data as ResendBatchResult
}

// startBatchAIFollowupSequence is the action behind the "Enable AI"
// modal on /admin/ai/followups. It flips the per-batch flag AND
// creates one sequence enrollment per valid recipient in the
// batch, using the admin's chosen behavior + cadence + tone.
//
// `excludePhones` is the list of phones the admin opted out of the
// new sequence in the duplicates warning modal. These are marked
// ai_status='excluded' server-side and skipped by the fan-out.
// Pass {excludePhones: [], overridePhones: []} (the default) when
// there are no duplicates — the existing behavior is preserved.
//
// overridePhones carries phones where this batch should take over.
// The backend pauses older active AI follow-ups first, then creates
// the current batch enrollment, so two agents do not send in parallel.
export async function startBatchAIFollowupSequence(
  batchId: number,
  config: BatchFollowupConfig,
  opts: StartBatchFollowupOpts = { excludePhones: [], overridePhones: [] },
): Promise<StartBatchFollowupResult> {
  const { data } = await api.post(
    `/api/batches/${batchId}/ai-followup/sequence`,
    {
      ...config,
      exclude_phones: opts.excludePhones,
      override_phones: opts.overridePhones,
    },
  )
  return data as StartBatchFollowupResult
}

// PreflightDuplicatesResult is the response from
// POST /api/batches/{id}/ai-followup/duplicates.
//
// Phase 9: gains `fresh_count` so the conflict modal can render
// "N conflicts · M fresh enrollments" in one round-trip.
// fresh_count = the count of recipient rows whose ai_status is
// neither 'excluded' nor 'opted_out' — these are the rows the new
// sequence WILL touch unless the operator excludes or overrides
// them in the modal.
export interface PreflightDuplicatesResult {
  duplicates: BatchAIFollowupDuplicate[]
  total: number
  fresh_count: number
}

// preflightBatchAIFollowupDuplicates is the read-only "are there
// phones in this batch that already have an active AI follow-up
// elsewhere?" check. Used by the Enable-AI warning modal BEFORE
// the admin commits to the sequence-start.
export async function preflightBatchAIFollowupDuplicates(
  batchId: number,
): Promise<PreflightDuplicatesResult> {
  const { data } = await api.post(
    `/api/batches/${batchId}/ai-followup/duplicates`,
  )
  return data as PreflightDuplicatesResult
}

// ============================================================================
// Per-recipient intervention endpoints (Phase 9)
// ============================================================================

// PauseBody is the optional payload for POST /api/batch-ai-recipients/:id/pause.
// Both fields are optional; defaults are filled server-side.
export interface PauseBody {
  reason?: string
  detail?: string
}

// pauseBatchAIRecipient — POST /api/batch-ai-recipients/:id/pause.
// Flips the active ai_followup enrollment to paused with the supplied
// reason/detail (or defaults if absent). Idempotent.
export async function pauseBatchAIRecipient(
  recipientId: number, body: PauseBody = {},
): Promise<{ ok: boolean; enrollment_id: number; status: string }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/pause`, body)
  return data
}

// resumeBatchAIRecipient — POST /api/batch-ai-recipients/:id/resume.
// Reverses Pause — flips enrollment back to active, clears pause
// metadata, and stamps next_run_at based on the override or step cadence.
export async function resumeBatchAIRecipient(
  recipientId: number,
): Promise<{ ok: boolean; enrollment_id: number; status: string }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/resume`, {})
  return data
}

// sendNextBatchAIStep — POST /api/batch-ai-recipients/:id/send-next.
// Clears pause metadata and stamps next_run_at = now() so the worker
// picks the enrollment up on its next tick. Returns 409 if the
// recipient is excluded.
export async function sendNextBatchAIStep(
  recipientId: number,
): Promise<{ ok: boolean; enrollment_id: number }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/send-next`, {})
  return data
}

// UpdatePlanBody is the partial-update payload for the Edit Plan
// modal. Every field is optional — nil means "leave column unchanged".
// cadence_days and max_messages must be >= 1; tone must be one of
// friendly / professional / casual / urgent.
export interface UpdatePlanBody {
  cadence_days?: number
  max_messages?: number
  tone?: string
  goal?: string
}

// updateBatchAIRecipientPlan — PUT /api/batch-ai-recipients/:id/plan.
// Sets per-enrollment override columns. Returns the updated
// FollowupEnrollmentRow (with effective cadence/tone/etc after the
// backend coalesces overrides over the step condition JSONB).
export async function updateBatchAIRecipientPlan(
  recipientId: number, body: UpdatePlanBody,
): Promise<FollowupEnrollmentRow> {
  const { data } = await api.put(`/api/batch-ai-recipients/${recipientId}/plan`, body)
  return data as FollowupEnrollmentRow
}

// setBatchAIRecipientMode — POST /api/batch-ai-recipients/:id/mode.
// Switches the enrollment between 'template' / 'ai_followup' /
// 'agentic_followup'.
export interface GenerateNextMessageBody {
  prompt: string
  history_limit: 10 | 20
}

export interface GeneratedNextMessage {
  message: string
  prompt: string
  history_limit: 10 | 20
  history_used: number
  context_message_id?: number | null
  generated_at: string
  model: string
  provider: string
}

export interface SaveNextMessageBody {
  message: string
  prompt: string
  source: 'ai' | 'manual'
  context_message_id?: number | null
  history_limit: 10 | 20
  generated_at?: string | null
}

export async function generateBatchAINextMessage(
  recipientId: number, body: GenerateNextMessageBody,
): Promise<GeneratedNextMessage> {
  const { data } = await api.post(
    `/api/batch-ai-recipients/${recipientId}/next-message/generate`,
    body,
  )
  return data as GeneratedNextMessage
}

export async function saveBatchAINextMessage(
  recipientId: number, body: SaveNextMessageBody,
): Promise<{ ok: boolean }> {
  const { data } = await api.put(
    `/api/batch-ai-recipients/${recipientId}/next-message`,
    body,
  )
  return data
}

export async function clearBatchAINextMessage(
  recipientId: number,
): Promise<{ ok: boolean }> {
  const { data } = await api.delete(
    `/api/batch-ai-recipients/${recipientId}/next-message`,
  )
  return data
}

export async function setBatchAIRecipientMode(
  recipientId: number, mode: string,
): Promise<{ ok: boolean; from: string; to: string }> {
  const { data } = await api.post(`/api/batch-ai-recipients/${recipientId}/mode`, { mode })
  return data
}

// listBatchAIRecipientAudit — GET /api/batch-ai-recipients/:id/audit.
// Returns audit entries for the recipient, ordered newest first.
// Powers the History card on the per-recipient detail page.
export async function listBatchAIRecipientAudit(
  recipientId: number, limit = 50,
): Promise<AuditLog[]> {
  const { data } = await api.get(`/api/batch-ai-recipients/${recipientId}/audit`, { params: { limit } })
  return data as AuditLog[]
}

// exportBatchAIFollowupsCSV triggers a CSV download of the current
// filtered queue. Returns the blob URL the caller should revoke after
// use; the helper below takes care of the click-trigger pattern.
export async function downloadFollowupsCSV(params: ListFollowupsParams): Promise<void> {
  const search = new URLSearchParams()
  if (params.status && params.status !== 'all') search.set('status', params.status)
  if (params.batch_id) search.set('batch_id', String(params.batch_id))
  if (params.search) search.set('search', params.search)
  const qs = search.toString()
  const url = qs ? `/api/ai/followups/export?${qs}` : '/api/ai/followups/export'
  const res = await api.get(url, { responseType: 'blob' })
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const dl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = dl
  a.download = `ai-followups-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(dl)
}
