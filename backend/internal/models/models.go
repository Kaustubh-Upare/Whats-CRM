package models

import (
	"encoding/json"
	"time"
)

type AdminUser struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	// PasswordHash is a pointer because OAuth-only accounts (created via
	// "Continue with Google") have no password — the column is NULL and
	// pgx can't scan NULL into a plain Go string.
	PasswordHash  *string `json:"-"`
	Name          string  `json:"name"`
	Role          string  `json:"role"`
	IsActive      bool    `json:"is_active"`
	GoogleID      *string `json:"google_id,omitempty"`
	AvatarURL     *string `json:"avatar_url,omitempty"`
	OAuthProvider *string `json:"oauth_provider,omitempty"`
	// WorkspaceName is the per-admin label shown in the sidebar header
	// and on the login screen. Each Google account / email account owns
	// its own workspace — strictly isolated from every other admin.
	WorkspaceName string     `json:"workspace_name"`
	CreatedAt     time.Time  `json:"created_at"`
	LastLoginAt   *time.Time `json:"last_login_at,omitempty"`
}

// WhatsappCredentials is one admin's WABA connection settings.
//
// Encrypted blobs and nonces are stored in the DB but never returned in
// API responses — the JSON tags on those fields use "-" so a stray
// `return &creds` cannot leak ciphertext.
//
// IsConfigured (computed by the handler from whether the row exists)
// is what the frontend reads to decide whether to show the
// "configure WABA" banner.
type WhatsappCredentials struct {
	AdminUserID   int64      `json:"-"`
	PhoneNumberID string     `json:"phone_number_id"`
	WABAID        *string    `json:"waba_id,omitempty"`
	APIVersion    string     `json:"api_version"`
	IsVerified    bool       `json:"is_verified"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	LastError     *string    `json:"last_error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	RemovedAt     *time.Time `json:"removed_at,omitempty"`
	RemovedBy     *int64     `json:"removed_by,omitempty"`
}

