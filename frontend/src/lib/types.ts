// Domain types matching the Go backend DTOs.

export interface AdminUser {
  id: number
  email: string
  name: string
  role: string
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
