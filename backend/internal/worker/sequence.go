// Phase 5: sequence worker + Phase 7 follow-up mode.
//
// Polls bc_crm_sequence_enrollments every tick (5s) for rows where
// status='active' AND next_run_at <= now(). For each due row:
//
//   1. Load the lead row + the current step (template + condition).
//   2. Resolve the per-admin WhatsApp client via Resolver. If no
//      creds, set status='paused' with reason 'no_sender' and audit.
//   3. Branch on enrollment.mode:
//        - 'template'    → render message_template (Phase 5 behavior)
//        - 'ai_followup' → call FollowUpGenerator.GenerateFollowUp to
//                          get an LLM-generated body referencing the
//                          lead's last chat topic (Phase 7).
//      Call SendText up to MaxAttempts times with exponential backoff.
//   4. On success: if condition->>'max_messages' caps us, mark
//      completed; else advance current_step + set next next_run_at.
//      On exhaustion, set status='paused' with reason 'send_failed'
//      and write a 'needs_attention' activity row on the lead.
//
// The worker lives in cmd/server/main.go's process. It shares the
// Resolver with the existing message-sending worker.

package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/whatsyitc/backend/internal/audit"
)

// FollowUpGenerator is the dependency the worker needs to call into
// the AI orchestrator for the 'ai_followup' mode. Same shape as
// orchestrator.FollowUpGenerator — re-declared here so the worker
// package does not need to import the orchestrator (which would create
// an import cycle via ai/retrieval). The orchestrator's
// *Orchestrator type satisfies this interface.
//
// The mode parameter selects the prompt + behavior:
//   - "default" / "custom": one short AI nudge referencing the last
//     topic; "custom" bakes the admin-supplied goal/tone into the
//     prompt verbatim.
//   - "agentic": the LLM decides whether a follow-up is appropriate
//     right now. Empty return is a legitimate "skip this tick".
type FollowUpGenerator interface {
	GenerateFollowUp(ctx context.Context, adminID int64, batchID *int64, phone, goal, lastTopic, tone, mode string) (string, error)
}

// HumanReviewRefresher lets the worker keep the phone-level Human Review queue
// fresh when a scheduled follow-up is sent, skipped, or paused.
type HumanReviewRefresher interface {
	RefreshAIHumanReviewForPhone(ctx context.Context, adminUserID int64, phone string) (int, error)
}

// followupCheckinInterval is the gap between "customer replied" and
// the worker sending the optional "still interested?" check-in
// message. Kept short (2h) so admins see the check-in land in the
// same day; configurable later via the lead's condition->>'checkin_after_minutes'.
const followupCheckinInterval = 2 * time.Hour

// MaxAttempts is how many times we retry a failed send before pausing
// the enrollment with reason 'send_failed'.
const MaxAttempts = 3

// seqBackoff is the sleep between retries: attempt 1 → 2s, 2 → 8s, 3 → 30s.
func seqBackoff(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 2 * time.Second
	case 2:
		return 8 * time.Second
	default:
		return 30 * time.Second
	}
}

// renderSeqTemplate substitutes {{lead.X}} tokens with values from the
// lead. Unknown tokens are left as-is so admins notice typos in the
// template editor. Pure function — easy to unit test.
func renderSeqTemplate(tmpl string, lead map[string]string) string {
	if tmpl == "" || lead == nil {
		return tmpl
	}
	out := make([]byte, 0, len(tmpl))
	i := 0
	for i < len(tmpl) {
		j := strings.Index(tmpl[i:], "{{")
		if j < 0 {
			out = append(out, tmpl[i:]...)
			break
		}
		j += i
		out = append(out, tmpl[i:j]...)
		k := strings.Index(tmpl[j+2:], "}}")
		if k < 0 {
			// Unterminated — leave the rest as-is.
			out = append(out, tmpl[j:]...)
			break
		}
		k += j + 2
		key := tmpl[j+2 : k]
		if val, ok := lead[key]; ok {
			out = append(out, val...)
		} else {
			out = append(out, tmpl[j:k+2]...)
		}
		i = k + 2
	}
	return string(out)
}

// seqLeadVars builds the {{lead.X}} var map from a row loaded from
// bc_crm_leads. Used by the worker to render the message template.
func seqLeadVars(name, phone, email, interest, budget, timeline, location, status string, score int) map[string]string {
	return map[string]string{
		"lead.name":     name,
		"lead.phone":    phone,
		"lead.email":    email,
		"lead.interest": interest,
		"lead.budget":   budget,
		"lead.timeline": timeline,
		"lead.location": location,
		"lead.status":   status,
		"lead.score":    strconv.Itoa(score),
	}
}

