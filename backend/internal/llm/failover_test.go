package llm

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// stubProvider is a minimal Provider implementation for tests. It
// returns the configured response on success, or the configured error
// on failure. Streaming is a 2-event show: one TextDelta then Done.
type stubProvider struct {
	name      string
	models    []string
	chatResp  *ChatResponse
	chatErr   error
	streamErr error // when set, the stream emits an ErrorEvent then closes

	// callCount counts how many times Stream / Chat were invoked. Used
	// to assert the failover chain walks providers in order.
	callCount int
}

func (s *stubProvider) Name() string { return s.name }

func (s *stubProvider) SupportsModel(model string) bool {
	if model == "" {
		return true
	}
	for _, m := range s.models {
		if m == model {
			return true
		}
	}
	return false
}

func (s *stubProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	s.callCount++
	if s.chatErr != nil {
		return nil, s.chatErr
	}
	return s.chatResp, nil
}

func (s *stubProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	s.callCount++
	if s.streamErr != nil {
		out := make(chan StreamEvent, 1)
		out <- ErrorEvent{Err: s.streamErr, Message: s.streamErr.Error()}
		close(out)
		return out, nil
	}
	out := make(chan StreamEvent, 4)
	if s.chatResp != nil && s.chatResp.Text != "" {
		out <- TextDeltaEvent{Text: s.chatResp.Text}
	}
	out <- DoneEvent{StopReason: "end_turn"}
	close(out)
	return out, nil
}

func (s *stubProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return nil, ErrEmbedUnsupported
}

// --- Chat failover tests ---

func TestFailoverChatPrimarySucceeds(t *testing.T) {
	primary := &stubProvider{
		name:     "primary",
		chatResp: &ChatResponse{Text: "ok", Usage: Usage{InputTokens: 10, OutputTokens: 5}},
	}
	fb := &stubProvider{name: "fallback", chatResp: &ChatResponse{Text: "fb"}}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})

	resp, err := f.Chat(context.Background(), ChatRequest{Model: "primary-model"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Text != "ok" {
		t.Errorf("text = %q, want %q", resp.Text, "ok")
	}
	if primary.callCount != 1 {
		t.Errorf("primary callCount = %d, want 1", primary.callCount)
	}
	if fb.callCount != 0 {
		t.Errorf("fallback callCount = %d, want 0 (primary succeeded)", fb.callCount)
	}
}

func TestFailoverChatWalksChainOnError(t *testing.T) {
	primary := &stubProvider{name: "primary", chatErr: errors.New("upstream down")}
	fb := &stubProvider{name: "fallback", chatResp: &ChatResponse{Text: "from-fb"}}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})

	resp, err := f.Chat(context.Background(), ChatRequest{Model: "primary-model"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Text != "from-fb" {
		t.Errorf("text = %q, want %q", resp.Text, "from-fb")
	}
	if primary.callCount != 1 {
		t.Errorf("primary callCount = %d, want 1", primary.callCount)
	}
	if fb.callCount != 1 {
		t.Errorf("fallback callCount = %d, want 1", fb.callCount)
	}
}

func TestFailoverChatAllDownReturnsError(t *testing.T) {
	primary := &stubProvider{name: "primary", chatErr: errors.New("p-fail")}
	fb := &stubProvider{name: "fallback", chatErr: errors.New("fb-fail")}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})

	_, err := f.Chat(context.Background(), ChatRequest{Model: "primary-model"})
	if err == nil {
		t.Fatal("expected AllProvidersDownError, got nil")
	}
	var allDown *AllProvidersDownError
	if !errors.As(err, &allDown) {
		t.Fatalf("err is not AllProvidersDownError: %T", err)
	}
	if len(allDown.Errors) != 2 {
		t.Errorf("allDown.Errors has %d entries, want 2", len(allDown.Errors))
	}
}

// --- Stream failover tests ---

