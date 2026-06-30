package store

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/whatsyitc/backend/internal/models"
)

type workflowDecision struct {
	State              string
	StateLabel         string
	StateReason        string
	NextAction         string
	NextMessagePreview string
	ConfidenceScore    int
	RiskLevel          string
	BuyerIntent        string
	KnowledgeMatched   bool
	KnowledgeRefs      []string
	Quality            map[string]any
	Source             string
	SignalHash         string
	DecisionType       string
	DecisionTitle      string
	Model              string
	Provider           string
}

func (s *Store) RefreshAIWorkflowQueue(ctx context.Context, adminUserID int64, maxRows int) (int, error) {
	rows, err := s.loadReviewSignalRows(ctx, adminUserID, "", maxRows)
	if err != nil {
		return 0, err
	}
	changed := 0
	for _, row := range rows {
		cand, hasCandidate := classifyReviewSignal(row, time.Now().UTC())
		var candPtr *reviewCandidate
		if hasCandidate {
			candPtr = &cand
		}
		if err := s.upsertAIWorkflowStateForRow(ctx, row, candPtr, nil, "rules_refresh"); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}

func (s *Store) RefreshAIWorkflowForPhone(ctx context.Context, adminUserID int64, phone string) (int, error) {
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
		cand, hasCandidate := classifyReviewSignal(row, time.Now().UTC())
		var candPtr *reviewCandidate
		if hasCandidate {
			candPtr = &cand
		}
		if err := s.upsertAIWorkflowStateForRow(ctx, row, candPtr, nil, "phone_refresh"); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}

func (s *Store) SaveAIWorkflowSignalForPhone(ctx context.Context, adminUserID int64, phone string, signal models.AIHumanReviewSignal) (int, error) {
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
		if err := s.upsertAIWorkflowStateForRow(ctx, row, nil, &signal, "llm_inline"); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}

func (s *Store) ListAIWorkflowStates(
	ctx context.Context,
	adminUserID int64,
	state string,
	batchID *int64,
	search string,
	limit, offset int,
) (models.AIWorkflowList, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	state = strings.TrimSpace(state)
	search = strings.TrimSpace(search)

	args := []any{adminUserID}
	where := []string{"admin_user_id = $1"}
	if state != "" && state != "all" {
		args = append(args, state)
		where = append(where, fmt.Sprintf("state = $%d", len(args)))
	}
	if batchID != nil && *batchID > 0 {
		args = append(args, *batchID)
		where = append(where, fmt.Sprintf("batch_id = $%d", len(args)))
	}
	if search != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search) + "%"
		args = append(args, like)
		where = append(where, fmt.Sprintf("(phone ILIKE $%d ESCAPE '\\' OR retailer_name ILIKE $%d ESCAPE '\\' OR batch_name ILIKE $%d ESCAPE '\\' OR state_reason ILIKE $%d ESCAPE '\\')", len(args), len(args), len(args), len(args)))
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*)::int FROM bc_ai_workflow_states "+whereSQL, args...).Scan(&total); err != nil {
		return models.AIWorkflowList{}, err
	}
	stats, err := s.AIWorkflowStats(ctx, adminUserID, batchID)
	if err != nil {
		return models.AIWorkflowList{}, err
	}

	args = append(args, limit, offset)
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
		SELECT id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       state, state_label, state_reason, next_action, next_message_preview,
		       confidence_score, risk_level, buyer_intent, knowledge_matched,
		       knowledge_refs, quality, source, last_message_at, last_event_at,
		       created_at, updated_at
		  FROM bc_ai_workflow_states
		 %s
		 ORDER BY
		   CASE state WHEN 'needs_human' THEN 1 WHEN 'buyer_replied' THEN 2 WHEN 'paused' THEN 3 WHEN 'followup_scheduled' THEN 4 WHEN 'ai_talking' THEN 5 WHEN 'new' THEN 6 ELSE 7 END,
		   CASE risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
		   COALESCE(last_message_at, last_event_at, updated_at) DESC
		 LIMIT $%d OFFSET $%d
	`, whereSQL, len(args)-1, len(args)), args...)
	if err != nil {
		return models.AIWorkflowList{}, err
	}
	defer rows.Close()
	items := []models.AIWorkflowState{}
	for rows.Next() {
		item, err := scanAIWorkflowState(rows)
		if err != nil {
			return models.AIWorkflowList{}, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return models.AIWorkflowList{}, err
	}
	return models.AIWorkflowList{Items: items, Total: total, Stats: stats}, nil
}

func (s *Store) AIWorkflowStats(ctx context.Context, adminUserID int64, batchID *int64) (models.AIWorkflowStats, error) {
	stats := models.AIWorkflowStats{ByState: map[string]int{}}
	args := []any{adminUserID}
	where := "WHERE admin_user_id = $1"
	if batchID != nil && *batchID > 0 {
		args = append(args, *batchID)
		where += " AND batch_id = $2"
	}
	rows, err := s.DB.Query(ctx, `
		SELECT state, risk_level, COUNT(*)::int, COALESCE(ROUND(AVG(confidence_score))::int, 0)
		  FROM bc_ai_workflow_states
		`+where+`
		 GROUP BY state, risk_level
	`, args...)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	confWeighted := 0
	for rows.Next() {
		var state, risk string
		var count, avg int
		if err := rows.Scan(&state, &risk, &count, &avg); err != nil {
			return stats, err
		}
		stats.Total += count
		stats.ByState[state] += count
		confWeighted += avg * count
		switch state {
		case "new":
			stats.New += count
		case "ai_talking":
			stats.AITalking += count
		case "buyer_replied":
			stats.BuyerReplied += count
		case "needs_human":
			stats.NeedsHuman += count
		case "followup_scheduled":
			stats.FollowupScheduled += count
		case "paused":
			stats.Paused += count
		case "closed":
			stats.Closed += count
		}
		if state == "needs_human" || state == "buyer_replied" {
			stats.ActionRequired += count
		}
		if risk == "critical" || risk == "high" {
			stats.HighRisk += count
		}
	}
	if stats.Total > 0 {
		stats.AvgConfidenceScore = confWeighted / stats.Total
	}
	return stats, rows.Err()
}

func (s *Store) GetAIWorkflowStateForRecipient(ctx context.Context, adminUserID, recipientID int64) (*models.AIWorkflowState, error) {
	row := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
		       retailer_id, phone, retailer_name, batch_name,
		       state, state_label, state_reason, next_action, next_message_preview,
		       confidence_score, risk_level, buyer_intent, knowledge_matched,
		       knowledge_refs, quality, source, last_message_at, last_event_at,
		       created_at, updated_at
		  FROM bc_ai_workflow_states
		 WHERE admin_user_id = $1 AND batch_ai_recipient_id = $2
	`, adminUserID, recipientID)
	item, err := scanAIWorkflowState(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	logs, err := s.ListAIDecisionLogsForRecipient(ctx, adminUserID, recipientID, 12)
	if err != nil {
		return nil, err
	}
	item.RecentDecisions = logs
	return item, nil
}

