package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/aws/smithy-go/auth/bearer"
)

// BedrockConfig holds the credentials + region for the Bedrock provider.
// Region is required; credentials can be omitted if the host has
// ambient credentials (IAM role, IMDS) — aws-sdk-go-v2 picks those up.
type BedrockConfig struct {
	Region               string
	AccessKeyID          string
	SecretAccessKey      string
	BearerToken          string
	DefaultDeepSeekModel string
	DefaultClaudeSonnet  string
	DefaultClaudeHaiku   string
	InferenceProfileARN  string
}

// BedrockProvider implements Provider against AWS Bedrock. Supports
// DeepSeek V3.2, Claude Sonnet 4.5, and Claude Haiku 4.5 via the
// Converse + ConverseStream APIs (which abstract over the per-model
// wire formats).
type BedrockProvider struct {
	client *bedrockruntime.Client
	cfg    BedrockConfig
}

// NewBedrockProvider builds the Bedrock client.
func NewBedrockProvider(ctx context.Context, cfg BedrockConfig) (*BedrockProvider, error) {
	if cfg.Region == "" {
		return nil, errors.New("bedrock: region is required")
	}
	loadOpts := []func(*awscfg.LoadOptions) error{awscfg.WithRegion(cfg.Region)}
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		loadOpts = append(loadOpts, awscfg.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		))
	}
	if cfg.BearerToken != "" {
		loadOpts = append(loadOpts, awscfg.WithBearerAuthTokenProvider(
			bearer.StaticTokenProvider{Token: bearer.Token{Value: cfg.BearerToken}},
		))
	}
	awsCfg, err := awscfg.LoadDefaultConfig(ctx, loadOpts...)
	if err != nil {
		return nil, fmt.Errorf("bedrock: load aws config: %w", err)
	}
	clientOpts := []func(*bedrockruntime.Options){}
	if cfg.BearerToken != "" {
		clientOpts = append(clientOpts, func(o *bedrockruntime.Options) {
			o.BearerAuthTokenProvider = bearer.StaticTokenProvider{Token: bearer.Token{Value: cfg.BearerToken}}
			o.AuthSchemePreference = []string{"httpBearerAuth"}
		})
	}
	return &BedrockProvider{
		client: bedrockruntime.NewFromConfig(awsCfg, clientOpts...),
		cfg:    cfg,
	}, nil
}

func (p *BedrockProvider) Name() string { return "bedrock" }

// SupportsModel returns true for any model id that resolves to one of
// our configured Bedrock model ids.
func (p *BedrockProvider) SupportsModel(model string) bool {
	if model == "" {
		return true
	}
	if strings.HasPrefix(model, "openai:") || strings.HasPrefix(model, "deepgram:") {
		return false
	}
	known := map[string]bool{}
	if p.cfg.DefaultDeepSeekModel != "" {
		known[p.cfg.DefaultDeepSeekModel] = true
	}
	if p.cfg.DefaultClaudeSonnet != "" {
		known[p.cfg.DefaultClaudeSonnet] = true
	}
	if p.cfg.DefaultClaudeHaiku != "" {
		known[p.cfg.DefaultClaudeHaiku] = true
	}
	if known[model] {
		return true
	}
	low := strings.ToLower(model)
	return strings.Contains(low, "deepseek") ||
		strings.Contains(low, "anthropic") ||
		strings.Contains(low, "claude")
}

// Embed returns ErrEmbedUnsupported — Bedrock embeddings (Titan) are
// out of scope for Phase 0.
func (p *BedrockProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return nil, ErrEmbedUnsupported
}

// resolveModel maps a logical name to a concrete Bedrock model id.
func (p *BedrockProvider) resolveModel(model string) string {
	switch model {
	case "":
		return p.cfg.DefaultDeepSeekModel
	case "bedrock:deepseek-v3.2":
		return p.cfg.DefaultDeepSeekModel
	case "bedrock:claude-sonnet-4.5":
		return p.cfg.DefaultClaudeSonnet
	case "bedrock:claude-haiku-4.5":
		return p.cfg.DefaultClaudeHaiku
	default:
		return model
	}
}

