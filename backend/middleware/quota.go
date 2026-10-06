package middleware

import (
	"sync"
	"time"
)

const quotaWindow = 24 * time.Hour
const maxQuotaEntries = 50000

type quotaEntry struct {
	bytes       int64
	windowStart time.Time
}

var (
	quotaMu    sync.Mutex
	quotaUsage = make(map[string]*quotaEntry)
)

func AllowQuota(ip string, size int64, maxBytes int64) bool {
	now := time.Now()

	quotaMu.Lock()
	defer quotaMu.Unlock()

	e, ok := quotaUsage[ip]
	if ok && now.Sub(e.windowStart) >= quotaWindow {
		delete(quotaUsage, ip)
		ok = false
	}

	if !ok {
		if len(quotaUsage) >= maxQuotaEntries {
			for k, v := range quotaUsage {
				if now.Sub(v.windowStart) >= quotaWindow {
					delete(quotaUsage, k)
				}
			}
			if len(quotaUsage) >= maxQuotaEntries {
				return false
			}
		}
		quotaUsage[ip] = &quotaEntry{windowStart: now}
		return size <= maxBytes
	}

	return e.bytes+size <= maxBytes
}

func ConsumeQuota(ip string, size int64) {
	quotaMu.Lock()
	defer quotaMu.Unlock()

	if e, ok := quotaUsage[ip]; ok {
		e.bytes += size
	}
}
