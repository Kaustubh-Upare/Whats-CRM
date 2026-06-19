package models

import (
	"encoding/json"
	"time"
)

type AdminUser struct {
	ID          int64      `json:"id"`
	Email       string     `json:"email"`
	PasswordHash string    `json:"-"`
	Name        string     `json:"name"`
	Role        string     `json:"role"`
	IsActive    bool       `json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

type Retailer struct {
	ID             int64      `json:"id"`
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
	ID            int64           `json:"id"`
	Direction     string          `json:"direction"` // "outbound" | "inbound"
	Body          string          `json:"body"`      // rendered text for outbound, raw text for inbound
	Status        string          `json:"status"`
	OccurredAt    time.Time       `json:"occurred_at"`
	TemplateName  string          `json:"template_name,omitempty"`
	LanguageCode  string          `json:"language_code,omitempty"`
	LastError     *string         `json:"last_error,omitempty"`
	ProviderMsgID *string         `json:"provider_msg_id,omitempty"`
	InvoiceNumber *string         `json:"invoice_number,omitempty"`
	Amount        *float64        `json:"amount,omitempty"`
	MessageJobID  int64           `json:"message_job_id"`
}

type Template struct {
	ID            int64           `json:"id"`
	Name          string          `json:"name"`
	LanguageCode  string          `json:"language_code"`
	Category      string          `json:"category"`
	Body          string          `json:"body"`
	VariableCount int             `json:"variable_count"`
	SamplePayload json.RawMessage `json:"sample_payload,omitempty"`
	IsActive      bool            `json:"is_active"`
	CreatedAt     time.Time       `json:"created_at"`
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
