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
// when a retailer master is matched/created.
func UpsertRetailerForRow(ctx context.Context, s *store.Store, rec *models.BillingRecord) error {
	if rec.RetailerCode == nil || rec.RetailerName == nil || rec.WhatsappNumber == nil {
		return nil
	}
	id, err := s.UpsertRetailer(ctx, *rec.RetailerCode, *rec.RetailerName, *rec.WhatsappNumber, "", "")
	if err != nil {
		return err
	}
	rec.RetailerID = &id
	return nil
}