func (s *Store) ListAIDecisionLogsForRecipient(ctx context.Context, adminUserID, recipientID int64, limit int) ([]models.AIDecisionLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, workflow_state_id, batch_id, batch_ai_recipient_id,
		       conversation_id, phone, decision_type, title, reason,
		       knowledge_refs, next_action, quality, model, provider, source, created_at
		  FROM bc_ai_decision_logs
		 WHERE admin_user_id = $1 AND batch_ai_recipient_id = $2
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3
	`, adminUserID, recipientID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AIDecisionLog{}
	for rows.Next() {
		log, err := scanAIDecisionLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *log)
	}
	return out, rows.Err()
}

func (s *Store) upsertAIWorkflowStateForRow(ctx context.Context, row reviewSignalRow, cand *reviewCandidate, signal *models.AIHumanReviewSignal, source string) error {
	decision := classifyWorkflowState(row, cand, signal, source)
	knowledgeRefs := encodeJSONList(decision.KnowledgeRefs)
	quality := encodeJSONMap(decision.Quality)
	var stateID int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_workflow_states (
			admin_user_id, batch_id, batch_ai_recipient_id, conversation_id,
			retailer_id, phone, retailer_name, batch_name,
			state, state_label, state_reason, next_action, next_message_preview,
			confidence_score, risk_level, buyer_intent, knowledge_matched,
			knowledge_refs, quality, source, signal_hash,
			last_message_at, last_event_at
		)
		VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10, $11, $12, $13,
			$14, $15, $16, $17,
			$18::jsonb, $19::jsonb, $20, $21,
			$22, $23
		)
		ON CONFLICT (admin_user_id, batch_ai_recipient_id)
		DO UPDATE SET
			batch_id = EXCLUDED.batch_id,
			conversation_id = EXCLUDED.conversation_id,
			retailer_id = EXCLUDED.retailer_id,
			phone = EXCLUDED.phone,
			retailer_name = EXCLUDED.retailer_name,
			batch_name = EXCLUDED.batch_name,
			state = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			              AND EXCLUDED.source <> 'llm_inline'
			              AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			             THEN bc_ai_workflow_states.state ELSE EXCLUDED.state END,
			state_label = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                    AND EXCLUDED.source <> 'llm_inline'
			                    AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                   THEN bc_ai_workflow_states.state_label ELSE EXCLUDED.state_label END,
			state_reason = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                     AND EXCLUDED.source <> 'llm_inline'
			                     AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                    THEN bc_ai_workflow_states.state_reason ELSE EXCLUDED.state_reason END,
			next_action = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                    AND EXCLUDED.source <> 'llm_inline'
			                    AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                   THEN bc_ai_workflow_states.next_action ELSE EXCLUDED.next_action END,
			next_message_preview = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                             AND EXCLUDED.source <> 'llm_inline'
			                             AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                            THEN bc_ai_workflow_states.next_message_preview ELSE EXCLUDED.next_message_preview END,
			confidence_score = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                         AND EXCLUDED.source <> 'llm_inline'
			                         AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                        THEN bc_ai_workflow_states.confidence_score ELSE EXCLUDED.confidence_score END,
			risk_level = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                   AND EXCLUDED.source <> 'llm_inline'
			                   AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                  THEN bc_ai_workflow_states.risk_level ELSE EXCLUDED.risk_level END,
			buyer_intent = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                     AND EXCLUDED.source <> 'llm_inline'
			                     AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                    THEN bc_ai_workflow_states.buyer_intent ELSE EXCLUDED.buyer_intent END,
			knowledge_matched = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                          AND EXCLUDED.source <> 'llm_inline'
			                          AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                         THEN bc_ai_workflow_states.knowledge_matched ELSE EXCLUDED.knowledge_matched END,
			knowledge_refs = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                       AND EXCLUDED.source <> 'llm_inline'
			                       AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                      THEN bc_ai_workflow_states.knowledge_refs ELSE EXCLUDED.knowledge_refs END,
			quality = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                AND EXCLUDED.source <> 'llm_inline'
			                AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			               THEN bc_ai_workflow_states.quality ELSE EXCLUDED.quality END,
			source = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			               AND EXCLUDED.source <> 'llm_inline'
			               AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			              THEN bc_ai_workflow_states.source ELSE EXCLUDED.source END,
			signal_hash = CASE WHEN bc_ai_workflow_states.source = 'llm_inline'
			                    AND EXCLUDED.source <> 'llm_inline'
			                    AND bc_ai_workflow_states.last_message_at IS NOT DISTINCT FROM EXCLUDED.last_message_at
			                   THEN bc_ai_workflow_states.signal_hash ELSE EXCLUDED.signal_hash END,
			last_message_at = EXCLUDED.last_message_at,
			last_event_at = EXCLUDED.last_event_at
		RETURNING id
	`, row.AdminUserID, row.BatchID, row.RecipientID, row.ConversationID,
		row.RetailerID, strings.TrimSpace(row.Phone), strings.TrimSpace(row.RetailerName), strings.TrimSpace(row.BatchName),
		decision.State, decision.StateLabel, decision.StateReason, decision.NextAction, decision.NextMessagePreview,
		decision.ConfidenceScore, decision.RiskLevel, decision.BuyerIntent, decision.KnowledgeMatched,
		knowledgeRefs, quality, decision.Source, decision.SignalHash,
		row.LastMessageAt, row.LastEventAt).Scan(&stateID)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `
		INSERT INTO bc_ai_decision_logs (
			admin_user_id, workflow_state_id, batch_id, batch_ai_recipient_id,
			conversation_id, phone, decision_type, title, reason,
			knowledge_refs, next_action, quality, model, provider, source, signal_hash
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16)
		ON CONFLICT (admin_user_id, batch_ai_recipient_id, signal_hash)
		WHERE signal_hash <> ''
		DO NOTHING
	`, row.AdminUserID, stateID, row.BatchID, row.RecipientID,
		row.ConversationID, strings.TrimSpace(row.Phone), decision.DecisionType, decision.DecisionTitle, decision.StateReason,
		knowledgeRefs, decision.NextAction, quality, decision.Model, decision.Provider, decision.Source, decision.SignalHash)
	return err
}

