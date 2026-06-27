package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
)

// OpenAICompatibleConfig configures a Chat Completions compatible provider.
// It is used for Bedrock-compatible gateways where auth is a bearer token and
// the only protocol change is the base URL.
type OpenAICompatibleConfig struct {
	APIKey       string
	BaseURL      string
	DefaultModel string
	ProviderName string
}

// OpenAICompatibleProvider implements Provider using /v1/chat/completions.
type OpenAICompatibleProvider struct {
	client openai.Client
	cfg    OpenAICompatibleConfig
}

func NewOpenAICompatibleProvider(cfg OpenAICompatibleConfig) (*OpenAICompatibleProvider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("openai-compatible: API key is required")
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, errors.New("openai-compatible: base URL is required")
	}
	if strings.TrimSpace(cfg.DefaultModel) == "" {
		return nil, errors.New("openai-compatible: default model is required")
	}
	if strings.TrimSpace(cfg.ProviderName) == "" {
		cfg.ProviderName = "openai-compatible"
	}
	c := openai.NewClient(
		option.WithAPIKey(cfg.APIKey),
		option.WithBaseURL(strings.TrimRight(cfg.BaseURL, "/")),
	)
	return &OpenAICompatibleProvider{client: c, cfg: cfg}, nil
}

func (p *OpenAICompatibleProvider) Name() string { return p.cfg.ProviderName }

func (p *OpenAICompatibleProvider) SupportsModel(model string) bool {
	if model == "" {
		return true
	}
	if strings.HasPrefix(model, "openai:") || strings.HasPrefix(model, "deepgram:") {
		return false
	}
	if strings.HasPrefix(model, "bedrock:") {
		return true
	}
	return true
}

func (p *OpenAICompatibleProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return nil, ErrEmbedUnsupported
}

func (p *OpenAICompatibleProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	model := p.resolveModel(req.Model)
	if model == "" {
		return nil, errors.New("openai-compatible: empty model id")
	}
	params := p.buildChatParams(req, model)
	resp, err := p.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s chat: %w", p.Name(), err)
	}
	return p.foldChatCompletion(resp, model), nil
}

func (p *OpenAICompatibleProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	out := make(chan StreamEvent, 16)
	go func() {
		defer close(out)
		resp, err := p.Chat(ctx, req)
		if err != nil {
			out <- ErrorEvent{Err: err, Message: err.Error()}
			return
		}
		if resp.Text != "" {
			out <- TextDeltaEvent{Text: resp.Text}
		}
		for _, tc := range resp.ToolCalls {
			out <- ToolCallStartEvent{ID: tc.ID, Name: tc.Name}
			out <- ToolCallCompleteEvent{Call: tc}
		}
		out <- UsageEvent{Usage: resp.Usage}
		out <- DoneEvent{StopReason: resp.StopReason}
	}()
	return out, nil
}

func (p *OpenAICompatibleProvider) buildChatParams(req ChatRequest, model string) openai.ChatCompletionNewParams {
	params := openai.ChatCompletionNewParams{
		Model: shared.ChatModel(model),
	}
	if req.System != "" {
		params.Messages = append(params.Messages, openai.SystemMessage(req.System))
	}
	for _, m := range req.Messages {
		switch m.Role {
		case RoleSystem:
			if strings.TrimSpace(m.Content) != "" {
				params.Messages = append(params.Messages, openai.SystemMessage(m.Content))
			}
		case RoleUser:
			params.Messages = append(params.Messages, openai.UserMessage(m.Content))
		case RoleAssistant:
			if tc, ok := messageToolCall(m); ok {
				msg := openai.AssistantMessage(m.Content)
				msg.OfAssistant.ToolCalls = []openai.ChatCompletionMessageToolCallUnionParam{
					chatToolCallParam(tc),
				}
				params.Messages = append(params.Messages, msg)
			} else if m.Content != "" {
				params.Messages = append(params.Messages, openai.AssistantMessage(m.Content))
			}
		case RoleTool:
			toolID := m.ToolID
			if toolID == "" {
				toolID = m.Name
			}
			if toolID != "" {
				params.Messages = append(params.Messages, openai.ToolMessage(m.Content, toolID))
			}
		}
	}
	if req.Temperature > 0 {
		params.Temperature = openai.Float(req.Temperature)
	}
	if req.MaxTokens > 0 {
		params.MaxTokens = openai.Int(int64(req.MaxTokens))
	}
	if len(req.Tools) > 0 {
		params.Tools = make([]openai.ChatCompletionToolUnionParam, 0, len(req.Tools))
		for _, t := range req.Tools {
			params.Tools = append(params.Tools, openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
				Name:        t.Name,
				Description: openai.String(t.Description),
				Parameters:  schemaAsFunctionParameters(t.JSONSchema),
			}))
		}
	}
	return params
}

