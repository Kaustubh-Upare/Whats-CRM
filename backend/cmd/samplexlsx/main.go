// cmd/samplexlsx generates frontend/public/sample-billing-template.xlsx with
// 5 valid rows + 2 intentionally invalid rows. Run:
//
//   go run ./cmd/samplexlsx ../frontend/public/sample-billing-template.xlsx
//
// (Run from inside backend/.)
package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/xuri/excelize/v2"
)

func main() {
	out := "frontend/public/sample-billing-template.xlsx"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}

	f := excelize.NewFile()
	defer f.Close()

	sheet := "Billing"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{
		"retailer_code", "retailer_name", "whatsapp_number",
		"invoice_number", "billing_amount", "due_date",
		"payment_link", "language",
	}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	// bold header
	style, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	f.SetRowStyle(sheet, 1, 1, style)

	// 5 valid + 2 invalid rows
	due := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	rows := [][]any{
		{"RET001", "Sharma Kirana Store",   "919876543210", "INV-2026-001", 12500.50, due, "https://pay.example.com/INV-2026-001", "en"},
		{"RET002", "Gupta General Store",  "919812345678", "INV-2026-002",  8725.00, due, "",                                    "en"},
		{"RET003", "Patel Provision",      "919898989898", "INV-2026-003",  3200.75, due, "https://pay.example.com/INV-2026-003", "hi"},
		{"RET004", "Reddy Wholesale",       "919811112222", "INV-2026-004", 45000.00, due, "https://pay.example.com/INV-2026-004", "en"},
		{"RET005", "Iyer Stores",           "919833334444", "INV-2026-005",  2100.00, due, "",                                    "en"},
		// Row 6: missing billing_amount (invalid)
		{"RET006", "Khan Traders",          "919855556666", "INV-2026-006",  nil,    due, "",                                    "en"},
		// Row 7: bad phone number (invalid)
		{"RET007", "Mehta & Sons",          "abc-not-a-phone", "INV-2026-007", 1500.00, due, "",                                 "en"},
	}
	for r, row := range rows {
		for c, v := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			f.SetCellValue(sheet, cell, v)
		}
	}

	// column widths
	f.SetColWidth(sheet, "A", "A", 14)
	f.SetColWidth(sheet, "B", "B", 26)
	f.SetColWidth(sheet, "C", "C", 18)
	f.SetColWidth(sheet, "D", "D", 16)
	f.SetColWidth(sheet, "E", "E", 14)
	f.SetColWidth(sheet, "F", "F", 12)
	f.SetColWidth(sheet, "G", "G", 40)
	f.SetColWidth(sheet, "H", "H", 10)

	if err := f.SaveAs(out); err != nil {
		log.Fatalf("save: %v", err)
	}
	fmt.Printf("wrote %s (%d rows: 5 valid, 2 invalid)\n", out, len(rows))
}
