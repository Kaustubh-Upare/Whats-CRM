// Package handlers wires every HTTP endpoint for the billingcomm service.
// Each handler is a method on Server (so they share *store.Store + *config).
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/whatsyitc/backend/internal/config"
	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
)

type Server struct {
	Cfg   *config.Config
	Store *store.Store
	WA    *whatsapp.Client
	Queue queue.JobQueue
}

func NewServer(cfg *config.Config, st *store.Store, wa *whatsapp.Client, q queue.JobQueue) *Server {
	return &Server{Cfg: cfg, Store: st, WA: wa, Queue: q}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func intParam(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func int64Param(r *http.Request, key string) (int64, bool) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