// CredentialsHistoryEntry is one row in bc_credentials_history.
// Surfaced in the Settings UI so the user can see "what did I last set".
type CredentialsHistoryEntry struct {
	ID            int64     `json:"id"`
	AdminUserID   int64     `json:"-"`
	Action        string    `json:"action"` // created | updated | removed | restored
	PhoneNumberID *string   `json:"phone_number_id,omitempty"`
	WABAID        *string   `json:"waba_id,omitempty"`
	APIVersion    *string   `json:"api_version,omitempty"`
	IsVerified    *bool     `json:"is_verified,omitempty"`
	ActorID       *int64    `json:"actor_id,omitempty"`
	IPAddress     *string   `json:"ip_address,omitempty"`
	UserAgent     *string   `json:"user_agent,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type Retailer struct {
	ID             int64      `json:"id"`
	AdminUserID    *int64     `json:"admin_user_id,omitempty"`
	RetailerCode   string     `json:"retailer_code"`
	RetailerName   string     `json:"retailer_name"`
	WhatsappNumber string     `json:"whatsapp_number"`
	City           *string    `json:"city,omitempty"`
	State          *string    `json:"state,omitempty"`
	IsOptedOut     bool       `json:"is_opted_out"`
	OptedOutAt     *time.Time `json:"opted_out_at,omitempty"`
	OptedOutReason *string    `json:"opted_out_reason,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type ValidationError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type BillingRecord struct {
	ID               int64             `json:"id"`
	AdminUserID      *int64            `json:"admin_user_id,omitempty"`
	BatchID          int64             `json:"batch_id"`
	RowNumber        int               `json:"row_number"`
	RetailerCode     *string           `json:"retailer_code,omitempty"`
	RetailerName     *string           `json:"retailer_name,omitempty"`
	WhatsappNumber   *string           `json:"whatsapp_number,omitempty"`
	InvoiceNumber    *string           `json:"invoice_number,omitempty"`
	BillingAmount    *float64          `json:"billing_amount,omitempty"`
	DueDate          *time.Time        `json:"due_date,omitempty"`
	PaymentLink      *string           `json:"payment_link,omitempty"`
	Language         *string           `json:"language,omitempty"`
	RawRow           json.RawMessage   `json:"raw_row,omitempty"`
	IsValid          bool              `json:"is_valid"`
	ValidationErrors []ValidationError `json:"validation_errors,omitempty"`
	RetailerID       *int64            `json:"retailer_id,omitempty"`
	MessageJobID     *int64            `json:"message_job_id,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
}

type UploadBatch struct {
	ID            int64      `json:"id"`
	FileName      string     `json:"file_name"`
	FilePath      string     `json:"file_path"`
	FileSizeBytes int64      `json:"file_size_bytes"`
	MimeType      string     `json:"mime_type"`
	TotalRows     int        `json:"total_rows"`
	ValidRows     int        `json:"valid_rows"`
	InvalidRows   int        `json:"invalid_rows"`
	Status        string     `json:"status"`
	UploadedBy    *int64     `json:"uploaded_by,omitempty"`
	ApprovedBy    *int64     `json:"approved_by,omitempty"`
	ApprovedAt    *time.Time `json:"approved_at,omitempty"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	Notes         *string    `json:"notes,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	// AIFollowupEnabled is a per-batch override: when true, the AI agent
	// (Phase 6/7) is allowed to auto-reply to inbound messages from
	// recipients in this batch. Independent of the global
	// AIAgentConfig.Enabled flag — the frontend surfaces a warning if
	// the global agent is disabled but the per-batch flag is on.
	AIFollowupEnabled   bool       `json:"ai_followup_enabled"`
	AIFollowupEnabledAt *time.Time `json:"ai_followup_enabled_at,omitempty"`
	// DisplayName is an operator-chosen label that overrides
	// `file_name` in the Batches list and BatchDetail header. NULL
	// means "fall back to file_name". Migration 023 enforces a 100-char
	// CHECK constraint and trims whitespace via a BEFORE trigger, so
	// the value here is always either nil or already-clean.
	DisplayName *string `json:"display_name,omitempty"`
}

type ValidationSummary struct {
	TotalRows     int `json:"total_rows"`
	ValidRows     int `json:"valid_rows"`
	InvalidRows   int `json:"invalid_rows"`
	DuplicateRows int `json:"duplicate_rows"`
	OptedOutRows  int `json:"opted_out_rows"`
}

type BatchValidationReport struct {
	Batch   UploadBatch       `json:"batch"`
	Errors  []BillingRecord   `json:"errors"`
	Preview []BillingRecord   `json:"preview"`
	Summary ValidationSummary `json:"summary"`
}

type MessageJob struct {
	ID              int64           `json:"id"`
	AdminUserID     *int64          `json:"admin_user_id,omitempty"`
	BatchID         int64           `json:"batch_id"`
	BillingRecordID int64           `json:"billing_record_id"`
	RetailerID      *int64          `json:"retailer_id,omitempty"`
	ToNumber        string          `json:"to_number"`
	TemplateName    string          `json:"template_name"`
	LanguageCode    string          `json:"language_code"`
	TemplateParams  json.RawMessage `json:"template_params,omitempty"`
	Status          string          `json:"status"`
	Attempts        int             `json:"attempts"`
	MaxAttempts     int             `json:"max_attempts"`
	LastError       *string         `json:"last_error,omitempty"`
	ProviderMsgID   *string         `json:"provider_msg_id,omitempty"`
	QueuedAt        time.Time       `json:"queued_at"`
	SentAt          *time.Time      `json:"sent_at,omitempty"`
	DeliveredAt     *time.Time      `json:"delivered_at,omitempty"`
	ReadAt          *time.Time      `json:"read_at,omitempty"`
	FailedAt        *time.Time      `json:"failed_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
}

type MessageWithContext struct {
	MessageJob
	RetailerName  *string  `json:"retailer_name,omitempty"`
	InvoiceNumber *string  `json:"invoice_number,omitempty"`
	Amount        *float64 `json:"amount,omitempty"`
}

