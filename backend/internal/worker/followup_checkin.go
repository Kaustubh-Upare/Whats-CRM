package worker

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// runFollowupCheckins is invoked from SequenceWorker.tickOnce. It
// picks up to batch pending "still interested?" check-in rows whose
// send_after <= now(), generates the body via the orchestrator's
// FollowUpGenerator, sends via the Resolver, and marks each row
// sent/cancelled.
//
// Cancellation: a fresh inbound webhook pause call updates the
// enrollment's pause_reason and we then cancel any still-pending
// check-in for that enrollment by flipping its status. This is what
// prevents "still interested?" from going out to a customer who
// already replied again.
//
// Idempotency: a row can only transition pending → sent or pending →
// cancelled. Once sent or cancelled, it stays that way.
func (w *SequenceWorker) runFollowupCheckins(ctx context.Context) {
	if w.followup == nil {
		return
	}

	rows, err := w.pool.Query(ctx, `
		SELECT c.id, c.admin_user_id, c.enrollment_id, c.lead_id, c.phone,
		       COALESCE(e.pause_reason, '') AS pause_reason
		FROM bc_crm_followup_checkins c
		JOIN bc_crm_sequence_enrollments e ON e.id = c.enrollment_id
		WHERE c.status = 'pending'
		  AND c.send_after <= now()
		ORDER BY c.send_after ASC
		LIMIT $1
	`, w.batch)
	if err != nil {
		log.Printf("[seq-worker] checkins: select: %v", err)
		return
	}

	type row struct {
		id, adminID, enrollmentID, leadID int64
		phone, pauseReason                string
	}
	var due []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.adminID, &r.enrollmentID, &r.leadID, &r.phone, &r.pauseReason); err == nil {
			due = append(due, r)
		}
	}
	rows.Close()

	for _, r := range due {
		w.processCheckin(ctx, r)
	}
}

// processCheckin handles one check-in row.
//
// Lifecycle:
//   - pending + send_after <= now()
//       - if pause_reason is now 'customer_replied' (the customer
//         replied AGAIN within the 2h window), cancel instead of send.
//       - else generate body via FollowUpGenerator, send via
//         Resolver, mark status='sent'.
//   - any error: leave the row in 'pending' (we'll try again next
//     tick). After 6h we could escalate; for now the 2h window
//     means a stuck row sits there harmlessly.
func (w *SequenceWorker) processCheckin(ctx context.Context, r struct {
	id, adminID, enrollmentID, leadID int64
	phone, pauseReason                string
}) {
	if r.pauseReason == "customer_replied" {
		w.cancelCheckin(ctx, r.id, "replied_again")
		return
	}

	// Resolve sender.
	if w.resolver == nil {
		w.cancelCheckin(ctx, r.id, "no_sender")
		return
	}
	wa, err := w.resolver(ctx, r.adminID)
	if err != nil || wa == nil {
		w.cancelCheckin(ctx, r.id, "no_sender")
		return
	}

	// Generate the "still interested?" body via the orchestrator.
	// The check-in flow always uses the default/custom prompt
	// (never the agentic "decide whether to send" prompt) because
	// the check-in itself IS the decision — if we got here, the
	// worker has already decided a check-in is warranted.
	// Check-ins are keyed on phone, not batch, so pass nil for
	// batchID — the orchestrator uses the admin's global default.
	body, err := w.followup.GenerateFollowUp(ctx, r.adminID, nil, r.phone,
		"still_interested", "", "", "custom")
	if err != nil {
		log.Printf("[seq-worker] checkin %d: GenerateFollowUp: %v", r.id, err)
		// Leave pending — we'll retry next tick.
		return
	}

	// Send with the same retry loop as the main worker, but inline
	// here so we don't have to thread it through.
	var lastErr error
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, sendErr := wa.SendText(sendCtx, r.phone, body)
		cancel()
		if sendErr == nil {
			lastErr = nil
			break
		}
		lastErr = sendErr
		log.Printf("[seq-worker] checkin %d: send attempt %d/%d failed: %v",
			r.id, attempt, MaxAttempts, sendErr)
		if attempt < MaxAttempts {
			select {
			case <-ctx.Done():
				return
			case <-time.After(seqBackoff(attempt)):
			}
		}
	}
	if lastErr != nil {
		log.Printf("[seq-worker] checkin %d: giving up: %v", r.id, lastErr)
		w.cancelCheckin(ctx, r.id, "send_failed")
		return
	}

	// Mark sent. Atomic check so we don't double-send if two ticks
	// raced.
	ct, err := w.pool.Exec(ctx, `
		UPDATE bc_crm_followup_checkins
		SET status = 'sent'
		WHERE id = $1 AND status = 'pending'
	`, r.id)
	if err != nil || ct.RowsAffected() == 0 {
		// Already flipped to cancelled by a concurrent inbound.
		return
	}
	log.Printf("[seq-worker] checkin %d sent for %s (enrollment %d)",
		r.id, r.phone, r.enrollmentID)
}

