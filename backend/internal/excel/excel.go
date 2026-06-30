// Package excel reads .xlsx (via excelize) and .csv files and returns the
// header row + each data row. Validation + business logic live in handlers.
package excel

import (
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/xuri/excelize/v2"
)

type Sheet struct {
	Headers []string
	Rows    [][]string // each row is a slice of strings, one per column
}

func Read(path string) (*Sheet, error) {
	lower := strings.ToLower(path)
	if strings.HasSuffix(lower, ".csv") {
		return readCSV(path)
	}
	return readXLSX(path)
}

func readCSV(path string) (*Sheet, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	all, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("csv: %w", err)
	}
	if len(all) == 0 {
		return &Sheet{}, nil
	}
	headers := trimAll(all[0])
	out := &Sheet{Headers: headers}
	for _, row := range all[1:] {
		out.Rows = append(out.Rows, trimAll(row))
	}
	return out, nil
}

func readXLSX(path string) (*Sheet, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("xlsx: no sheets")
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, fmt.Errorf("xlsx: read sheet %q: %w", sheets[0], err)
	}
	if len(rows) == 0 {
		return &Sheet{}, nil
	}
	headers := trimAll(rows[0])
	out := &Sheet{Headers: headers}
	for _, row := range rows[1:] {
		out.Rows = append(out.Rows, trimAll(row))
	}
	return out, nil
}

func trimAll(s []string) []string {
	for i := range s {
		s[i] = strings.TrimSpace(s[i])
	}
	return s
}

// ToMap converts a row to a map keyed by header (lowercased, trimmed).
func (s *Sheet) ToMap(row []string) map[string]string {
	m := make(map[string]string, len(s.Headers))
	for i, h := range s.Headers {
		key := strings.ToLower(strings.TrimSpace(h))
		if i < len(row) {
			m[key] = row[i]
		} else {
			m[key] = ""
		}
	}
	return m
}

// ToOriginalMap converts a row to a map keyed by the exact header text. This
// is useful for upload mapping UIs where the operator sees the original column
// names from their spreadsheet.
func (s *Sheet) ToOriginalMap(row []string) map[string]string {
	m := make(map[string]string, len(s.Headers))
	for i, h := range s.Headers {
		key := strings.TrimSpace(h)
		if i < len(row) {
			m[key] = row[i]
		} else {
			m[key] = ""
		}
	}
	return m
}

var _ = io.EOF // keep io import in case we add streaming later