type StatusEvent struct {
	ID            int64           `json:"id"`
	MessageJobID  int64           `json:"message_job_id"`
	ProviderMsgID *string         `json:"provider_msg_id,omitempty"`
	Status        string          `json:"status"`
	ReasonCode    *string         `json:"reason_code,omitempty"`
	ReasonText    *string         `json:"reason_text,omitempty"`
	RawPayload    json.RawMessage `json:"raw_payload,omitempty"`
	OccurredAt    time.Time       `json:"occurred_at"`
}

// Conversation is one chat thread (grouped by retailer_id, or by phone
// when a message has no linked retailer). Surfaced in the /chats view.
type Conversation struct {
	RetailerID    *int64    `json:"retailer_id,omitempty"`
	Phone         string    `json:"phone"`
	RetailerName  string    `json:"retailer_name"`
	LastMessageAt time.Time `json:"last_message_at"`
	LastPreview   string    `json:"last_preview"`
	LastStatus    string    `json:"last_status"`
	LastDirection string    `json:"last_direction"` // "outbound" | "inbound"
	MessageCount  int       `json:"message_count"`
	HasFailed     bool      `json:"has_failed"`
}

// ThreadMessage is one bubble in a chat thread. It can be either an outbound
// job or an inbound status event (status="received").
type ThreadMessage struct {
	ID            int64     `json:"id"`
	Direction     string    `json:"direction"` // "outbound" | "inbound"
	Body          string    `json:"body"`      // rendered text for outbound, raw text for inbound
	Status        string    `json:"status"`
	OccurredAt    time.Time `json:"occurred_at"`
	TemplateName  string    `json:"template_name,omitempty"`
	LanguageCode  string    `json:"language_code,omitempty"`
	LastError     *string   `json:"last_error,omitempty"`
	ProviderMsgID *string   `json:"provider_msg_id,omitempty"`
	InvoiceNumber *string   `json:"invoice_number,omitempty"`
	Amount        *float64  `json:"amount,omitempty"`
	MessageJobID  int64     `json:"message_job_id"`
}

type Template struct {
	ID            int64           `json:"id"`
	AdminUserID   *int64          `json:"admin_user_id,omitempty"`
	Name          string          `json:"name"`
	LanguageCode  string          `json:"language_code"`
	Category      string          `json:"category"`
	Body          string          `json:"body"`
	VariableCount int             `json:"variable_count"`
	SamplePayload json.RawMessage `json:"sample_payload,omitempty"`
	IsActive      bool            `json:"is_active"`
	CreatedAt     time.Time       `json:"created_at"`
}

// WebhookLog is one row in bc_webhook_logs. Returned to the UI for the
// live "incoming payload" feed.
type WebhookLog struct {
	ID             int64           `json:"id"`
	AdminUserID    *int64          `json:"admin_user_id,omitempty"`
	ReceivedAt     time.Time       `json:"received_at"`
	SourceIP       *string         `json:"source_ip,omitempty"`
	UserAgent      *string         `json:"user_agent,omitempty"`
	EventKind      string          `json:"event_kind"`
	Payload        json.RawMessage `json:"payload"`
	ParsedMessages int             `json:"parsed_messages"`
	ParsedStatuses int             `json:"parsed_statuses"`
	ParseError     *string         `json:"parse_error,omitempty"`
}

