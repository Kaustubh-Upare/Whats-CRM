// AI Assistant API client. Mirrors lib/settings.ts — typed wrappers
// around the api axios instance.
import { api } from '@/lib/api'
import type {
  AddKBPayload, AIAgentConfig, AIAgentKnowledgeScope, AIConversation, AIConversationMessage,
  AIConversationsList, AIStatus, AIUser, AIUserFollowupResult, AIUsersImportResult, AIUsersInspectResult, AIUsersList,
  BatchFollowupConfig, EditKBPayload,
  IngestURLPayload, IngestURLResult, KBChunk, KBListResponse,
  PutAIAgentKnowledgePayload, PutAIAgentPayload, SearchKBRequest, SearchKBResult, SendHumanMessageResult,
  SendHumanMessage, TestAgentRequest, TestAgentResult,
} from '@/lib/types'

// --- Status ---

export async function getAIStatus(): Promise<AIStatus> {
  const { data } = await api.get('/api/ai/status')
  return data as AIStatus
}

// --- AI users ---

export interface ListAIUsersParams {
  q?: string
  limit?: number
  offset?: number
}

export async function listAIUsers(params: ListAIUsersParams = {}): Promise<AIUsersList> {
  const { data } = await api.get('/api/ai/users', { params })
  return data as AIUsersList
}

export async function createAIUser(payload: {
  name: string
  phone: string
  extra_fields?: Record<string, string>
}): Promise<AIUser> {
  const { data } = await api.post('/api/ai/users', payload)
  return data as AIUser
}

export async function startAIUserFollowup(
  retailerId: number,
  config: BatchFollowupConfig,
  opts: { overrideExisting?: boolean } = {},
): Promise<AIUserFollowupResult> {
  const { data } = await api.post(`/api/ai/users/${retailerId}/followup/start`, {
    ...config,
    override_existing: opts.overrideExisting ?? false,
  })
  return data as AIUserFollowupResult
}

export async function inspectAIUsersUpload(file: File): Promise<AIUsersInspectResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/ai/users/inspect-upload', form)
  return data as AIUsersInspectResult
}

export async function importAIUsers(
  file: File,
  mapping: { name: string; phone: string; extra_columns: string[] },
): Promise<AIUsersImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('mapping', JSON.stringify(mapping))
  const { data } = await api.post('/api/ai/users/import', form)
  return data as AIUsersImportResult
}

// --- Agent config ---
//
// Phase 8 multi-agent surface:
//   listAIAgents  — every agent the admin owns
//   createAIAgent — POST /api/ai/agents (enforces 20-cap server-side)
//   getAIAgent    — fetch one by id
//   updateAIAgent — PUT /api/ai/agents/:id
//   deleteAIAgent — DELETE /api/ai/agents/:id
//   setDefaultAIAgent — POST /api/ai/agents/:id/default
//   getDefaultAIAgent / putDefaultAIAgent — alias of /ai/agent
//     (kept for back-compat with the legacy single-agent UI path)
export async function listAIAgents(): Promise<AIAgentConfig[]> {
  const { data } = await api.get('/api/ai/agents')
  return (data ?? []) as AIAgentConfig[]
}

export async function createAIAgent(payload: PutAIAgentPayload): Promise<AIAgentConfig> {
  const { data } = await api.post('/api/ai/agents', payload)
  return data as AIAgentConfig
}

export async function getAIAgent(id: number): Promise<AIAgentConfig> {
  const { data } = await api.get(`/api/ai/agents/${id}`)
  return data as AIAgentConfig
}

export async function updateAIAgent(id: number, payload: PutAIAgentPayload): Promise<AIAgentConfig> {
  const { data } = await api.put(`/api/ai/agents/${id}`, payload)
  return data as AIAgentConfig
}