// SequenceWorker is the long-lived poller. Construct with
// NewSequenceWorker, then call Start(ctx) in its own goroutine. It
// exits cleanly when ctx is done.
type SequenceWorker struct {
	pool     *pgxpool.Pool
	resolver Resolver
	tick     time.Duration
	batch    int

	// followup is the LLM-backed body generator for the 'ai_followup'
	// enrollment mode. May be nil — the worker then pauses any
	// ai_followup enrollment it picks up with reason 'no_followup_generator'.
	followup FollowUpGenerator

	humanReview HumanReviewRefresher

	// testHook fires after every tick (nil in production; set in tests
	// to advance the loop deterministically without sleeping).
	testHook func()
}

// NewSequenceWorker builds the worker. tick=0 falls back to 5s,
// batch=0 falls back to 25. Resolver may be nil — the worker still
// starts but pauses every enrollment it picks up with reason
// 'no_sender'.
func NewSequenceWorker(pool *pgxpool.Pool, r Resolver) *SequenceWorker {
	return &SequenceWorker{
		pool:     pool,
		resolver: r,
		tick:     5 * time.Second,
		batch:    25,
	}
}

// SetFollowUpGenerator wires the LLM-backed body generator. The main
// process passes the orchestrator here after both are constructed.
func (w *SequenceWorker) SetFollowUpGenerator(g FollowUpGenerator) {
	w.followup = g
}

// SetHumanReviewRefresher wires the persisted phone-level review queue.
func (w *SequenceWorker) SetHumanReviewRefresher(r HumanReviewRefresher) {
	w.humanReview = r
}

// lockedRow is the slim shape we read from the worker's lock query.
// Mode is 'template' (Phase 5) or 'ai_followup' (Phase 7).
type lockedRow struct {
	id, adminID, seqID, leadID, currentStep int64
	sourceBatchID                           *int64
	mode                                    string
}

// SetTick overrides the poll interval (used in tests).
func (w *SequenceWorker) SetTick(d time.Duration) { w.tick = d }

// SetBatch overrides the per-tick batch size (used in tests).
func (w *SequenceWorker) SetBatch(n int) {
	if n > 0 {
		w.batch = n
	}
}

// SetTestHook sets a callback fired after every tick.
func (w *SequenceWorker) SetTestHook(f func()) { w.testHook = f }

// Start blocks until ctx is done, ticking every w.tick. Safe to run
// in a goroutine. Each tick is bounded by 30s so a stuck DB doesn't
// hold the worker forever.
func (w *SequenceWorker) Start(ctx context.Context) {
	log.Printf("[seq-worker] starting (tick=%s, batch=%d)", w.tick, w.batch)
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[seq-worker] stopped")
			return
		case <-t.C:
			w.tickOnce(ctx)
			if w.testHook != nil {
				w.testHook()
			}
		}
	}
}

// tickOnce runs a single pass. Exposed for tests so we don't have to
// wait for the ticker. Each row is processed in its own short-lived
// context so a slow WhatsApp send doesn't hold a transaction open
// across the whole batch.
func (w *SequenceWorker) tickOnce(ctx context.Context) {
	tickCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := w.pool.Query(tickCtx, `
		SELECT id, admin_user_id, sequence_id, lead_id, current_step, mode, source_batch_id
		FROM bc_crm_sequence_enrollments
		WHERE status = 'active' AND next_run_at <= now()
		ORDER BY next_run_at ASC
		LIMIT $1
	`, w.batch)
	if err != nil {
		log.Printf("[seq-worker] lock due enrollments: %v", err)
		return
	}
	var due []lockedRow
	for rows.Next() {
		var l lockedRow
		var sourceBatch sql.NullInt64
		if err := rows.Scan(&l.id, &l.adminID, &l.seqID, &l.leadID, &l.currentStep, &l.mode, &sourceBatch); err == nil {
			l.sourceBatchID = int64PtrFromNull(sourceBatch)
			due = append(due, l)
		}
	}
	rows.Close()

	if len(due) == 0 {
		return
	}

	for i := range due {
		w.processOne(tickCtx, due[i])
	}

	// Phase 7: pick up "still interested?" check-ins. Same tick,
	// separate query. Cheap because the partial index keeps the
	// pending scan O(N due) not O(total rows).
	w.runFollowupCheckins(tickCtx)
}

