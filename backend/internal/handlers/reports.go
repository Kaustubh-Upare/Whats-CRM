package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"time"
)

func (s *Server) ReportSummary(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r)
	summary, err := s.Store.ReportSummary(r.Context(), from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"from": from, "to": to, "status_counts": summary,
	})
}

// ReportTrend returns one row per day in the requested [from, to] window
// (zero-filled via Postgres generate_series) with per-day counts for sent /
// delivered / read / failed. Powers the daily-trend chart on /reports and
// supports arbitrary windows (not capped at 7 days like /api/dashboard/trend).
//
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD — both required for this endpoint
// because unlike ReportSummary, "last 7 days" doesn't make sense here (the
// chart already implies a known range from the picker).
//
// Caps: range is hard-limited to 366 days to protect the generate_series
// plan; wider requests get clamped.
func (s *Server) ReportTrend(w http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		writeErr(w, http.StatusBadRequest, "from and to are required (YYYY-MM-DD)")
		return
	}
	fromT, err := time.Parse("2006-01-02", fromStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "from: bad date — expected YYYY-MM-DD")
		return
	}
	toT, err := time.Parse("2006-01-02", toStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "to: bad date — expected YYYY-MM-DD")
		return
	}
	if toT.Before(fromT) {
		writeErr(w, http.StatusBadRequest, "to must be on or after from")
		return
	}
	// Hard cap: 366 days so a typo (from=2020-01-01) can't blow the plan up.
	maxDays := 366
	if days := int(toT.Sub(fromT).Hours()/24) + 1; days > maxDays {
		fromT = toT.AddDate(0, 0, -(maxDays - 1))
	}

	points, err := s.Store.ReportsTrend(r.Context(), fromT, toT)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The "to" returned should be the original (un-clamped) request so the UI
	// can show "Jun 12 – Jun 19" even if the chart only rendered the last 366
	// days. We still hand back the truncated window so the chart can show
	// its actual data span.
	writeJSON(w, http.StatusOK, map[string]any{
		"from":          fromStr,
		"to":            toStr,
		"rendered_from": fromT.Format("2006-01-02"),
		"rendered_to":   toT.Format("2006-01-02"),
		"points":        points,
	})
}

func (s *Server) ReportExport(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r)
	rows, _, err := s.Store.ListMessages(r.Context(), "", "", 100000, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="messages.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "retailer", "to", "status", "template", "invoice", "amount", "queued_at", "sent_at", "delivered_at", "read_at", "failed_at"})
	for _, m := range rows {
		if m.QueuedAt.Before(from) || m.QueuedAt.After(to) {
			continue
		}
		row := []string{
			fmt.Sprintf("%d", m.ID),
			derefStr(m.RetailerName),
			m.ToNumber,
			m.Status,
			m.TemplateName,
			derefStr(m.InvoiceNumber),
			derefFloat(m.Amount),
			m.QueuedAt.Format(time.RFC3339),
			fmtTime(m.SentAt),
			fmtTime(m.DeliveredAt),
			fmtTime(m.ReadAt),
			fmtTime(m.FailedAt),
		}
		_ = cw.Write(row)
	}
	cw.Flush()
}

func parseRange(r *http.Request) (time.Time, time.Time) {
	now := time.Now()
	from := now.AddDate(0, 0, -7)
	to := now
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			to = t.Add(24 * time.Hour)
		}
	}
	return from, to
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefFloat(f *float64) string {
	if f == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *f)
}

func fmtTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}
