package llm

import (
	"encoding/json"
	"testing"

	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

func TestBedrockBuildConverseInputUsesSystemFallbackMessage(t *testing.T) {
	p := &BedrockProvider{cfg: BedrockConfig{DefaultDeepSeekModel: "model-id"}}

	input := p.buildConverseInput(ChatRequest{System: "You are helpful."})

	if len(input.Messages) != 1 {
		t.Fatalf("messages len = %d, want 1", len(input.Messages))
	}
	if input.Messages[0].Role != brtypes.ConversationRoleUser {
		t.Fatalf("role = %q", input.Messages[0].Role)
	}
	if len(input.Messages[0].Content) != 1 {
		t.Fatalf("content len = %d, want 1", len(input.Messages[0].Content))
	}
	if _, ok := input.Messages[0].Content[0].(*brtypes.ContentBlockMemberText); !ok {
		t.Fatalf("content block = %T, want text", input.Messages[0].Content[0])
	}
}

func TestBedrockBuildConverseInputLeavesTrulyEmptyRequestEmpty(t *testing.T) {
	p := &BedrockProvider{cfg: BedrockConfig{DefaultDeepSeekModel: "model-id"}}

	input := p.buildConverseInput(ChatRequest{})

	if len(input.Messages) != 0 {
		t.Fatalf("messages len = %d, want 0", len(input.Messages))
	}
}

func TestBedrockBuildMessagesRendersToolUseAndObjectToolResult(t *testing.T) {
	p := &BedrockProvider{cfg: BedrockConfig{DefaultDeepSeekModel: "model-id"}}

	msgs := p.buildMessages([]Message{
		{
			Role: RoleAssistant,
			Tags: map[string]any{"tool_call": ToolCall{
				ID:   "toolu_1",
				Name: "lookup_order",
				Args: json.RawMessage(`{"order_id":"123"}`),
			}},
		},
		{
			Role:    RoleTool,
			ToolID:  "toolu_1",
			Name:    "lookup_order",
			Content: "okay",
		},
	})

	if len(msgs) != 2 {
		t.Fatalf("messages len = %d, want 2", len(msgs))
	}
	toolUse, ok := msgs[0].Content[0].(*brtypes.ContentBlockMemberToolUse)
	if !ok {
		t.Fatalf("first block = %T, want tool use", msgs[0].Content[0])
	}
	if got := *toolUse.Value.ToolUseId; got != "toolu_1" {
		t.Fatalf("tool use id = %q", got)
	}

	toolResult, ok := msgs[1].Content[0].(*brtypes.ContentBlockMemberToolResult)
	if !ok {
		t.Fatalf("second block = %T, want tool result", msgs[1].Content[0])
	}
	jsonBlock, ok := toolResult.Value.Content[0].(*brtypes.ToolResultContentBlockMemberJson)
	if !ok {
		t.Fatalf("tool result content = %T, want json", toolResult.Value.Content[0])
	}
	raw := documentToJSON(jsonBlock.Value)
	if string(raw) != `{"text":"okay"}` {
		t.Fatalf("tool result json = %s, want object-wrapped text", raw)
	}
}

func TestBedrockJSONDocumentObjectWrapsJSONArray(t *testing.T) {
	raw := documentToJSON(bedrockJSONDocumentObject(json.RawMessage(`[1,2]`)))
	if string(raw) != `{"value":[1,2]}` {
		t.Fatalf("wrapped json = %s", raw)
	}
}