// processOne advances one enrollment. Note we don't hold a row lock
// across the whole operation: the per-row UPDATE is atomic, and
// re-firing the same step is acceptable (we'd just send a duplicate
// message). For higher throughput, a SKIP LOCKED tx variant can be
// added later; the partial index on (next_run_at) WHERE status='active'
// keeps the WHERE scan cheap.
func (w *SequenceWorker) processOne(ctx context.Context, l lockedRow) {
	// 1. Load the lead row (for phone + var values).
	var (
		leadName, leadPhone, leadEmail, leadInterest,
		leadBudget, leadTimeline, leadLocation, leadStatus string
		leadScore int
	)
	err := w.pool.QueryRow(ctx, `
		SELECT name, phone, email, interest, budget, timeline, location, status, score
		FROM bc_crm_leads WHERE id = $1 AND admin_user_id = $2
	`, l.leadID, l.adminID).Scan(
		&leadName, &leadPhone, &leadEmail, &leadInterest,
		&leadBudget, &leadTimeline, &leadLocation, &leadStatus, &leadScore,
	)
	if err != nil {
		log.Printf("[seq-worker] load lead %d: %v — pausing enrollment %d", l.leadID, err, l.id)
		w.pauseEnrollment(ctx, l, "lead_missing", fmt.Sprintf("lead #%d not found: %v", l.leadID, err))
		return
	}

	// 2. Load the current step (0-indexed → position = current_step + 1).
	// For ai_followup mode we also need the step's condition JSONB
	// (carries goal / tone / max_messages / last_topic / checkin).
	var (
		stepTpl     string
		stepDelay   int
		stepCondRaw []byte
		hasStep     bool
	)
	err = w.pool.QueryRow(ctx, `
		SELECT message_template, COALESCE(delay_minutes, 0), condition
		FROM bc_crm_sequence_steps
		WHERE sequence_id = $1 AND position = $2
	`, l.seqID, l.currentStep+1).Scan(&stepTpl, &stepDelay, &stepCondRaw)
	hasStep = err == nil
	if err != nil && err != pgx.ErrNoRows {
		log.Printf("[seq-worker] load step seq=%d pos=%d: %v", l.seqID, l.currentStep+1, err)
		w.pauseEnrollment(ctx, l, "step_load_failed", err.Error())
		return
	}

	// 3. No more steps → mark completed.
	if !hasStep {
		_, _ = w.pool.Exec(ctx, `
			UPDATE bc_crm_sequence_enrollments
			SET status = 'completed', completed_at = now()
			WHERE id = $1
		`, l.id)
		audit.Log(ctx, w.pool, audit.Entry{
			Action:     "crm.sequence.completed",
			EntityType: strPtr("crm_sequence_enrollment"),
			EntityID:   &l.id,
			Metadata: map[string]any{
				"sequence_id": l.seqID, "lead_id": l.leadID,
				"final_step": l.currentStep, "mode": l.mode,
			},
		})
		w.refreshHumanReviewForPhone(ctx, l.adminID, leadPhone, "sequence_completed")
		return
	}

	// Parse the step condition JSONB once (used by ai_followup mode).
	var stepCond map[string]any
	if len(stepCondRaw) > 0 {
		_ = json.Unmarshal(stepCondRaw, &stepCond)
	}
	stepCond = w.applyEnrollmentOverrides(ctx, l, stepCond)

	// 4. Resolve the per-admin WhatsApp client. If no creds, pause.
	if w.resolver == nil {
		w.pauseEnrollment(ctx, l, "no_sender", "no resolver configured")
		return
	}
	wa, err := w.resolver(ctx, l.adminID)
	if err != nil || wa == nil {
		reason := "no_sender"
		detail := "resolver returned no client"
		if err != nil {
			detail = err.Error()
		}
		w.pauseEnrollment(ctx, l, reason, detail)
		return
	}

	// 5. Build the body. Branch on enrollment.mode:
	//    - 'template'         → render message_template (Phase 5).
	//    - 'ai_followup'      → call the LLM to generate a fresh,
	//                          contextually-aware body (Phase 7). The
	//                          LLM uses the admin-supplied goal/tone
	//                          from the step's condition JSONB.
	//    - 'agentic_followup' → same call, but the LLM is prompted to
	//                          decide whether to send at all. Empty
	//                          return = "skip this tick, advance".
	var body string
	savedDraft, draftFresh := w.loadNextMessageDraft(ctx, l, leadPhone)
	if draftFresh {
		body = savedDraft
	} else if l.mode == "ai_followup" || l.mode == "agentic_followup" {
		if w.followup == nil {
			w.pauseEnrollment(ctx, l, "no_followup_generator",
				"ai_followup enrollment picked up but no FollowUpGenerator is wired")
			return
		}
		goal := strFromCond(stepCond, "goal")
		tone := strFromCond(stepCond, "tone")
		lastTopic := strFromCond(stepCond, "last_topic")
		// 'ai_followup'      → mode='custom' (admin-supplied goal/tone
		//                      baked into the prompt verbatim).
		// 'agentic_followup' → mode='agentic' (LLM decides whether
		//                      to send at all; empty = skip). The first
		//                      touch is forced through custom mode so Smart
		//                      AI actually starts the conversation instead
		//                      of logging "first touch due" forever.
		modeArg := "custom"
		if l.mode == "agentic_followup" && l.currentStep > 0 {
			modeArg = "agentic"
		}
		// Resolve the enrollment's batch context so the orchestrator can
		// honor a per-batch agent override. New enrollments carry the
		// source batch directly; legacy rows fall back to the previous
		// phone lookup.
		batchID := l.sourceBatchID
		if batchID == nil {
			batchID = w.resolveBatchIDForPhone(ctx, l.adminID, leadPhone)
		}
		body, err = w.followup.GenerateFollowUp(ctx, l.adminID, batchID, leadPhone, goal, lastTopic, tone, modeArg)
		if err != nil {
			log.Printf("[seq-worker] followup body for enrollment %d: %v", l.id, err)
			w.pauseEnrollment(ctx, l, "send_failed", "followup LLM: "+err.Error())
			return
		}
		// In agentic mode, "" is a legitimate "skip this tick", but it
		// must not count as a sent follow-up. Keep the same current_step
		// and only move next_run_at forward.
		if l.mode == "agentic_followup" && strings.TrimSpace(body) == "" {
			w.rescheduleAgenticSkip(ctx, l, stepCond, leadPhone)
			w.refreshHumanReviewForPhone(ctx, l.adminID, leadPhone, "agentic_skip")
			return
		}
	} else {
		body = renderSeqTemplate(stepTpl, seqLeadVars(
			leadName, leadPhone, leadEmail, leadInterest, leadBudget,
			leadTimeline, leadLocation, leadStatus, leadScore,
		))
	}

	// 6. Send with retry (same loop for both modes).
	var lastErr error
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, err := wa.SendText(sendCtx, leadPhone, body)
		cancel()
		if err == nil {
			lastErr = nil
			break
		}
		lastErr = err
		log.Printf("[seq-worker] send attempt %d/%d failed for enrollment %d: %v",
			attempt, MaxAttempts, l.id, err)
		if attempt < MaxAttempts {
			select {
			case <-ctx.Done():
				return
			case <-time.After(seqBackoff(attempt)):
			}
		}
	}

	// 6a. All attempts failed → pause + write 'needs_attention' activity.
	if lastErr != nil {
		w.pauseEnrollment(ctx, l, "send_failed", lastErr.Error())
		_, _ = w.pool.Exec(ctx, `
			INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
			VALUES ($1, $2, 'needs_attention', $3, $4::jsonb)
		`, l.adminID, l.leadID,
			fmt.Sprintf("Sequence step %d failed after %d attempts: %s", l.currentStep+1, MaxAttempts, lastErr.Error()),
			fmt.Sprintf(`{"enrollment_id":%d,"sequence_id":%d,"step":%d,"reason":%q}`,
				l.id, l.seqID, l.currentStep+1, "send_failed"),
		)
		return
	}

	// 6b. Success → advance current_step + set next next_run_at, or
	// mark completed if there is no next step.
	if err := w.persistFollowupConversationMessage(ctx, l, leadPhone, body); err != nil {
		log.Printf("[seq-worker] persist sent follow-up enrollment=%d: %v", l.id, err)
	}
	w.markBatchRecipientFollowupSent(ctx, l, leadPhone, body)
	w.advanceEnrollmentStep(ctx, l, stepCond)
	w.refreshHumanReviewForPhone(ctx, l.adminID, leadPhone, "followup_sent")
}

