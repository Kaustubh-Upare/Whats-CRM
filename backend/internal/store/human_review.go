package store

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/whatsyitc/backend/internal/models"
)

type reviewSignalRow struct {
	RecipientID        int64
	AdminUserID        int64
	BatchID            *int64
	BatchName          string
	RetailerID         *int64
	RetailerName       string
	Phone              string
	AIStatus           string
	LastEvent          string
	LastEventAt        *time.Time
	RecipientUpdatedAt time.Time
	ConversationID     *int64
	ConversationStatus string
	HandoffReason      string
	HandedOffAt        *time.Time
	LastMessageRole    string
	LastMessageContent string
	LastMessageAt      *time.Time
	LastSendStatus     string
	LastSendError      string
	EnrollmentStatus   string
	PauseReason        string
	PauseDetail        string
	PausedAt           *time.Time
	NextRunAt          *time.Time
}

type reviewCandidate struct {
	Severity           string
	PriorityScore      int
	ReasonCode         string
	ReasonLabel        string
	ReasonDetail       string
	SuggestedAction    string
	Labels             []string
	LastMessagePreview string
	SignalHash         string
}

// RefreshAIHumanReviewQueue recomputes deterministic review signals for the
// current admin. It spends zero LLM tokens: the goal is to keep the review
// inbox fast and fresh while reserving AI calls for explicit "help me reply"
// actions.
func (s *Store) RefreshAIHumanReviewQueue(ctx context.Context, adminUserID int64, maxRows int) (int, error) {
	rows, err := s.loadReviewSignalRows(ctx, adminUserID, "", maxRows)
	if err != nil {
		return 0, err
	}
	changed := 0
	for _, row := range rows {
		if cand, ok := classifyReviewSignal(row, time.Now().UTC()); ok {
			if err := s.upsertAIHumanReviewCandidate(ctx, row, cand); err != nil {
				return changed, err
			}
			if err := s.upsertAIWorkflowStateForRow(ctx, row, &cand, nil, "human_review_rules"); err != nil {
				return changed, err
			}
			changed++
		} else if err := s.resolveAIHumanReviewByRecipient(ctx, adminUserID, row.RecipientID); err != nil {
			return changed, err
		} else if err := s.upsertAIWorkflowStateForRow(ctx, row, nil, nil, "human_review_rules"); err != nil {
			return changed, err
		}
	}
	return changed, nil
}

// RefreshAIHumanReviewForPhone is the lightweight webhook hook. It updates
// only the rows that could have changed after one inbound WhatsApp message.
func (s *Store) RefreshAIHumanReviewForPhone(ctx context.Context, adminUserID int64, phone string) (int, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" || adminUserID <= 0 {
		return 0, nil
	}
	rows, err := s.loadReviewSignalRows(ctx, adminUserID, phone, 50)
	if err != nil {
		return 0, err
	}
	changed := 0
	for _, row := range rows {
		if cand, ok := classifyReviewSignal(row, time.Now().UTC()); ok {
			if err := s.upsertAIHumanReviewCandidate(ctx, row, cand); err != nil {
				return changed, err
			}
			if err := s.upsertAIWorkflowStateForRow(ctx, row, &cand, nil, "phone_rules"); err != nil {
				return changed, err
			}
			changed++
		} else if err := s.resolveAIHumanReviewByRecipient(ctx, adminUserID, row.RecipientID); err != nil {
			return changed, err
		} else if err := s.upsertAIWorkflowStateForRow(ctx, row, nil, nil, "phone_rules"); err != nil {
			return changed, err
		}
	}
	return changed, nil
}

// SaveAIHumanReviewSignalForPhone persists the internal review judgement that
// was produced during an existing AI reply/follow-up LLM call. This is the
// token-saving path: the customer response and operator signal come from the
// same model pass.
func (s *Store) SaveAIHumanReviewSignalForPhone(ctx context.Context, adminUserID int64, phone string, signal models.AIHumanReviewSignal) (int, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" || adminUserID <= 0 {
		return 0, nil
	}
	signal = normalizeAIHumanReviewSignal(signal)
	rows, err := s.loadReviewSignalRows(ctx, adminUserID, phone, 50)
	if err != nil {
		return 0, err
	}
	changed := 0
	for _, row := range rows {
		if signal.RequiresReview {
			if err := s.upsertAIHumanReviewAISignal(ctx, row, signal); err != nil {
				return changed, err
			}
			if err := s.upsertAIWorkflowStateForRow(ctx, row, nil, &signal, "llm_inline"); err != nil {
				return changed, err
			}
			changed++
			continue
		}
		if err := s.resolveAIHumanReviewByRecipientFromAISignal(ctx, adminUserID, row.RecipientID); err != nil {
			return changed, err
		}
		if err := s.upsertAIWorkflowStateForRow(ctx, row, nil, &signal, "llm_inline"); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}

