package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/whatsyitc/backend/internal/audit"
)

func strconvItoa(n int) string { return strconv.Itoa(n) }

// WebhookVerify handles GET — Meta verification handshake.
func (s *Server) WebhookVerify(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")
	ok := mode == "subscribe" && token == os.Getenv("WHATS_VERIFY_TOKEN")
	s.logWebhookVerifyAttempt(r, ok, mode, challenge)
	if ok {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(challenge))
		return
	}
	http.Error(w, "forbidden", http.StatusForbidden)
}

func (s *Server) logWebhookVerifyAttempt(r *http.Request, ok bool, mode, challenge string) {
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
	})
	if _, err := s.Store.InsertWebhookLog(r.Context(), ip, r.UserAgent(), kind, payload, 0, 0, nil); err != nil {
		log.Printf("[webhook] verify log insert failed: %v", err)
	}
	log.Printf("[webhook] verify path=%s ok=%v mode=%q challenge=%v ip=%s", r.URL.Path, ok, mode, challenge != "", ip)
}

// MetaStatusPayload is the shape of a delivery-status webhook.
// Sample:
//
//	{
//	  "object":"whatsapp_business_account",
//	  "entry":[{"changes":[{"value":{"statuses":[
//	    {"id":"wamid.HBgL...","status":"delivered","timestamp":"1718700000","recipient_id":"91..."}]}}]}]
//	}
type MetaStatusPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		Changes []struct {
			Value struct {
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
				// Inbound messages from the user (separate from status updates).
				// When a retailer replies to us, Meta sends a 'messages' array.
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
				// Kept as a fallback for old/sample payloads. Real Meta inbound
				// reply context lives inside each messages[] item.
				Context struct {
					From string `json:"from"`
					ID   string `json:"id"`
				} `json:"context"`
				// Contacts who sent the message (handy for resolving retailer
				// identity when there's no parent job).
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
		// Still log the raw payload so we can debug what Meta sent.
		if _, logErr := s.Store.InsertWebhookLog(r.Context(), ip, ua, "error", body, 0, 0, &parseErrMsg); logErr != nil {
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
	log.Printf("[webhook] hit kind=%s messages=%d statuses=%d ip=%s bytes=%d", kind, msgCount, statusCount, ip, len(body))
	if _, err := s.Store.InsertWebhookLog(r.Context(), ip, ua, kind, body, msgCount, statusCount, nil); err != nil {
		log.Printf("[webhook] log insert failed: %v", err)
	}

	ctx := r.Context()
	for _, e := range p.Entry {
		for _, c := range e.Changes {
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
				_ = s.Store.MarkJobStatus(ctx, job.ID, status, &wamid, reasonText)
				audit.Log(ctx, s.Store.DB, audit.Entry{
					Action:     "message.status." + status,
					EntityType: strPtr("message"),
					EntityID:   &job.ID,
					Metadata:   map[string]any{"wamid": wamid, "recipient": st.RecipientID},
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
				jobID, err := s.recordInbound(ctx, msg.From, body, parentWamid, msg.Timestamp, "webhook", contactName)
				log.Printf("[webhook] inbound: from=%s body=%q parent=%s inbound=%s -> jobID=%d err=%v", msg.From, body, parentWamid, msg.ID, jobID, err)
			}
		}
	}
	w.WriteHeader(http.StatusOK)
}

// recordInbound persists one inbound text message from a retailer. Used by
// both the real Meta webhook and the /api/dev/simulate-inbound dev tool so
// they share the exact same code path.
//
//   - parentWamid: the wamid of the message the retailer is replying to
//     (empty string for an unsolicited first message).
//   - timestamp:   unix-seconds string from Meta, or "" (we use time.Now()).
//   - source:      "webhook" or "dev" — written into the audit log so we
//     can tell how the inbound arrived.
//   - contactName: optional. If non-empty, used to upgrade the retailer
//     row's name (overwrites the "(unknown)" placeholder
//     that CreateOrphanInboundJob sets).
//
// Returns the resolved message_job_id (existing parent job, or new orphan job).
func (s *Server) recordInbound(ctx context.Context, phone, body, parentWamid, timestamp, source, contactName string) (int64, error) {
	parentJob, _ := s.Store.FindJobByProviderMsgID(ctx, parentWamid)
	if parentJob == nil {
		// Orphan inbound — no parent job on our side. Create a synthetic
		// inbound-only message_job so the chat thread exists.
		newID, err := s.Store.CreateOrphanInboundJob(ctx, phone, body, timestamp)
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
			Metadata:   map[string]any{"from": phone, "body_len": len(body), "source": source, "contact_name": contactName},
		})
		return newID, nil
	}

	receivedStatus := "received"
	if err := s.Store.InsertStatusEvent(ctx, parentJob.ID, nil, &receivedStatus, nil, &body, nil); err != nil {
		return parentJob.ID, err
	}
	audit.Log(ctx, s.Store.DB, audit.Entry{
		Action:     "message.received",
		EntityType: strPtr("message"),
		EntityID:   &parentJob.ID,
		Metadata:   map[string]any{"from": phone, "body_len": len(body), "source": source},
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
// retailer without needing a live Meta webhook. Useful for the /chats UI
// when the user wants to test the conversation view from the admin side
// without a real Meta round-trip (e.g. before ngrok is configured).
//
// POST /api/dev/simulate-inbound
//
//	{ "phone": "919168810152", "body": "Hello from retailer", "name": "OFFLINE" }
//
// Shares the same recordInbound code path as the real webhook, so a single
// fix here updates both.
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
	jobID, err := s.recordInbound(r.Context(), req.Phone, req.Body, req.ParentWA, "", "dev", req.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "job_id": jobID, "phone": req.Phone,
	})
}