// advanceEnrollmentStep moves the enrollment forward by one step.
// Called on a successful send. Agentic skip uses rescheduleAgenticSkip instead
// because a skip should not count as a sent message.
//
// stepCond is the JSONB condition blob on the current step row;
// we read max_messages from there.
func (w *SequenceWorker) advanceEnrollmentStep(ctx context.Context, l lockedRow, stepCond map[string]any) {
	// Look up the next step's delay_minutes. If absent, this is the
	// last step and the enrollment auto-completes below.
	var nextStepDelay int
	err := w.pool.QueryRow(ctx, `
		SELECT COALESCE(delay_minutes, 0) FROM bc_crm_sequence_steps
		WHERE sequence_id = $1 AND position = $2
	`, l.seqID, l.currentStep+2).Scan(&nextStepDelay)
	hasNext := err == nil
	if err != nil && err != pgx.ErrNoRows {
		log.Printf("[seq-worker] load next step seq=%d pos=%d: %v", l.seqID, l.currentStep+2, err)
		w.pauseEnrollment(ctx, l, "next_step_load_failed", err.Error())
		return
	}

	// max_messages cap. When the step's condition carries
	// max_messages, we've just sent the final message — mark the
	// enrollment completed regardless of whether more step rows
	// exist. This is what stops a "3 messages total" follow-up at
	// exactly 3 sends instead of running through every step row
	// the sequence happens to have.
	maxMessages, hasMax := intFromCond(stepCond, "max_messages")
	if hasMax && maxMessages > 0 && int(l.currentStep+1) >= maxMessages {
		_, err = w.pool.Exec(ctx, `
			UPDATE bc_crm_sequence_enrollments
			SET current_step = current_step + 1,
			    status = 'completed', completed_at = now()
			WHERE id = $1
		`, l.id)
		hasNext = false
	} else if hasNext {
		if cadenceDays, ok := intFromCond(stepCond, "cadence_days"); ok && cadenceDays > 0 {
			nextStepDelay = cadenceDays * 24 * 60
		}
		_, err = w.pool.Exec(ctx, `
			UPDATE bc_crm_sequence_enrollments
			SET current_step = current_step + 1,
			    next_run_at = now() + ($1 || ' minutes')::interval
			WHERE id = $2
		`, strconv.Itoa(nextStepDelay), l.id)
	} else {
		_, err = w.pool.Exec(ctx, `
			UPDATE bc_crm_sequence_enrollments
			SET current_step = current_step + 1,
			    status = 'completed', completed_at = now()
			WHERE id = $1
		`, l.id)
	}
	if err != nil {
		log.Printf("[seq-worker] advance enrollment %d: %v", l.id, err)
		return
	}
	if _, clearErr := w.pool.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET next_message_body = NULL,
		    next_message_prompt = NULL,
		    next_message_source = NULL,
		    next_message_context_message_id = NULL,
		    next_message_history_limit = NULL,
		    next_message_generated_at = NULL,
		    next_message_updated_at = NULL
		WHERE id = $1
	`, l.id); clearErr != nil {
		log.Printf("[seq-worker] clear next-message draft enrollment=%d: %v", l.id, clearErr)
	}

	audit.Log(ctx, w.pool, audit.Entry{
		Action:     "crm.sequence.advanced",
		EntityType: strPtr("crm_sequence_enrollment"),
		EntityID:   &l.id,
		Metadata: map[string]any{
			"sequence_id": l.seqID, "lead_id": l.leadID,
			"from_step": l.currentStep + 1, "to_step": l.currentStep + 2,
			"completed": !hasNext,
		},
	})
}

func (w *SequenceWorker) rescheduleAgenticSkip(ctx context.Context, l lockedRow, stepCond map[string]any, phone string) {
	cadenceMinutes := 24 * 60
	if cadenceDays, ok := intFromCond(stepCond, "cadence_days"); ok && cadenceDays > 0 {
		cadenceMinutes = cadenceDays * 24 * 60
	}
	_, err := w.pool.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET next_run_at = now() + ($1 || ' minutes')::interval,
		    pause_reason = NULL,
		    paused_at = NULL,
		    pause_detail = NULL
		WHERE id = $2
	`, strconv.Itoa(cadenceMinutes), l.id)
	if err != nil {
		log.Printf("[seq-worker] reschedule agentic skip enrollment %d: %v", l.id, err)
		return
	}
	w.markBatchRecipientAgenticSkip(ctx, l, phone)
	audit.Log(ctx, w.pool, audit.Entry{
		Action:     "crm.sequence.agentic_skipped",
		EntityType: strPtr("crm_sequence_enrollment"),
		EntityID:   &l.id,
		Metadata: map[string]any{
			"sequence_id":     l.seqID,
			"lead_id":         l.leadID,
			"current_step":    l.currentStep + 1,
			"cadence_minutes": cadenceMinutes,
			"reason":          "agent_decided_not_to_send",
		},
	})
}

