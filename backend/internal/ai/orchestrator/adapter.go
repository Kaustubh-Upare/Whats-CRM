// Package orchestrator — WhatsApp adapter.
//
// whatsappAdapter wraps the live *whatsapp.Client (which has a
// context-aware SendText) into the orchestrator.Sender interface so
// the orchestrator can be tested with a stub without touching
// WhatsApp.
package orchestrator

import (
	"context"
	"log/slog"

	"github.com/whatsyitc/backend/internal/whatsapp"
)

// whatsappAdapter wraps a *whatsapp.Client into the orchestrator's
// Sender interface. The provider is supplied pre-constructed so
// cmd/server/main.go reads its env vars once.
type whatsappAdapter struct {
	provider *whatsapp.Client
}

// NewWhatsAppAdapter builds the adapter.
func NewWhatsAppAdapter(p *whatsapp.Client) Sender {
	return &whatsappAdapter{provider: p}
}

func (a *whatsappAdapter) SendText(ctx context.Context, to, body string) error {
	// Live provider is already context-aware. We log a warning if
	// the caller's context was already cancelled so the
	// orchestrator's loop knows not to retry.
	if err := ctx.Err(); err != nil {
		slog.Warn("orchestrator: ctx cancelled before send", "to", to, "err", err)
		return err
	}
	_, err := a.provider.SendText(ctx, to, body)
	return err
}