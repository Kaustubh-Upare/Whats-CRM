// Domain types matching the Go backend DTOs.

export interface AdminUser {
  id: number
  email: string
  name: string
  role: string
  /** Per-admin workspace label shown in the sidebar header + Login.
   *  Each Google account / email account owns its own workspace —
   *  strictly isolated from every other admin. */
  workspace_name?: string
  whatsapp_configured?: boolean
  oauth_provider?: 'google' | string | null
  avatar_url?: string | null
}

// WhatsappSettings is the response shape from GET /api/settings/whatsapp.
// Tokens / verify-tokens are NEVER returned over the wire.
//
// When the user has previously removed their credentials, `configured`
// flips to false and `is_removed=true` plus the last_known_* snapshot
// fields are populated so the Settings page can render a
// "previously configured" view with a Restore button.
export interface WhatsappSettings {
  configured: boolean
  is_removed?: boolean
  phone_number_id?: string
  waba_id?: string | null
  api_version: string
  is_verified: boolean
  verified_at?: string | null
  last_error?: string | null
  created_at?: string | null
  updated_at?: string | null
  removed_at?: string | null
  removed_by?: number | null
  // Last-known public identifiers from when the credentials were removed.
  // Empty when the row is still active.
  last_known_phone_number_id?: string
  last_known_waba_id?: string
  last_known_api_version?: string
  last_seen_is_verified?: boolean | null
}

// CredentialsHistoryEntry mirrors the bc_credentials_history table.
export interface CredentialsHistoryEntry {
  id: number
  action: 'created' | 'updated' | 'removed' | 'restored' | string
  phone_number_id?: string | null
  waba_id?: string | null
  api_version?: string | null
  is_verified?: boolean | null
  actor_id?: number | null
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
}

// GoogleStatus is the JSON returned by GET /auth/google.
export interface GoogleStatus {
  enabled: boolean
  start_url: string
}

export interface LoginResponse {
  token: string
  user: AdminUser
}

export interface Retailer {
  id: number
  retailer_code: string
  retailer_name: string
  whatsapp_number: string
  city?: string | null
  state?: string | null
  is_opted_out: boolean
  opted_out_at?: string | null
  opted_out_reason?: string | null
  created_at: string
  updated_at: string
}

export interface ValidationErrorItem {
  field: string
  code: string
  message: string
}

export interface BillingRecord {
  id: number
  batch_id: number
  row_number: number
  retailer_code?: string | null
  retailer_name?: string | null
  whatsapp_number?: string | null
  invoice_number?: string | null
  billing_amount?: number | null
  due_date?: string | null
  payment_link?: string | null
  language?: string | null
  raw_row?: Record<string, any> | null
  is_valid: boolean
  validation_errors?: ValidationErrorItem[] | null
  retailer_id?: number | null
  message_job_id?: number | null
  created_at: string
}

export interface UploadBatch {
  id: number
  file_name: string
  file_path: string
  file_size_bytes: number
  mime_type: string
  total_rows: number
  valid_rows: number
  invalid_rows: number
  status: 'uploaded' | 'validated' | 'approved' | 'sending' | 'completed' | 'failed' | string
  uploaded_by?: number | null
  approved_by?: number | null
  approved_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  notes?: string | null
  created_at: string
  // Per-batch AI follow-up override (Phase 7). Independent of the
  // global AIAgentConfig.enabled — see the warning chip in the UI.
  ai_followup_enabled: boolean
  ai_followup_enabled_at?: string | null
  // Operator-chosen label that overrides `file_name` in the Batches
  // list and BatchDetail header. Null/undefined means "fall back to
  // file_name". Migration 023 enforces a 100-char cap server-side.
  display_name?: string | null
}

export interface MessageJob {
  id: number
  batch_id: number
  billing_record_id: number
  retailer_id?: number | null
  to_number: string
  template_name: string
  language_code: string
  template_params?: any
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | string
  attempts: number
  max_attempts: number
  last_error?: string | null
  provider_msg_id?: string | null
  queued_at: string
  sent_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
  failed_at?: string | null
  created_at: string
  retailer_name?: string | null
  invoice_number?: string | null
  amount?: number | null
}

