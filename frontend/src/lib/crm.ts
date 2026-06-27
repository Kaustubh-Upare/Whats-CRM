// CRM API client. Mirrors the shape of lib/ai.ts — typed wrappers
// around the api axios instance for the /api/crm/* endpoints.
import { api } from '@/lib/api'
import type {
  CRMDeal, CRMDealListItem, CRMDealListResponse, CRMSequence, CRMSequenceRun,
  CRMSequenceStep, CRMLead, CRMLeadActivity, CRMLeadListResponse, CRMPipeline,
  CRMPipelineListResponse, CRMPipelineStage, CRMSequenceListResponse,
  CRMTask, LeadFollowupStatus,
} from '@/lib/types'

// --- Pipelines ---

export async function listPipelines(): Promise<CRMPipelineListResponse> {
  const { data } = await api.get('/api/crm/pipelines')
  return data as CRMPipelineListResponse
}

export async function getPipeline(id: number): Promise<CRMPipeline> {
  const { data } = await api.get(`/api/crm/pipelines/${id}`)
  return data as CRMPipeline
}

export async function createPipeline(payload: {
  name: string
  template?: 'sales' | 'support' | 'blank' | string
}): Promise<{ id: number }> {
  const { data } = await api.post('/api/crm/pipelines', payload)
  return data as { id: number }
}

export async function updatePipeline(id: number, payload: { name: string }): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/pipelines/${id}`, payload)
  return data as { ok: true }
}

export async function updatePipelineStages(
  id: number,
  stages: Array<{ name: string; color?: string; position?: number; automations?: any }>,
): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/pipelines/${id}/stages`, { stages })
  return data as { ok: true }
}

export async function deletePipeline(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/crm/pipelines/${id}`)
  return data as { ok: true }
}

// --- Leads ---

export interface ListLeadsParams {
  status?: string
  score_min?: number
  owner?: number
  search?: string
  limit?: number
  offset?: number
}

export async function listLeads(params: ListLeadsParams = {}): Promise<CRMLeadListResponse> {
  const { data } = await api.get('/api/crm/leads', { params })
  return data as CRMLeadListResponse
}

export async function getLead(id: number): Promise<CRMLead> {
  const { data } = await api.get(`/api/crm/leads/${id}`)
  return data as CRMLead
}

export async function createLead(payload: {
  name?: string
  phone: string
  email?: string
  source?: string
  interest?: string
  budget?: string
  timeline?: string
  location?: string
}): Promise<{ id: number }> {
  const { data } = await api.post('/api/crm/leads', payload)
  return data as { id: number }
}

export async function updateLead(id: number, payload: Partial<CRMLead>): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/leads/${id}`, payload)
  return data as { ok: true }
}

export async function deleteLead(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/crm/leads/${id}`)
  return data as { ok: true }
}

// --- Lead sub-resources ---

export async function listLeadActivities(leadID: number, limit = 100, offset = 0): Promise<CRMLeadActivity[]> {
  const { data } = await api.get(`/api/crm/leads/${leadID}/activities`, { params: { limit, offset } })
  return data as CRMLeadActivity[]
}

export async function addLeadActivity(leadID: number, payload: {
  type: 'note' | 'call' | 'email'
  content: string
}): Promise<{ id: number }> {
  const { data } = await api.post(`/api/crm/leads/${leadID}/activities`, payload)
  return data as { id: number }
}

export async function listLeadTasks(leadID: number): Promise<CRMTask[]> {
  const { data } = await api.get(`/api/crm/leads/${leadID}/tasks`)
  return data as CRMTask[]
}

export async function addLeadTask(leadID: number, payload: {
  title: string
  description?: string
  due_at?: string
}): Promise<{ id: number }> {
  const { data } = await api.post(`/api/crm/leads/${leadID}/tasks`, payload)
  return data as { id: number }
}

export async function updateLeadTask(leadID: number, taskID: number, payload: {
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
}): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/leads/${leadID}/tasks/${taskID}`, payload)
  return data as { ok: true }
}

export async function listLeadConversations(leadID: number): Promise<any[]> {
  const { data } = await api.get(`/api/crm/leads/${leadID}/conversations`)
  return data as any[]
}

export async function listLeadDeals(leadID: number): Promise<CRMDeal[]> {
  const { data } = await api.get(`/api/crm/leads/${leadID}/deals`)
  return data as CRMDeal[]
}

// --- Deals ---

/**
 * List all deals in a pipeline, joined with the lead row. The kanban
 * groups these by stage on the client.
 */
export async function listDealsByPipeline(pipelineID: number): Promise<CRMDealListResponse> {
  const { data } = await api.get('/api/crm/deals', { params: { pipeline_id: pipelineID } })
  return data as CRMDealListResponse
}

export async function createDeal(payload: {
  lead_id: number
  pipeline_id: number
  stage_id: number
  name?: string
  value?: number
}): Promise<{ id: number }> {
  const { data } = await api.post('/api/crm/deals', payload)
  return data as { id: number }
}

export async function moveDealStage(
  dealID: number,
  payload: { stage_id: number; reason?: string },
): Promise<CRMDeal> {
  const { data } = await api.post(`/api/crm/deals/${dealID}/stage`, payload)
  return data as CRMDeal
}