func TestFailoverStreamSuccessPrimary(t *testing.T) {
	primary := &stubProvider{name: "primary", chatResp: &ChatResponse{Text: "hi"}}
	fb := &stubProvider{name: "fallback", chatResp: &ChatResponse{Text: "from-fb"}}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})

	ch, err := f.Stream(context.Background(), ChatRequest{Model: "primary-model"})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var sawText, sawDone bool
	for evt := range ch {
		switch v := evt.(type) {
		case TextDeltaEvent:
			sawText = true
			if v.Text != "hi" {
				t.Errorf("text = %q, want %q", v.Text, "hi")
			}
		case DoneEvent:
			sawDone = true
		case ErrorEvent:
			t.Errorf("unexpected ErrorEvent: %v", v.Err)
		}
	}
	if !sawText {
		t.Error("did not see TextDeltaEvent")
	}
	if !sawDone {
		t.Error("did not see DoneEvent")
	}
	if fb.callCount != 0 {
		t.Errorf("fallback should not be called, got %d", fb.callCount)
	}
}

func TestFailoverStreamWalksChainOnStreamError(t *testing.T) {
	primary := &stubProvider{name: "primary", streamErr: errors.New("primary-stream-broken")}
	fb := &stubProvider{name: "fallback", chatResp: &ChatResponse{Text: "fallback-text"}}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})
	f.MaxRetries = 0 // don't retry primary

	ch, err := f.Stream(context.Background(), ChatRequest{Model: "primary-model"})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var sawFallbackText bool
	var lastEvent StreamEvent
	for evt := range ch {
		lastEvent = evt
		if v, ok := evt.(TextDeltaEvent); ok && v.Text == "fallback-text" {
			sawFallbackText = true
		}
	}
	if !sawFallbackText {
		t.Error("did not see fallback text")
	}
	// Final event should be DoneEvent from the fallback.
	if _, ok := lastEvent.(DoneEvent); !ok {
		t.Errorf("last event = %T, want DoneEvent", lastEvent)
	}
}

func TestFailoverStreamAllDownEmitsError(t *testing.T) {
	primary := &stubProvider{name: "primary", streamErr: errors.New("p-fail")}
	fb := &stubProvider{name: "fallback", streamErr: errors.New("fb-fail")}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fb-model"}})
	f.MaxRetries = 0

	ch, err := f.Stream(context.Background(), ChatRequest{Model: "primary-model"})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var lastEvent StreamEvent
	for evt := range ch {
		lastEvent = evt
	}
	errEvt, ok := lastEvent.(ErrorEvent)
	if !ok {
		t.Fatalf("last event = %T, want ErrorEvent", lastEvent)
	}
	if _, isAllDown := errEvt.Err.(*AllProvidersDownError); !isAllDown {
		t.Errorf("err = %T, want *AllProvidersDownError", errEvt.Err)
	}
}

func TestFailoverSupportsModelDelegates(t *testing.T) {
	primary := &stubProvider{name: "primary", models: []string{"primary-model", "shared"}}
	fb := &stubProvider{name: "fallback", models: []string{"fallback-model", "shared"}}
	f := NewFailover(primary, []FallbackTarget{{Provider: fb, Model: "fallback-model"}})

	if !f.SupportsModel("primary-model") {
		t.Error("expected failover to support primary-model")
	}
	if !f.SupportsModel("fallback-model") {
		t.Error("expected failover to support fallback-model")
	}
	if !f.SupportsModel("shared") {
		t.Error("expected failover to support shared (both support it)")
	}
	if f.SupportsModel("totally-unknown-model") {
		t.Error("expected failover to NOT support totally-unknown-model")
	}
}

// --- AllProvidersDownError ---

func TestAllProvidersDownErrorFormat(t *testing.T) {
	e := &AllProvidersDownError{Errors: []error{errors.New("a"), errors.New("b")}}
	msg := e.Error()
	if !strings.Contains(msg, "all LLM providers failed") {
		t.Errorf("Error() missing prefix: %q", msg)
	}
	if !strings.Contains(msg, "b") {
		t.Errorf("Error() should include last error: %q", msg)
	}
}

func TestIsFatal(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"context-cancelled", context.Canceled, true},
		{"context-deadline", context.DeadlineExceeded, true},
		{"all-providers-down", &AllProvidersDownError{}, true},
		{"plain-error", errors.New("plain"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsFatal(tc.err); got != tc.want {
				t.Errorf("IsFatal(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// Sanity check that time.Duration is used somewhere — ensures the
// package compiles even if a future refactor removes the field's
// only consumer.
var _ = 100 * time.Millisecond