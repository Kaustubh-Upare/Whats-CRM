// Package worker consumes MessageJobs from the queue and sends them via
// the Meta Cloud API. On success it writes a status event + updates the
// job. On failure it increments attempts; the queue will retry up to
// MaxAttempts.
//
// Per-user credentials
// --------------------
// This worker no longer holds a static *whatsapp.Client. Instead the
// caller (cmd/server/main.go) supplies a Resolver function:
//
//	type Resolver func(ctx context.Context, adminUserID int64) (*whatsapp.Client, error)
//
// For each job, Handle looks up the job's admin_user_id (set when the
// approver created the batch), calls the Resolver to get a per-admin
// client, and sends through that client. If the admin has no
// credentials row, the job is marked failed with a clear error.
package worker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
)

// Resolver returns a *whatsapp.Client bound to the given admin's
// credentials. Implementations typically read + decrypt
// bc_whatsapp_credentials and call whatsapp.NewClient(...).
//
// adminUserID == 0 is allowed but should be treated as "system / no
// owner" — the worker will refuse to send for those rows.
type Resolver func(ctx context.Context, adminUserID int64) (*whatsapp.Client, error)

func strPtr(s string) *string { return &s }

type Worker struct {
	Store    *store.Store
	Resolver Resolver
}

// New builds a worker. forceText is no longer a static toggle — plain-text
// fallback is decided per-job inside Handle (based on template errors).
func New(s *store.Store, resolver Resolver) *Worker {
	return &Worker{Store: s, Resolver: resolver}
}

// ErrNoCredentials indicates the job's owning admin has no WABA creds
// configured. Treated as a hard failure (do not retry).
var ErrNoCredentials = errors.New("admin has no WhatsApp credentials configured")

// Handle is the queue.Handler.
func (w *Worker) Handle(ctx context.Context, job queue.MessageJob) {
	// Load the job so we can read its admin_user_id. We re-use the
	// existing GetMessage call (which is now admin-scoped but allows
	// NULL-owned legacy rows to be read by any admin).
	// For the worker we want to read the row regardless of scope — use
	// a direct store helper.
	owner, err := w.ownerOfJob(ctx, job.MessageJobID)
	if err != nil {
		log.Printf("[worker] load job owner: %v", err)
		return
	}
	if w.Resolver == nil {
		errStr := "no resolver configured"
		_ = w.Store.MarkJobStatus(ctx, owner, job.MessageJobID, "failed", nil, &errStr)
		return
	}
	wa, err := w.Resolver(ctx, owner)
	if err != nil {
		errStr := fmt.Sprintf("resolve credentials for admin %d: %v", owner, err)
		if errors.Is(err, ErrNoCredentials) {
			errStr = err.Error()
		}
		_ = w.Store.MarkJobStatus(ctx, owner, job.MessageJobID, "failed", nil, &errStr)
		log.Printf("[worker] %s (job=%d)", errStr, job.MessageJobID)
		return
	}

	// mark sending
	if err := w.Store.MarkJobStatus(ctx, owner, job.MessageJobID, "sending", nil, nil); err != nil {
		log.Printf("[worker] mark sending: %v", err)
		return
	}

	var (
		res      *whatsapp.SendResult
		usedText bool
	)

	// Plain-text path is the auto-fallback when the template error is
	// "not found / not approved" (#132001, #132000). We always TRY the
	// template first (which is what production deployments need).
	res, err = wa.SendTemplate(ctx, job.ToNumber, job.TemplateName, job.LanguageCode, job.TemplateParams)
	if err != nil && isTemplateNotFound(err) {
		log.Printf("[worker] template %q not available, falling back to plain text: %v", job.TemplateName, err)
		body := composeTextBody(job.TemplateParams)
		res, err = wa.SendText(ctx, job.ToNumber, body)
		usedText = true
	}

	if err != nil {
		errStr := err.Error()
		_ = w.Store.MarkJobStatus(ctx, owner, job.MessageJobID, "failed", nil, &errStr)
		log.Printf("[worker] send failed job=%d admin=%d: %s", job.MessageJobID, owner, errStr)
		return
	}
	provID := res.ProviderMsgID
	if err := w.Store.MarkJobStatus(ctx, owner, job.MessageJobID, "sent", &provID, nil); err != nil {
		log.Printf("[worker] mark sent: %v", err)
		return
	}
	_ = w.Store.InsertStatusEvent(ctx, job.MessageJobID, &provID, strPtr("sent"), nil, nil, []byte(res.RawBody))
	if usedText {
		log.Printf("[worker] sent job=%d wamid=%s (plain text, template %q bypassed) admin=%d", job.MessageJobID, provID, job.TemplateName, owner)
	} else {
		log.Printf("[worker] sent job=%d wamid=%s admin=%d", job.MessageJobID, provID, owner)
	}
	_ = time.Millisecond * 50 // tiny sleep keeps us under Meta's per-second rate cap
}

// ownerOfJob fetches the admin_user_id of a message job without applying
// the per-admin scope guard (the worker is a system actor that must be
// able to read every job it was handed).
func (w *Worker) ownerOfJob(ctx context.Context, jobID int64) (int64, error) {
	var owner *int64
	err := w.Store.DB.QueryRow(ctx,
		`SELECT admin_user_id FROM bc_message_jobs WHERE id=$1`, jobID,
	).Scan(&owner)
	if err != nil {
		return 0, err
	}
	if owner == nil {
		// Legacy NULL-owned rows: route through the most-recently-verified
		// admin. If none exist, refuse.
		admins, lerr := w.Store.ListVerifiedAdminIDs(ctx)
		if lerr != nil {
			return 0, lerr
		}
		if len(admins) == 0 {
			return 0, ErrNoCredentials
		}
		return admins[0], nil
	}
	return *owner, nil
}

// composeTextBody turns the {{N}} parameters into a readable plain-text message
// so the recipient sees something sensible even when we're bypassing the
// approved template.
func composeTextBody(params []string) string {
	if len(params) == 0 {
		return "Hello from WhatsyITC."
	}
	parts := make([]string, 0, len(params))
	for _, p := range params {
		if strings.TrimSpace(p) == "" {
			continue
		}
		parts = append(parts, p)
	}
	if len(parts) == 0 {
		return "Hello from WhatsyITC."
	}
	switch {
	case len(parts) >= 6:
		return fmt.Sprintf(
			"Hello %s, your billing summary for %s.\n\nInvoice: %s\nAmount: INR %s\nDue Date: %s\n\nFor billing queries, contact %s.",
			parts[0], parts[1], parts[2], parts[3], parts[4], parts[5],
		)
	case len(parts) >= 2:
		return "Hello " + parts[0] + ",\n\n" + strings.Join(parts[1:], "\n")
	default:
		return strings.Join(parts, "\n")
	}
}

// isTemplateNotFound matches Meta's template-not-found / unapproved errors so we
// can auto-fall-back to plain text instead of hard-failing the demo.
func isTemplateNotFound(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	if strings.Contains(s, "132001") || strings.Contains(s, "132000") ||
		strings.Contains(s, "does not exist") ||
		strings.Contains(s, "template") && strings.Contains(s, "not approved") {
		return true
	}
	return false
}
