package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/whatsyitc/backend/internal/audit"
)

func strconvItoa(n int) string { return strconv.Itoa(n) }

// WebhookVerify handles GET — Meta verification handshake.
//
// In the per-user-credentials model the verify token is per admin (stored
// in bc_whatsapp_credentials.verify_token, AES-GCM encrypted). We look
// it up by decrypting every row and constant-time-comparing; the first
// match wins. This is O(N) over admins but the handshake happens at
// most a handful of times per deployment.
func (s *Server) WebhookVerify(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")
	ok := mode == "subscribe"
	adminID := int64(0)
	if ok {
		adminID, _ = s.Store.FindAdminByVerifyToken(r.Context(), s.Cfg.FieldEncKey, token)
		ok = adminID > 0
	}
	s.logWebhookVerifyAttempt(r, adminID, ok, mode, challenge)
	if ok {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(challenge))
		return
	}
	http.Error(w, "forbidden", http.StatusForbidden)
}

func (s *Server) logWebhookVerifyAttempt(r *http.Request, adminID int64, ok bool, mode, challenge string) {
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip = xff
	}
	kind := "verify_failed"
	if ok {
		kind = "verify"
	}
	payload, _ := json.Marshal(map[string]any{
		"path":          r.URL.Path,
		"mode":          mode,
		"token_matches": ok,
		"has_challenge": challenge != "",
		"admin_id":      adminID,
	})
	if _, err := s.Store.InsertWebhookLog(r.Context(), adminID, ip, r.UserAgent(), kind, payload, 0, 0, nil); err != nil {
		log.Printf("[webhook] verify log insert failed: %v", err)
	}
	log.Printf("[webhook] verify path=%s ok=%v mode=%q challenge=%v ip=%s admin=%d", r.URL.Path, ok, mode, challenge != "", ip, adminID)
}