// cancelCheckin flips a row to cancelled. Idempotent: if the row is
// already sent or cancelled, this is a no-op.
func (w *SequenceWorker) cancelCheckin(ctx context.Context, id int64, reason string) {
	_, err := w.pool.Exec(ctx, `
		UPDATE bc_crm_followup_checkins
		SET status = 'cancelled', cancel_reason = $2
		WHERE id = $1 AND status = 'pending'
	`, id, reason)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("[seq-worker] cancel checkin %d: %v", id, err)
	}
}

// ScheduleFollowupCheckinForPhone inserts a check-in row for every
// active (post-pause) ai_followup enrollment on this phone that has
// checkin_enabled=true. Called by the webhook's pause hook so the
// customer gets one final "still interested?" message 2h after they
// replied.
//
// Best-effort: errors are logged. The pause itself already
// succeeded; a check-in failure just means no follow-up message
// goes out (the customer already replied, after all).
func (w *SequenceWorker) ScheduleFollowupCheckinForPhone(ctx context.Context, adminID int64, phone string) (int, error) {
	// Find all paused ai_followup enrollments on this phone that
	// have checkin_enabled=true AND don't already have a pending
	// check-in scheduled.
	rows, err := w.pool.Query(ctx, `
		SELECT e.id, e.lead_id
		FROM bc_crm_sequence_enrollments e
		JOIN bc_crm_leads l ON l.id = e.lead_id
		WHERE e.admin_user_id = $1
		  AND l.admin_user_id = $1
		  AND l.phone = $2
		  AND e.status = 'paused'
		  AND e.mode = 'ai_followup'
		  AND e.checkin_enabled = TRUE
		  AND e.pause_reason = 'customer_replied'
		  AND NOT EXISTS (
		    SELECT 1 FROM bc_crm_followup_checkins c
		    WHERE c.enrollment_id = e.id
		      AND c.status = 'pending'
		  )
	`, adminID, phone)
	if err != nil {
		return 0, err
	}
	type row struct {
		id, leadID int64
	}
	var due []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.leadID); err == nil {
			due = append(due, r)
		}
	}
	rows.Close()

	inserted := 0
	for _, r := range due {
		_, err := w.pool.Exec(ctx, `
			INSERT INTO bc_crm_followup_checkins
				(admin_user_id, enrollment_id, lead_id, phone, send_after, status)
			VALUES ($1, $2, $3, $4, now() + interval '2 hours', 'pending')
		`, adminID, r.id, r.leadID, phone)
		if err != nil {
			log.Printf("[seq-worker] schedule checkin for enrollment %d: %v", r.id, err)
			continue
		}
		inserted++
	}
	return inserted, nil
}

// ensurePool is a tiny sanity guard used by tests; we keep the
// pgxpool import for followup_checkin.go even when the parent
// sequence.go owns the actual poll loop.
var _ = pgxpool.Pool{}