export interface StatusEvent {
  id: number
  message_job_id: number
  provider_msg_id?: string | null
  status: string
  reason_code?: string | null
  reason_text?: string | null
  raw_payload?: any
  occurred_at: string
}

export interface Template {
  id: number
  name: string
  language_code: string
  category: string
  body: string
  variable_count: number
  sample_payload?: any
  is_active: boolean
  created_at: string
}

export interface DashboardKPI {
  total_retailers: number
  opted_out_retailers: number
  messages_today: number
  delivered_today: number
  read_today: number
  failed_today: number
  delivery_rate_today: number
  read_rate_today: number
}

export interface DailyTrendPoint {
  date: string
  sent: number
  delivered: number
  read: number
  failed: number
}

export interface ReportsTrendResponse {
  from: string
  to: string
  rendered_from: string
  rendered_to: string
  points: DailyTrendPoint[]
}

export interface ReportSummary {
  from: string
  to: string
  status_counts: Record<string, number>
}

export interface AuditLog {
  id: number
  actor_id?: number | null
  actor_email?: string | null
  action: string
  entity_type?: string | null
  entity_id?: number | null
  metadata?: any
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
}

// ============================================================================
// AI Assistant (Phase 1)
// ============================================================================

// AIAgentConfig is the JSON shape served by GET /api/ai/agent.
// `working_hours`, `handoff_rules`, and `qualification_criteria` are
// stored as JSONB on the backend; we keep them as `Record<string, any>`
// on the frontend and pretty-print them into textareas for editing.
export interface AIAgentConfig {
  id: number
  configured: boolean
  enabled: boolean
  name: string
  persona_md: string
  tone: 'friendly' | 'professional' | 'concise' | string
  languages: string[]
  working_hours: Record<string, any>
  handoff_rules: Record<string, any>
  primary_model: string
  fallback_models: string[]
  premium_model: string
  faq_confidence_threshold: number
  system_prompt: string
  qualification_criteria: Record<string, any>
  is_default: boolean
  created_at?: string | null
  updated_at?: string | null
}

// Source discriminator returned by GET /api/batches/{id}/agent. The
// UI renders different copy + colors depending on how the agent was
// resolved so the operator can never be confused about which agent
// is actually live for a batch.
export type AgentSource = 'global_default' | 'batch_override' | 'none'

// EffectiveAIAgent pairs an agent with the source discriminator.
// agent may be null when source='none' (admin has no agents yet).
export interface EffectiveAIAgent {
  agent: AIAgentConfig | null
  source: AgentSource
}

export interface AIAgentKnowledgeScope {
  agent_id: number
  mode: 'all' | 'selected' | string
  selected_ids: number[]
  chunks: KBChunk[]
  total_kb: number
}

export interface PutAIAgentKnowledgePayload {
  selected_ids: number[]
}

// SetBatchAgentPayload is the body for PUT /api/batches/{id}/agent.
// agent_id === null clears the override and reverts to global default.
export interface SetBatchAgentPayload {
  agent_id: number | null
}

// PutAIAgentPayload is the request body for PUT /api/ai/agent.
// All keys optional — only supplied keys are updated server-side.
export interface PutAIAgentPayload {
  enabled?: boolean
  name?: string
  persona_md?: string
  tone?: string
  languages?: string[]
  working_hours?: Record<string, any>
  handoff_rules?: Record<string, any>
  primary_model?: string
  fallback_models?: string[]
  premium_model?: string
  faq_confidence_threshold?: number
  system_prompt?: string
  qualification_criteria?: Record<string, any>
}

// TestAgentRequest is the body for POST /api/ai/agent/test.
// Phase 8 multi-agent: pass agent_id to test a specific agent instead
// of the admin's global default. 0 / omitted = global default.
export interface TestAgentRequest {
  message: string
  system_prompt_override?: string
  agent_id?: number
}

// RetrievedChunk is one chunk returned by retrieval (and surfaced in
// the test playground + KB search).
export interface RetrievedChunk {
  id: number
  title?: string
  content: string
  source_type: 'manual' | 'qa_pair' | 'url' | 'pdf' | 'conversation' | string
  source_ref?: string
  vector_sim: number
  keyword_sim: number
  final_score: number
}

