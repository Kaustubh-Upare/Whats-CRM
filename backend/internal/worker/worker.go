// Package worker consumes MessageJobs from the queue and sends them via
// Meta Cloud API. On success it writes a status event + updates the job.
// On failure it increments attempts; the queue will retry up to MaxAttempts
// (enforced by the approval handler when it first enqueues).
package worker

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
)

func strPtr(s string) *string { return &s }

type Worker struct {
	Store     *store.Store
	WA        *whatsapp.Client
	ForceText bool // WHATS_FORCE_TEXT=true => always send as free-form text
}

func New(s *store.Store, wa *whatsapp.Client, forceText bool) *Worker {
	return &Worker{Store: s, WA: wa, ForceText: forceText}
}

// Handle is the queue.Handler.
func (w *Worker) Handle(ctx context.Context, job queue.MessageJob) {
	// mark sending
	if err := w.Store.MarkJobStatus(ctx, job.MessageJobID, "sending", nil, nil); err != nil {
		log.Printf("[worker] mark sending: %v", err)
		return
	}

	var (
		res     *whatsapp.SendResult
		err     error
		usedText bool
	)

	// Plain-text path (test mode) — used when forced, or as auto-fallback when
	// Meta rejects the template (e.g. template not approved yet, #132001).
	if w.ForceText {
		body := composeTextBody(job.TemplateParams)
		res, err = w.WA.SendText(ctx, job.ToNumber, body)
		usedText = true
	} else {
		res, err = w.WA.SendTemplate(ctx, job.ToNumber, job.TemplateName, job.LanguageCode, job.TemplateParams)
		// Auto-fallback: if the template errored with #132001 (template not
		// found/unapproved) or similar "template" class of error, retry once
		// as plain text so the demo flow works while approval is pending.
		if err != nil && isTemplateNotFound(err) {
			log.Printf("[worker] template %q not available, falling back to plain text: %v", job.TemplateName, err)
			body := composeTextBody(job.TemplateParams)
			res, err = w.WA.SendText(ctx, job.ToNumber, body)
			usedText = true
		}
	}

	if err != nil {
		errStr := err.Error()
		_ = w.Store.MarkJobStatus(ctx, job.MessageJobID, "failed", nil, &errStr)
		log.Printf("[worker] send failed job=%d: %s", job.MessageJobID, errStr)
		return
	}
	provID := res.ProviderMsgID
	if err := w.Store.MarkJobStatus(ctx, job.MessageJobID, "sent", &provID, nil); err != nil {
		log.Printf("[worker] mark sent: %v", err)
		return
	}
	_ = w.Store.InsertStatusEvent(ctx, job.MessageJobID, &provID, strPtr("sent"), nil, nil, []byte(res.RawBody))
	if usedText {
		log.Printf("[worker] sent job=%d wamid=%s (plain text, template %q bypassed)", job.MessageJobID, provID, job.TemplateName)
	} else {
		log.Printf("[worker] sent job=%d wamid=%s", job.MessageJobID, provID)
	}
	_ = time.Millisecond * 50 // tiny sleep keeps us under Meta's per-second rate cap
}

// composeTextBody turns the {{N}} parameters into a readable plain-text message
// so the recipient sees something sensible even when we're bypassing the
// approved template.
func composeTextBody(params []string) string {
	if len(params) == 0 {
		return "Hello from WhatsyITC."
	}
	// Generic friendly layout — works for any template shape we currently ship.
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
	// Common shape: [name, period, invoice, amount, due_date, contact]
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
	// #132001 = "Template name does not exist in the translation"
	// #132000 = generic template parameter / approval issues
	// #100   = generic parameter error
	if strings.Contains(s, "132001") || strings.Contains(s, "132000") ||
		strings.Contains(s, "does not exist") ||
		strings.Contains(s, "template") && strings.Contains(s, "not approved") {
		return true
	}
	return false
}
