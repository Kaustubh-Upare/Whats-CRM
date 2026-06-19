package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/queue"
)

// buildTemplateParams maps a billing record into {{1}}..{{N}} for the template.
// We provide a sensible default mapping matching the demo Utility template:
//   {{1}} retailer_name
//   {{2}} period (today's date in YYYY-MM-DD)
//   {{3}} invoice_number
//   {{4}} billing_amount (formatted to 2dp)
//   {{5}} due_date (YYYY-MM-DD)
//   {{6}} support contact (placeholder "support@itc.example")
// For richer templates, you can change this function or use the sample payload
// stored on the template row.
func buildTemplateParams(rec models.BillingRecord, body string) []string {
	varsNeeded := countVars(body)
	now := time.Now().Format("2006-01-02")
	amount := ""
	if rec.BillingAmount != nil {
		amount = fmt.Sprintf("%.2f", *rec.BillingAmount)
	}
	due := ""
	if rec.DueDate != nil {
		due = rec.DueDate.Format("2006-01-02")
	}
	inv := ""
	if rec.InvoiceNumber != nil {
		inv = *rec.InvoiceNumber
	}
	name := ""
	if rec.RetailerName != nil {
		name = *rec.RetailerName
	}
	defaults := []string{name, now, inv, amount, due, "support@itc.example"}
	if varsNeeded <= len(defaults) {
		return defaults[:varsNeeded]
	}
	// pad with empty strings if template needs more vars
	out := append([]string{}, defaults...)
	for len(out) < varsNeeded {
		out = append(out, "")
	}
	return out
}

func countVars(body string) int {
	max := 0
	for i := 1; i <= 20; i++ {
		token := fmt.Sprintf("{{%d}}", i)
		if !strings.Contains(body, token) {
			break
		}
		max = i
	}
	return max
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func queueJob(jobID int64, rec models.BillingRecord, tpl *models.Template, params []string) queue.MessageJob {
	to := ""
	if rec.WhatsappNumber != nil {
		to = *rec.WhatsappNumber
	}
	return queue.MessageJob{
		MessageJobID:   jobID,
		BatchID:        rec.BatchID,
		BillingRecordID: rec.ID,
		ToNumber:       to,
		TemplateName:   tpl.Name,
		LanguageCode:   tpl.LanguageCode,
		TemplateParams: params,
	}
}

// renderPreview substitutes template_params into the template body to produce
// a human-readable preview for the chat-list UI. Truncates to ~80 chars.
func renderPreview(j *models.MessageJob) string {
	body := j.TemplateName
	// Prefer the actual stored template body if we have it on the join side;
	// store-side falls back to template_name. The chat-list path passes the
	// job only, so for the conversation row we use the stored params directly.
	if len(j.TemplateParams) > 0 {
		var params []string
		if err := json.Unmarshal(j.TemplateParams, &params); err == nil {
			// Apply same {{N}} substitution as buildTemplateParams
			// to a synthetic body of {{1}} {{2}} ... so the preview shows
			// the params in order. If the real template body is known,
			// pass it via the second arg (future enhancement).
			body = ""
			for i, p := range params {
				if i > 0 {
					body += " "
				}
				body += p
			}
		}
	}
	if len(body) > 80 {
		body = body[:77] + "…"
	}
	return body
}