// TestAgentResult is the response from POST /api/ai/agent/test.
export interface TestAgentResult {
  reply: string
  model: string
  provider: string
  tier: 'standard' | 'cheap' | 'premium' | string
  routing_reason: string
  intent: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
  latency_ms: number
  retrieved_chunks: RetrievedChunk[]
}

// ============================================================================
// Per-batch AI follow-up (Upload page AI agent activity panel)
// ============================================================================

// BatchFollowupConfig is the payload posted to
// POST /api/batches/{id}/ai-followup/sequence — the "Enable AI with
// timeline" modal on /admin/ai/followups.
//
// `behavior` selects one of three modes that map onto the backend
// follow-up pipeline:
//   - 'default': today's behavior — one short AI nudge per tick.
//   - 'custom':  admin-supplied goal/tone baked into the prompt.
//   - 'agentic': the LLM decides whether a follow-up is appropriate
//                right now and may return "" to skip the tick.
//
// `cadence_days` is the gap between follow-ups (1-30). `max_messages`
// caps the total (1-20). When `behavior = 'custom'`, `goal` carries
// the admin's free-form goal text.
export type FollowupBehavior = 'default' | 'custom' | 'agentic'
export type FollowupTone = 'friendly' | 'professional' | 'urgent' | string

export interface BatchFollowupConfig {
  cadence_days: number      // 1-30
  max_messages: number      // 1-20
  tone: FollowupTone
  goal: string              // only used in 'custom'
  behavior: FollowupBehavior
  checkin_enabled: boolean
}

// StartBatchFollowupResult is the response from the sequence endpoint.
// `excluded_count` is the number of phones the admin opted out of the
// new sequence (via the duplicates warning modal); 0 when no
// exclusions were applied.
export interface StartBatchFollowupResult {
  batch_id: number
  enrollment_ids: number[]
  sequence_ids: number[]
  count: number
  excluded_count: number
}

// BatchAIFollowupDuplicate is one phone in the current batch that
// already has an active AI follow-up on another (or the same)
// batch. The Enable AI modal uses this list to warn the admin
// before creating a duplicate sequence.
//
// Fields mirror the backend store.BatchAIFollowupDuplicate. The
// `source_batch_id` is the batch that owns the EXISTING enrollment
// (so the admin can deep-link there if they want to inspect it).
//
// Phase 9 — multi-agent visibility: the modal needs to know which
// agent is currently handling the conflicting phone, so we expose
// the source batch's agent + filename + whether it's a batch
// override or the global default. The modal uses this to render
// "Sales Hindi (batch override)" or "Riya ★ (global default)" so
// the admin can decide per-phone whether the current agent is
// the right one to keep running, or whether they want this batch's
// agent to take over.
export interface BatchAIFollowupDuplicate {
  recipient_id: number
  phone: string
  retailer_name?: string | null
  lead_id: number
  enrollment_id: number
  sequence_id: number
  sequence_name: string
  mode: 'ai_followup' | 'agentic_followup' | string
  current_step: number
  next_run_at: string
  source_batch_id?: number | null
  // Phase 9 — agent + filename from the source batch.
  source_batch_name: string
  source_agent_id: number | null
  source_agent_name: string
  source_agent_is_default: boolean
  source_agent_source: 'batch_override' | 'global_default' | string
  target_agent_id: number | null
  target_agent_name: string
  target_agent_is_default: boolean
  target_agent_source: 'batch_override' | 'global_default' | string
  agent_conflict: boolean
  step_message_preview?: string | null
}

// StartBatchFollowupOpts is the per-row decision list passed to
// PUT /api/batches/{id}/ai-followup/sequence. Both lists are
// trimmed+deduplicated server-side.
//
// excludePhones: phones to skip from this batch entirely. The
//   existing follow-up on the other batch keeps running.
// overridePhones: phones where the current batch should take over.
//   The backend pauses older active AI follow-ups for that phone before
//   creating the new enrollment, so two agents do not send in parallel.
// (phones in BOTH lists are treated as excluded — the exclude
//  signal wins.)
export interface StartBatchFollowupOpts {
  excludePhones: string[]
  overridePhones: string[]
}