// MetaStatusPayload is the shape of a delivery-status webhook. Real
// Meta payloads include `metadata.phone_number_id` inside each
// `value`, which we use to attribute the payload to the right admin.
type MetaStatusPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		Changes []struct {
			Value struct {
				// Meta attaches `metadata: { phone_number_id, display_phone_number }`
				// to every webhook delivery. We use phone_number_id to look up
				// the owning admin.
				Metadata struct {
					PhoneNumberID      string `json:"phone_number_id"`
					DisplayPhoneNumber string `json:"display_phone_number"`
				} `json:"metadata"`
				Statuses []struct {
					ID          string `json:"id"`
					Status      string `json:"status"`
					Timestamp   string `json:"timestamp"`
					RecipientID string `json:"recipient_id"`
					Errors      []struct {
						Code  int    `json:"code"`
						Title string `json:"title"`
					} `json:"errors,omitempty"`
				} `json:"statuses"`
				Messages []struct {
					ID        string `json:"id"`
					From      string `json:"from"`
					Timestamp string `json:"timestamp"`
					Type      string `json:"type"`
					Context   struct {
						From string `json:"from"`
						ID   string `json:"id"`
					} `json:"context"`
					Text struct {
						Body string `json:"body"`
					} `json:"text"`
				} `json:"messages"`
				Context struct {
					From string `json:"from"`
					ID   string `json:"id"`
				} `json:"context"`
				Contacts []struct {
					Profile struct {
						Name string `json:"name"`
					} `json:"profile"`
					WaID string `json:"wa_id"`
				} `json:"contacts"`
			} `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

func (s *Server) WebhookStatus(w http.ResponseWriter, r *http.Request) {
	body, _ := readAll(r)
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip = xff
	}
	ua := r.UserAgent()

	var p MetaStatusPayload
	parseErrMsg := ""
	if err := json.Unmarshal(body, &p); err != nil {
		parseErrMsg = err.Error()
		// We can't attribute to any admin until the JSON parses, so log as
		// NULL-owner. The UI still shows this row in the "shared" feed for
		// every admin (so no one is blind to a broken webhook).
		if _, logErr := s.Store.InsertWebhookLog(r.Context(), 0, ip, ua, "error", body, 0, 0, &parseErrMsg); logErr != nil {
			log.Printf("[webhook] log insert failed after parse error: %v", logErr)
		}
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	// Pre-count entries for the log row.
	msgCount := 0
	statusCount := 0
	for _, e := range p.Entry {
		for _, c := range e.Changes {
			statusCount += len(c.Value.Statuses)
			msgCount += len(c.Value.Messages)
		}
	}
	kind := "unknown"
	switch {
	case msgCount > 0 && statusCount > 0:
		kind = "mixed"
	case msgCount > 0:
		kind = "message"
	case statusCount > 0:
		kind = "status"
	}

	// Attribute the payload to the admin that owns the phone_number_id
	// Meta told us about. We use the FIRST phone_number_id we see in the
	// payload (multi-entry payloads from the same WABA are the common
	// case; mixed-WABA payloads are unusual and resolve to the first
	// claimed phone).
	var adminID int64
	for _, e := range p.Entry {
		for _, c := range e.Changes {
			if c.Value.Metadata.PhoneNumberID != "" {
				adminID, _ = s.Store.FindAdminByPhoneNumberID(r.Context(), c.Value.Metadata.PhoneNumberID)
				if adminID > 0 {
					break
				}
			}
		}
		if adminID > 0 {
			break
		}
	}

	log.Printf("[webhook] hit kind=%s messages=%d statuses=%d ip=%s bytes=%d admin=%d", kind, msgCount, statusCount, ip, len(body), adminID)
	if _, err := s.Store.InsertWebhookLog(r.Context(), adminID, ip, ua, kind, body, msgCount, statusCount, nil); err != nil {
		log.Printf("[webhook] log insert failed: %v", err)
	}

	ctx := r.Context()
	for _, e := range p.Entry {
		for _, c := range e.Changes {
			// Per-change admin resolution (in case the payload is mixed-WABA).
			changeAdminID := adminID
			if c.Value.Metadata.PhoneNumberID != "" {
				if aid, _ := s.Store.FindAdminByPhoneNumberID(ctx, c.Value.Metadata.PhoneNumberID); aid > 0 {
					changeAdminID = aid
				}
			}

			for _, st := range c.Value.Statuses {
				wamid := st.ID
				job, err := s.Store.FindJobByProviderMsgID(ctx, wamid)
				if err != nil || job == nil {
					continue
				}
				status := strings.ToLower(st.Status)
				statusPtr := &status
				var reasonCode, reasonText *string
				if len(st.Errors) > 0 {
					cd := strconvItoa(st.Errors[0].Code)
					tt := st.Errors[0].Title
					reasonCode = &cd
					reasonText = &tt
				}
				_ = s.Store.InsertStatusEvent(ctx, job.ID, &wamid, statusPtr, reasonCode, reasonText, body)
				_ = s.Store.MarkJobStatus(ctx, changeAdminID, job.ID, status, &wamid, reasonText)
				audit.Log(ctx, s.Store.DB, audit.Entry{
					Action:     "message.status." + status,
					EntityType: strPtr("message"),
					EntityID:   &job.ID,
					Metadata:   map[string]any{"wamid": wamid, "recipient": st.RecipientID, "admin_id": changeAdminID},
				})
			}

			// Inbound: when a retailer replies (or messages us first), Meta sends a
			// 'messages' array alongside (or instead of) 'statuses'. Each text
			// message is recorded via recordInbound (handles reply + orphan).
			for _, msg := range c.Value.Messages {
				body := strings.TrimSpace(msg.Text.Body)
				if msg.Type != "text" || body == "" {
					continue
				}
				parentWamid := msg.Context.ID
				if parentWamid == "" {
					parentWamid = c.Value.Context.ID
				}
				// Look up the contact's display name from the same payload
				// (the contacts array is keyed by wa_id = sender phone).
				contactName := ""
				for _, ct := range c.Value.Contacts {
					if ct.WaID == msg.From {
						contactName = ct.Profile.Name
						break
					}
				}
				jobID, err := s.recordInbound(ctx, changeAdminID, msg.From, body, parentWamid, msg.Timestamp, "webhook", contactName)
				log.Printf("[webhook] inbound: from=%s body=%q parent=%s inbound=%s -> jobID=%d admin=%d err=%v", msg.From, body, parentWamid, msg.ID, jobID, changeAdminID, err)
				if err == nil {
					if _, rerr := s.Store.RefreshAIHumanReviewForPhone(ctx, changeAdminID, msg.From); rerr != nil {
						log.Printf("[webhook] human review refresh for %s: %v", msg.From, rerr)
					}
				}

				// Phase 7: pause any active AI follow-up enrollments
				// for this phone before short-circuiting (opt-out)
				// or handing to the orchestrator. Without this hook,
				// the worker would happily fire follow-ups at someone
				// who already replied. Best-effort: a pause failure
				// doesn't break the inbound path.
				if s.Worker != nil {
					if n, perr := s.Worker.PauseAllFollowupsForPhone(ctx, changeAdminID, msg.From); perr != nil {
						log.Printf("[webhook] pause followups for %s: %v", msg.From, perr)
					} else if n > 0 {
						log.Printf("[webhook] paused %d followup enrollment(s) for %s (customer replied)", n, msg.From)
						// Schedule "still interested?" check-in(s)
						// for any paused enrollment that opted in.
						if sched, serr := s.Worker.ScheduleFollowupCheckinForPhone(ctx, changeAdminID, msg.From); serr != nil {
							log.Printf("[webhook] schedule checkins for %s: %v", msg.From, serr)
						} else if sched > 0 {
							log.Printf("[webhook] scheduled %d followup check-in(s) for %s", sched, msg.From)
						}
					}
				}

				// Phase 6: forward to the AI orchestrator (or the
				// opt-out handler) for every inbound text message.
				// Opt-out is checked first so a STOP message never
				// triggers an LLM call.
				if isOptOut(body) {
					if err := s.handleOptOut(ctx, changeAdminID, msg.From); err != nil {
						log.Printf("[webhook] opt-out: %v", err)
					}
					continue
				}
				if s.Orch != nil {
					go s.Orch.HandleInbound(context.Background(), changeAdminID, msg.From, body)
				}
			}
		}
	}
	w.WriteHeader(http.StatusOK)
}

// isOptOut returns true when the message body matches a common
// opt-out keyword. Case-insensitive, whitespace-trimmed.
//
// Phase 6: recognised keywords — STOP, UNSUBSCRIBE, CANCEL, END,
// QUIT, OPT-OUT, OPTOUT, OPT OUT. Anything else passes through to
// the agent loop.
func isOptOut(body string) bool {
	b := strings.ToLower(strings.TrimSpace(body))
	switch b {
	case "stop", "unsubscribe", "cancel", "end", "quit",
		"opt-out", "optout", "opt out":
		return true
	}
	return false
}

// handleOptOut flips the conversation status to 'resolved' with
// handoff_reason='opt_out' and inserts a 'customer.opt_out' audit
// row. The conversation is no longer eligible for AI replies until
// an admin re-enables it manually.
func (s *Server) handleOptOut(ctx context.Context, adminID int64, phone string) error {
	// Look up the conversation row (or no-op if there is none).
	var (
		convID  int64
		convKey string
	)
	err := s.Store.DB.QueryRow(ctx, `
		SELECT id, conversation_key FROM bc_ai_conversation_states
		WHERE admin_user_id = $1 AND phone = $2
		ORDER BY updated_at DESC
		LIMIT 1
	`, adminID, phone).Scan(&convID, &convKey)
	if err == pgx.ErrNoRows {
		// No conversation yet — nothing to opt out of. Just audit.
		audit.Log(ctx, s.Store.DB, audit.Entry{
			Action:     "customer.opt_out",
			EntityType: strPtr("bc_ai_conversation"),
			Metadata:   map[string]any{"phone": phone, "admin_id": adminID, "no_conversation": true},
		})
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.Store.DB.Exec(ctx, `
		UPDATE bc_ai_conversation_states
		SET status = 'resolved', handoff_reason = 'opt_out', handed_off_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, convID, adminID)
	if err != nil {
		return err
	}
	_, _ = s.Store.DB.Exec(ctx, `
		INSERT INTO bc_ai_handoffs (conversation_key, admin_user_id, from_actor, to_actor, reason)
		VALUES ($1, $2, 'customer', 'system', 'opt_out_keyword')
	`, convKey, adminID)
	audit.Log(ctx, s.Store.DB, audit.Entry{
		Action:     "customer.opt_out",
		EntityType: strPtr("bc_ai_conversation"),
		EntityID:   &convID,
		Metadata:   map[string]any{"phone": phone, "admin_id": adminID},
	})
	log.Printf("[webhook] opt-out: admin=%d phone=%s conv=%d", adminID, phone, convID)
	return nil
}

