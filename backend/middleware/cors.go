package middleware

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const originsFile = "origins.txt"

var (
	originsMu    sync.RWMutex
	originsCache map[string]bool
	originsAll   bool
	originsAt    time.Time
)

const originsCacheTTL = 5 * time.Second

func parseOrigins(raw string) (map[string]bool, bool) {
	set := make(map[string]bool)
	all := false
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})
	for _, origin := range parts {
		if origin == "*" {
			all = true
			continue
		}
		set[strings.TrimSuffix(origin, "/")] = true
	}
	return set, all
}

func loadOrigins() (map[string]bool, bool) {
	originsMu.RLock()
	if originsCache != nil && time.Since(originsAt) < originsCacheTTL {
		set, all := originsCache, originsAll
		originsMu.RUnlock()
		return set, all
	}
	originsMu.RUnlock()

	fromEnv, envAll := parseOrigins(os.Getenv("ALLOWED_ORIGINS"))

	if data, err := os.ReadFile(originsFile); err == nil {
		fromFile, fileAll := parseOrigins(string(data))
		for origin := range fromFile {
			fromEnv[origin] = true
		}
		envAll = envAll || fileAll
	}

	originsMu.Lock()
	originsCache = fromEnv
	originsAll = envAll
	originsAt = time.Now()
	originsMu.Unlock()

	return fromEnv, envAll
}

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin != "" {
			allowed, allowAll := loadOrigins()
			normalized := strings.TrimSuffix(origin, "/")

			if allowAll || allowed[normalized] {
				if allowAll {
					w.Header().Set("Access-Control-Allow-Origin", "*")
				} else {
					w.Header().Set("Access-Control-Allow-Origin", origin)
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.Header().Add("Vary", "Origin")

				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}
