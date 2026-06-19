package audit

import (
	"context"
	"encoding/json"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	ActorID    *int64
	ActorEmail *string
	Action     string
	EntityType *string
	EntityID   *int64
	Metadata   any
	IPAddress  *string
	UserAgent  *string
}

func Log(ctx context.Context, db *pgxpool.Pool, e Entry) {
	if e.Action == "" {
		return
	}
	var metaBytes []byte
	if e.Metadata != nil {
		if b, err := json.Marshal(e.Metadata); err == nil {
			metaBytes = b
		}
	}
	_, err := db.Exec(ctx, `
		INSERT INTO bc_audit_logs
			(actor_id, actor_email, action, entity_type, entity_id, metadata, ip_address, user_agent)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, e.ActorID, e.ActorEmail, e.Action, e.EntityType, e.EntityID, metaBytes, e.IPAddress, e.UserAgent)
	if err != nil {
		log.Printf("[audit] insert failed action=%s err=%v", e.Action, err)
	}
}