export async function deleteAIAgent(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/ai/agents/${id}`)
  return data as { ok: true }
}

export async function setDefaultAIAgent(id: number): Promise<AIAgentConfig> {
  const { data } = await api.post(`/api/ai/agents/${id}/default`)
  return data as AIAgentConfig
}

export async function getAIAgentKnowledge(id: number): Promise<AIAgentKnowledgeScope> {
  const { data } = await api.get(`/api/ai/agents/${id}/knowledge`)
  return data as AIAgentKnowledgeScope
}

export async function updateAIAgentKnowledge(
  id: number,
  payload: PutAIAgentKnowledgePayload,
): Promise<AIAgentKnowledgeScope> {
  const { data } = await api.put(`/api/ai/agents/${id}/knowledge`, payload)
  return data as AIAgentKnowledgeScope
}

// getDefaultAIAgent returns the admin's global default agent.
// The server returns sensible defaults (Riya / friendly / gpt-4o-mini)
// when the admin has no agents yet — the UI uses this to render the
// "first run" empty editor.
export async function getDefaultAIAgent(): Promise<AIAgentConfig> {
  const { data } = await api.get('/api/ai/agents/default')
  return data as AIAgentConfig
}

// putDefaultAIAgent is the back-compat alias for the legacy editor.
// Routes to PUT /api/ai/agents/default which maps to the default agent.
export async function putDefaultAIAgent(payload: PutAIAgentPayload): Promise<AIAgentConfig> {
  const { data } = await api.put('/api/ai/agents/default', payload)
  return data as AIAgentConfig
}

// Legacy names kept so existing callers don't break. The new UI uses
// listAIAgents / getDefaultAIAgent directly.
export const getAIAgentConfig = getDefaultAIAgent
export const putAIAgentConfig = putDefaultAIAgent

// --- Test playground ---

export async function testAIAgent(payload: TestAgentRequest): Promise<TestAgentResult> {
  const { data } = await api.post('/api/ai/agent/test', payload)
  return data as TestAgentResult
}

// --- Knowledge base CRUD ---

export interface ListKBParams {
  source_type?: string
  search?: string
  limit?: number
  offset?: number
}

export async function listKB(params: ListKBParams = {}): Promise<KBListResponse> {
  const { data } = await api.get('/api/ai/kb', { params })
  return data as KBListResponse
}

export async function addKB(payload: AddKBPayload): Promise<{ id: number }> {
  const { data } = await api.post('/api/ai/kb', payload)
  return data as { id: number }
}

export async function editKB(id: number, payload: EditKBPayload): Promise<{ ok: true }> {
  const { data } = await api.put(`/api/ai/kb/${id}`, payload)
  return data as { ok: true }
}

export async function deleteKB(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete(`/api/ai/kb/${id}`)
  return data as { ok: true }
}

export async function ingestKBURL(payload: IngestURLPayload): Promise<IngestURLResult> {
  const { data } = await api.post('/api/ai/kb/url', payload)
  return data as IngestURLResult
}

// --- KB search test ---

export async function searchKB(payload: SearchKBRequest): Promise<SearchKBResult> {
  const { data } = await api.post('/api/ai/kb/search', payload)
  return data as SearchKBResult
}

// --- KB: generate chunks from a text blob (Bedrock DeepSeek V3.2) ---

export interface GenerateKBFromTextPayload {
  text: string
  max_chunks?: number
}

export interface GenerateKBFromTextResult {
  count: number
  created_ids: number[]
  titles: string[]
}

export async function generateKBFromText(
  payload: GenerateKBFromTextPayload,
): Promise<GenerateKBFromTextResult> {
  const { data } = await api.post('/api/ai/kb/generate-from-text', payload)
  return data as GenerateKBFromTextResult
}

export interface StartKBImportPayload {
  text: string
  source_name?: string
  max_chunks?: number
}

export interface KBImportJob {
  id: number
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  source_type: string
  source_name: string
  source_chars: number
  max_chunks: number
  total_sections: number
  processed_sections: number
  created_count: number
  created_ids: number[]
  titles: string[]
  warnings: string[]
  error?: string
  metadata?: any
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export async function startKBImport(payload: StartKBImportPayload): Promise<KBImportJob> {
  const { data } = await api.post('/api/ai/kb/imports', payload)
  return data as KBImportJob
}

export async function getKBImportJob(id: number): Promise<KBImportJob> {
  const { data } = await api.get(`/api/ai/kb/imports/${id}`)
  return data as KBImportJob
}

// --- Conversations (Phase 2) ---

export interface ListConversationsParams {
  status?: string
  limit?: number
  offset?: number
}

export async function listConversations(params: ListConversationsParams = {}): Promise<AIConversationsList> {
  const { data } = await api.get('/api/ai/conversations', { params })
  return data as AIConversationsList
}

export async function getConversation(id: number): Promise<AIConversation> {
  const { data } = await api.get(`/api/ai/conversations/${id}`)
  return data as AIConversation
}

export async function getConversationMessages(id: number): Promise<AIConversationMessage[]> {
  const { data } = await api.get(`/api/ai/conversations/${id}/messages`)
  return data as AIConversationMessage[]
}

export async function takeOverConversation(id: number): Promise<{ ok: true; status: string }> {
  const { data } = await api.post(`/api/ai/conversations/${id}/takeover`)
  return data as { ok: true; status: string }
}

export async function handBackConversation(id: number): Promise<{ ok: true; status: string }> {
  const { data } = await api.post(`/api/ai/conversations/${id}/handback`)
  return data as { ok: true; status: string }
}

export async function sendHumanMessage(id: number, content: string): Promise<SendHumanMessageResult> {
  const { data } = await api.post(`/api/ai/conversations/${id}/messages`, { content })
  return data as SendHumanMessageResult
}

// --- query key helpers (so callers don't repeat the strings) ---

export const aiKeys = {
  status:       () => ['ai', 'status'] as const,
  users:        (params: ListAIUsersParams) => ['ai', 'users', params] as const,
  agent:        () => ['ai', 'agent'] as const,            // legacy alias
  agents:       () => ['ai', 'agents'] as const,
  agentItem:    (id: number) => ['ai', 'agents', id] as const,
  agentKnowledge: (id: number | null) => ['ai', 'agents', id, 'knowledge'] as const,
  defaultAgent: () => ['ai', 'agents', 'default'] as const,
  kb:           (params: ListKBParams) => ['ai', 'kb', params] as const,
  kbItem:       (id: number) => ['ai', 'kb', 'item', id] as const,
  kbImport:     (id: number | null) => ['ai', 'kb', 'import', id] as const,
  conversations:(params: ListConversationsParams) => ['ai', 'conversations', params] as const,
  conversation: (id: number) => ['ai', 'conversations', id] as const,
  messages:     (id: number) => ['ai', 'conversations', id, 'messages'] as const,
}

// re-export so callers don't have to import types separately
export type { KBChunk, AIConversation, AIConversationMessage, AIConversationsList, SendHumanMessage, SendHumanMessageResult }