// Chat is the non-streaming convenience method.
func (p *BedrockProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	input := p.buildConverseInput(req)
	if len(input.Messages) == 0 {
		return nil, errors.New("bedrock: at least one user or assistant message is required")
	}
	resp, err := p.client.Converse(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("bedrock converse: %w", err)
	}
	out := &ChatResponse{Model: req.Model, Provider: p.Name()}
	if resp.Output != nil {
		if msg, ok := resp.Output.(*brtypes.ConverseOutputMemberMessage); ok {
			for _, c := range msg.Value.Content {
				switch v := c.(type) {
				case *brtypes.ContentBlockMemberText:
					out.Text += v.Value
				case *brtypes.ContentBlockMemberToolUse:
					args := documentToJSON(v.Value.Input)
					out.ToolCalls = append(out.ToolCalls, ToolCall{
						ID:   aws.ToString(v.Value.ToolUseId),
						Name: aws.ToString(v.Value.Name),
						Args: args,
					})
				}
			}
		}
	}
	if resp.Usage != nil {
		out.Usage = Usage{
			InputTokens:  int(aws.ToInt32(resp.Usage.InputTokens)),
			OutputTokens: int(aws.ToInt32(resp.Usage.OutputTokens)),
		}
	}
	if resp.StopReason != "" {
		out.StopReason = string(resp.StopReason)
	}
	return out, nil
}

// Stream returns a buffered channel of typed events.
func (p *BedrockProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	input := p.buildConverseStreamInput(req)
	if len(input.Messages) == 0 {
		return nil, errors.New("bedrock: at least one user or assistant message is required")
	}
	resp, err := p.client.ConverseStream(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("bedrock converse stream: %w", err)
	}
	out := make(chan StreamEvent, 32)
	go p.pumpStream(ctx, resp, out)
	return out, nil
}

// pumpStream consumes Bedrock's ConverseStream events.
func (p *BedrockProvider) pumpStream(ctx context.Context, resp *bedrockruntime.ConverseStreamOutput, out chan<- StreamEvent) {
	defer close(out)

	type inFlight struct {
		id, name string
		buf      strings.Builder
	}
	inflight := map[string]*inFlight{}

	for evt := range resp.GetStream().Events() {
		if ctx.Err() != nil {
			out <- ErrorEvent{Err: ctx.Err(), Fatal: true, Message: "context cancelled"}
			return
		}
		switch v := evt.(type) {

		case *brtypes.ConverseStreamOutputMemberContentBlockStart:
			if v.Value.Start == nil {
				continue
			}
			if tb, ok := v.Value.Start.(*brtypes.ContentBlockStartMemberToolUse); ok {
				id := aws.ToString(tb.Value.ToolUseId)
				name := aws.ToString(tb.Value.Name)
				inflight[id] = &inFlight{id: id, name: name}
				out <- ToolCallStartEvent{ID: id, Name: name}
			}

		case *brtypes.ConverseStreamOutputMemberContentBlockDelta:
			if v.Value.Delta == nil {
				continue
			}
			switch d := v.Value.Delta.(type) {
			case *brtypes.ContentBlockDeltaMemberText:
				out <- TextDeltaEvent{Text: d.Value}
			case *brtypes.ContentBlockDeltaMemberToolUse:
				// ToolUseBlockDelta.Input is a *string containing a
				// partial argument-JSON chunk. We accumulate into the
				// in-flight tool's buffer and emit a delta event so
				// the agent loop can show a "thinking…" preview.
				if d.Value.Input == nil {
					continue
				}
				var lastID string
				for id := range inflight {
					lastID = id
				}
				if lastID != "" {
					chunk := []byte(*d.Value.Input)
					inflight[lastID].buf.Write(chunk)
					out <- ToolCallDeltaEvent{ID: lastID, Delta: chunk}
				}
			}

		case *brtypes.ConverseStreamOutputMemberContentBlockStop:
			for id, c := range inflight {
				args := json.RawMessage(c.buf.String())
				if len(args) == 0 {
					args = json.RawMessage("{}")
				}
				out <- ToolCallCompleteEvent{Call: ToolCall{ID: id, Name: c.name, Args: args}}
				delete(inflight, id)
			}

		case *brtypes.ConverseStreamOutputMemberMessageStop:
			out <- DoneEvent{StopReason: string(v.Value.StopReason)}

		case *brtypes.ConverseStreamOutputMemberMetadata:
			if v.Value.Usage != nil {
				out <- UsageEvent{Usage: Usage{
					InputTokens:  int(aws.ToInt32(v.Value.Usage.InputTokens)),
					OutputTokens: int(aws.ToInt32(v.Value.Usage.OutputTokens)),
				}}
			}

		case *brtypes.UnknownUnionMember:
			continue
		}
	}

	for id, c := range inflight {
		args := json.RawMessage(c.buf.String())
		if len(args) == 0 {
			args = json.RawMessage("{}")
		}
		out <- ToolCallCompleteEvent{Call: ToolCall{ID: id, Name: c.name, Args: args}}
	}
}

