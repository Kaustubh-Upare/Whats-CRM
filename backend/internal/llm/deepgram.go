package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// DeepgramConfig is the configuration for the Deepgram transcriber.
type DeepgramConfig struct {
	APIKey string

	// Model is the Deepgram model id. Default "nova-2". Use "nova-3"
	// for the latest (better Indian English + Hindi).
	Model string

	// Language is a BCP-47 tag ("en", "hi", "en-IN"). Leave empty to
	// let Deepgram auto-detect ("multi").
	Language string

	// SmartFormat applies Deepgram's reformatting (numbers, dates,
	// punctuation). Highly recommended for WhatsApp voice notes.
	SmartFormat bool

	// BaseURL is overrideable for testing. Defaults to the public
	// Deepgram REST endpoint.
	BaseURL string
}

// Transcriber is the surface the agent loop uses for voice notes.
// DeepgramProvider implements it.
//
// Kept as its own interface (not part of Provider) because the
// response shape is fundamentally different — transcription returns
// a single string with optional metadata, not a stream of typed
// events.
type Transcriber interface {
	Transcribe(ctx context.Context, audio io.Reader, contentType string) (*Transcript, error)
}

// Transcript is the structured result of one transcription.
type Transcript struct {
	Text       string        // final transcript
	Language   string        // detected / requested language
	Confidence float64       // 0-1
	DurationMs int           // audio duration in milliseconds
	Words      []TranscriptWord
	Raw        json.RawMessage // raw Deepgram response (for debugging)
}

// TranscriptWord is one word from the transcript with timing +
// confidence. Useful for the admin UI's "play with captions" feature
// (Phase 3).
type TranscriptWord struct {
	Word       string  `json:"word"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
	Confidence float64 `json:"confidence"`
}

// DeepgramProvider implements Transcriber against Deepgram's REST API.
// We don't use an SDK — the API is small enough to call directly and
// the SDK adds little value.
type DeepgramProvider struct {
	cfg  DeepgramConfig
	http *http.Client
}

// NewDeepgramProvider builds the transcriber. Returns an error when
// APIKey is empty.
func NewDeepgramProvider(cfg DeepgramConfig) (*DeepgramProvider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("deepgram: API key is required")
	}
	if cfg.Model == "" {
		cfg.Model = "nova-2"
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.deepgram.com"
	}
	return &DeepgramProvider{
		cfg:  cfg,
		http: &http.Client{Timeout: 60 * time.Second},
	}, nil
}

func (p *DeepgramProvider) Name() string { return "deepgram" }

// Transcribe sends audio bytes to Deepgram and returns the transcript.
// contentType must be a MIME type Deepgram accepts
// (audio/wav, audio/mpeg, audio/ogg, audio/webm, etc.).
//
// Pricing note: Deepgram charges per minute of audio, not per token.
// The cost is recorded separately in deepgramCost() and is NOT
// returned here — the caller attaches it to the bc_ai_llm_metrics row.
func (p *DeepgramProvider) Transcribe(ctx context.Context, audio io.Reader, contentType string) (*Transcript, error) {
	if audio == nil {
		return nil, errors.New("deepgram: audio reader is nil")
	}
	if contentType == "" {
		contentType = "audio/ogg"
	}

	// Build query parameters.
	q := url.Values{}
	q.Set("model", p.cfg.Model)
	if p.cfg.Language != "" {
		q.Set("language", p.cfg.Language)
	} else {
		q.Set("language", "multi")
	}
	if p.cfg.SmartFormat {
		q.Set("smart_format", "true")
	}
	q.Set("punctuate", "true")
	q.Set("utterances", "false")
	q.Set("detect_language", boolStr(p.cfg.Language == ""))

	endpoint := p.cfg.BaseURL + "/v1/listen?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, audio)
	if err != nil {
		return nil, fmt.Errorf("deepgram: build request: %w", err)
	}
	req.Header.Set("Authorization", "Token "+p.cfg.APIKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("deepgram: request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("deepgram: status=%d body=%s", resp.StatusCode, string(body))
	}

	return parseDeepgramResponse(body)
}

// parseDeepgramResponse maps Deepgram's JSON to our Transcript.
// Deepgram's response is well-documented:
//   results.channels[0].alternatives[0].transcript (string)
//   results.channels[0].alternatives[0].confidence (number)
//   results.channels[0].alternatives[0].words[] (array)
//   results.detected_language (string, when detect_language=true)
//   metadata.duration (number, seconds)
func parseDeepgramResponse(raw []byte) (*Transcript, error) {
	var resp struct {
		Metadata struct {
			Duration  float64 `json:"duration"`
			Channels  int     `json:"channels"`
			ModelInfo struct {
				Name string `json:"name"`
			} `json:"model_info"`
		} `json:"metadata"`
		Results struct {
			Channels []struct {
				Alternatives []struct {
					Transcript string  `json:"transcript"`
					Confidence float64 `json:"confidence"`
					Words      []struct {
						Word       string  `json:"word"`
						Start      float64 `json:"start"`
						End        float64 `json:"end"`
						Confidence float64 `json:"confidence"`
					} `json:"words"`
				} `json:"alternatives"`
				DetectedLanguage string `json:"detected_language"`
			} `json:"channels"`
		} `json:"results"`
		DetectedLanguage string `json:"detected_language"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("deepgram: parse response: %w", err)
	}

	out := &Transcript{Raw: raw, DurationMs: int(resp.Metadata.Duration * 1000)}

	if len(resp.Results.Channels) == 0 || len(resp.Results.Channels[0].Alternatives) == 0 {
		return out, nil // empty audio — return empty transcript
	}
	ch := resp.Results.Channels[0]
	alt := ch.Alternatives[0]
	out.Text = alt.Transcript
	out.Confidence = alt.Confidence
	if lang := ch.DetectedLanguage; lang != "" {
		out.Language = lang
	} else {
		out.Language = resp.DetectedLanguage
	}
	for _, w := range alt.Words {
		out.Words = append(out.Words, TranscriptWord{
			Word:       w.Word,
			Start:      w.Start,
			End:        w.End,
			Confidence: w.Confidence,
		})
	}
	return out, nil
}

// DeepgramCostPerMinute is the USD cost per minute of audio. Nova-2
// is currently $0.0043/min for the pay-as-you-go tier. Stored as a
// constant so the cost is auditable.
const DeepgramCostPerMinute = 0.0043

// DeepgramCost returns the dollar cost for a transcript of durationMs.
func DeepgramCost(durationMs int) float64 {
	return float64(durationMs) / 60000.0 * DeepgramCostPerMinute
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// EnsureDeepgramBody is a helper to wrap an audio byte slice as the
// reader expected by Transcribe.
func EnsureDeepgramBody(b []byte) (io.Reader, string) {
	// We can't sniff content type from raw bytes reliably, so the
	// caller supplies it. This helper exists for symmetry with
	// future call sites.
	return bytes.NewReader(b), "application/octet-stream"
}

// Compile-time assertion: *DeepgramProvider satisfies Transcriber.
var _ Transcriber = (*DeepgramProvider)(nil)