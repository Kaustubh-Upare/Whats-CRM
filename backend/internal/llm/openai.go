package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/responses"
)

// OpenAIConfig is the configuration for the OpenAI provider.
type OpenAIConfig struct {
	APIKey       string
	DefaultModel string
	BaseURL      string
}

// OpenAIProvider implements Provider against the OpenAI Responses API.
// Supports chat (gpt-4.1 family) and embeddings (text-embedding-3-*).
type OpenAIProvider struct {
	client openai.Client
	cfg    OpenAIConfig
}

// NewOpenAIProvider builds the OpenAI client.
func NewOpenAIProvider(cfg OpenAIConfig) (*OpenAIProvider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("openai: API key is required")
	}
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = "gpt-4.1"
	}
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey)}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	c := openai.NewClient(opts...)
	return &OpenAIProvider{client: c, cfg: cfg}, nil
}

func (p *OpenAIProvider) Name() string { return "openai" }

// SupportsModel returns true for known OpenAI model ids.
func (p *OpenAIProvider) SupportsModel(model string) bool {
	if model == "" {
		return true
	}
	if strings.HasPrefix(model, "bedrock:") || strings.HasPrefix(model, "deepgram:") {
		return false
	}
	switch model {
	case "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
		"gpt-4o", "gpt-4o-mini",
		"text-embedding-3-small", "text-embedding-3-large",
		"text-embedding-ada-002":
		return true
	}
	return strings.HasPrefix(model, "openai:")
}

// Embed calls the OpenAI embeddings endpoint with batching.
func (p *OpenAIProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	params := openai.EmbeddingNewParams{
		Model: openai.EmbeddingModelTextEmbedding3Small,
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: append([]string{}, texts...),
		},
	}
	resp, err := p.client.Embeddings.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("openai embed: %w", err)
	}
	out := make([][]float32, 0, len(resp.Data))
	for _, d := range resp.Data {
		v := make([]float32, 0, len(d.Embedding))
		for _, f := range d.Embedding {
			v = append(v, float32(f))
		}
		out = append(out, v)
	}
	return out, nil
}

// Chat is the non-streaming convenience method.
func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	model := p.resolveModel(req.Model)
	if model == "" {
		return nil, errors.New("openai: empty model id")
	}
	params := p.buildParams(req, model)
	resp, err := p.client.Responses.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("openai chat: %w", err)
	}
	return p.foldResponse(resp, req.Model), nil
}

// Stream returns a buffered channel of typed events.
func (p *OpenAIProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error) {
	model := p.resolveModel(req.Model)
	if model == "" {
		return nil, errors.New("openai: empty model id")
	}
	params := p.buildParams(req, model)
	stream := p.client.Responses.NewStreaming(ctx, params)
	out := make(chan StreamEvent, 32)
	go p.pumpStream(stream, out)
	return out, nil
}

// pumpStream converts OpenAI's typed event stream to our StreamEvent
// union. Always closes out.
func (p *OpenAIProvider) pumpStream(stream *ssestream.Stream[responses.ResponseStreamEventUnion], out chan<- StreamEvent) {
	defer close(out)

	for stream.Next() {
		evt := stream.Current()
		switch v := evt.AsAny().(type) {

		case responses.ResponseTextDeltaEvent:
			out <- TextDeltaEvent{Text: v.Delta}

		case responses.ResponseOutputItemAddedEvent:
			if v.Item.Type == "function_call" {
				out <- ToolCallStartEvent{
					ID:   v.Item.CallID,
					Name: v.Item.Name,
				}
			}

		case responses.ResponseFunctionCallArgumentsDeltaEvent:
			out <- ToolCallDeltaEvent{
				ID:    v.ItemID,
				Delta: json.RawMessage(v.Delta),
			}

		case responses.ResponseFunctionCallArgumentsDoneEvent:
			args := json.RawMessage(v.Arguments)
			if len(args) == 0 {
				args = json.RawMessage("{}")
			}
			out <- ToolCallCompleteEvent{
				Call: ToolCall{ID: v.ItemID, Name: v.Name, Args: args},
			}

		case responses.ResponseCompletedEvent:
			out <- UsageEvent{Usage: Usage{
				InputTokens:  int(v.Response.Usage.InputTokens),
				OutputTokens: int(v.Response.Usage.OutputTokens),
			}}
			out <- DoneEvent{StopReason: "end_turn"}

		case responses.ResponseIncompleteEvent:
			out <- DoneEvent{StopReason: "incomplete"}

		case responses.ResponseFailedEvent:
			out <- ErrorEvent{
				Err:     fmt.Errorf("openai response failed"),
				Message: "response.failed",
			}
			return
		}
	}

	if err := stream.Err(); err != nil {
		out <- ErrorEvent{Err: err, Message: err.Error()}
	}
}