func classifyWorkflowState(row reviewSignalRow, cand *reviewCandidate, signal *models.AIHumanReviewSignal, source string) workflowDecision {
	now := time.Now().UTC()
	status := strings.ToLower(strings.TrimSpace(row.AIStatus))
	convStatus := strings.ToLower(strings.TrimSpace(row.ConversationStatus))
	enrollmentStatus := strings.ToLower(strings.TrimSpace(row.EnrollmentStatus))
	pauseReason := strings.ToLower(strings.TrimSpace(row.PauseReason))
	lastRole := strings.ToLower(strings.TrimSpace(row.LastMessageRole))
	lastText := strings.TrimSpace(row.LastMessageContent)
	intent := workflowIntent(lastText)
	state := "new"
	label := "New"
	reason := "AI is tracking this phone and waiting for the first useful signal."
	nextAction := "Wait for the first buyer message or create the first AI follow-up plan."
	risk := "low"
	confidence := 62
	nextPreview := ""
	decisionType := "state_changed"
	title := "Workflow state updated"

	if signal != nil {
		reasonCode := strings.ToLower(strings.TrimSpace(signal.ReasonCode))
		reason = firstNonEmpty(strings.TrimSpace(signal.ReasonDetail), strings.TrimSpace(signal.Summary), "AI analyzed this phone while generating a reply.")
		nextAction = firstNonEmpty(strings.TrimSpace(signal.NextAction), strings.TrimSpace(signal.SuggestedAction), "Let AI continue unless the buyer asks for a person or confidence drops.")
		risk = normalizeReviewSeverity(signal.Severity)
		confidence = clampWorkflowScore(signal.PriorityScore)
		intent = firstNonEmpty(workflowIntentFromReason(reasonCode), intent)
		nextPreview = compactReviewText(signal.SuggestedReply, 260)
		decisionType = "llm_signal"
		title = "AI workflow signal"
		if signal.RequiresReview {
			state = "needs_human"
			label = "Needs human"
			decisionType = "llm_review"
			title = "AI requested human review"
		} else {
			switch reasonCode {
			case "hot_lead", "price_question", "meeting_request", "product_confusion":
				state = "buyer_replied"
				label = "Buyer replied"
				if nextAction == "" {
					nextAction = "AI can keep handling this. Review only if the buyer asks for a person or the answer becomes uncertain."
				}
			case "followup_scheduled":
				state = "followup_scheduled"
				label = "Follow-up scheduled"
			case "ai_handled", "none", "":
				if lastRole == "assistant" || status == "active" {
					state = "ai_talking"
					label = "AI talking"
				} else if lastRole == "user" {
					state = "buyer_replied"
					label = "Buyer replied"
				}
			default:
				if lastRole == "assistant" || status == "active" {
					state = "ai_talking"
					label = "AI talking"
				}
			}
		}
	} else if cand != nil {
		reasonCode := strings.ToLower(strings.TrimSpace(cand.ReasonCode))
		switch reasonCode {
		case "send_failed", "sender_missing", "ai_generator_missing", "followup_setup_issue", "human_needed", "human_requested", "complaint":
			state = "needs_human"
			label = "Needs human"
		case "price_question", "hot_lead", "buyer_replied":
			state = "buyer_replied"
			label = "Buyer replied"
		case "first_touch_due":
			state = "new"
			label = "New"
		default:
			state = "needs_human"
			label = "Needs human"
		}
		reason = cand.ReasonDetail
		nextAction = cand.SuggestedAction
		risk = cand.Severity
		confidence = clampWorkflowScore(cand.PriorityScore)
		intent = firstNonEmpty(workflowIntentFromReason(reasonCode), intent)
		decisionType = "rule_signal"
		title = cand.ReasonLabel
	} else {
		switch {
		case status == "opted_out" || enrollmentStatus == "completed":
			state = "closed"
			label = "Closed"
			reason = "This phone is no longer in an active AI follow-up path."
			nextAction = "No automatic action is needed."
			confidence = 86
		case status == "disabled" || status == "excluded" || pauseReason != "" || enrollmentStatus == "paused":
			state = "paused"
			label = "Paused"
			reason = "Automation is paused or this phone is excluded from the active batch AI workflow."
			if pauseReason != "" {
				reason = "Paused because " + strings.ReplaceAll(pauseReason, "_", " ") + "."
			}
			nextAction = "Resume only when you want AI to continue for this phone."
			risk = "medium"
			confidence = 78
		case convStatus == "handed_off" || status == "handed_off":
			state = "needs_human"
			label = "Needs human"
			reason = "The conversation is handed off to a person."
			nextAction = "Reply manually, then hand back to AI when the issue is resolved."
			risk = "critical"
			confidence = 92
		case lastRole == "user":
			state = "buyer_replied"
			label = "Buyer replied"
			reason = "The latest visible message came from the buyer."
			nextAction = "Open the thread and let AI reply only if confidence is high."
			risk = "high"
			confidence = 82
		case row.NextRunAt != nil && row.NextRunAt.After(now):
			state = "followup_scheduled"
			label = "Follow-up scheduled"
			reason = "The next AI follow-up is waiting on its cadence."
			nextAction = "No action needed unless you want to edit the next message."
			confidence = 80
		case lastRole == "assistant" || status == "active":
			state = "ai_talking"
			label = "AI talking"
			reason = "AI has context for this phone and is handling the next reply or follow-up."
			nextAction = "Monitor only if the buyer replies or a send fails."
			confidence = 76
		}
	}

	quality := map[string]any{
		"confidence":        confidence,
		"risk_level":        risk,
		"buyer_intent":      intent,
		"knowledge_matched": false,
	}
	if row.LastSendStatus != "" {
		quality["last_send_status"] = row.LastSendStatus
	}
	if row.PauseReason != "" {
		quality["pause_reason"] = row.PauseReason
	}
	if signal != nil {
		if signal.Model != "" {
			quality["model"] = signal.Model
		}
		if signal.Provider != "" {
			quality["provider"] = signal.Provider
		}
	}
	decision := workflowDecision{
		State:              state,
		StateLabel:         label,
		StateReason:        compactReviewText(reason, 600),
		NextAction:         compactReviewText(nextAction, 500),
		NextMessagePreview: compactReviewText(nextPreview, 500),
		ConfidenceScore:    confidence,
		RiskLevel:          normalizeReviewSeverity(risk),
		BuyerIntent:        compactReviewText(firstNonEmpty(intent, "unknown"), 120),
		KnowledgeMatched:   false,
		KnowledgeRefs:      []string{},
		Quality:            quality,
		Source:             firstNonEmpty(strings.TrimSpace(source), "rules"),
		DecisionType:       decisionType,
		DecisionTitle:      compactReviewText(title, 120),
	}
	if signal != nil {
		decision.Model = strings.TrimSpace(signal.Model)
		decision.Provider = strings.TrimSpace(signal.Provider)
	}
	decision.SignalHash = workflowSignalHash(row, decision)
	return decision
}