// buildConverseInput builds a non-streaming ConverseInput.
func (p *BedrockProvider) buildConverseInput(req ChatRequest) *bedrockruntime.ConverseInput {
	return &bedrockruntime.ConverseInput{
		ModelId:         aws.String(p.modelIDFor(req.Model)),
		System:          p.buildSystemBlocks(req.System),
		Messages:        p.buildInputMessages(req),
		InferenceConfig: p.buildInferenceConfig(req.Temperature, req.MaxTokens),
		ToolConfig:      p.buildToolConfig(req.Tools),
	}
}

// buildConverseStreamInput builds a ConverseStreamInput. Same shape
// as ConverseInput but a separate Go type.
func (p *BedrockProvider) buildConverseStreamInput(req ChatRequest) *bedrockruntime.ConverseStreamInput {
	return &bedrockruntime.ConverseStreamInput{
		ModelId:         aws.String(p.modelIDFor(req.Model)),
		System:          p.buildSystemBlocks(req.System),
		Messages:        p.buildInputMessages(req),
		InferenceConfig: p.buildInferenceConfig(req.Temperature, req.MaxTokens),
		ToolConfig:      p.buildToolConfig(req.Tools),
	}
}

// modelIDFor returns the Bedrock model id for a given ChatRequest.Model
// alias. InferenceProfileARN wins over the resolved alias when set.
func (p *BedrockProvider) modelIDFor(reqModel string) string {
	if p.cfg.InferenceProfileARN != "" {
		return p.cfg.InferenceProfileARN
	}
	return p.resolveModel(reqModel)
}

func (p *BedrockProvider) buildSystemBlocks(system string) []brtypes.SystemContentBlock {
	if system == "" {
		return nil
	}
	return []brtypes.SystemContentBlock{
		&brtypes.SystemContentBlockMemberText{Value: system},
	}
}

func (p *BedrockProvider) buildInferenceConfig(temp float64, maxTokens int) *brtypes.InferenceConfiguration {
	if temp <= 0 && maxTokens <= 0 {
		return nil
	}
	cfg := &brtypes.InferenceConfiguration{}
	if temp > 0 {
		t := float32(temp)
		cfg.Temperature = &t
	}
	if maxTokens > 0 {
		mt := int32(maxTokens)
		cfg.MaxTokens = &mt
	}
	return cfg
}

// buildMessages renders a chat into Bedrock's content-block format.
// Phase 6: image attachments on user messages are dropped here (the
// legacy Backend/ version has the same behavior — image content is
// stored in metadata and the agent asks the customer to describe it).
// Phase 7 will fetch the bytes and use ImageBlock.Bytes.
func (p *BedrockProvider) buildInputMessages(req ChatRequest) []brtypes.Message {
	msgs := p.buildMessages(req.Messages)
	if len(msgs) > 0 {
		return msgs
	}
	if strings.TrimSpace(req.System) == "" {
		return nil
	}
	return []brtypes.Message{
		{
			Role: brtypes.ConversationRoleUser,
			Content: []brtypes.ContentBlock{
				&brtypes.ContentBlockMemberText{
					Value: "Please follow the system instructions and provide the requested response.",
				},
			},
		},
	}
}