func (w *SequenceWorker) markBatchRecipientAgenticSkip(ctx context.Context, l lockedRow, phone string) {
	if l.sourceBatchID == nil {
		return
	}
	_, err := w.pool.Exec(ctx, `
		UPDATE bc_batch_ai_recipients
		SET ai_status = CASE WHEN ai_status = 'pending' THEN 'active' ELSE ai_status END,
		    last_event = 'Smart AI skipped this tick to avoid an unnecessary follow-up',
		    last_event_at = now(),
		    updated_at = now()
		WHERE admin_user_id = $1
		  AND batch_id = $2
		  AND whatsapp_number = $3
		  AND COALESCE(ai_status, 'pending') NOT IN ('excluded', 'opted_out', 'disabled')
	`, l.adminID, *l.sourceBatchID, strings.TrimSpace(phone))
	if err != nil {
		log.Printf("[seq-worker] mark agentic skip batch=%d enrollment=%d: %v", *l.sourceBatchID, l.id, err)
	}
}

func (w *SequenceWorker) markBatchRecipientFollowupSent(ctx context.Context, l lockedRow, phone, body string) {
	preview := strings.TrimSpace(body)
	if runes := []rune(preview); len(runes) > 180 {
		preview = strings.TrimSpace(string(runes[:180]))
	}
	var err error
	if l.sourceBatchID != nil {
		_, err = w.pool.Exec(ctx, `
			UPDATE bc_batch_ai_recipients
			SET ai_status = 'active',
			    last_event = $4,
			    last_event_at = now(),
			    updated_at = now()
			WHERE admin_user_id = $1
			  AND batch_id = $2
			  AND whatsapp_number = $3
			  AND COALESCE(ai_status, 'pending') NOT IN ('excluded', 'opted_out', 'disabled')
		`, l.adminID, *l.sourceBatchID, strings.TrimSpace(phone), "AI follow-up sent: "+preview)
	} else {
		_, err = w.pool.Exec(ctx, `
			UPDATE bc_batch_ai_recipients
			SET ai_status = 'active',
			    last_event = $3,
			    last_event_at = now(),
			    updated_at = now()
			WHERE admin_user_id = $1
			  AND whatsapp_number = $2
			  AND COALESCE(ai_status, 'pending') NOT IN ('excluded', 'opted_out', 'disabled')
		`, l.adminID, strings.TrimSpace(phone), "AI follow-up sent: "+preview)
	}
	if err != nil {
		log.Printf("[seq-worker] mark batch recipient active enrollment=%d phone=%s: %v", l.id, phone, err)
	}
}

