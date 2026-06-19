// Package queue is a tiny in-memory job queue. Phase 3 will wire the worker.
// For production (30K msg/day per the proposal) swap in Redis + Asynq
// behind the same interface.
package queue

import (
	"context"
	"log"
	"sync"
)

type MessageJob struct {
	MessageJobID   int64
	BatchID        int64
	BillingRecordID int64
	ToNumber       string
	TemplateName   string
	LanguageCode   string
	TemplateParams []string
	Attempt        int
}

type JobQueue interface {
	Enqueue(ctx context.Context, job MessageJob) error
	Run(ctx context.Context, handler func(context.Context, MessageJob))
	Stop()
	Depth() int
}

type MemoryQueue struct {
	ch       chan MessageJob
	wg       sync.WaitGroup
	stopOnce sync.Once
	stopped  chan struct{}
}

func NewMemory(buffer int) *MemoryQueue {
	if buffer <= 0 {
		buffer = 1024
	}
	return &MemoryQueue{
		ch:      make(chan MessageJob, buffer),
		stopped: make(chan struct{}),
	}
}

func (q *MemoryQueue) Enqueue(_ context.Context, job MessageJob) error {
	q.ch <- job
	return nil
}

func (q *MemoryQueue) Run(ctx context.Context, handler func(context.Context, MessageJob)) {
	const workers = 4
	for i := 0; i < workers; i++ {
		q.wg.Add(1)
		go func(id int) {
			defer q.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case <-q.stopped:
					return
				case job, ok := <-q.ch:
					if !ok {
						return
					}
					go func(j MessageJob) {
						defer func() {
							if r := recover(); r != nil {
								log.Printf("[queue] worker panic: %v", r)
							}
						}()
						handler(ctx, j)
					}(job)
				}
			}
		}(i)
	}
}

func (q *MemoryQueue) Stop() {
	q.stopOnce.Do(func() {
		close(q.stopped)
		close(q.ch)
	})
	q.wg.Wait()
}

func (q *MemoryQueue) Depth() int { return len(q.ch) }