// BatchAIRecipient is the per-recipient AI follow-up state for a single
// batch. Mirrors models.BatchAIRecipient on the backend.
export type BatchAIStatus =
  | 'pending'
  | 'active'
  | 'handed_off'
  | 'opted_out'
  | 'disabled'
  | 'failed'
  | 'excluded'
  | string

export interface BatchAIRecipient {
  id: number
  batch_id: number
  retailer_id?: number | null
  whatsapp_number: string
  retailer_name?: string | null
  ai_status: BatchAIStatus
  conversation_id?: number | null
  last_event_at?: string | null
  last_event?: string | null
  // Denormalized last AI-conversation message preview. Direction is
  // "in" (retailer → us) or "out" (AI → retailer). Empty string when
  // there is no message yet.
  last_message_preview?: string
  last_message_direction?: 'in' | 'out' | string
  last_message_at?: string | null
  created_at: string
  updated_at: string
}

// BatchAIFollowup is the response shape for
// GET /api/batches/{id}/ai-followup. The flag is independent of the
// global AIAgentConfig.enabled — see the warning chip in the UI.
export interface BatchAIFollowup {
  batch_id: number
  batch_status: string
  enabled: boolean
  enabled_at?: string | null
  recipients: BatchAIRecipient[]
  recipients_total: number
  // Counts of recipients grouped by ai_status, e.g.
  // { pending: 12, active: 3, handed_off: 1 }. The backend emits a
  // fixed set of keys (see migration 015 CHECK constraint).
  recipients_by_status: Record<string, number>
}

// KBChunk is one knowledge-base chunk returned by the list endpoint.
export interface KBChunk {
  id: number
  title?: string
  content: string
  source_type: 'manual' | 'qa_pair' | 'url' | 'pdf' | 'conversation' | string
  source_ref?: string
  metadata?: any
  created_at: string
  updated_at: string
  content_size: number
}

// KBListResponse wraps a paginated list of chunks.
export interface KBListResponse {
  items: KBChunk[]
  total: number
}

// AddKBPayload is the body for POST /api/ai/kb.
export interface AddKBPayload {
  title?: string
  content: string
  source_type?: 'manual' | 'qa_pair' | string
}

// EditKBPayload is the body for PUT /api/ai/kb/:id.
export interface EditKBPayload {
  title?: string
  content: string
}

// IngestURLPayload is the body for POST /api/ai/kb/url.
export interface IngestURLPayload {
  url: string
  title?: string
}

// IngestURLResult is the response from a URL ingest.
export interface IngestURLResult {
  url: string
  title: string
  added: number
  skipped: number
  errors?: string[]
  chunk_ids?: number[]
}

// SearchKBRequest is the body for POST /api/ai/kb/search.
export interface SearchKBRequest {
  query: string
  top_k?: number
  agent_id?: number
}

// SearchKBResult is the response from a KB search.
export interface SearchKBResult {
  query: string
  chunks: RetrievedChunk[]
}

// AIStatus is the response from GET /api/ai/status.
export interface AIStatus {
  llm_enabled: boolean
  embeddings_enabled: boolean
  transcriber_enabled: boolean
}

// ============================================================================
// Conversations (Phase 2)
// ============================================================================

// AIConversation is the wire shape for one row in the live inbox.
export interface AIConversation {
  id: number
  phone: string
  status: 'active' | 'handed_off' | 'resolved' | 'archived' | string
  handed_off_at?: string | null
  handoff_reason?: string
  ai_handled_count: number
  human_handled_count: number
  last_message_preview?: string
  last_message_at: string
  started_at: string
  summary?: string
  lead_id?: number | null
  lead_name?: string
}

// AIConversationMessage is one message in a conversation thread.
export interface AIConversationMessage {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'system' | 'human' | string
  content: string
  model_used?: string
  provider?: string
  provider_msg_id?: string
  send_status?: 'pending' | 'sent' | 'failed' | 'stored' | string
  send_error?: string
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  latency_ms?: number
  is_voice: boolean
  tool_summary?: string
  sent_at?: string | null
  created_at: string
}

// ============================================================================
// CRM (Phase 4)
// ============================================================================

