package llm

import "testing"

func TestNormalizeOpenAIBaseURLDefaultsWhenBlank(t *testing.T) {
	got, err := normalizeOpenAIBaseURL("")
	if err != nil {
		t.Fatalf("normalizeOpenAIBaseURL: %v", err)
	}
	if got != defaultOpenAIBaseURL {
		t.Fatalf("base URL = %q, want %q", got, defaultOpenAIBaseURL)
	}
}

func TestNormalizeOpenAIBaseURLTrimsTrailingSlash(t *testing.T) {
	got, err := normalizeOpenAIBaseURL(" https://example.test/v1/ ")
	if err != nil {
		t.Fatalf("normalizeOpenAIBaseURL: %v", err)
	}
	if got != "https://example.test/v1" {
		t.Fatalf("base URL = %q", got)
	}
}

func TestNormalizeOpenAIBaseURLRejectsHostlessURL(t *testing.T) {
	if _, err := normalizeOpenAIBaseURL("/v1"); err == nil {
		t.Fatal("expected invalid hostless URL error")
	}
}

func TestNewOpenAIProviderSetsExplicitDefaultBaseURL(t *testing.T) {
	p, err := NewOpenAIProvider(OpenAIConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("NewOpenAIProvider: %v", err)
	}
	if p.cfg.BaseURL != defaultOpenAIBaseURL {
		t.Fatalf("base URL = %q, want %q", p.cfg.BaseURL, defaultOpenAIBaseURL)
	}
}