// recordInbound persists one inbound text message from a retailer. Used by
// both the real Meta webhook and the /api/dev/simulate-inbound dev tool so
// they share the exact same code path.
//
//   - adminID: the resolved owner (from the webhook payload's
//     metadata.phone_number_id). 0 = unowned / system.
//   - parentWamid: the wamid of the message the retailer is replying to
//     (empty string for an unsolicited first message).
//   - timestamp:   unix-seconds string from Meta, or "" (we use time.Now()).
//   - source:      "webhook" or "dev" — written into the audit log so we
//     can tell how the inbound arrived.
//   - contactName: optional. If non-empty, used to upgrade the retailer
//     row's name (overwrites the "(unknown)" placeholder that
//     CreateOrphanInboundJob sets).
//
// Returns the resolved message_job_id (existing parent job, or new orphan job).
func (s *Server) recordInbound(ctx context.Context, adminID int64, phone, body, parentWamid, timestamp, source, contactName string) (int64, error) {
	parentJob, _ := s.Store.FindJobByProviderMsgID(ctx, parentWamid)
	if parentJob == nil {
		// Orphan inbound — no parent job on our side. Create a synthetic
		// inbound-only message_job so the chat thread exists.
		newID, err := s.Store.CreateOrphanInboundJob(ctx, adminID, phone, body, timestamp)
		if err != nil {
			return 0, err
		}
		// Upgrade the placeholder retailer name if Meta told us the contact's
		// display name (it appears in the same webhook payload).
		if contactName = strings.TrimSpace(contactName); contactName != "" && contactName != "(unknown)" {
			_ = s.Store.UpdateRetailerNameByPhone(ctx, phone, contactName)
		}
		audit.Log(ctx, s.Store.DB, audit.Entry{
			Action:     "message.received.orphan",
			EntityType: strPtr("message"),
			EntityID:   &newID,
			Metadata:   map[string]any{"from": phone, "body_len": len(body), "source": source, "contact_name": contactName, "admin_id": adminID},
		})
		return newID, nil
	}

	receivedStatus := "received"
	if err := s.Store.InsertStatusEvent(ctx, parentJob.ID, nil, &receivedStatus, nil, &body, nil); err != nil {
		return parentJob.ID, err
	}
	// Use the parent's admin id (or fallback to the webhook-resolved one).
	owner := adminID
	if parentJob.AdminUserID != nil && *parentJob.AdminUserID > 0 {
		owner = *parentJob.AdminUserID
	}
	audit.Log(ctx, s.Store.DB, audit.Entry{
		Action:     "message.received",
		EntityType: strPtr("message"),
		EntityID:   &parentJob.ID,
		Metadata:   map[string]any{"from": phone, "body_len": len(body), "source": source, "admin_id": owner},
	})
	return parentJob.ID, nil
}