// applyEnrollmentOverrides merges admin edits from
// bc_crm_sequence_enrollments.override_* into the parsed step condition
// map. The UI writes these override columns from the batch AI control
// page; the worker must honor them at generation time so edited goal,
// tone, max messages, and cadence affect the very next send.
func (w *SequenceWorker) applyEnrollmentOverrides(ctx context.Context, l lockedRow, cond map[string]any) map[string]any {
	if cond == nil {
		cond = map[string]any{}
	}
	var cadence sql.NullInt64
	var maxMessages sql.NullInt64
	var tone sql.NullString
	var goal sql.NullString
	err := w.pool.QueryRow(ctx, `
		SELECT override_cadence_days, override_max_messages,
		       override_tone, override_goal
		FROM bc_crm_sequence_enrollments
		WHERE id = $1 AND admin_user_id = $2
	`, l.id, l.adminID).Scan(&cadence, &maxMessages, &tone, &goal)
	if err != nil {
		log.Printf("[seq-worker] load overrides enrollment=%d: %v", l.id, err)
		return cond
	}
	if cadence.Valid && cadence.Int64 > 0 {
		cond["cadence_days"] = int(cadence.Int64)
	}
	if maxMessages.Valid && maxMessages.Int64 > 0 {
		cond["max_messages"] = int(maxMessages.Int64)
	}
	if tone.Valid && strings.TrimSpace(tone.String) != "" {
		cond["tone"] = strings.TrimSpace(tone.String)
	}
	if goal.Valid {
		cond["goal"] = strings.TrimSpace(goal.String)
	}
	return cond
}

// loadNextMessageDraft returns the exact one-time body only when the
// conversation has not moved since the operator saved it.
func (w *SequenceWorker) loadNextMessageDraft(ctx context.Context, l lockedRow, phone string) (string, bool) {
	var body string
	var basedOn, latest sql.NullInt64
	err := w.pool.QueryRow(ctx, `
		SELECT COALESCE(e.next_message_body, ''),
		       e.next_message_context_message_id,
		       (
		           SELECT MAX(m.id)
		           FROM bc_ai_conversation_messages m
		           WHERE m.admin_user_id = e.admin_user_id
		             AND m.conversation_key = $3
		       )
		FROM bc_crm_sequence_enrollments e
		WHERE e.id = $1 AND e.admin_user_id = $2
	`, l.id, l.adminID, "phone:"+strings.TrimSpace(phone)).Scan(&body, &basedOn, &latest)
	if err != nil {
		log.Printf("[seq-worker] load next-message draft enrollment=%d: %v", l.id, err)
		return "", false
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return "", false
	}
	if !draftMatchesContext(int64PtrFromNull(basedOn), int64PtrFromNull(latest)) {
		log.Printf("[seq-worker] stale next-message draft ignored enrollment=%d", l.id)
		return "", false
	}
	return body, true
}

func draftMatchesContext(basedOn, latest *int64) bool {
	if basedOn == nil || latest == nil {
		return basedOn == nil && latest == nil
	}
	return *basedOn == *latest
}

// resolveBatchIDForPhone returns the most recent batch id that
// enrolled this phone via the batch-AI follow-up flow, or nil when no
// batch context exists (legacy enrollment, pre-batch-flow lead).
//
// The batch-AI recipient row is the join point: every batch that has
// AI follow-up enabled creates one row per phone in bc_batch_ai_recipients.
// The enrollment row itself doesn't carry batch_id (it lives in
// CRM's enrollment → sequence → lead hierarchy), so we look up the
// most recent batch id for the phone.
//
// Returns nil silently when no row exists — this is the common case
// for enrollments that pre-date the batch flow.
func (w *SequenceWorker) resolveBatchIDForPhone(ctx context.Context, adminID int64, phone string) *int64 {
	var batchID int64
	err := w.pool.QueryRow(ctx, `
		SELECT batch_id FROM bc_batch_ai_recipients
		WHERE admin_user_id = $1 AND whatsapp_number = $2
		ORDER BY last_event_at DESC NULLS LAST, id DESC
		LIMIT 1
	`, adminID, phone).Scan(&batchID)
	if err != nil {
		// Most common path: phone has never been in a batch AI flow.
		return nil
	}
	return &batchID
}