export async function updateDeal(
  dealID: number,
  payload: { name?: string; value?: number; currency?: string; probability?: number; expected_close_date?: string; owner_user_id?: number },
): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/deals/${dealID}`, payload)
  return data as { ok: true }
}

export async function deleteDeal(dealID: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/crm/deals/${dealID}`)
  return data as { ok: true }
}

// --- Sequences ---

export async function listSequences(): Promise<CRMSequenceListResponse> {
  const { data } = await api.get('/api/crm/sequences')
  return data as CRMSequenceListResponse
}

export async function createSequence(payload: {
  name: string
  trigger_event?: string
  trigger_config?: any
  enabled?: boolean
}): Promise<{ id: number }> {
  const { data } = await api.post('/api/crm/sequences', payload)
  return data as { id: number }
}

export async function updateSequence(id: number, payload: {
  name?: string
  trigger_event?: string
  trigger_config?: any
  enabled?: boolean
}): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/sequences/${id}`, payload)
  return data as { ok: true }
}

export async function deleteSequence(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/crm/sequences/${id}`)
  return data as { ok: true }
}

export async function getSequenceSteps(id: number): Promise<CRMSequenceStep[]> {
  const { data } = await api.get(`/api/crm/sequences/${id}/steps`)
  return data as CRMSequenceStep[]
}

export async function updateSequenceSteps(
  id: number,
  steps: Array<{
    position?: number
    delay_minutes: number
    message_template: string
    condition?: any
  }>,
): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/crm/sequences/${id}/steps`, { steps })
  return data as { ok: true }
}

export async function enrollLeadInSequence(
  sequenceID: number,
  payload: { lead_id: number },
): Promise<{ id: number }> {
  const { data } = await api.post(`/api/crm/sequences/${sequenceID}/enrollments`, payload)
  return data as { id: number }
}

export async function listSequenceEnrollments(sequenceID: number): Promise<any[]> {
  const { data } = await api.get(`/api/crm/sequences/${sequenceID}/enrollments`)
  return data as any[]
}

/**
 * Per-sequence run history. Returns the last 50 enrollments with
 * their lead row + the most recent failure reason (NULL when the
 * enrollment is healthy).
 */
export async function listSequenceRuns(sequenceID: number): Promise<CRMSequenceRun[]> {
  const { data } = await api.get(`/api/crm/sequences/${sequenceID}/runs`)
  return data as CRMSequenceRun[]
}

// --- query key helpers ---

export const crmKeys = {
  pipelines:        () => ['crm', 'pipelines'] as const,
  pipeline:         (id: number) => ['crm', 'pipelines', id] as const,
  leads:            (params: ListLeadsParams) => ['crm', 'leads', params] as const,
  lead:             (id: number) => ['crm', 'leads', id] as const,
  leadActivities:  (id: number) => ['crm', 'leads', id, 'activities'] as const,
  leadTasks:        (id: number) => ['crm', 'leads', id, 'tasks'] as const,
  leadConversations:(id: number) => ['crm', 'leads', id, 'conversations'] as const,
  leadDeals:        (id: number) => ['crm', 'leads', id, 'deals'] as const,
  // Phase 7: per-lead smart follow-up status. Same key shape across
  // the chat thread / lead detail / kanban so invalidations propagate.
  leadFollowup:    (id: number) => ['crm', 'leads', id, 'followup'] as const,
  // Phase 5: deal-by-pipeline view for the kanban.
  dealsByPipeline:  (pipelineID: number) => ['crm', 'deals', 'pipeline', pipelineID] as const,
  sequences:        () => ['crm', 'sequences'] as const,
  sequence:         (id: number) => ['crm', 'sequences', id] as const,
  sequenceSteps:   (id: number) => ['crm', 'sequences', id, 'steps'] as const,
  sequenceEnrollments: (id: number) => ['crm', 'sequences', id, 'enrollments'] as const,
  sequenceRuns:    (id: number) => ['crm', 'sequences', id, 'runs'] as const,
}

// --- Phase 7: smart follow-up ---

export interface SetupFollowupPayload {
  cadence_days: number
  max_messages: number
  tone: 'friendly' | 'professional' | 'urgent' | string
  goal?: string
  checkin_enabled: boolean
}

export interface SetupFollowupResponse {
  ok: boolean
  sequence_id: number
  enrollment_id: number
  restarted: boolean
}

export async function setupLeadFollowup(
  leadID: number,
  payload: SetupFollowupPayload,
): Promise<SetupFollowupResponse> {
  const { data } = await api.post(`/api/crm/leads/${leadID}/followup`, payload)
  return data as SetupFollowupResponse
}

export async function getLeadFollowupStatus(leadID: number) {
  const { data } = await api.get(`/api/crm/leads/${leadID}/followup`)
  return data as { enrollment: LeadFollowupStatus['enrollment'] }
}

export async function pauseLeadFollowup(leadID: number): Promise<{ ok: boolean }> {
  const { data } = await api.post(`/api/crm/leads/${leadID}/followup/pause`, {})
  return data as { ok: boolean }
}

// re-export the most-used types for callers
export type { CRMPipelineStage, CRMDealListItem, CRMSequenceRun }