// buildParams renders a ChatRequest into OpenAI Responses params.
// Phase 6: image attachments on user messages are dropped here (the
// legacy Backend/ version has the same behavior — image content is
// stored in metadata and the agent asks the customer to describe it).
// Phase 7 will add multi-part content blocks.
func (p *OpenAIProvider) buildParams(req ChatRequest, model string) responses.ResponseNewParams {
	params := responses.ResponseNewParams{
		Model: openai.ResponsesModel(model),
	}
	if req.System != "" {
		params.Instructions = openai.String(req.System)
	}
	items := make(responses.ResponseInputParam, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case RoleSystem:
			cur := params.Instructions.Value
			params.Instructions = openai.String(cur + "\n\n" + m.Content)
		case RoleUser:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRoleUser,
					Content: responses.EasyInputMessageContentUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		case RoleAssistant:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRoleAssistant,
					Content: responses.EasyInputMessageContentUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		case RoleTool:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
					CallID: m.ToolID,
					Output: responses.ResponseInputItemFunctionCallOutputOutputUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		}
	}
	params.Input = responses.ResponseNewParamsInputUnion{
		OfInputItemList: items,
	}
	if len(req.Tools) > 0 {
		tools := make([]responses.ToolUnionParam, 0, len(req.Tools))
		for _, t := range req.Tools {
			// Parameters must be a map[string]any; we round-trip the
			// raw JSON schema through Unmarshal so the SDK can re-marshal
			// it correctly.
			var paramsMap map[string]any
			if len(t.JSONSchema) > 0 {
				_ = json.Unmarshal(t.JSONSchema, &paramsMap)
			}
			if paramsMap == nil {
				paramsMap = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			tools = append(tools, responses.ToolUnionParam{
				OfFunction: &responses.FunctionToolParam{
					Name:        t.Name,
					Description: openai.String(t.Description),
					Parameters:  paramsMap,
					Strict:      openai.Bool(true),
				},
			})
		}
		params.Tools = tools
	}
	if req.Temperature > 0 {
		params.Temperature = openai.Float(req.Temperature)
	}
	if req.MaxTokens > 0 {
		params.MaxOutputTokens = openai.Int(int64(req.MaxTokens))
	}
	return params
}

func (p *OpenAIProvider) foldResponse(resp *responses.Response, model string) *ChatResponse {
	out := &ChatResponse{Model: model, Provider: p.Name()}
	for _, item := range resp.Output {
		switch v := item.AsAny().(type) {
		case responses.ResponseOutputMessage:
			for _, c := range v.Content {
				if txt, ok := c.AsAny().(responses.ResponseOutputText); ok {
					out.Text += txt.Text
				}
			}
		case responses.ResponseFunctionToolCall:
			args := json.RawMessage(v.Arguments)
			if len(args) == 0 {
				args = json.RawMessage("{}")
			}
			out.ToolCalls = append(out.ToolCalls, ToolCall{
				ID:   v.CallID,
				Name: v.Name,
				Args: args,
			})
		}
	}
	out.Usage = Usage{
		InputTokens:  int(resp.Usage.InputTokens),
		OutputTokens: int(resp.Usage.OutputTokens),
	}
	out.StopReason = string(resp.Status)
	return out
}

func (p *OpenAIProvider) resolveModel(model string) string {
	switch model {
	case "":
		return p.cfg.DefaultModel
	case "openai:gpt-4.1":
		return "gpt-4.1"
	case "openai:gpt-4.1-mini":
		return "gpt-4.1-mini"
	default:
		return model
	}
}

// Compile-time assertion.
var _ Provider = (*OpenAIProvider)(nil)