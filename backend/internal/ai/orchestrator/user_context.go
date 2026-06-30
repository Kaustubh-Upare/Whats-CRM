package orchestrator

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (o *Orchestrator) loadAIUserPromptContext(ctx context.Context, adminID int64, phone string) (*aiUserPromptContext, error) {
	normalized := digitsOnly(phone)
	if adminID <= 0 || normalized == "" {
		return nil, nil
	}
	var out aiUserPromptContext
	var raw json.RawMessage
	err := o.pool.QueryRow(ctx, `
		SELECT
		  COALESCE(NULLIF(p.display_name, ''), r.retailer_name, ''),
		  r.whatsapp_number,
		  COALESCE(NULLIF(p.source, ''), 'retailer'),
		  COALESCE(p.extra_fields, '{}'::jsonb)
		FROM bc_retailers r
		LEFT JOIN bc_ai_user_profiles p
		  ON p.admin_user_id = r.admin_user_id AND p.retailer_id = r.id
		WHERE r.admin_user_id = $1
		  AND regexp_replace(r.whatsapp_number, '[^0-9]', '', 'g') = $2
		ORDER BY p.updated_at DESC NULLS LAST, r.updated_at DESC, r.id DESC
		LIMIT 1
	`, adminID, normalized).Scan(&out.Name, &out.Phone, &out.Source, &raw)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out.ExtraFields = map[string]string{}
	if len(raw) > 0 {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err == nil {
			for k, v := range m {
				k = strings.TrimSpace(k)
				if k == "" {
					continue
				}
				switch x := v.(type) {
				case string:
					out.ExtraFields[k] = strings.TrimSpace(x)
				default:
					if b, err := json.Marshal(x); err == nil {
						out.ExtraFields[k] = string(b)
					}
				}
			}
		}
	}
	return &out, nil
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