func workflowIntent(text string) string {
	t := strings.ToLower(strings.TrimSpace(text))
	switch {
	case containsAny(t, "price", "pricing", "cost", "rate", "discount", "offer", "mrp", "wholesale", "kitna", "daam", "bhav"):
		return "price question"
	case containsAny(t, "meeting", "call", "next week", "tomorrow", "time", "schedule"):
		return "meeting request"
	case containsAny(t, "buy", "order", "available", "stock", "catalog", "catalogue", "send me", "urgent", "today"):
		return "purchase intent"
	case containsAny(t, "complaint", "refund", "wrong", "bad", "not received", "delay", "damaged", "cancel"):
		return "complaint"
	case containsAny(t, "human", "person", "manager", "support"):
		return "human requested"
	case t == "":
		return "unknown"
	default:
		return "general reply"
	}
}

func workflowIntentFromReason(reason string) string {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "price_question":
		return "price question"
	case "hot_lead":
		return "purchase intent"
	case "meeting_request":
		return "meeting request"
	case "product_confusion":
		return "product question"
	case "human_needed", "human_requested":
		return "human requested"
	case "complaint":
		return "complaint"
	case "send_failed":
		return "delivery issue"
	case "buyer_replied":
		return "buyer replied"
	default:
		return ""
	}
}

