package llm

import (
	"context"
	"errors"
)

// Registry is the single object the rest of the app holds. It owns the
// provider set + router + transcriber, and exposes the high-level
// operations the agent loop needs:
//
//   - Chat / Stream    routed LLM calls with failover
//   - Embed            embeddings (OpenAI today)
//   - Transcribe       voice-note text (Deepgram)
//
// All of these are no-ops (returning errors) when the corresponding
// provider is not configured, so a deployment without AWS / OpenAI /
// Deepgram keys boots fine and the AI features stay disabled.
type Registry struct {
	cfg         RegistryConfig
	providers   map[string]Provider // by provider name
	transcriber Transcriber
	router      *Router

	// primary is the Provider returned to the agent loop. It's a
	// Failover wrapping Bedrock + fallback targets when configured,
	// or the OpenAI provider alone when only OpenAI is available.
	primary Provider
}

// RegistryConfig mirrors the LLM-related fields on config.Config so
// the caller can construct one without depending on the config package
// (useful in tests).
type RegistryConfig struct {
	AWSRegion             string
	AWSAccessKey          string
	AWSSecretKey          string
	BedrockBearerToken    string
	BedrockOpenAIAPIKey   string
	BedrockOpenAIBaseURL  string
	BedrockModel          string
	OpenAIAPIKey          string
	OpenAIBaseURL         string
	OpenAIModel           string
	EmbedModel            string
	EmbedDim              int
	OpenAIChatEnabled     bool
	OpenAIFallbackEnabled bool
	DeepgramAPIKey        string
	DeepgramModel         string
	BedrockDeepSeek       string
	BedrockClaudeSonnet   string
	BedrockClaudeHaiku    string
	BedrockProfile        string
}

// NewRegistry builds the full LLM stack. It NEVER log.Fatals — the
// caller (cmd/server/main.go) logs at startup and decides whether the
// disabled state is acceptable.
func NewRegistry(ctx context.Context, cfg RegistryConfig) (*Registry, error) {
	r := &Registry{
		cfg:       cfg,
		providers: map[string]Provider{},
	}

	// --- Bedrock ---
	var bedrock Provider
	if cfg.BedrockOpenAIAPIKey != "" && cfg.BedrockOpenAIBaseURL != "" {
		bp, err := NewOpenAICompatibleProvider(OpenAICompatibleConfig{
			APIKey:       cfg.BedrockOpenAIAPIKey,
			BaseURL:      cfg.BedrockOpenAIBaseURL,
			DefaultModel: firstSet(cfg.BedrockModel, cfg.BedrockDeepSeek, cfg.BedrockClaudeSonnet),
			ProviderName: "bedrock",
		})
		if err == nil {
			bedrock = bp
			r.providers["bedrock"] = bp
		}
	} else if cfg.AWSRegion != "" && (cfg.AWSAccessKey != "" || cfg.BedrockBearerToken != "" || hasAmbientAWSCreds()) {
		bp, err := NewBedrockProvider(ctx, BedrockConfig{
			Region:               cfg.AWSRegion,
			AccessKeyID:          cfg.AWSAccessKey,
			SecretAccessKey:      cfg.AWSSecretKey,
			BearerToken:          cfg.BedrockBearerToken,
			DefaultDeepSeekModel: firstSet(cfg.BedrockDeepSeek, cfg.BedrockModel),
			DefaultClaudeSonnet:  firstSet(cfg.BedrockClaudeSonnet, cfg.BedrockModel),
			DefaultClaudeHaiku:   firstSet(cfg.BedrockClaudeHaiku, cfg.BedrockModel),
			InferenceProfileARN:  cfg.BedrockProfile,
		})
		if err == nil {
			bedrock = bp
			r.providers["bedrock"] = bp
		}
	}

	// --- OpenAI ---
	var openaiP *OpenAIProvider
	if cfg.OpenAIAPIKey != "" {
		op, err := NewOpenAIProvider(OpenAIConfig{
			APIKey:          cfg.OpenAIAPIKey,
			DefaultModel:    defaultStr(cfg.OpenAIModel, "gpt-4.1"),
			BaseURL:         cfg.OpenAIBaseURL,
			EmbedModel:      defaultStr(cfg.EmbedModel, "text-embedding-3-small"),
			EmbedDimensions: cfg.EmbedDim,
		})
		if err == nil {
			openaiP = op
			r.providers["openai"] = op
		}
	}

	// --- Deepgram ---
	if cfg.DeepgramAPIKey != "" {
		tp, err := NewDeepgramProvider(DeepgramConfig{
			APIKey:      cfg.DeepgramAPIKey,
			Model:       defaultStr(cfg.DeepgramModel, "nova-2"),
			SmartFormat: true,
		})
		if err == nil {
			r.transcriber = tp
		}
	}

	// --- Primary + failover chain ---
	// If Bedrock is configured, it's primary; OpenAI is the fallback.
	// If only OpenAI is configured, OpenAI is primary and there's no
	// fallback (caller can extend later).
	switch {
	case bedrock != nil && openaiP != nil:
		var fallbacks []FallbackTarget
		if cfg.OpenAIFallbackEnabled {
			fallbacks = []FallbackTarget{
				{Provider: openaiP, Model: defaultStr(cfg.OpenAIModel, "gpt-4.1")},
			}
		}
		r.primary = NewFailover(bedrock, fallbacks)
	case bedrock != nil:
		r.primary = NewFailover(bedrock, nil)
	case openaiP != nil && cfg.OpenAIChatEnabled:
		r.primary = NewFailover(openaiP, nil)
	default:
		// No LLM configured. Return a registry with nil primary;
		// callers must check Enabled() before invoking.
		r.primary = nil
	}

	// --- Router ---
	rules := DefaultRoutingRules()
	if bedrock != nil {
		defaultModel := firstSet(cfg.BedrockModel, cfg.BedrockDeepSeek, cfg.BedrockClaudeSonnet)
		rules.DefaultModel = defaultModel
		rules.PremiumModel = firstSet(cfg.BedrockClaudeSonnet, defaultModel)
		rules.CheapModel = firstSet(cfg.BedrockClaudeHaiku, defaultModel)
	} else if openaiP != nil {
		rules.DefaultModel = "openai:gpt-4.1"
		rules.PremiumModel = "openai:gpt-4.1"
		rules.CheapModel = "openai:gpt-4.1-mini"
	}
	r.router = NewRouter(rules)

	return r, nil
}