func (s *Store) loadReviewSignalRows(ctx context.Context, adminUserID int64, phone string, limit int) ([]reviewSignalRow, error) {
	if limit <= 0 || limit > 5000 {
		limit = 2000
	}
	args := []any{adminUserID}
	where := []string{"r.admin_user_id = $1"}
	if phone = strings.TrimSpace(phone); phone != "" {
		args = append(args, phone)
		where = append(where, fmt.Sprintf("r.whatsapp_number = $%d", len(args)))
	}
	args = append(args, limit)
	sql := fmt.Sprintf(`
		SELECT r.id,
		       r.admin_user_id,
		       r.batch_id,
		       COALESCE(NULLIF(b.display_name, ''), NULLIF(b.file_name, ''), 'Batch #' || r.batch_id::text) AS batch_name,
		       r.retailer_id,
		       COALESCE(ret.retailer_name, '') AS retailer_name,
		       r.whatsapp_number,
		       r.ai_status,
		       COALESCE(r.last_event, '') AS last_event,
		       r.last_event_at,
		       r.updated_at,
		       conv.id AS conversation_id,
		       COALESCE(conv.status, '') AS conversation_status,
		       COALESCE(conv.handoff_reason, '') AS handoff_reason,
		       conv.handed_off_at,
		       COALESCE(last_msg.role, '') AS last_message_role,
		       COALESCE(last_msg.content, '') AS last_message_content,
		       last_msg.created_at AS last_message_at,
		       COALESCE(last_msg.send_status, '') AS last_send_status,
		       COALESCE(last_msg.send_error, '') AS last_send_error,
		       COALESCE(enr.status, '') AS enrollment_status,
		       COALESCE(enr.pause_reason, '') AS pause_reason,
		       COALESCE(enr.pause_detail, '') AS pause_detail,
		       enr.paused_at,
		       enr.next_run_at
		  FROM bc_batch_ai_recipients r
		  LEFT JOIN bc_upload_batches b ON b.id = r.batch_id
		  LEFT JOIN bc_retailers ret ON ret.id = r.retailer_id
		  LEFT JOIN LATERAL (
		    SELECT id, status, handoff_reason, handed_off_at
		      FROM bc_ai_conversation_states
		     WHERE admin_user_id = r.admin_user_id
		       AND phone = r.whatsapp_number
		     ORDER BY updated_at DESC, id DESC
		     LIMIT 1
		  ) AS conv ON TRUE
		  LEFT JOIN LATERAL (
		    SELECT role, content, created_at, send_status, send_error
		      FROM bc_ai_conversation_messages
		     WHERE admin_user_id = r.admin_user_id
		       AND phone = r.whatsapp_number
		     ORDER BY created_at DESC, id DESC
		     LIMIT 1
		  ) AS last_msg ON TRUE
		  LEFT JOIN LATERAL (
		    SELECT e.status, e.pause_reason, e.pause_detail, e.paused_at, e.next_run_at
		      FROM bc_crm_sequence_enrollments e
		      LEFT JOIN bc_crm_leads l ON l.id = e.lead_id AND l.admin_user_id = e.admin_user_id
		     WHERE e.admin_user_id = r.admin_user_id
		       AND e.mode IN ('ai_followup', 'agentic_followup')
		       AND (
		         e.source_batch_recipient_id = r.id
		         OR (e.source_batch_id = r.batch_id AND l.phone = r.whatsapp_number)
		         OR (e.source_batch_id IS NULL AND l.phone = r.whatsapp_number)
		       )
		     ORDER BY
		       CASE e.status WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
		       COALESCE(e.paused_at, e.next_run_at, e.created_at) DESC,
		       e.id DESC
		     LIMIT 1
		  ) AS enr ON TRUE
		 WHERE %s
		 ORDER BY COALESCE(last_msg.created_at, r.last_event_at, r.updated_at) DESC
		 LIMIT $%d
	`, strings.Join(where, " AND "), len(args))

	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []reviewSignalRow{}
	for rows.Next() {
		var r reviewSignalRow
		if err := rows.Scan(
			&r.RecipientID,
			&r.AdminUserID,
			&r.BatchID,
			&r.BatchName,
			&r.RetailerID,
			&r.RetailerName,
			&r.Phone,
			&r.AIStatus,
			&r.LastEvent,
			&r.LastEventAt,
			&r.RecipientUpdatedAt,
			&r.ConversationID,
			&r.ConversationStatus,
			&r.HandoffReason,
			&r.HandedOffAt,
			&r.LastMessageRole,
			&r.LastMessageContent,
			&r.LastMessageAt,
			&r.LastSendStatus,
			&r.LastSendError,
			&r.EnrollmentStatus,
			&r.PauseReason,
			&r.PauseDetail,
			&r.PausedAt,
			&r.NextRunAt,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func classifyReviewSignal(row reviewSignalRow, now time.Time) (reviewCandidate, bool) {
	status := strings.ToLower(strings.TrimSpace(row.AIStatus))
	convStatus := strings.ToLower(strings.TrimSpace(row.ConversationStatus))
	pauseReason := strings.ToLower(strings.TrimSpace(row.PauseReason))
	sendStatus := strings.ToLower(strings.TrimSpace(row.LastSendStatus))
	sendErr := strings.TrimSpace(row.LastSendError)
	preview := compactReviewText(row.LastMessageContent, 260)
	if preview == "" {
		preview = compactReviewText(row.LastEvent, 260)
	}

	c := reviewCandidate{
		Severity:           "medium",
		PriorityScore:      50,
		LastMessagePreview: preview,
		Labels:             []string{},
	}
	set := func(score int, severity, code, label, detail, action string, labels ...string) {
		c.PriorityScore = score
		c.Severity = severity
		c.ReasonCode = code
		c.ReasonLabel = label
		c.ReasonDetail = detail
		c.SuggestedAction = action
		c.Labels = append(c.Labels, labels...)
	}

	switch {
	case status == "failed" || pauseReason == "send_failed" || sendStatus == "failed":
		detail := "A WhatsApp send failed for this phone. Review the failure before the next automated touch."
		if sendErr != "" {
			detail = compactReviewText(sendErr, 220)
		} else if strings.TrimSpace(row.PauseDetail) != "" {
			detail = compactReviewText(row.PauseDetail, 220)
		}
		set(98, "critical", "send_failed", "Send failed", detail,
			"Open the timeline, fix credentials/template/number issues, then retry only this phone.", "send_failed", "delivery_blocked")
	case pauseReason == "no_sender":
		detail := "WhatsApp sender credentials are missing or invalid for this admin, so AI cannot send follow-ups."
		if strings.TrimSpace(row.PauseDetail) != "" {
			detail = compactReviewText(row.PauseDetail, 220)
		}
		set(97, "critical", "sender_missing", "Sender missing", detail,
			"Fix the WhatsApp sender/token setup, then resume or retry this follow-up.", "setup_issue", "delivery_blocked")
	case pauseReason == "no_followup_generator":
		detail := "The AI follow-up generator is not configured, so the scheduled AI message could not be created."
		if strings.TrimSpace(row.PauseDetail) != "" {
			detail = compactReviewText(row.PauseDetail, 220)
		}
		set(96, "critical", "ai_generator_missing", "AI generator missing", detail,
			"Check Bedrock/LLM configuration, then resume the follow-up after the model is available.", "setup_issue", "ai_config")
	case containsAny(pauseReason, "lead_missing", "step_load_failed", "next_step_load_failed"):
		detail := "The follow-up sequence could not load the lead or timeline step it needs."
		if strings.TrimSpace(row.PauseDetail) != "" {
			detail = compactReviewText(row.PauseDetail, 220)
		}
		set(90, "high", "followup_setup_issue", "Follow-up setup issue", detail,
			"Open the batch setup, check the lead and timeline, then resume once the sequence is valid.", "setup_issue")
	case status == "handed_off" || convStatus == "handed_off":
		detail := "AI marked this conversation for human attention."
		if strings.TrimSpace(row.HandoffReason) != "" {
			detail = compactReviewText(row.HandoffReason, 220)
		}
		set(94, "critical", "human_needed", "Human needed", detail,
			"Read the latest messages, answer manually, then hand back to AI when safe.", "human_needed")
	case strings.EqualFold(row.LastMessageRole, "user"):
		text := strings.ToLower(row.LastMessageContent)
		switch {
		case containsAny(text, "refund", "complaint", "angry", "wrong", "bad", "not received", "delay", "late", "damaged", "missing", "cancel order", "cancel my"):
			set(93, "critical", "complaint", "Complaint / risk", "The buyer message looks like a complaint or service issue.",
				"Reply personally, acknowledge the issue, and pause automation until it is handled.", "complaint", "human_needed")
		case containsAny(text, "human", "person", "call me", "call back", "phone call", "talk to", "manager", "agent", "owner", "support"):
			set(91, "critical", "human_requested", "Human requested", "The buyer appears to be asking for a person.",
				"Take over the chat and respond as a human before AI continues.", "human_needed")
		case containsAny(text, "price", "pricing", "cost", "rate", "rates", "how much", "discount", "offer", "mrp", "wholesale", "kitna", "kitne", "daam", "bhav"):
			set(88, "high", "price_question", "Price question", "The latest buyer reply is asking about price, cost, discount, or an offer.",
				"Use AI help to draft a price-aware answer, then send or adjust it manually.", "price_question", "warm_lead")
		case containsAny(text, "buy", "order", "interested", "available", "availability", "stock", "want", "send me", "catalog", "catalogue", "cod", "delivery", "urgent", "asap", "today"):
			set(86, "high", "hot_lead", "Hot lead", "The buyer is showing purchase intent or availability interest.",
				"Reply quickly with the next step, product detail, or ordering path.", "hot_lead", "warm_lead")
		default:
			set(82, "high", "buyer_replied", "Buyer replied", "The latest visible message came from the buyer.",
				"Open the conversation and decide whether AI should continue or a human should answer.", "buyer_replied")
		}
		if row.LastMessageAt != nil {
			age := now.Sub(*row.LastMessageAt)
			if age >= 12*time.Hour {
				c.PriorityScore += 8
				c.Labels = append(c.Labels, "waiting_over_12h")
				c.ReasonDetail += " It has been waiting for more than 12 hours."
			} else if age >= 4*time.Hour {
				c.PriorityScore += 4
				c.Labels = append(c.Labels, "waiting_over_4h")
			}
		}
	case status == "pending" && strings.TrimSpace(row.LastMessageContent) == "":
		score := 45
		severity := "low"
		detail := "This phone is tracked by AI but has not received a visible AI follow-up yet."
		if row.NextRunAt != nil && row.NextRunAt.Before(now) {
			score = 62
			severity = "medium"
			detail = "The first AI touch appears due or overdue."
		}
		set(score, severity, "first_touch_due", "First touch due", detail,
			"Review the planned first message or send the next step when ready.", "first_touch")
	default:
		return reviewCandidate{}, false
	}

	if c.PriorityScore > 100 {
		c.PriorityScore = 100
	}
	c.Labels = normalizeReviewLabels(c.Labels)
	c.SignalHash = reviewSignalHash(row, c)
	return c, true
}

func (s *Store) upsertAIHumanReviewCandidate(ctx context.Context, row reviewSignalRow, cand reviewCandidate) error {
	labels := encodeJSONList(cand.Labels)
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_ai_human_review_items (
			admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
			retailer_id, phone, retailer_name, batch_name,
			status, severity, priority_score, reason_code, reason_label,
			reason_detail, suggested_action, labels,
			last_message_preview, last_message_role, last_message_at, last_event_at,
			source, signal_hash
		)
		VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			'open', $9, $10, $11, $12,
			$13, $14, $15::jsonb,
			$16, $17, $18, $19,
			'rules', $20
		)
		ON CONFLICT (admin_user_id, batch_ai_recipient_id)
		DO UPDATE SET
			batch_id = EXCLUDED.batch_id,
			conversation_id = EXCLUDED.conversation_id,
			retailer_id = EXCLUDED.retailer_id,
			phone = EXCLUDED.phone,
			retailer_name = EXCLUDED.retailer_name,
			batch_name = EXCLUDED.batch_name,
			status = CASE
				WHEN bc_ai_human_review_items.status = 'resolved'
				 AND bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.status
				ELSE 'open'
			END,
			resolved_at = CASE
				WHEN bc_ai_human_review_items.status = 'resolved'
				 AND bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.resolved_at
				ELSE NULL
			END,
			snoozed_until = CASE
				WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.snoozed_until
				ELSE NULL
			END,
			severity = EXCLUDED.severity,
			priority_score = EXCLUDED.priority_score,
			reason_code = EXCLUDED.reason_code,
			reason_label = EXCLUDED.reason_label,
			reason_detail = EXCLUDED.reason_detail,
			suggested_action = EXCLUDED.suggested_action,
			labels = EXCLUDED.labels,
			last_message_preview = EXCLUDED.last_message_preview,
			last_message_role = EXCLUDED.last_message_role,
			last_message_at = EXCLUDED.last_message_at,
			last_event_at = EXCLUDED.last_event_at,
			source = EXCLUDED.source,
			ai_summary = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_summary ELSE '' END,
			ai_suggested_reply = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_suggested_reply ELSE '' END,
			ai_next_action = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_next_action ELSE '' END,
			ai_model = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_model ELSE '' END,
			ai_provider = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_provider ELSE '' END,
			ai_generated_at = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_generated_at ELSE NULL END,
			ai_error = CASE WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash THEN bc_ai_human_review_items.ai_error ELSE '' END,
			signal_hash = EXCLUDED.signal_hash
	`, row.AdminUserID, row.BatchID, row.RecipientID, row.ConversationID,
		row.RetailerID, row.Phone, strings.TrimSpace(row.RetailerName), strings.TrimSpace(row.BatchName),
		cand.Severity, cand.PriorityScore, cand.ReasonCode, cand.ReasonLabel,
		cand.ReasonDetail, cand.SuggestedAction, labels,
		cand.LastMessagePreview, strings.TrimSpace(row.LastMessageRole), row.LastMessageAt, row.LastEventAt,
		cand.SignalHash)
	return err
}

func (s *Store) upsertAIHumanReviewAISignal(ctx context.Context, row reviewSignalRow, signal models.AIHumanReviewSignal) error {
	labels := encodeJSONList(signal.Labels)
	preview := compactReviewText(row.LastMessageContent, 260)
	if preview == "" {
		preview = compactReviewText(row.LastEvent, 260)
	}
	source := strings.TrimSpace(signal.Source)
	if source == "" {
		source = "llm_inline"
	}
	signalHash := aiReviewSignalHash(row, signal)
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_ai_human_review_items (
			admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
			retailer_id, phone, retailer_name, batch_name,
			status, severity, priority_score, reason_code, reason_label,
			reason_detail, suggested_action, labels,
			last_message_preview, last_message_role, last_message_at, last_event_at,
			source, signal_hash,
			ai_summary, ai_suggested_reply, ai_next_action,
			ai_model, ai_provider, ai_generated_at, ai_error
		)
		VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			'open', $9, $10, $11, $12,
			$13, $14, $15::jsonb,
			$16, $17, $18, $19,
			$20, $21,
			$22, $23, $24,
			$25, $26, now(), ''
		)
		ON CONFLICT (admin_user_id, batch_ai_recipient_id)
		DO UPDATE SET
			batch_id = EXCLUDED.batch_id,
			conversation_id = EXCLUDED.conversation_id,
			retailer_id = EXCLUDED.retailer_id,
			phone = EXCLUDED.phone,
			retailer_name = EXCLUDED.retailer_name,
			batch_name = EXCLUDED.batch_name,
			status = CASE
				WHEN bc_ai_human_review_items.status = 'resolved'
				 AND bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.status
				ELSE 'open'
			END,
			resolved_at = CASE
				WHEN bc_ai_human_review_items.status = 'resolved'
				 AND bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.resolved_at
				ELSE NULL
			END,
			snoozed_until = CASE
				WHEN bc_ai_human_review_items.signal_hash = EXCLUDED.signal_hash
				THEN bc_ai_human_review_items.snoozed_until
				ELSE NULL
			END,
			severity = EXCLUDED.severity,
			priority_score = EXCLUDED.priority_score,
			reason_code = EXCLUDED.reason_code,
			reason_label = EXCLUDED.reason_label,
			reason_detail = EXCLUDED.reason_detail,
			suggested_action = EXCLUDED.suggested_action,
			labels = EXCLUDED.labels,
			last_message_preview = EXCLUDED.last_message_preview,
			last_message_role = EXCLUDED.last_message_role,
			last_message_at = EXCLUDED.last_message_at,
			last_event_at = EXCLUDED.last_event_at,
			source = EXCLUDED.source,
			ai_summary = EXCLUDED.ai_summary,
			ai_suggested_reply = EXCLUDED.ai_suggested_reply,
			ai_next_action = EXCLUDED.ai_next_action,
			ai_model = EXCLUDED.ai_model,
			ai_provider = EXCLUDED.ai_provider,
			ai_generated_at = now(),
			ai_error = '',
			signal_hash = EXCLUDED.signal_hash
	`, row.AdminUserID, row.BatchID, row.RecipientID, row.ConversationID,
		row.RetailerID, row.Phone, strings.TrimSpace(row.RetailerName), strings.TrimSpace(row.BatchName),
		signal.Severity, signal.PriorityScore, signal.ReasonCode, signal.ReasonLabel,
		signal.ReasonDetail, signal.SuggestedAction, labels,
		preview, strings.TrimSpace(row.LastMessageRole), row.LastMessageAt, row.LastEventAt,
		source, signalHash,
		compactReviewText(signal.Summary, 1200), compactReviewText(signal.SuggestedReply, 1600), compactReviewText(signal.NextAction, 500),
		strings.TrimSpace(signal.Model), strings.TrimSpace(signal.Provider))
	return err
}

func (s *Store) resolveAIHumanReviewByRecipient(ctx context.Context, adminUserID, recipientID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_human_review_items
		   SET status = 'resolved',
		       resolved_at = COALESCE(resolved_at, now())
		 WHERE admin_user_id = $1
		   AND batch_ai_recipient_id = $2
		   AND status = 'open'
		   AND COALESCE(source, '') <> 'llm_inline'
	`, adminUserID, recipientID)
	return err
}

func (s *Store) resolveAIHumanReviewByRecipientFromAISignal(ctx context.Context, adminUserID, recipientID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_human_review_items
		   SET status = 'resolved',
		       resolved_at = COALESCE(resolved_at, now())
		 WHERE admin_user_id = $1
		   AND batch_ai_recipient_id = $2
		   AND status = 'open'
		   AND COALESCE(reason_code, '') NOT IN (
		       'send_failed',
		       'sender_missing',
		       'ai_generator_missing',
		       'followup_setup_issue',
		       'human_needed',
		       'human_requested',
		       'complaint'
		   )
	`, adminUserID, recipientID)
	return err
}