type AuditLog struct {
	ID         int64           `json:"id"`
	ActorID    *int64          `json:"actor_id,omitempty"`
	ActorEmail *string         `json:"actor_email,omitempty"`
	Action     string          `json:"action"`
	EntityType *string         `json:"entity_type,omitempty"`
	EntityID   *int64          `json:"entity_id,omitempty"`
	Metadata   json.RawMessage `json:"metadata,omitempty"`
	IPAddress  *string         `json:"ip_address,omitempty"`
	UserAgent  *string         `json:"user_agent,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type DashboardKPI struct {
	TotalRetailers    int     `json:"total_retailers"`
	OptedOutRetailers int     `json:"opted_out_retailers"`
	MessagesToday     int     `json:"messages_today"`
	DeliveredToday    int     `json:"delivered_today"`
	ReadToday         int     `json:"read_today"`
	FailedToday       int     `json:"failed_today"`
	DeliveryRateToday float64 `json:"delivery_rate_today"`
	ReadRateToday     float64 `json:"read_rate_today"`
}

type DailyTrendPoint struct {
	Date      string `json:"date"`
	Sent      int    `json:"sent"`
	Delivered int    `json:"delivered"`
	Read      int    `json:"read"`
	Failed    int    `json:"failed"`
}

type AIAgentConfig struct {
	ID                     int64          `json:"id"`
	AdminUserID            int64          `json:"-"`
	Configured             bool           `json:"configured"`
	Enabled                bool           `json:"enabled"`
	Name                   string         `json:"name"`
	PersonaMD              string         `json:"persona_md"`
	Tone                   string         `json:"tone"`
	Languages              []string       `json:"languages"`
	WorkingHours           map[string]any `json:"working_hours"`
	HandoffRules           map[string]any `json:"handoff_rules"`
	PrimaryModel           string         `json:"primary_model"`
	FallbackModels         []string       `json:"fallback_models"`
	PremiumModel           string         `json:"premium_model"`
	FAQConfidenceThreshold float64        `json:"faq_confidence_threshold"`
	SystemPrompt           string         `json:"system_prompt"`
	QualificationCriteria  map[string]any `json:"qualification_criteria"`
	IsDefault              bool           `json:"is_default"`
	CreatedAt              *time.Time     `json:"created_at,omitempty"`
	UpdatedAt              *time.Time     `json:"updated_at,omitempty"`
}

// EffectiveAIAgent is the resolved agent for a context (batch or global).
// Source discriminates how the agent was picked so the UI can show the
// operator exactly why this agent is active.
type EffectiveAIAgent struct {
	Agent  *AIAgentConfig `json:"agent"`
	Source string         `json:"source"` // "global_default" | "batch_override" | "none"
}

type AIKBChunk struct {
	ID          int64          `json:"id"`
	AdminUserID int64          `json:"-"`
	Title       string         `json:"title,omitempty"`
	Content     string         `json:"content"`
	SourceType  string         `json:"source_type"`
	SourceRef   string         `json:"source_ref,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	ContentSize int            `json:"content_size"`
}

type AIAgentKnowledgeScope struct {
	AgentID     int64       `json:"agent_id"`
	Mode        string      `json:"mode"` // "all" | "selected"
	SelectedIDs []int64     `json:"selected_ids"`
	Chunks      []AIKBChunk `json:"chunks"`
	TotalKB     int         `json:"total_kb"`
}

type AIKBImportJob struct {
	ID                int64          `json:"id"`
	AdminUserID       int64          `json:"-"`
	Status            string         `json:"status"`
	SourceType        string         `json:"source_type"`
	SourceName        string         `json:"source_name"`
	SourceChars       int            `json:"source_chars"`
	MaxChunks         int            `json:"max_chunks"`
	TotalSections     int            `json:"total_sections"`
	ProcessedSections int            `json:"processed_sections"`
	CreatedCount      int            `json:"created_count"`
	CreatedIDs        []int64        `json:"created_ids"`
	Titles            []string       `json:"titles"`
	Warnings          []string       `json:"warnings"`
	Error             string         `json:"error,omitempty"`
	Metadata          map[string]any `json:"metadata"`
	StartedAt         *time.Time     `json:"started_at,omitempty"`
	CompletedAt       *time.Time     `json:"completed_at,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type AIRetrievedChunk struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title,omitempty"`
	Content    string  `json:"content"`
	SourceType string  `json:"source_type"`
	SourceRef  string  `json:"source_ref,omitempty"`
	VectorSim  float64 `json:"vector_sim"`
	KeywordSim float64 `json:"keyword_sim"`
	FinalScore float64 `json:"final_score"`
}