// Enabled returns true when at least one LLM provider is configured.
// When false, the AI features are disabled and callers should return
// a "configure AI" placeholder rather than trying to call.
func (r *Registry) Enabled() bool { return r.primary != nil }

// HasEmbeddings returns true when at least one provider supports
// embeddings. Today that's OpenAI; future versions will add Bedrock
// Titan.
func (r *Registry) HasEmbeddings() bool {
	for _, p := range r.providers {
		if p.SupportsModel("text-embedding-3-small") {
			return true
		}
	}
	return false
}

func (r *Registry) EmbeddingModel() string {
	if op, ok := r.providers["openai"]; ok {
		if named, ok := op.(interface{ EmbeddingModel() string }); ok {
			return named.EmbeddingModel()
		}
	}
	return defaultStr(r.cfg.EmbedModel, "text-embedding-3-small")
}

// HasTranscriber returns true when a Deepgram key is configured.
func (r *Registry) HasTranscriber() bool { return r.transcriber != nil }

// Router returns the routing policy so callers can route calls
// before invoking Chat/Stream.
func (r *Registry) Router() *Router { return r.router }

// Primary returns the primary (failover-wrapped) provider. May be nil.
func (r *Registry) Primary() Provider { return r.primary }

// Provider returns a named provider (e.g. "bedrock", "openai"). Used
// in tests and for direct transcriber access; most callers go through
// Primary() + Router.
func (r *Registry) Provider(name string) (Provider, bool) {
	p, ok := r.providers[name]
	return p, ok
}

// Transcriber returns the Deepgram transcriber (may be nil).
func (r *Registry) Transcriber() Transcriber { return r.transcriber }

// Chat is a one-shot call. Most callers should prefer Stream.
func (r *Registry) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	if !r.Enabled() {
		return nil, errors.New("llm: no providers configured")
	}
	return r.primary.Chat(ctx, req)
}

// Stream is the hot path. Routes the request and returns a channel of
// typed events with automatic failover on transient errors.
func (r *Registry) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	if !r.Enabled() {
		ch := make(chan StreamEvent, 1)
		ch <- ErrorEvent{
			Err:     errors.New("llm: no providers configured"),
			Fatal:   true,
			Message: "AI assistant is not configured",
		}
		close(ch)
		return ch, nil
	}
	return r.primary.Stream(ctx, req)
}

// Embed returns embeddings via OpenAI. Cache is the caller's
// responsibility (the retrieval package owns it).
func (r *Registry) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if !r.HasEmbeddings() {
		return nil, errors.New("llm: no embedding provider configured (set OPENAI_API_KEY)")
	}
	// Prefer the named embedding provider.
	if op, ok := r.providers["openai"]; ok {
		return op.Embed(ctx, texts)
	}
	return nil, errors.New("llm: no embedding provider available")
}

// Transcribe forwards to Deepgram.
func (r *Registry) Transcribe(ctx context.Context, audio []byte, contentType string) (*Transcript, error) {
	if r.transcriber == nil {
		return nil, errors.New("llm: no transcriber configured (set DEEPGRAM_API_KEY)")
	}
	return r.transcriber.Transcribe(ctx, bytesReader(audio), contentType)
}

// --- helpers ---

func defaultStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func firstSet(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// hasAmbientAWSCreds returns true when the host has AWS credentials
// available without explicit keys (env vars, shared config, IAM role).
// We can't actually probe the chain without a request, so we treat
// the region-without-keys case as "maybe" and let Bedrock fail later
// if no creds exist.
func hasAmbientAWSCreds() bool {
	// Cheap check: env vars present means yes.
	for _, k := range []string{"AWS_BEARER_TOKEN_BEDROCK", "AWS_PROFILE", "AWS_EXECUTION_ENV", "AWS_LAMBDA_FUNCTION_NAME"} {
		if getenv(k) != "" {
			return true
		}
	}
	return false
}

func getenv(k string) string {
	// Tiny helper to avoid importing os in this file's top-level.
	// We only need a few keys, so this stays light.
	if v, ok := lookupEnv(k); ok {
		return v
	}
	return ""
}