func (s *Store) ListAIHumanReviewItems(
	ctx context.Context,
	adminUserID int64,
	status, reason, severity, search string,
	limit, offset int,
) (models.AIHumanReviewList, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = "open"
	}
	reason = strings.TrimSpace(reason)
	severity = strings.TrimSpace(severity)
	search = strings.TrimSpace(search)

	args := []any{adminUserID}
	where := []string{"admin_user_id = $1"}
	if status != "all" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if reason != "" && reason != "all" {
		args = append(args, reason)
		where = append(where, fmt.Sprintf("reason_code = $%d", len(args)))
	}
	if severity != "" && severity != "all" {
		args = append(args, severity)
		where = append(where, fmt.Sprintf("severity = $%d", len(args)))
	}
	if search != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search) + "%"
		args = append(args, like)
		where = append(where, fmt.Sprintf(
			"(phone ILIKE $%d ESCAPE '\\' OR retailer_name ILIKE $%d ESCAPE '\\' OR batch_name ILIKE $%d ESCAPE '\\' OR reason_label ILIKE $%d ESCAPE '\\' OR last_message_preview ILIKE $%d ESCAPE '\\')",
			len(args), len(args), len(args), len(args), len(args),
		))
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")
	orderSQL := humanReviewPriorityOrderSQL()
	phoneKeySQL := humanReviewPhoneKeySQL()

	var total int
	if err := s.DB.QueryRow(ctx, fmt.Sprintf(`
		WITH ranked AS (
			SELECT phone,
			       ROW_NUMBER() OVER (PARTITION BY %s ORDER BY %s) AS phone_rank
			  FROM bc_ai_human_review_items
			 %s
		)
		SELECT COUNT(*)::int FROM ranked WHERE phone_rank = 1
	`, phoneKeySQL, orderSQL, whereSQL), args...).Scan(&total); err != nil {
		return models.AIHumanReviewList{}, err
	}

	stats, err := s.AIHumanReviewStats(ctx, adminUserID)
	if err != nil {
		return models.AIHumanReviewList{}, err
	}

	args = append(args, limit, offset)
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
		WITH ranked AS (
		SELECT id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       status, severity, priority_score, reason_code, reason_label,
		       reason_detail, suggested_action, labels,
		       last_message_preview, last_message_role, last_message_at, last_event_at,
		       source, ai_summary, ai_suggested_reply, ai_next_action,
		       ai_model, ai_provider, ai_generated_at, ai_error,
		       snoozed_until, resolved_at, created_at, updated_at,
		       ROW_NUMBER() OVER (PARTITION BY %s ORDER BY %s) AS phone_rank
		  FROM bc_ai_human_review_items
		 %s
		)
		SELECT id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       status, severity, priority_score, reason_code, reason_label,
		       reason_detail, suggested_action, labels,
		       last_message_preview, last_message_role, last_message_at, last_event_at,
		       source, ai_summary, ai_suggested_reply, ai_next_action,
		       ai_model, ai_provider, ai_generated_at, ai_error,
		       snoozed_until, resolved_at, created_at, updated_at
		  FROM ranked
		 WHERE phone_rank = 1
		 ORDER BY
		   %s
		 LIMIT $%d OFFSET $%d
	`, phoneKeySQL, orderSQL, whereSQL, orderSQL, len(args)-1, len(args)), args...)
	if err != nil {
		return models.AIHumanReviewList{}, err
	}
	defer rows.Close()

	items := []models.AIHumanReviewItem{}
	for rows.Next() {
		item, err := scanAIHumanReviewItem(rows)
		if err != nil {
			return models.AIHumanReviewList{}, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return models.AIHumanReviewList{}, err
	}
	return models.AIHumanReviewList{Items: items, Total: total, Stats: stats}, nil
}

func (s *Store) AIHumanReviewStats(ctx context.Context, adminUserID int64) (models.AIHumanReviewStats, error) {
	stats := models.AIHumanReviewStats{ByReason: map[string]int{}}
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
		WITH ranked AS (
			SELECT phone, reason_code, severity,
			       ROW_NUMBER() OVER (PARTITION BY %s ORDER BY %s) AS phone_rank
			  FROM bc_ai_human_review_items
			 WHERE admin_user_id = $1
			   AND status = 'open'
		)
		SELECT reason_code, severity, COUNT(*)::int
		  FROM ranked
		 WHERE phone_rank = 1
		 GROUP BY reason_code, severity
	`, humanReviewPhoneKeySQL(), humanReviewPriorityOrderSQL()), adminUserID)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	for rows.Next() {
		var reason, severity string
		var count int
		if err := rows.Scan(&reason, &severity, &count); err != nil {
			return stats, err
		}
		stats.Open += count
		stats.ByReason[reason] += count
		switch severity {
		case "critical":
			stats.Critical += count
		case "high":
			stats.High += count
		case "medium":
			stats.Medium += count
		case "low":
			stats.Low += count
		}
		switch reason {
		case "buyer_replied":
			stats.BuyerReplies += count
		case "human_needed", "human_requested", "complaint":
			stats.HumanNeeded += count
		case "send_failed":
			stats.FailedSends += count
		case "price_question":
			stats.PriceQuestions += count
		case "hot_lead":
			stats.HotLeads += count
		}
	}
	return stats, rows.Err()
}

