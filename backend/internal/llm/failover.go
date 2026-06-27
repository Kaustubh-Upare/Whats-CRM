package llm

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Failover is a Provider wrapper that walks a chain of providers on
// error. The agent loop talks to Failover as if it were a single
// provider; failover is invisible to callers.
//
// Behavior
// --------
//   - Stream / Chat try the primary provider first.
//   - On a *recoverable* error (5xx, network blip, rate limit, transient
//     SDK error), the wrapper walks the fallback chain in order.
//   - On a *fatal* error (context cancelled, validation error, schema
//     failure), the wrapper stops immediately — fallbacks would just
//     fail the same way.
//   - AllProvidersDownError is returned when every provider in the
//     chain errors out.
//
// Routing note
// ------------
// The Failover wraps a primary provider + a list of (provider, model)
// fallbacks. The model id in ChatRequest is treated as the primary's
// model id; fallbacks carry their own model ids so a DeepSeek outage
// can fall through to OpenAI gpt-4.1.
type Failover struct {
	primary   Provider
	fallbacks []FallbackTarget

	// MaxRetries is the number of times the failover wrapper will
	// retry the PRIMARY provider before falling through. 0 (default)
	// means: try primary once, then fall through. 1 means: try primary
	// twice with backoff, then fall through. We keep this low because
	// each retry adds latency the customer feels.
	MaxRetries int

	// RetryBackoff is the sleep between primary retries. Default 200ms.
	RetryBackoff time.Duration
}

// FallbackTarget pairs a Provider with a model id for one failover hop.
// The model id is what the wrapper substitutes into ChatRequest.Model
// before calling the fallback provider.
type FallbackTarget struct {
	Provider Provider
	Model    string
}

// NewFailover wraps a primary provider with the supplied fallback
// targets. fallbacks can be empty (failover degenerates to single
// provider).
func NewFailover(primary Provider, fallbacks []FallbackTarget) *Failover {
	if fallbacks == nil {
		fallbacks = []FallbackTarget{}
	}
	return &Failover{
		primary:      primary,
		fallbacks:    fallbacks,
		MaxRetries:   1,
		RetryBackoff: 200 * time.Millisecond,
	}
}

func (f *Failover) Name() string { return "failover(" + f.primary.Name() + ")" }

// SupportsModel returns true if either the primary or any fallback
// supports the requested model id.
func (f *Failover) SupportsModel(model string) bool {
	if f.primary.SupportsModel(model) {
		return true
	}
	for _, fb := range f.fallbacks {
		if fb.Provider.SupportsModel(model) {
			return true
		}
	}
	return false
}

// Embed is pass-through to the primary if it supports embeddings;
// otherwise the first fallback that does. Returns ErrEmbedUnsupported
// if no provider in the chain supports embeddings.
func (f *Failover) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if _, err := f.primary.Embed(ctx, nil); err == nil || !errors.Is(err, ErrEmbedUnsupported) {
		return f.primary.Embed(ctx, texts)
	}
	for _, fb := range f.fallbacks {
		if _, err := fb.Provider.Embed(ctx, nil); err == nil || !errors.Is(err, ErrEmbedUnsupported) {
			return fb.Provider.Embed(ctx, texts)
		}
	}
	return nil, ErrEmbedUnsupported
}

// Chat walks the failover chain. Returns the first successful
// response or AllProvidersDownError with every underlying error.
func (f *Failover) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	providers := f.chain(req.Model)
	errs := make([]error, 0, len(providers))

	for i, hop := range providers {
		hopReq := req
		if hop.modelOverride != "" {
			hopReq.Model = hop.modelOverride
		}
		resp, err := hop.provider.Chat(ctx, hopReq)
		if err == nil {
			if i > 0 {
				slog.Warn("llm_failover_chat", "from", f.primary.Name(), "to", hop.provider.Name(),
					"attempt", i+1, "model", hopReq.Model)
			}
			return resp, nil
		}
		errs = append(errs, fmt.Errorf("%s: %w", hop.provider.Name(), err))
		if IsFatal(err) {
			return nil, &AllProvidersDownError{Errors: errs}
		}
	}
	return nil, &AllProvidersDownError{Errors: errs}
}

