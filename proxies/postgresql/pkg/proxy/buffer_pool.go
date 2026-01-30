package proxy

import (
	"sync"
)

// BufferPool is a pool of byte slices used for I/O operations
type BufferPool struct {
	pool sync.Pool
}

// NewBufferPool creates a new buffer pool with the specified buffer size
func NewBufferPool(size int) *BufferPool {
	return &BufferPool{
		pool: sync.Pool{
			New: func() interface{} {
				buffer := make([]byte, size)
				return &buffer
			},
		},
	}
}

// Get retrieves a buffer from the pool
func (p *BufferPool) Get() *[]byte {
	return p.pool.Get().(*[]byte)
}

// Put returns a buffer to the pool
func (p *BufferPool) Put(buf *[]byte) {
	p.pool.Put(buf)
}
