// Package whatsapp is a tiny Meta Cloud API client.
// It supports:
//   - SendText(to, body)  -> free-form message (works in Meta test mode for 5 numbers)
//   - SendTemplate(to, name, lang, vars) -> pre-approved template (production path)
//
// The webhooks receiver lives in internal/handlers and is wired in Phase 4.
package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type SendResult struct {
	ProviderMsgID string
	RawBody       string
	StatusCode    int
}

type Client struct {
	BaseURL    string
	PhoneID    string
	Token      string
	HTTPClient *http.Client
}

func NewClient(apiVersion, phoneID, token string) *Client {
	return &Client{
		BaseURL: "https://graph.facebook.com/" + strings.TrimPrefix(apiVersion, "/"),
		PhoneID: phoneID,
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *Client) SendText(ctx context.Context, to, body string) (*SendResult, error) {
	url := fmt.Sprintf("%s/%s/messages", c.BaseURL, c.PhoneID)
	payload := map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "text",
		"text":              map[string]string{"body": body},
	}
	return c.do(ctx, url, payload)
}

// SendTemplate sends a pre-approved template. params[] maps to {{1}}..{{N}}.
// Each param becomes a `{"type":"text","text":"..."}` component param.
func (c *Client) SendTemplate(ctx context.Context, to, name, lang string, params []string) (*SendResult, error) {
	url := fmt.Sprintf("%s/%s/messages", c.BaseURL, c.PhoneID)
	components := []map[string]any{}
	if len(params) > 0 {
		pp := make([]map[string]string, 0, len(params))
		for _, v := range params {
			pp = append(pp, map[string]string{"type": "text", "text": v})
		}
		components = append(components, map[string]any{
			"type":       "body",
			"parameters": pp,
		})
	}
	payload := map[string]any{
		"messaging_product": "whatsapp",
		"to":                to,
		"type":              "template",
		"template": map[string]any{
			"name":       name,
			"language":   map[string]string{"code": lang},
			"components": components,
		},
	}
	return c.do(ctx, url, payload)
}

func (c *Client) do(ctx context.Context, url string, payload any) (*SendResult, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	out := &SendResult{StatusCode: resp.StatusCode, RawBody: string(raw)}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var parsed struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(raw, &parsed); err == nil && len(parsed.Messages) > 0 {
			out.ProviderMsgID = parsed.Messages[0].ID
		}
		return out, nil
	}
	return out, fmt.Errorf("whatsapp api error: status=%d body=%s", resp.StatusCode, string(raw))
}
