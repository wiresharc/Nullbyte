package middleware

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
)

type LogEntry struct {
	Timestamp   string `json:"timestamp"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	IP          string `json:"ip"`
	StatusCode  int    `json:"status_code"`
	BytesSent   int64  `json:"bytes_sent"`
	UserAgent   string `json:"user_agent"`
}

var (
	logFile *os.File
	logMu   sync.Mutex
)

func init() {
	var err error
	logFile, err = os.OpenFile("requests.jsonl", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		panic("cannot open log file: " + err.Error())
	}
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)

		// Wrap response writer to capture status and bytes
		wrapped := &responseWriter{ResponseWriter: w, statusCode: 200}

		next.ServeHTTP(wrapped, r)

		entry := LogEntry{
			Timestamp:  start.UTC().Format(time.RFC3339),
			Method:     r.Method,
			Path:       r.URL.Path,
			IP:         ip,
			StatusCode: wrapped.statusCode,
			BytesSent:  wrapped.bytesWritten,
			UserAgent:  r.UserAgent(),
		}

		logMu.Lock()
		enc := json.NewEncoder(logFile)
		enc.Encode(entry)
		logMu.Unlock()
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int64
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.bytesWritten += int64(n)
	return n, err
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