export interface CRMPipeline {
  id: number
  name: string
  is_default: boolean
  created_at: string
  stages: CRMPipelineStage[]
}

export interface CRMPipelineStage {
  id: number
  name: string
  color: string
  position: number
  automations?: any
  deal_count: number
}

export interface CRMPipelineListResponse {
  items: CRMPipeline[]
  total: number
}

export interface CRMLead {
  id: number
  name: string
  phone: string
  email: string
  source: string
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost' | string
  score: number
  interest: string
  budget: string
  timeline: string
  location: string
  notes: string
  owner_user_id?: number | null
  tags: string[]
  conversation_id?: number | null
  created_at: string
  updated_at: string
  fact_count: number
  deal_count: number
  // LeadDetail-only fields:
  facts?: CRMLeadFact[]
}

export interface CRMLeadFact {
  fact_key: string
  fact_value: string
  source: string
  confidence: number
  updated_at: string
}

export interface CRMLeadListResponse {
  items: CRMLead[]
  total: number
}

export interface CRMLeadActivity {
  id: number
  type: 'stage_change' | 'lead_status_change' | 'note' | 'call' | 'email' | string
  content: string
  user_id?: number | null
  metadata?: any
  created_at: string
}

export interface CRMTask {
  id: number
  title: string
  description?: string
  due_at?: string | null
  status: 'pending' | 'in_progress' | 'done' | 'cancelled' | string
  assignee_id?: number | null
  created_at: string
  completed_at?: string | null
}

export interface CRMDeal {
  id: number
  business_id: number
  lead_id: number
  pipeline_id: number
  stage_id: number
  name: string
  value?: number | null
  currency: string
  probability: number
  expected_close_date?: string | null
  owner_user_id?: number | null
  created_at: string
  updated_at: string
  pipeline_name?: string
  stage_name?: string
}

// CRMDealListItem extends CRMDeal with denormalised lead fields +
// age-in-stage. Returned by GET /api/crm/deals?pipeline_id=N for the
// kanban.
export interface CRMDealListItem extends CRMDeal {
  lead_name: string
  lead_phone: string
  lead_score: number
  age_seconds: number
}

export interface CRMDealListResponse {
  items: CRMDealListItem[]
  total: number
}

// CRMSequenceRun is one row in the per-sequence "runs" panel.
export interface CRMSequenceRun {
  enrollment_id: number
  lead_id: number
  lead_name: string
  lead_phone: string
  current_step: number
  status: 'active' | 'paused' | 'completed' | 'cancelled' | string
  next_run_at: string
  enrolled_at: string
  completed_at?: string | null
  last_error?: string | null
  // Phase 7 fields. mode='ai_followup' renders the "AI" pill.
  // pause_reason='customer_replied' / 'terminal_stage' / 'send_failed'
  // drives the per-pause-color pill in the runs panel.
  mode?: 'template' | 'ai_followup' | string
  pause_reason?: string | null
  paused_at?: string | null
  pause_detail?: string | null
  checkin_enabled?: boolean
}

// LeadFollowupStatus is the per-lead response from
// GET /api/crm/leads/:id/followup. Null when no smart follow-up
// exists for the lead; otherwise carries the cadence/max/tone the
// admin picked so the dialog can pre-fill on "Restart".
export interface LeadFollowupStatus {
  enrollment: {
    id: number
    sequence_id: number
    status: 'active' | 'paused' | string
    current_step: number
    pause_reason: string
    checkin_enabled: boolean
    next_run_at: string
    cadence_days: number
    max_messages: number
    tone: 'friendly' | 'professional' | 'urgent' | string
    goal: string
  } | null
}