func (s *Store) GetAIHumanReviewItem(ctx context.Context, adminUserID, id int64) (*models.AIHumanReviewItem, error) {
	row := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       status, severity, priority_score, reason_code, reason_label,
		       reason_detail, suggested_action, labels,
		       last_message_preview, last_message_role, last_message_at, last_event_at,
		       source, ai_summary, ai_suggested_reply, ai_next_action,
		       ai_model, ai_provider, ai_generated_at, ai_error,
		       snoozed_until, resolved_at, created_at, updated_at
		  FROM bc_ai_human_review_items
		 WHERE id = $1 AND admin_user_id = $2
	`, id, adminUserID)
	item, err := scanAIHumanReviewItem(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return item, err
}

func (s *Store) ResolveAIHumanReviewItem(ctx context.Context, adminUserID, id int64) (*models.AIHumanReviewItem, error) {
	var phone string
	if err := s.DB.QueryRow(ctx, `
		SELECT phone
		  FROM bc_ai_human_review_items
		 WHERE id = $1 AND admin_user_id = $2
	`, id, adminUserID).Scan(&phone); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	phoneKey := normalizeReviewPhoneKey(phone)
	if phoneKey == "" {
		return s.GetAIHumanReviewItem(ctx, adminUserID, id)
	}
	if _, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_human_review_items
		   SET status = 'resolved',
		       resolved_at = COALESCE(resolved_at, now())
		 WHERE admin_user_id = $1
		   AND COALESCE(NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), ''), lower(trim(COALESCE(phone, '')))) = $2
		   AND status = 'open'
	`, adminUserID, phoneKey); err != nil {
		return nil, err
	}
	item, err := s.GetAIHumanReviewItem(ctx, adminUserID, id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return item, err
}