func readAll(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 2048)
	for {
		n, err := r.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			break
		}
	}
	return buf, nil
}

// SimulateInbound is a dev/test helper that records an inbound text from a
// retailer without needing a live Meta webhook. The dev path attributes the
// inbound to the most recently verified admin (same fallback rule the real
// webhook uses when phone_number_id can't be resolved).
//
// POST /api/dev/simulate-inbound
//
//	{ "phone": "919168810152", "body": "Hello from retailer", "name": "OFFLINE" }
func (s *Server) SimulateInbound(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone    string `json:"phone"`
		Body     string `json:"body"`
		Name     string `json:"name"`
		ParentWA string `json:"parent_wamid"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Phone = strings.TrimSpace(req.Phone)
	req.Body = strings.TrimSpace(req.Body)
	if req.Phone == "" || req.Body == "" {
		writeErr(w, http.StatusBadRequest, "phone and body required")
		return
	}
	if req.Name == "" {
		req.Name = "(unknown)"
	}
	adminID := int64(0)
	if ids, err := s.Store.ListVerifiedAdminIDs(r.Context()); err == nil && len(ids) > 0 {
		adminID = ids[0]
	}
	jobID, err := s.recordInbound(r.Context(), adminID, req.Phone, req.Body, req.ParentWA, "", "dev", req.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = s.Store.RefreshAIHumanReviewForPhone(r.Context(), adminID, req.Phone)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "job_id": jobID, "phone": req.Phone, "admin_id": adminID,
	})
}