func workflowSignalHash(row reviewSignalRow, decision workflowDecision) string {
	lastAt := ""
	if row.LastMessageAt != nil {
		lastAt = row.LastMessageAt.UTC().Format(time.RFC3339Nano)
	}
	raw := strings.Join([]string{
		decision.State,
		decision.RiskLevel,
		decision.BuyerIntent,
		decision.StateReason,
		decision.NextAction,
		row.AIStatus,
		row.ConversationStatus,
		row.EnrollmentStatus,
		row.PauseReason,
		row.LastSendStatus,
		lastAt,
		compactReviewText(row.LastMessageContent, 260),
	}, "|")
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func scanAIWorkflowState(row rowScanner) (*models.AIWorkflowState, error) {
	var item models.AIWorkflowState
	var refsRaw, qualityRaw []byte
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
		&item.State,
		&item.StateLabel,
		&item.StateReason,
		&item.NextAction,
		&item.NextMessagePreview,
		&item.ConfidenceScore,
		&item.RiskLevel,
		&item.BuyerIntent,
		&item.KnowledgeMatched,
		&refsRaw,
		&qualityRaw,
		&item.Source,
		&item.LastMessageAt,
		&item.LastEventAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.KnowledgeRefs = decodeStringJSONList(refsRaw)
	item.Quality = decodeJSONMap(qualityRaw)
	return &item, nil
}

func scanAIDecisionLog(row rowScanner) (*models.AIDecisionLog, error) {
	var item models.AIDecisionLog
	var refsRaw, qualityRaw []byte
	if err := row.Scan(
		&item.ID,
		&item.AdminUserID,
		&item.WorkflowStateID,
		&item.BatchID,
		&item.BatchAIRecipientID,
		&item.ConversationID,
		&item.Phone,
		&item.DecisionType,
		&item.Title,
		&item.Reason,
		&refsRaw,
		&item.NextAction,
		&qualityRaw,
		&item.Model,
		&item.Provider,
		&item.Source,
		&item.CreatedAt,
	); err != nil {
		return nil, err
	}
	item.KnowledgeRefs = decodeStringJSONList(refsRaw)
	item.Quality = decodeJSONMap(qualityRaw)
	return &item, nil
}

func encodeJSONMap(v map[string]any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("{}")
	}
	return b
}

func decodeJSONMap(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	if out == nil {
		return map[string]any{}
	}
	return out
}

func clampWorkflowScore(n int) int {
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