func (p *BedrockProvider) buildMessages(msgs []Message) []brtypes.Message {
	if len(msgs) == 0 {
		return nil
	}
	out := make([]brtypes.Message, 0, len(msgs))
	for _, m := range msgs {
		switch m.Role {
		case RoleSystem:
			// Top-level System field handles this; ignore here.
			continue
		case RoleUser:
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleUser,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberText{Value: m.Content},
				},
			})
		case RoleAssistant:
			if tc, ok := toolCallFromTags(m.Tags); ok {
				out = append(out, brtypes.Message{
					Role: brtypes.ConversationRoleAssistant,
					Content: []brtypes.ContentBlock{
						&brtypes.ContentBlockMemberToolUse{
							Value: brtypes.ToolUseBlock{
								ToolUseId: aws.String(tc.ID),
								Name:      aws.String(tc.Name),
								Input:     bedrockJSONDocumentObject(tc.Args),
							},
						},
					},
				})
				continue
			}
			if m.Content == "" {
				continue
			}
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleAssistant,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberText{Value: m.Content},
				},
			})
		case RoleTool:
			doc := bedrockJSONDocumentObject(json.RawMessage(m.Content))
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleUser,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberToolResult{
						Value: brtypes.ToolResultBlock{
							ToolUseId: aws.String(m.ToolID),
							Content: []brtypes.ToolResultContentBlock{
								&brtypes.ToolResultContentBlockMemberJson{Value: doc},
							},
						},
					},
				},
			})
		}
	}
	return out
}

func toolCallFromTags(tags map[string]any) (ToolCall, bool) {
	if len(tags) == 0 {
		return ToolCall{}, false
	}
	switch v := tags["tool_call"].(type) {
	case ToolCall:
		return v, strings.TrimSpace(v.ID) != "" && strings.TrimSpace(v.Name) != ""
	case *ToolCall:
		if v == nil {
			return ToolCall{}, false
		}
		return *v, strings.TrimSpace(v.ID) != "" && strings.TrimSpace(v.Name) != ""
	default:
		return ToolCall{}, false
	}
}

func bedrockJSONDocumentObject(raw json.RawMessage) document.Interface {
	var v any
	if len(raw) > 0 && json.Unmarshal(raw, &v) == nil {
		if obj, ok := v.(map[string]any); ok && obj != nil {
			return document.NewLazyDocument(obj)
		}
		return document.NewLazyDocument(map[string]any{"value": v})
	}
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return document.NewLazyDocument(map[string]any{})
	}
	return document.NewLazyDocument(map[string]any{"text": text})
}

func (p *BedrockProvider) buildToolConfig(tools []ToolDef) *brtypes.ToolConfiguration {
	if len(tools) == 0 {
		return nil
	}
	specs := make([]brtypes.Tool, 0, len(tools))
	for _, t := range tools {
		var schema document.Interface
		if len(t.JSONSchema) > 0 {
			var v any
			if err := json.Unmarshal(t.JSONSchema, &v); err == nil {
				schema = document.NewLazyDocument(v)
			} else {
				schema = document.NewLazyDocument(map[string]any{})
			}
		} else {
			schema = document.NewLazyDocument(map[string]any{})
		}
		specs = append(specs, &brtypes.ToolMemberToolSpec{
			Value: brtypes.ToolSpecification{
				Name:        aws.String(t.Name),
				Description: aws.String(t.Description),
				InputSchema: &brtypes.ToolInputSchemaMemberJson{Value: schema},
			},
		})
	}
	return &brtypes.ToolConfiguration{Tools: specs}
}

// documentToJSON extracts a json.RawMessage from a Bedrock document.
// Falls back to "{}" on any error.
func documentToJSON(d document.Interface) json.RawMessage {
	if d == nil {
		return json.RawMessage("{}")
	}
	raw, ok := marshalDocument(d)
	if !ok || len(raw) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(raw)
}

// marshalDocument calls MarshalSmithyDocument on the supplied document
// and returns the resulting JSON bytes. Centralised so the call sites
// stay tidy.
func marshalDocument(d document.Interface) ([]byte, bool) {
	if d == nil {
		return nil, false
	}
	m, ok := d.(interface {
		MarshalSmithyDocument() ([]byte, error)
	})
	if !ok {
		return nil, false
	}
	b, err := m.MarshalSmithyDocument()
	if err != nil {
		return nil, false
	}
	return b, true
}

// Compile-time assertion.
var _ Provider = (*BedrockProvider)(nil)