func humanReviewPriorityOrderSQL() string {
	return `CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
		   priority_score DESC,
		   COALESCE(last_message_at, last_event_at, updated_at) DESC,
		   id DESC`
}

func humanReviewPhoneKeySQL() string {
	return `COALESCE(NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), ''), lower(trim(COALESCE(phone, ''))))`
}

func (s *Store) SaveAIHumanReviewAdvice(
	ctx context.Context,
	adminUserID, id int64,
	summary, suggestedReply, nextAction, model, provider, aiErr string,
) (*models.AIHumanReviewItem, error) {
	summary = compactReviewText(summary, 1200)
	suggestedReply = compactReviewText(suggestedReply, 1600)
	nextAction = compactReviewText(nextAction, 500)
	aiErr = compactReviewText(aiErr, 600)
	row := s.DB.QueryRow(ctx, `
		UPDATE bc_ai_human_review_items
		   SET ai_summary = $3,
		       ai_suggested_reply = $4,
		       ai_next_action = $5,
		       ai_model = $6,
		       ai_provider = $7,
		       ai_error = $8,
		       ai_generated_at = CASE WHEN $8 = '' THEN now() ELSE ai_generated_at END
		 WHERE id = $1 AND admin_user_id = $2
		 RETURNING id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       status, severity, priority_score, reason_code, reason_label,
		       reason_detail, suggested_action, labels,
		       last_message_preview, last_message_role, last_message_at, last_event_at,
		       source, ai_summary, ai_suggested_reply, ai_next_action,
		       ai_model, ai_provider, ai_generated_at, ai_error,
		       snoozed_until, resolved_at, created_at, updated_at
	`, id, adminUserID, summary, suggestedReply, nextAction, model, provider, aiErr)
	item, err := scanAIHumanReviewItem(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return item, err
}

func (s *Store) ListAIReviewRecentMessagesForPhone(ctx context.Context, adminUserID int64, phone string, limit int) ([]models.AIConversationMessage, error) {
	if limit != 10 && limit != 20 {
		limit = 20
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, role, content, coalesce(model_used, ''), coalesce(provider, ''),
		       coalesce(provider_msg_id, ''), coalesce(send_status, ''), coalesce(send_error, ''),
		       coalesce(tokens_in, 0), coalesce(tokens_out, 0), coalesce(cost_usd, 0),
		       coalesce(latency_ms, 0), is_voice, coalesce(tool_summary, ''), sent_at, created_at
		  FROM (
		    SELECT *
		      FROM bc_ai_conversation_messages
		     WHERE admin_user_id = $1
		       AND phone = $2
		     ORDER BY created_at DESC, id DESC
		     LIMIT $3
		  ) m
		 ORDER BY created_at ASC, id ASC
	`, adminUserID, strings.TrimSpace(phone), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AIConversationMessage{}
	for rows.Next() {
		msg, err := scanLocalAIConversationMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *msg)
	}
	return out, rows.Err()
}

func scanAIHumanReviewItem(row rowScanner) (*models.AIHumanReviewItem, error) {
	var item models.AIHumanReviewItem
	var labelsRaw []byte
	if err := row.Scan(
		&item.ID,
		&item.AdminUserID,
		&item.BatchID,
		&item.BatchAIRecipientID,
		&item.ConversationID,
		&item.RetailerID,
		&item.Phone,
		&item.RetailerName,
		&item.BatchName,
		&item.Status,
		&item.Severity,
		&item.PriorityScore,
		&item.ReasonCode,
		&item.ReasonLabel,
		&item.ReasonDetail,
		&item.SuggestedAction,
		&labelsRaw,
		&item.LastMessagePreview,
		&item.LastMessageRole,
		&item.LastMessageAt,
		&item.LastEventAt,
		&item.Source,
		&item.AISummary,
		&item.AISuggestedReply,
		&item.AINextAction,
		&item.AIModel,
		&item.AIProvider,
		&item.AIGeneratedAt,
		&item.AIError,
		&item.SnoozedUntil,
		&item.ResolvedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.Labels = decodeStringJSONList(labelsRaw)
	return &item, nil
}

func reviewSignalHash(row reviewSignalRow, cand reviewCandidate) string {
	lastAt := ""
	if row.LastMessageAt != nil {
		lastAt = row.LastMessageAt.UTC().Format(time.RFC3339Nano)
	}
	raw := strings.Join([]string{
		cand.ReasonCode,
		row.AIStatus,
		row.ConversationStatus,
		row.PauseReason,
		row.LastSendStatus,
		lastAt,
		cand.LastMessagePreview,
	}, "|")
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func aiReviewSignalHash(row reviewSignalRow, signal models.AIHumanReviewSignal) string {
	lastAt := ""
	if row.LastMessageAt != nil {
		lastAt = row.LastMessageAt.UTC().Format(time.RFC3339Nano)
	}
	raw := strings.Join([]string{
		"llm_inline",
		signal.ReasonCode,
		signal.Severity,
		strconv.Itoa(signal.PriorityScore),
		lastAt,
		compactReviewText(row.LastMessageContent, 260),
		compactReviewText(signal.Summary, 500),
		compactReviewText(signal.NextAction, 300),
	}, "|")
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func normalizeAIHumanReviewSignal(signal models.AIHumanReviewSignal) models.AIHumanReviewSignal {
	signal.Source = strings.TrimSpace(signal.Source)
	if signal.Source == "" {
		signal.Source = "llm_inline"
	}
	signal.ReasonCode = normalizeReviewCode(signal.ReasonCode)
	if shouldDemoteNoisyAIReview(signal) {
		signal.RequiresReview = false
		signal.Labels = normalizeReviewLabels(append(signal.Labels, signal.ReasonCode, signal.Severity, "quiet_gate"))
		if signal.ReasonLabel == "" {
			signal.ReasonLabel = defaultReviewLabel(signal.ReasonCode)
		}
		if signal.NextAction == "" {
			signal.NextAction = "Let AI continue; no human action needed unless the buyer asks for a person or the answer becomes uncertain."
		}
		return signal
	}
	if !signal.RequiresReview {
		signal.Labels = normalizeReviewLabels(append(signal.Labels, signal.ReasonCode, signal.Severity))
		return signal
	}
	signal.Severity = normalizeReviewSeverity(signal.Severity)
	if signal.PriorityScore <= 0 {
		signal.PriorityScore = defaultReviewPriority(signal.Severity)
	}
	if signal.PriorityScore > 100 {
		signal.PriorityScore = 100
	}
	if signal.ReasonCode == "" || signal.ReasonCode == "none" {
		signal.ReasonCode = "ai_review"
	}
	signal.ReasonLabel = compactReviewText(signal.ReasonLabel, 80)
	if signal.ReasonLabel == "" {
		signal.ReasonLabel = defaultReviewLabel(signal.ReasonCode)
	}
	signal.ReasonDetail = compactReviewText(signal.ReasonDetail, 500)
	if signal.ReasonDetail == "" {
		signal.ReasonDetail = "The AI found this phone worth operator attention while generating its reply."
	}
	signal.SuggestedAction = compactReviewText(signal.SuggestedAction, 500)
	if signal.SuggestedAction == "" {
		signal.SuggestedAction = "Open the timeline, check the AI response, and decide whether a human should step in."
	}
	signal.Labels = normalizeReviewLabels(append(signal.Labels, signal.ReasonCode, signal.Severity))
	return signal
}

func shouldDemoteNoisyAIReview(signal models.AIHumanReviewSignal) bool {
	if !signal.RequiresReview {
		return false
	}
	code := normalizeReviewCode(signal.ReasonCode)
	if code == "" {
		return false
	}
	if normalizeReviewSeverity(signal.Severity) == "critical" {
		return false
	}
	labels := strings.ToLower(strings.Join(signal.Labels, " "))
	detail := strings.ToLower(strings.Join([]string{
		signal.ReasonDetail,
		signal.SuggestedAction,
		signal.Summary,
		signal.NextAction,
		labels,
	}, " "))
	if containsAny(detail, "human_needed", "human requested", "asked for human", "complaint", "refund", "payment issue", "delivery issue", "send failed", "low confidence", "cannot answer", "not confident") {
		return false
	}
	switch code {
	case "hot_lead", "price_question", "meeting_request", "product_confusion":
		return true
	default:
		return false
	}
}

func normalizeReviewSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical", "high", "medium", "low":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "medium"
	}
}

func defaultReviewPriority(severity string) int {
	switch normalizeReviewSeverity(severity) {
	case "critical":
		return 95
	case "high":
		return 85
	case "low":
		return 35
	default:
		return 60
	}
}

func normalizeReviewCode(value string) string {
	clean := strings.ToLower(strings.TrimSpace(value))
	clean = strings.NewReplacer(" ", "_", "-", "_", ".", "_", "/", "_").Replace(clean)
	var b strings.Builder
	for _, r := range clean {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), "_")
}

func defaultReviewLabel(code string) string {
	switch code {
	case "hot_lead":
		return "Hot lead"
	case "price_question":
		return "Price question"
	case "human_needed", "human_requested":
		return "Human needed"
	case "product_confusion":
		return "Product confusion"
	case "complaint":
		return "Complaint / risk"
	default:
		return "AI review"
	}
}

func containsAny(s string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

func normalizeReviewLabels(labels []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, label := range labels {
		clean := strings.ToLower(strings.TrimSpace(label))
		clean = strings.NewReplacer(" ", "_", "-", "_").Replace(clean)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func compactReviewText(value string, maxLen int) string {
	clean := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if maxLen <= 0 || len([]rune(clean)) <= maxLen {
		return clean
	}
	runes := []rune(clean)
	return strings.TrimSpace(string(runes[:maxLen-1])) + "..."
}

func normalizeReviewPhoneKey(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return ""
	}
	var digits strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	if digits.Len() > 0 {
		return digits.String()
	}
	return strings.ToLower(phone)
}
