package excel

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/store"
)

type UploadMapping struct {
	Phone         string            `json:"phone"`
	Name          string            `json:"name"`
	RetailerCode  string            `json:"retailer_code"`
	InvoiceNumber string            `json:"invoice_number"`
	BillingAmount string            `json:"billing_amount"`
	DueDate       string            `json:"due_date"`
	PaymentLink   string            `json:"payment_link"`
	Language      string            `json:"language"`
	TemplateVars  map[string]string `json:"template_vars"`
}

// Required headers (case-insensitive). The Excel template on the frontend ships
// with these exact names; we look them up by lower-cased key.
var requiredHeaders = []string{
	"retailer_code", "retailer_name", "whatsapp_number",
	"invoice_number", "billing_amount", "due_date",
}

func CheckHeaders(headers []string) error {
	have := map[string]bool{}
	for _, h := range headers {
		have[strings.ToLower(strings.TrimSpace(h))] = true
	}
	missing := []string{}
	for _, req := range requiredHeaders {
		if !have[req] {
			missing = append(missing, req)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required columns: %s", strings.Join(missing, ", "))
	}
	return nil
}

// ParseRow converts one Excel row (already mapped by header) into a BillingRecord
// with full validation. Returns the record (populated even on errors so we can
// show row-level error reports) and a list of validation errors.
func ParseRow(rowNum int, m map[string]string) (*models.BillingRecord, []models.ValidationError) {
	rec := &models.BillingRecord{RowNumber: rowNum}
	var errs []models.ValidationError

	code := strings.TrimSpace(m["retailer_code"])
	if code == "" {
		errs = append(errs, models.ValidationError{Field: "retailer_code", Code: "required", Message: "retailer_code is required"})
	} else {
		rec.RetailerCode = &code
	}

	name := strings.TrimSpace(m["retailer_name"])
	if name == "" {
		errs = append(errs, models.ValidationError{Field: "retailer_name", Code: "required", Message: "retailer_name is required"})
	} else {
		rec.RetailerName = &name
	}

	phone := strings.TrimSpace(m["whatsapp_number"])
	if phone == "" {
		errs = append(errs, models.ValidationError{Field: "whatsapp_number", Code: "required", Message: "whatsapp_number is required"})
	} else if !isValidE164ish(phone) {
		errs = append(errs, models.ValidationError{Field: "whatsapp_number", Code: "format", Message: "must be digits, 10-15 chars, optional leading +"})
	} else {
		rec.WhatsappNumber = &phone
	}

	inv := strings.TrimSpace(m["invoice_number"])
	if inv == "" {
		errs = append(errs, models.ValidationError{Field: "invoice_number", Code: "required", Message: "invoice_number is required"})
	} else {
		rec.InvoiceNumber = &inv
	}

	amtStr := strings.TrimSpace(m["billing_amount"])
	if amtStr == "" {
		errs = append(errs, models.ValidationError{Field: "billing_amount", Code: "required", Message: "billing_amount is required"})
	} else {
		amt, err := strconv.ParseFloat(strings.ReplaceAll(amtStr, ",", ""), 64)
		if err != nil || amt < 0 {
			errs = append(errs, models.ValidationError{Field: "billing_amount", Code: "format", Message: "must be a non-negative number"})
		} else {
			rec.BillingAmount = &amt
		}
	}

	dueStr := strings.TrimSpace(m["due_date"])
	if dueStr == "" {
		errs = append(errs, models.ValidationError{Field: "due_date", Code: "required", Message: "due_date is required"})
	} else {
		d, err := parseDate(dueStr)
		if err != nil {
			errs = append(errs, models.ValidationError{Field: "due_date", Code: "format", Message: "expected YYYY-MM-DD or DD/MM/YYYY"})
		} else {
			rec.DueDate = &d
		}
	}

	if v := strings.TrimSpace(m["payment_link"]); v != "" {
		vv := v
		rec.PaymentLink = &vv
	}
	if v := strings.TrimSpace(m["language"]); v != "" {
		vv := v
		rec.Language = &vv
	}

	if b, err := json.Marshal(m); err == nil {
		rec.RawRow = b
	}

	rec.IsValid = len(errs) == 0
	rec.ValidationErrors = errs
	return rec, errs
}

// ParseMappedRow converts a row using an operator-provided column mapping.
// Template-first upload only requires a WhatsApp number. Extra spreadsheet
// columns are preserved in RawRow and ignored safely.
func ParseMappedRow(rowNum int, original map[string]string, mapping UploadMapping) (*models.BillingRecord, []models.ValidationError) {
	rec := &models.BillingRecord{RowNumber: rowNum}
	var errs []models.ValidationError

	phoneRaw := mappedValue(original, mapping.Phone)
	phone := NormalizeWhatsAppNumber(phoneRaw)
	if phone == "" {
		errs = append(errs, models.ValidationError{Field: "whatsapp_number", Code: "required", Message: "map a phone column for WhatsApp sending"})
	} else if !isValidE164ish(phone) {
		errs = append(errs, models.ValidationError{Field: "whatsapp_number", Code: "format", Message: "phone must include 10-15 digits after cleanup"})
	} else {
		rec.WhatsappNumber = &phone
	}

	name := strings.TrimSpace(mappedValue(original, mapping.Name))
	if name == "" && phone != "" {
		if len(phone) >= 4 {
			name = "Customer " + phone[len(phone)-4:]
		} else {
			name = "Customer"
		}
	}
	if name != "" {
		rec.RetailerName = &name
	}

	code := strings.TrimSpace(mappedValue(original, mapping.RetailerCode))
	if code == "" {
		if phone != "" {
			code = phone
		} else {
			code = fmt.Sprintf("row-%d", rowNum)
		}
	}
	rec.RetailerCode = &code

	if inv := strings.TrimSpace(mappedValue(original, mapping.InvoiceNumber)); inv != "" {
		rec.InvoiceNumber = &inv
	}
	if amtStr := strings.TrimSpace(mappedValue(original, mapping.BillingAmount)); amtStr != "" {
		amt, err := strconv.ParseFloat(strings.ReplaceAll(amtStr, ",", ""), 64)
		if err != nil || amt < 0 {
			errs = append(errs, models.ValidationError{Field: "billing_amount", Code: "format", Message: "mapped amount must be a non-negative number"})
		} else {
			rec.BillingAmount = &amt
		}
	}
	if dueStr := strings.TrimSpace(mappedValue(original, mapping.DueDate)); dueStr != "" {
		d, err := parseDate(dueStr)
		if err != nil {
			errs = append(errs, models.ValidationError{Field: "due_date", Code: "format", Message: "mapped due date should be YYYY-MM-DD or DD/MM/YYYY"})
		} else {
			rec.DueDate = &d
		}
	}
	if v := strings.TrimSpace(mappedValue(original, mapping.PaymentLink)); v != "" {
		rec.PaymentLink = &v
	}
	if v := strings.TrimSpace(mappedValue(original, mapping.Language)); v != "" {
		rec.Language = &v
	}

	templateParams := map[string]string{}
	for token, column := range mapping.TemplateVars {
		token = strings.Trim(strings.TrimSpace(token), "{}")
		if token == "" || strings.TrimSpace(column) == "" {
			continue
		}
		templateParams[token] = strings.TrimSpace(mappedValue(original, column))
	}

	raw := map[string]any{
		"original":          original,
		"upload_mapping":    mapping,
		"template_params":   templateParams,
		"mapping_mode":      "template_first",
		"normalized_phone":  phone,
		"fallback_customer": name != "" && strings.TrimSpace(mappedValue(original, mapping.Name)) == "",
	}
	if b, err := json.Marshal(raw); err == nil {
		rec.RawRow = b
	}

	rec.IsValid = len(errs) == 0
	rec.ValidationErrors = errs
	return rec, errs
}

func mappedValue(row map[string]string, column string) string {
	column = strings.TrimSpace(column)
	if column == "" {
		return ""
	}
	if v, ok := row[column]; ok {
		return v
	}
	want := strings.ToLower(column)
	for k, v := range row {
		if strings.ToLower(strings.TrimSpace(k)) == want {
			return v
		}
	}
	return ""
}

func NormalizeWhatsAppNumber(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	for len(out) > 10 && strings.HasPrefix(out, "0") {
		out = out[1:]
	}
	if len(out) == 10 {
		out = "91" + out
	}
	return out
}

func isValidE164ish(s string) bool {
	if len(s) < 10 || len(s) > 15 {
		return false
	}
	if s[0] == '+' {
		s = s[1:]
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func parseDate(s string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02", "02/01/2006", "02-01-2006", "01/02/2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("bad date: %s", s)
}

// UpsertRetailerForRow is a convenience wrapper that also sets rec.RetailerID
// when a retailer master is matched/created. adminUserID stamps the
// retailer + billing record so they're scoped to the uploader.
func UpsertRetailerForRow(ctx context.Context, s *store.Store, adminUserID int64, rec *models.BillingRecord) error {
	if rec.RetailerCode == nil || rec.RetailerName == nil || rec.WhatsappNumber == nil {
		return nil
	}
	id, err := s.UpsertRetailer(ctx, adminUserID, *rec.RetailerCode, *rec.RetailerName, *rec.WhatsappNumber, "", "")
	if err != nil {
		return err
	}
	rec.RetailerID = &id
	return nil
}