// Stream walks the failover chain. The returned channel emits events
// from the first provider that successfully completes. Errors from
// the failed providers are collected and returned as the last event
// before the channel closes (if all fail).
//
// Behavior detail: we attempt the primary (with up to MaxRetries-1
// retries) before walking the fallback chain. The first successful
// stream takes over; subsequent streams are not started.
func (f *Failover) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	providers := f.chain(req.Model)
	if len(providers) == 0 {
		return nil, &AllProvidersDownError{Errors: []error{errors.New("no providers configured")}}
	}

	// We attempt each provider sequentially. For the primary, we
	// retry up to MaxRetries times on transient errors before
	// walking the chain. Implementation: spawn a goroutine that
	// runs the chain and pumps events into a single output channel.

	out := make(chan StreamEvent, 64)
	errsCh := make(chan error, len(providers))

	go f.runChain(ctx, req, providers, out, errsCh)

	return out, nil
}

// runChain is the streaming failover driver. It blocks until one of:
//   - a provider stream emits a DoneEvent (success path)
//   - all providers error out (all-down path)
//   - the context is cancelled (fatal path)
//
// On success it pipes the chosen provider's events to out and closes.
// On all-down it emits an ErrorEvent containing AllProvidersDownError
// and closes.
func (f *Failover) runChain(ctx context.Context, req ChatRequest, providers []hop, out chan<- StreamEvent, errsCh chan<- error) {
	defer close(out)

	tried := make([]error, 0, len(providers))

	for i, hop := range providers {
		hopReq := req
		if hop.modelOverride != "" {
			hopReq.Model = hop.modelOverride
		}

		attempts := 1
		if i == 0 && f.MaxRetries > 0 {
			attempts = 1 + f.MaxRetries
		}

		var streamCh <-chan StreamEvent
		var lastErr error

		for attempt := 1; attempt <= attempts; attempt++ {
			ch, err := hop.provider.Stream(ctx, hopReq)
			if err != nil {
				lastErr = fmt.Errorf("%s: %w", hop.provider.Name(), err)
				tried = append(tried, lastErr)
				if IsFatal(err) {
					out <- ErrorEvent{Err: &AllProvidersDownError{Errors: tried}, Fatal: true,
						Message: "fatal error on provider"}
					return
				}
				continue
			}
			streamCh = ch
			lastErr = nil
			break
		}

		if streamCh == nil {
			// All retries on this provider failed; fall through.
			if i > 0 {
				slog.Warn("llm_failover_provider", "from", providers[i-1].provider.Name(),
					"to", hop.provider.Name(), "err", lastErr)
			}
			continue
		}

		// We have a stream. Pump events to out until Done, Error, or
		// context cancellation. Any ErrorEvent that isn't fatal is
		// treated as "this provider's stream failed, try the next".
		gotFatal := false
		for evt := range streamCh {
			if errEvt, ok := evt.(ErrorEvent); ok {
				tried = append(tried, fmt.Errorf("%s: %s", hop.provider.Name(), errEvt.Message))
				if errEvt.Fatal {
					out <- ErrorEvent{
						Err:     &AllProvidersDownError{Errors: tried},
						Fatal:   true,
						Message: "fatal mid-stream error",
					}
					gotFatal = true
				}
				break
			}
			out <- evt
			if _, ok := evt.(DoneEvent); ok {
				// Successful end of stream.
				return
			}
		}

		if gotFatal {
			return
		}
		// Loop fell out without a DoneEvent — provider's stream ended
		// with an ErrorEvent. Try the next provider in the chain.
		if i > 0 {
			slog.Warn("llm_failover_stream", "from", providers[i-1].provider.Name(),
				"to", hop.provider.Name())
		}
	}

	// Every provider failed.
	out <- ErrorEvent{
		Err:     &AllProvidersDownError{Errors: tried},
		Fatal:   true,
		Message: "all providers down",
	}
}

// hop is one (provider, optional model override) pair in the failover
// chain. modelOverride == "" means "use req.Model verbatim".
type hop struct {
	provider      Provider
	modelOverride string
}

// chain returns the failover chain for a given primary model.
// fallbacks carry their own model ids (set when NewFailover was
// called); the primary keeps the original model id.
func (f *Failover) chain(primaryModel string) []hop {
	out := make([]hop, 0, 1+len(f.fallbacks))
	out = append(out, hop{provider: f.primary, modelOverride: ""})
	for _, fb := range f.fallbacks {
		out = append(out, hop{provider: fb.Provider, modelOverride: fb.Model})
	}
	return out
}

// Compile-time assertion: *Failover satisfies Provider.
var _ Provider = (*Failover)(nil)