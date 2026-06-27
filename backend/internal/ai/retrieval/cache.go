package retrieval

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache is the abstraction behind the retriever's two-level cache.
//
// Implementations:
//   - RedisCache      (preferred — shared across replicas)
//   - MemoryCache     (per-process fallback when Redis isn't configured)
//   - NoopCache       (always misses; for tests that don't want cache)
//
// The interface returns a copy of the cached bytes; callers should
// not assume the slice is reusable.
type Cache interface {
	Get(key string) ([]byte, bool)
	Set(key string, value []byte, ttl time.Duration)
}

// --- In-memory cache ---

// MemoryCache is a per-process TTL cache. Single-process deployments
// can run without Redis and still benefit from embedding-result
// caching (the embedding call is the expensive part).
type MemoryCache struct {
	mu      sync.RWMutex
	entries map[string]memEntry
}

// memEntry is one (value, expiresAt) pair.
type memEntry struct {
	value     []byte
	expiresAt time.Time
}

// NewMemoryCache returns an empty in-memory cache.
func NewMemoryCache() *MemoryCache {
	return &MemoryCache{entries: make(map[string]memEntry)}
}

// Get returns (value, true) when the key is present and not expired.
func (c *MemoryCache) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	e, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.value, true
}

// Set writes a value with the given TTL.
func (c *MemoryCache) Set(key string, value []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = memEntry{value: value, expiresAt: time.Now().Add(ttl)}
	// Light GC: sweep once per ~1000 writes would be ideal, but we
	// keep the implementation tiny — the entry will be lazily
	// discarded on the next Get that touches it.
	if len(c.entries) > 4096 {
		c.gc()
	}
}

func (c *MemoryCache) gc() {
	now := time.Now()
	for k, e := range c.entries {
		if now.After(e.expiresAt) {
			delete(c.entries, k)
		}
	}
}

// --- Redis cache ---

// RedisCache wraps a go-redis Client.
type RedisCache struct {
	client *redis.Client
}

// NewRedisCache builds a Redis-backed cache. The caller owns the
// *redis.Client lifecycle (call Close() on shutdown).
func NewRedisCache(client *redis.Client) *RedisCache {
	return &RedisCache{client: client}
}

// Get fetches a key. Errors are treated as misses — a Redis outage
// must never break the AI assistant.
func (c *RedisCache) Get(key string) ([]byte, bool) {
	if c == nil || c.client == nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	v, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}
	return v, true
}

// Set writes a key with a TTL. Errors are swallowed (logged at
// the caller's discretion) so Redis outages degrade silently.
func (c *RedisCache) Set(key string, value []byte, ttl time.Duration) {
	if c == nil || c.client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_ = c.client.Set(ctx, key, value, ttl).Err()
}

// --- No-op cache ---

// NoopCache always misses. Useful in tests that want to bypass cache.
type NoopCache struct{}

// Get implements Cache.
func (NoopCache) Get(string) ([]byte, bool) { return nil, false }

// Set implements Cache.
func (NoopCache) Set(string, []byte, time.Duration) {}