// BatchAIRecipient is the per-recipient AI follow-up state for a single
// batch. Derived state — source of truth for messages is
// bc_ai_conversations / bc_messages. See migration
// 015_batch_ai_followup.sql for the schema and the lifecycle of
// ai_status (pending → active → handed_off / opted_out / failed).
type BatchAIRecipient struct {
	ID             int64      `json:"id"`
	BatchID        int64      `json:"batch_id"`
	RetailerID     *int64     `json:"retailer_id,omitempty"`
	WhatsappNumber string     `json:"whatsapp_number"`
	RetailerName   *string    `json:"retailer_name,omitempty"`
	AIStatus       string     `json:"ai_status"`
	ConversationID *int64     `json:"conversation_id,omitempty"`
	LastEventAt    *time.Time `json:"last_event_at,omitempty"`
	LastEvent      *string    `json:"last_event,omitempty"`
	// Last message preview, denormalized from bc_ai_conversations for
	// the Upload page panel. Direction is "in" (retailer → us) or
	// "out" (AI → retailer). Empty string means "no message yet".
	LastMessagePreview   string     `json:"last_message_preview,omitempty"`
	LastMessageDirection string     `json:"last_message_direction,omitempty"`
	LastMessageAt        *time.Time `json:"last_message_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// FollowupEnrollmentRow is the denormalized summary of a single
// bc_crm_sequence_enrollments row that drives a smart follow-up
// (mode='ai_followup'). CadenceDays / MaxMessages / Tone / Goal are
// post-fetched from the first step's condition JSONB and exposed as
// top-level fields so the UI doesn't have to parse JSONB. Used by
// the per-recipient workflow page at /admin/ai/followups/:id.
type FollowupEnrollmentRow struct {
	ID                          int64      `json:"id"`
	SequenceID                  int64      `json:"sequence_id"`
	Status                      string     `json:"status"`
	CurrentStep                 int64      `json:"current_step"`
	PauseReason                 string     `json:"pause_reason"`
	CheckinEnabled              bool       `json:"checkin_enabled"`
	NextRunAt                   time.Time  `json:"next_run_at"`
	CadenceDays                 int        `json:"cadence_days"`
	MaxMessages                 int        `json:"max_messages"`
	Tone                        string     `json:"tone"`
	Goal                        string     `json:"goal"`
	OverrideCadenceDays         *int       `json:"override_cadence_days,omitempty"`
	OverrideMaxMessages         *int       `json:"override_max_messages,omitempty"`
	OverrideTone                *string    `json:"override_tone,omitempty"`
	OverrideGoal                *string    `json:"override_goal,omitempty"`
	PauseDetail                 string     `json:"pause_detail,omitempty"`
	PausedAt                    *time.Time `json:"paused_at,omitempty"`
	Mode                        string     `json:"mode,omitempty"`
	NextMessageBody             string     `json:"next_message_body,omitempty"`
	NextMessagePrompt           string     `json:"next_message_prompt,omitempty"`
	NextMessageSource           string     `json:"next_message_source,omitempty"`
	NextMessageContextMessageID *int64     `json:"next_message_context_message_id,omitempty"`
	NextMessageHistoryLimit     int        `json:"next_message_history_limit,omitempty"`
	NextMessageGeneratedAt      *time.Time `json:"next_message_generated_at,omitempty"`
	NextMessageUpdatedAt        *time.Time `json:"next_message_updated_at,omitempty"`
	NextMessageStale            bool       `json:"next_message_stale"`
}

// BatchAIFollowup is the response shape for
// GET/PUT /api/batches/{id}/ai-followup — the per-batch toggle plus
// the rolled-up recipient list.
type BatchAIFollowup struct {
	BatchID            int64              `json:"batch_id"`
	BatchStatus        string             `json:"batch_status"`
	Enabled            bool               `json:"enabled"`
	EnabledAt          *time.Time         `json:"enabled_at,omitempty"`
	Recipients         []BatchAIRecipient `json:"recipients"`
	RecipientsTotal    int                `json:"recipients_total"`
	RecipientsByStatus map[string]int     `json:"recipients_by_status"`
}

type BatchAIWarmLead struct {
	Phone  string `json:"phone"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// BatchAIInsight is the saved CRM intelligence row for one AI follow-up
// batch. It lets the dashboard show action-required context without
// regenerating an LLM summary on every page load.
type BatchAIInsight struct {
	ID                int64             `json:"id"`
	AdminUserID       int64             `json:"-"`
	BatchID           int64             `json:"batch_id"`
	Summary           string            `json:"summary"`
	Mood              string            `json:"mood"`
	BuyerIntent       string            `json:"buyer_intent"`
	ActionRequired    bool              `json:"action_required"`
	ActionReason      string            `json:"action_reason"`
	PriorityScore     int               `json:"priority_score"`
	RecommendedAction string            `json:"recommended_action"`
	WhatHappened      []string          `json:"what_happened"`
	Risks             []string          `json:"risks"`
	NextActions       []string          `json:"next_actions"`
	WarmLeads         []BatchAIWarmLead `json:"warm_leads"`
	Labels            []string          `json:"labels"`
	HistoryLimit      int               `json:"history_limit"`
	HistoryUsed       int               `json:"history_used"`
	Model             string            `json:"model"`
	Provider          string            `json:"provider"`
	LastMessageAt     *time.Time        `json:"last_message_at,omitempty"`
	LastAnalyzedAt    time.Time         `json:"last_analyzed_at"`
	GeneratedAt       time.Time         `json:"generated_at"`
	GenerationError   string            `json:"generation_error,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

// AIHumanReviewSignal is the compact internal judgement an existing AI reply
// call can return alongside the customer-safe message. It lets the agent update
// the Human Review queue without spending a second LLM request.
type AIHumanReviewSignal struct {
	RequiresReview  bool     `json:"requires_review"`
	Severity        string   `json:"severity"`
	PriorityScore   int      `json:"priority_score"`
	ReasonCode      string   `json:"reason_code"`
	ReasonLabel     string   `json:"reason_label"`
	ReasonDetail    string   `json:"reason_detail"`
	SuggestedAction string   `json:"suggested_action"`
	Labels          []string `json:"labels"`
	Summary         string   `json:"summary"`
	SuggestedReply  string   `json:"suggested_reply"`
	NextAction      string   `json:"next_action"`
	Model           string   `json:"model,omitempty"`
	Provider        string   `json:"provider,omitempty"`
	Source          string   `json:"source,omitempty"`
}

// AIHumanReviewItem is one phone-level urgency signal for the operator
// review inbox. Rows can be created by deterministic backend rules or by the
// internal review signal emitted during an existing AI reply generation.
type AIHumanReviewItem struct {
	ID                 int64      `json:"id"`
	AdminUserID        int64      `json:"-"`
	BatchID            *int64     `json:"batch_id,omitempty"`
	BatchAIRecipientID int64      `json:"batch_ai_recipient_id"`
	ConversationID     *int64     `json:"conversation_id,omitempty"`
	RetailerID         *int64     `json:"retailer_id,omitempty"`
	Phone              string     `json:"phone"`
	RetailerName       string     `json:"retailer_name"`
	BatchName          string     `json:"batch_name"`
	Status             string     `json:"status"`
	Severity           string     `json:"severity"`
	PriorityScore      int        `json:"priority_score"`
	ReasonCode         string     `json:"reason_code"`
	ReasonLabel        string     `json:"reason_label"`
	ReasonDetail       string     `json:"reason_detail"`
	SuggestedAction    string     `json:"suggested_action"`
	Labels             []string   `json:"labels"`
	LastMessagePreview string     `json:"last_message_preview"`
	LastMessageRole    string     `json:"last_message_role"`
	LastMessageAt      *time.Time `json:"last_message_at,omitempty"`
	LastEventAt        *time.Time `json:"last_event_at,omitempty"`
	Source             string     `json:"source"`
	AISummary          string     `json:"ai_summary,omitempty"`
	AISuggestedReply   string     `json:"ai_suggested_reply,omitempty"`
	AINextAction       string     `json:"ai_next_action,omitempty"`
	AIModel            string     `json:"ai_model,omitempty"`
	AIProvider         string     `json:"ai_provider,omitempty"`
	AIGeneratedAt      *time.Time `json:"ai_generated_at,omitempty"`
	AIError            string     `json:"ai_error,omitempty"`
	SnoozedUntil       *time.Time `json:"snoozed_until,omitempty"`
	ResolvedAt         *time.Time `json:"resolved_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type AIHumanReviewStats struct {
	Open           int            `json:"open"`
	Critical       int            `json:"critical"`
	High           int            `json:"high"`
	Medium         int            `json:"medium"`
	Low            int            `json:"low"`
	BuyerReplies   int            `json:"buyer_replies"`
	HumanNeeded    int            `json:"human_needed"`
	FailedSends    int            `json:"failed_sends"`
	PriceQuestions int            `json:"price_questions"`
	HotLeads       int            `json:"hot_leads"`
	ByReason       map[string]int `json:"by_reason"`
}

type AIHumanReviewList struct {
	Items []AIHumanReviewItem `json:"items"`
	Total int                 `json:"total"`
	Stats AIHumanReviewStats  `json:"stats"`
}

// BatchFollowupConfig is the request body for
// POST /api/batches/{id}/ai-followup/sequence. It captures the
// admin's choice of behavior mode + timeline when enabling AI
// follow-up on a batch from /admin/ai/followups.
//
// The three behavior modes map onto bc_crm_sequence_enrollments.mode:
//   - "default" → mode='ai_followup', no goal/tone on the step
//   - "custom"  → mode='ai_followup', goal/tone stamped on the step
//   - "agentic" → mode='agentic_followup', empty goal/tone
//
// CadenceDays is the gap (in days) between consecutive follow-up
// messages to a single retailer. MaxMessages caps the total number
// of follow-ups. After MaxMessages, the enrollment auto-completes.
type BatchFollowupConfig struct {
	CadenceDays    int    `json:"cadence_days"`
	MaxMessages    int    `json:"max_messages"`
	Tone           string `json:"tone"`
	Goal           string `json:"goal"`
	Behavior       string `json:"behavior"` // "default" | "custom" | "agentic"
	CheckinEnabled bool   `json:"checkin_enabled"`
}

// StartBatchFollowupResult is the response shape for
// POST /api/batches/{id}/ai-followup/sequence. Lists the new
// sequence IDs and enrollment IDs created so the frontend can
// deep-link into the CRM Runs panel if desired. ExcludedCount
// is the number of phones the admin opted out of the new
// sequence (via the duplicates warning modal); 0 when no
// exclusions were applied.
type StartBatchFollowupResult struct {
	BatchID       int64   `json:"batch_id"`
	EnrollmentIDs []int64 `json:"enrollment_ids"`
	SequenceIDs   []int64 `json:"sequence_ids"`
	Count         int     `json:"count"`
	ExcludedCount int     `json:"excluded_count"`
}

type AIConversation struct {
	ID                 int64      `json:"id"`
	Phone              string     `json:"phone"`
	Status             string     `json:"status"`
	HandedOffAt        *time.Time `json:"handed_off_at,omitempty"`
	HandoffReason      string     `json:"handoff_reason,omitempty"`
	AIHandledCount     int        `json:"ai_handled_count"`
	HumanHandledCount  int        `json:"human_handled_count"`
	LastMessagePreview string     `json:"last_message_preview,omitempty"`
	LastMessageAt      time.Time  `json:"last_message_at"`
	StartedAt          time.Time  `json:"started_at"`
	Summary            string     `json:"summary,omitempty"`
	LeadID             *int64     `json:"lead_id,omitempty"`
	LeadName           string     `json:"lead_name,omitempty"`
}

type AIConversationMessage struct {
	ID            int64      `json:"id"`
	Role          string     `json:"role"`
	Content       string     `json:"content"`
	ModelUsed     string     `json:"model_used,omitempty"`
	Provider      string     `json:"provider,omitempty"`
	ProviderMsgID string     `json:"provider_msg_id,omitempty"`
	SendStatus    string     `json:"send_status,omitempty"`
	SendError     string     `json:"send_error,omitempty"`
	TokensIn      int        `json:"tokens_in,omitempty"`
	TokensOut     int        `json:"tokens_out,omitempty"`
	CostUSD       float64    `json:"cost_usd,omitempty"`
	LatencyMS     int        `json:"latency_ms,omitempty"`
	IsVoice       bool       `json:"is_voice"`
	ToolSummary   string     `json:"tool_summary,omitempty"`
	SentAt        *time.Time `json:"sent_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type CRMPipeline struct {
	ID        int64              `json:"id"`
	Name      string             `json:"name"`
	IsDefault bool               `json:"is_default"`
	CreatedAt time.Time          `json:"created_at"`
	Stages    []CRMPipelineStage `json:"stages"`
}

type CRMPipelineStage struct {
	ID          int64          `json:"id"`
	Name        string         `json:"name"`
	Color       string         `json:"color"`
	Position    int            `json:"position"`
	Automations map[string]any `json:"automations,omitempty"`
	DealCount   int            `json:"deal_count"`
}

type CRMLead struct {
	ID             int64         `json:"id"`
	Name           string        `json:"name"`
	Phone          string        `json:"phone"`
	Email          string        `json:"email"`
	Source         string        `json:"source"`
	Status         string        `json:"status"`
	Score          int           `json:"score"`
	Interest       string        `json:"interest"`
	Budget         string        `json:"budget"`
	Timeline       string        `json:"timeline"`
	Location       string        `json:"location"`
	Notes          string        `json:"notes"`
	OwnerUserID    *int64        `json:"owner_user_id,omitempty"`
	Tags           []string      `json:"tags"`
	ConversationID *int64        `json:"conversation_id,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
	FactCount      int           `json:"fact_count"`
	DealCount      int           `json:"deal_count"`
	Facts          []CRMLeadFact `json:"facts,omitempty"`
}

type CRMLeadFact struct {
	FactKey    string    `json:"fact_key"`
	FactValue  string    `json:"fact_value"`
	Source     string    `json:"source"`
	Confidence float64   `json:"confidence"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type CRMLeadActivity struct {
	ID        int64          `json:"id"`
	Type      string         `json:"type"`
	Content   string         `json:"content"`
	UserID    *int64         `json:"user_id,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type CRMTask struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	DueAt       *time.Time `json:"due_at,omitempty"`
	Status      string     `json:"status"`
	AssigneeID  *int64     `json:"assignee_id,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type CRMDeal struct {
	ID                int64      `json:"id"`
	BusinessID        int64      `json:"business_id"`
	LeadID            int64      `json:"lead_id"`
	PipelineID        int64      `json:"pipeline_id"`
	StageID           int64      `json:"stage_id"`
	Name              string     `json:"name"`
	Value             *float64   `json:"value,omitempty"`
	Currency          string     `json:"currency"`
	Probability       int        `json:"probability"`
	ExpectedCloseDate *time.Time `json:"expected_close_date,omitempty"`
	OwnerUserID       *int64     `json:"owner_user_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	PipelineName      string     `json:"pipeline_name,omitempty"`
	StageName         string     `json:"stage_name,omitempty"`
}

type CRMDealListItem struct {
	CRMDeal
	LeadName   string `json:"lead_name"`
	LeadPhone  string `json:"lead_phone"`
	LeadScore  int    `json:"lead_score"`
	AgeSeconds int64  `json:"age_seconds"`
}

type CRMSequence struct {
	ID              int64          `json:"id"`
	Name            string         `json:"name"`
	TriggerEvent    string         `json:"trigger_event"`
	TriggerConfig   map[string]any `json:"trigger_config,omitempty"`
	Enabled         bool           `json:"enabled"`
	CreatedAt       time.Time      `json:"created_at"`
	StepCount       int            `json:"step_count"`
	EnrollmentCount int            `json:"enrollment_count"`
}

type CRMSequenceStep struct {
	ID              int64          `json:"id"`
	SequenceID      int64          `json:"sequence_id"`
	Position        int            `json:"position"`
	DelayMinutes    int            `json:"delay_minutes"`
	MessageTemplate string         `json:"message_template"`
	Condition       map[string]any `json:"condition,omitempty"`
}
