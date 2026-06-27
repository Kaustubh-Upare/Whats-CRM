package llm

import (
	"bytes"
	"os"
)

// bytesReader wraps a byte slice in a bytes.Reader — used by the
// transcriber entry point.
func bytesReader(b []byte) *bytes.Reader {
	if len(b) == 0 {
		return bytes.NewReader(nil)
	}
	return bytes.NewReader(b)
}

// lookupEnv is a thin wrapper around os.LookupEnv so we don't have
// to import "os" in registry.go. (Keeps the registry's import surface
// tidy for downstream callers.)
func lookupEnv(k string) (string, bool) {
	return os.LookupEnv(k)
}