func int64PtrFromNull(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// persistFollowupConversationMessage keeps scheduled/template follow-ups in
// the same timeline used by the inbox and future AI draft generation.
func (w *SequenceWorker) persistFollowupConversationMessage(
	ctx context.Context,
	l lockedRow,
	phone, body string,
) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	preview := body
	if runes := []rune(preview); len(runes) > 240 {
		preview = strings.TrimSpace(string(runes[:240]))
	}
	_, err := w.pool.Exec(ctx, `
		WITH conv AS (
			INSERT INTO bc_ai_conversation_states
				(admin_user_id, conversation_key, phone, started_at,
				 updated_at, last_message_at, last_message_preview,
				 last_message_role, last_message_direction, ai_handled_count)
			VALUES ($1, $2, $3, now(), now(), now(), $4, 'assistant', 'outbound', 1)
			ON CONFLICT (admin_user_id, conversation_key) DO UPDATE
			SET phone = EXCLUDED.phone,
			    updated_at = now(),
			    last_message_at = now(),
			    last_message_preview = EXCLUDED.last_message_preview,
			    last_message_role = 'assistant',
			    last_message_direction = 'outbound',
			    ai_handled_count = bc_ai_conversation_states.ai_handled_count + 1
			RETURNING id
		)
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, conversation_id, phone,
			 role, content, source, send_status, sent_at)
		SELECT $1, $2, id, $3, 'assistant', $5, 'followup', 'sent', now()
		FROM conv
	`, l.adminID, "phone:"+strings.TrimSpace(phone), phone, preview, body)
	return err
}