// FollowupEnrollmentRow is the denormalized summary of a single
// bc_crm_sequence_enrollments row that drives a smart follow-up.
// Mirrors backend models.FollowupEnrollmentRow exactly. Used by
// the per-recipient workflow page at /admin/ai/followups/recipients/:id.
//
// Override fields (override_*) are nullable — populated only when
// the admin has set a per-enrollment override via the Edit Plan
// modal. The effective cadence/tone/goal/max_messages are exposed
// via the non-override fields, after coalescing on the backend.
export interface FollowupEnrollmentRow {
  id: number
  sequence_id: number
  status: 'active' | 'paused' | 'completed' | 'cancelled' | string
  current_step: number
  pause_reason: string
  checkin_enabled: boolean
  next_run_at: string
  cadence_days: number
  max_messages: number
  tone: 'friendly' | 'professional' | 'urgent' | string
  goal: string
  // Per-enrollment overrides (Phase 9 — added in migration 018).
  override_cadence_days?: number | null
  override_max_messages?: number | null
  override_tone?: string | null
  override_goal?: string | null
  // Pause detail surfaced from the worker (e.g. the lastErr from a
  // failed send) so the detail page can render the failed-send banner.
  pause_detail?: string | null
  paused_at?: string | null
  // The enrollment mode — drives which worker path renders the
  // message body. Settable via the Mode switcher on the detail page.
  mode?: 'template' | 'ai_followup' | 'agentic_followup' | string
  next_message_body?: string
  next_message_prompt?: string
  next_message_source?: 'ai' | 'manual' | string
  next_message_context_message_id?: number | null
  next_message_history_limit?: number
  next_message_generated_at?: string | null
  next_message_updated_at?: string | null
  next_message_stale: boolean
}

// BatchAIRecipientDetail is the response shape from
// GET /api/batch-ai-recipients/:id. Combines the recipient row
// with the resolved conversation, lead, batch header, and active
// follow-up enrollment so the per-recipient workflow page can
// render in a single round-trip.
export interface BatchAIRecipientDetail {
  recipient: BatchAIRecipient
  conversation?: AIConversation | null
  lead?: CRMLead | null
  followup?: FollowupEnrollmentRow | null
  batch?: UploadBatch | null
}

export interface AIHumanReviewItem {
  id: number
  batch_id?: number | null
  batch_ai_recipient_id: number
  conversation_id?: number | null
  retailer_id?: number | null
  phone: string
  retailer_name: string
  batch_name: string
  status: 'open' | 'resolved' | 'snoozed' | string
  severity: 'critical' | 'high' | 'medium' | 'low' | string
  priority_score: number
  reason_code: string
  reason_label: string
  reason_detail: string
  suggested_action: string
  labels: string[]
  last_message_preview: string
  last_message_role: string
  last_message_at?: string | null
  last_event_at?: string | null
  source: string
  ai_summary?: string
  ai_suggested_reply?: string
  ai_next_action?: string
  ai_model?: string
  ai_provider?: string
  ai_generated_at?: string | null
  ai_error?: string
  snoozed_until?: string | null
  resolved_at?: string | null
  created_at: string
  updated_at: string
}

export interface AIHumanReviewStats {
  open: number
  critical: number
  high: number
  medium: number
  low: number
  buyer_replies: number
  human_needed: number
  failed_sends: number
  price_questions: number
  hot_leads: number
  by_reason: Record<string, number>
}

export interface AIHumanReviewList {
  items: AIHumanReviewItem[]
  total: number
  stats: AIHumanReviewStats
}

// StageAutomation is the shape we send to PUT
// /api/crm/pipelines/:id/stages for each stage's automations column.
// Matches the Go side's `OnStageEntered.EnrollSequences` struct.
export interface StageAutomation {
  on_stage_entered?: {
    enroll_sequences?: Array<{ sequence_id: number }>
  }
}

export interface CRMSequence {
  id: number
  name: string
  trigger_event: string
  trigger_config?: any
  enabled: boolean
  created_at: string
  step_count: number
  enrollment_count: number
}

export interface CRMSequenceStep {
  id: number
  sequence_id: number
  position: number
  delay_minutes: number
  message_template: string
  condition?: any
}

export interface CRMSequenceListResponse {
  items: CRMSequence[]
  total: number
}

// AIConversationsList is the envelope for the list endpoint.
export interface AIConversationsList {
  items: AIConversation[]
  total: number
}

// SendHumanMessage is the body for POST /api/ai/conversations/:id/messages.
export interface SendHumanMessage {
  content: string
}

export interface SendHumanMessageResult {
  ok: true
  sent: boolean
  phone: string
  provider_msg_id?: string
  error?: string
  message?: AIConversationMessage
}
