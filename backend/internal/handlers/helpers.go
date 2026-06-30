package handlers

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/queue"
)

// buildTemplateParams maps a billing record into {{1}}..{{N}} for the template.
// We provide a sensible default mapping matching the demo Utility template:
//
//	{{1}} retailer_name
//	{{2}} period (today's date in YYYY-MM-DD)
//	{{3}} invoice_number
//	{{4}} billing_amount (formatted to 2dp)
//	{{5}} due_date (YYYY-MM-DD)
//	{{6}} support contact (placeholder "support@itc.example")
//
// For richer templates, you can change this function or use the sample payload
// stored on the template row.
func buildTemplateParams(rec models.BillingRecord, body string) []string {
	if mapped := mappedTemplateParams(rec); len(mapped) > 0 {
		tokens := templateTokens(body)
		if len(tokens) > 0 {
			out := make([]string, 0, len(tokens))
			for _, token := range tokens {
				if v, ok := mapped[token]; ok {
					out = append(out, v)
					continue
				}
				out = append(out, "")
			}
			return out
		}
	}

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

func mappedTemplateParams(rec models.BillingRecord) map[string]string {
	if len(rec.RawRow) == 0 {
		return nil
	}
	var raw map[string]any
	if err := json.Unmarshal(rec.RawRow, &raw); err != nil {
		return nil
	}
	node, ok := raw["template_params"]
	if !ok {
		return nil
	}
	out := map[string]string{}
	switch t := node.(type) {
	case map[string]any:
		for k, v := range t {
			out[strings.Trim(strings.TrimSpace(k), "{}")] = fmt.Sprint(v)
		}
	case map[string]string:
		for k, v := range t {
			out[strings.Trim(strings.TrimSpace(k), "{}")] = v
		}
	}
	return out
}

func templateTokens(body string) []string {
	out := []string{}
	seen := map[string]bool{}
	for i := 0; i < len(body)-3; {
		if body[i] == '{' && body[i+1] == '{' {
			end := strings.Index(body[i+2:], "}}")
			if end < 0 {
				break
			}
			token := strings.TrimSpace(body[i+2 : i+2+end])
			if token != "" && !seen[token] {
				seen[token] = true
				out = append(out, token)
			}
			i += 2 + end + 2
			continue
		}
		i++
	}
	return out
}

func fallbackParamForToken(rec models.BillingRecord, token string) string {
	if n, err := strconv.Atoi(token); err == nil {
		defaults := defaultTemplateParams(rec)
		if n >= 1 && n <= len(defaults) {
			return defaults[n-1]
		}
		return ""
	}
	switch strings.ToLower(token) {
	case "name", "retailer_name", "customer", "customer_name":
		if rec.RetailerName != nil {
			return *rec.RetailerName
		}
	case "phone", "whatsapp", "whatsapp_number", "mobile":
		if rec.WhatsappNumber != nil {
			return *rec.WhatsappNumber
		}
	case "invoice", "invoice_no", "invoice_number", "bill_no":
		if rec.InvoiceNumber != nil {
			return *rec.InvoiceNumber
		}
	case "amount", "billing_amount", "total", "pending":
		if rec.BillingAmount != nil {
			return fmt.Sprintf("%.2f", *rec.BillingAmount)
		}
	case "due", "due_date", "date":
		if rec.DueDate != nil {
			return rec.DueDate.Format("2006-01-02")
		}
	case "payment_link", "link":
		if rec.PaymentLink != nil {
			return *rec.PaymentLink
		}
	}
	return ""
}

func defaultTemplateParams(rec models.BillingRecord) []string {
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
	return []string{name, now, inv, amount, due, "support@itc.example"}
}

func renderBodyWithParams(body string, params []string) string {
	out := body
	for i, p := range params {
		out = strings.ReplaceAll(out, "{{"+strconv.Itoa(i+1)+"}}", p)
	}
	tokens := templateTokens(out)
	for i, token := range tokens {
		if i < len(params) {
			out = strings.ReplaceAll(out, "{{"+token+"}}", params[i])
		}
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
		MessageJobID:    jobID,
		BatchID:         rec.BatchID,
		BillingRecordID: rec.ID,
		ToNumber:        to,
		TemplateName:    tpl.Name,
		LanguageCode:    tpl.LanguageCode,
		TemplateParams:  params,
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
