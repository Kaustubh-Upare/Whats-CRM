package llm

import (
	"context"
	"errors"
)

// Provider is the abstraction every concrete LLM backend implements.
//
// One Provider per (vendor, protocol) — not per model. So Bedrock is
// one Provider that routes to multiple model ids; OpenAI is another.
// The Router (router.go) picks the (Provider, Model) pair; the
// Failover wrapper (failover.go) walks a chain of Provider calls.
//
// Methods:
//   - Name:    short identifier used in metrics (e.g. "bedrock", "openai").
//   - Chat:    non-streaming convenience call. Most callers should use Stream.
//   - Stream:  the hot path. Returns a buffered channel of typed events.
//              MUST close the channel when the call ends (success or error).
//   - Embed:   vendor-specific embeddings (OpenAI today; Bedrock Titan
//              in future). Returning an error from a provider without
//              Embed is allowed — callers MUST check before calling.
type Provider interface {
	Name() string

	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)

	Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error)

	// Embed is optional. Providers that don't support embeddings
	// return ErrEmbedUnsupported.
	Embed(ctx context.Context, texts []string) ([][]float32, error)

	// SupportsModel returns true if this provider can serve the
	// requested model id. Used by Router and Failover to skip
	// providers that don't know the model.
	SupportsModel(model string) bool
}

// ErrEmbedUnsupported is returned by Provider.Embed when the vendor
// doesn't ship an embedding endpoint. Callers fall back to OpenAI.
var ErrEmbedUnsupported = errors.New("provider does not support embeddings")

// ErrAllProvidersDown is returned by Failover when every provider in
// the chain has been tried and all errored. The Errors slice is in
// call order so the caller can log the full failure trail.
type AllProvidersDownError struct {
	Errors []error
}

func (e *AllProvidersDownError) Error() string {
	if len(e.Errors) == 0 {
		return "all LLM providers failed"
	}
	return "all LLM providers failed (last: " + e.Errors[len(e.Errors)-1].Error() + ")"
}

// Unwrap returns the last error in the chain so errors.Is / errors.As
// can probe for specific causes (e.g. context.Canceled).
func (e *AllProvidersDownError) Unwrap() error {
	if len(e.Errors) == 0 {
		return nil
	}
	return e.Errors[len(e.Errors)-1]
}

// IsFatal returns true when an error is non-recoverable and the
// failover chain should abort (e.g. context cancelled, request
// validation failed). Non-fatal errors (5xx, rate limit, network
// blip) walk the failover chain.
func IsFatal(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// ErrAllProvidersDown is the terminal error from the failover
	// wrapper — calling failover on it would loop.
	var allDown *AllProvidersDownError
	if errors.As(err, &allDown) {
		return true
	}
	return false
}