// strFromCond reads a string field from the parsed step condition
// JSONB. Returns "" if the field is missing or not a string.
//
// Used to extract goal / tone / last_topic for ai_followup mode
// without scattering type assertions across processOne.
func strFromCond(cond map[string]any, key string) string {
	if cond == nil {
		return ""
	}
	v, ok := cond[key]
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

// intFromCond reads a number field from the parsed step condition
// JSONB. Returns (0, false) if missing or not a number. Used for
// condition->>'max_messages'.
func intFromCond(cond map[string]any, key string) (int, bool) {
	if cond == nil {
		return 0, false
	}
	v, ok := cond[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}

// pauseEnrollment flips the enrollment to 'paused' and writes an audit
// row with the reason + detail. Best-effort: errors are logged but
// don't break the worker loop.
func (w *SequenceWorker) pauseEnrollment(ctx context.Context, l lockedRow, reason, detail string) {
	if _, err := w.pool.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'paused',
		    pause_reason = NULLIF($2, ''),
		    paused_at = now(),
		    pause_detail = NULLIF($3, '')
		WHERE id = $1
	`, l.id, strings.TrimSpace(reason), strings.TrimSpace(detail)); err != nil {
		log.Printf("[seq-worker] pause enrollment %d: %v", l.id, err)
	}
	log.Printf("[seq-worker] enrollment %d paused: reason=%s detail=%s", l.id, reason, detail)
	audit.Log(ctx, w.pool, audit.Entry{
		Action:     "crm.sequence.paused",
		EntityType: strPtr("crm_sequence_enrollment"),
		EntityID:   &l.id,
		Metadata: map[string]any{
			"sequence_id": l.seqID, "lead_id": l.leadID,
			"reason": reason, "detail": detail,
		},
	})
	w.refreshHumanReviewForLead(ctx, l, "enrollment_paused")
}

func (w *SequenceWorker) refreshHumanReviewForLead(ctx context.Context, l lockedRow, event string) {
	if w.humanReview == nil || l.adminID <= 0 || l.leadID <= 0 {
		return
	}
	var phone string
	err := w.pool.QueryRow(ctx, `
		SELECT phone
		FROM bc_crm_leads
		WHERE id = $1 AND admin_user_id = $2
	`, l.leadID, l.adminID).Scan(&phone)
	if err != nil {
		log.Printf("[seq-worker] human review refresh lookup lead=%d event=%s: %v", l.leadID, event, err)
		return
	}
	w.refreshHumanReviewForPhone(ctx, l.adminID, phone, event)
}

func (w *SequenceWorker) refreshHumanReviewForPhone(ctx context.Context, adminID int64, phone, event string) {
	if w.humanReview == nil {
		return
	}
	phone = strings.TrimSpace(phone)
	if adminID <= 0 || phone == "" {
		return
	}
	if _, err := w.humanReview.RefreshAIHumanReviewForPhone(ctx, adminID, phone); err != nil {
		log.Printf("[seq-worker] human review refresh phone=%s event=%s: %v", phone, event, err)
	}
}

// PauseAllFollowupsForPhone is the inbound-webhook hook. When any
// inbound text arrives from a customer (including STOP opt-out), the
// webhook calls this to flip every active ai_followup enrollment for
// that (adminID, phone) pair to status='paused' with
// pause_reason='customer_replied'. Returns the count of rows paused.
//
// This is what stops a follow-up sequence the moment the customer
// re-engages. Without it, the worker would happily fire 3 follow-ups
// at someone who already replied.
//
// Side effects per paused row:
//   - bc_audit_log: 1 row (action='crm.sequence.paused')
//   - bc_crm_lead_activities: 1 row (type='sequence_paused')
//
// Idempotent: calling this for a phone with no active ai_followup
// enrollments is a no-op (returns 0).
func (w *SequenceWorker) PauseAllFollowupsForPhone(ctx context.Context, adminID int64, phone string) (int, error) {
	// Pause every active ai_followup enrollment for this phone. The
	// UPDATE ... RETURNING lets us write per-row audit + activity
	// without a second query.
	rows, err := w.pool.Query(ctx, `
		UPDATE bc_crm_sequence_enrollments e
		SET status = 'paused',
		    pause_reason = 'customer_replied',
		    paused_at = now(),
		    pause_detail = 'inbound message arrived from customer'
		FROM bc_crm_leads l
		WHERE e.admin_user_id = $1
		  AND l.admin_user_id = $1
		  AND e.lead_id = l.id
		  AND l.phone = $2
		  AND e.status = 'active'
		  AND e.mode = 'ai_followup'
		RETURNING e.id, e.sequence_id, e.lead_id
	`, adminID, phone)
	if err != nil {
		return 0, fmt.Errorf("pause followups for phone %s: %w", phone, err)
	}
	defer rows.Close()

	type paused struct {
		id, seqID, leadID int64
	}
	var pausedRows []paused
	for rows.Next() {
		var p paused
		if err := rows.Scan(&p.id, &p.seqID, &p.leadID); err != nil {
			return len(pausedRows), err
		}
		pausedRows = append(pausedRows, p)
	}
	if err := rows.Err(); err != nil {
		return len(pausedRows), err
	}

	// Per-row audit + activity writes. Best-effort: a write failure
	// on one row must not block the others.
	for _, p := range pausedRows {
		audit.Log(ctx, w.pool, audit.Entry{
			Action:     "crm.sequence.paused",
			EntityType: strPtr("crm_sequence_enrollment"),
			EntityID:   &p.id,
			Metadata: map[string]any{
				"sequence_id": p.seqID, "lead_id": p.leadID,
				"phone": phone, "reason": "customer_replied",
			},
		})
		_, _ = w.pool.Exec(ctx, `
			INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
			VALUES ($1, $2, 'sequence_paused', $3, $4::jsonb)
		`, adminID, p.leadID,
			"Smart follow-up paused — customer replied",
			fmt.Sprintf(`{"enrollment_id":%d,"sequence_id":%d,"reason":%q}`, p.id, p.seqID, "customer_replied"),
		)
	}
	return len(pausedRows), nil
}

// ScheduleFollowupCheckin inserts a single row into
// bc_crm_followup_checkins so the worker can send a "still
// interested?" message 2h after the customer replied. Called by the
// webhook after PauseAllFollowupsForPhone succeeds, when the
// enrollment had checkin_enabled=true.
//
// Returns an error if the insert fails (so the webhook can log it).
// Best-effort: a failure here doesn't unwind the pause.
func (w *SequenceWorker) ScheduleFollowupCheckin(ctx context.Context, adminID, enrollmentID, leadID int64, phone string) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO bc_crm_followup_checkins
			(admin_user_id, enrollment_id, lead_id, phone, send_after, status)
		VALUES ($1, $2, $3, $4, now() + interval '2 hours', 'pending')
	`, adminID, enrollmentID, leadID, phone)
	return err
}

// CascadePauseForLead is the terminal-stage hook called from
// MoveCRMDealStage when a lead moves to Won/Lost. Flips every active
// ai_followup enrollment for the lead to paused with
// reason='terminal_stage' and writes a single activity row.
//
// Idempotent: no-op if no active ai_followup enrollments exist.
func (w *SequenceWorker) CascadePauseForLead(ctx context.Context, adminID, leadID int64, stageName string) (int, error) {
	rows, err := w.pool.Query(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'paused',
		    pause_reason = 'terminal_stage',
		    paused_at = now(),
		    pause_detail = $3
		WHERE lead_id = $1 AND admin_user_id = $2
		  AND status = 'active' AND mode = 'ai_followup'
		RETURNING id, sequence_id
	`, leadID, adminID, "lead moved to "+stageName)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type paused struct{ id, seqID int64 }
	var out []paused
	for rows.Next() {
		var p paused
		if err := rows.Scan(&p.id, &p.seqID); err != nil {
			return len(out), err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return len(out), err
	}

	for _, p := range out {
		audit.Log(ctx, w.pool, audit.Entry{
			Action:     "crm.sequence.paused",
			EntityType: strPtr("crm_sequence_enrollment"),
			EntityID:   &p.id,
			Metadata: map[string]any{
				"sequence_id": p.seqID, "lead_id": leadID,
				"reason": "terminal_stage", "stage": stageName,
			},
		})
	}
	if len(out) > 0 {
		_, _ = w.pool.Exec(ctx, `
			INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
			VALUES ($1, $2, 'sequence_paused', $3, $4::jsonb)
		`, adminID, leadID,
			"Smart follow-up paused — lead is "+strings.ToLower(stageName),
			fmt.Sprintf(`{"reason":%q,"stage":%q,"paused_count":%d}`, "terminal_stage", stageName, len(out)),
		)
	}
	return len(out), nil
}
