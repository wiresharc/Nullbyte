package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type visitor struct {
	count    int
	lastSeen time.Time
}

type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     int
	window   time.Duration
}

const maxTrackedVisitors = 100000

func newRateLimiter(rate int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		window:   window,
	}
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		for ip, v := range rl.visitors {
			if time.Since(v.lastSeen) > rl.window*2 {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *rateLimiter) evictLocked(now time.Time) {
	for ip, v := range rl.visitors {
		if now.Sub(v.lastSeen) > rl.window*2 {
			delete(rl.visitors, ip)
		}
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	now := time.Now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[ip]
	if !exists {
		if len(rl.visitors) >= maxTrackedVisitors {
			rl.evictLocked(now)
			if len(rl.visitors) >= maxTrackedVisitors {
				return false
			}
		}
		rl.visitors[ip] = &visitor{count: 1, lastSeen: now}
		return true
	}

	if now.Sub(v.lastSeen) > rl.window {
		v.count = 1
		v.lastSeen = now
		return true
	}

	if v.count >= rl.rate {
		return false
	}

	v.count++
	return true
}

type limitRule struct {
	prefix string
	rate   int
	window time.Duration
}

var defaultRule = limitRule{rate: 60, window: time.Minute}

var rules = []limitRule{
	{prefix: "/api/upload", rate: 40, window: time.Minute},
	{prefix: "/api/captcha/token", rate: 20, window: time.Minute},
	{prefix: "/api/info/", rate: 20, window: time.Minute},
}

var limiters = map[limitRule]*rateLimiter{}

func init() {
	limiters[defaultRule] = newRateLimiter(defaultRule.rate, defaultRule.window)
	for _, r := range rules {
		limiters[r] = newRateLimiter(r.rate, r.window)
	}
}

func limiterFor(path string) *rateLimiter {
	for _, r := range rules {
		if strings.HasPrefix(path, r.prefix) {
			return limiters[r]
		}
	}
	return limiters[defaultRule]
}

func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !limiterFor(r.URL.Path).allow(ClientIP(r)) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