func (p *OpenAICompatibleProvider) foldChatCompletion(resp *openai.ChatCompletion, model string) *ChatResponse {
	out := &ChatResponse{Model: model, Provider: p.Name()}
	if resp == nil {
		return out
	}
	if resp.Model != "" {
		out.Model = resp.Model
	}
	if len(resp.Choices) > 0 {
		choice := resp.Choices[0]
		out.Text = choice.Message.Content
		out.StopReason = choice.FinishReason
		for _, raw := range choice.Message.ToolCalls {
			if tc, ok := responseToolCall(raw); ok {
				out.ToolCalls = append(out.ToolCalls, tc)
			}
		}
	}
	out.Usage = Usage{
		InputTokens:  int(resp.Usage.PromptTokens),
		OutputTokens: int(resp.Usage.CompletionTokens),
	}
	return out
}

func (p *OpenAICompatibleProvider) resolveModel(model string) string {
	switch {
	case model == "":
		return p.cfg.DefaultModel
	case strings.HasPrefix(model, "bedrock:"):
		return p.cfg.DefaultModel
	default:
		return model
	}
}

func messageToolCall(m Message) (ToolCall, bool) {
	if m.Tags == nil {
		return ToolCall{}, false
	}
	switch v := m.Tags["tool_call"].(type) {
	case ToolCall:
		return v, true
	case *ToolCall:
		if v != nil {
			return *v, true
		}
	}
	return ToolCall{}, false
}

func chatToolCallParam(tc ToolCall) openai.ChatCompletionMessageToolCallUnionParam {
	args := string(tc.Args)
	if strings.TrimSpace(args) == "" {
		args = "{}"
	}
	return openai.ChatCompletionMessageToolCallUnionParam{
		OfFunction: &openai.ChatCompletionMessageFunctionToolCallParam{
			ID: tc.ID,
			Function: openai.ChatCompletionMessageFunctionToolCallFunctionParam{
				Name:      tc.Name,
				Arguments: args,
			},
		},
	}
}

func responseToolCall(raw openai.ChatCompletionMessageToolCallUnion) (ToolCall, bool) {
	switch v := raw.AsAny().(type) {
	case openai.ChatCompletionMessageFunctionToolCall:
		args := json.RawMessage(v.Function.Arguments)
		if len(args) == 0 {
			args = json.RawMessage("{}")
		}
		return ToolCall{ID: v.ID, Name: v.Function.Name, Args: args}, true
	default:
		if raw.Type == "function" {
			args := json.RawMessage(raw.Function.Arguments)
			if len(args) == 0 {
				args = json.RawMessage("{}")
			}
			return ToolCall{ID: raw.ID, Name: raw.Function.Name, Args: args}, true
		}
	}
	return ToolCall{}, false
}

func schemaAsFunctionParameters(raw json.RawMessage) shared.FunctionParameters {
	if len(raw) == 0 {
		return shared.FunctionParameters{"type": "object", "properties": map[string]any{}}
	}
	var params map[string]any
	if err := json.Unmarshal(raw, &params); err != nil || params == nil {
		return shared.FunctionParameters{"type": "object", "properties": map[string]any{}}
	}
	return shared.FunctionParameters(params)
}

var _ Provider = (*OpenAICompatibleProvider)(nil)
