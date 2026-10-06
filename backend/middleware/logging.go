package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type LogEntry struct {
	Timestamp  string `json:"timestamp"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Client     string `json:"client"`
	StatusCode int    `json:"status"`
	BytesSent  int64  `json:"bytes"`
}

const (
	logDirName     = "logs"
	logFileName    = "requests.jsonl"
	maxLogBytes    = 32 << 20
	logGenerations = 3
)

var (
	logFile   *os.File
	logMu     sync.Mutex
	logBytes  int64
	logSecret []byte
)

func init() {
	logSecret = make([]byte, 32)
	rand.Read(logSecret)
}

func clientPseudonym(ip string) string {
	h := sha256.New()
	h.Write(logSecret)
	h.Write([]byte(ip))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))[:16]
}

func openLog() {
	os.MkdirAll(logDirName, 0700)
	path := filepath.Join(logDirName, logFileName)

	if info, err := os.Stat(path); err == nil {
		if info.Size() >= maxLogBytes {
			rotateLogs()
		} else {
			logBytes = info.Size()
		}
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		panic("cannot open log file: " + err.Error())
	}
	logFile = f
}

func rotateLogs() {
	oldest := filepath.Join(logDirName, logFileName+"."+itoa(logGenerations))
	os.Remove(oldest)

	for i := logGenerations - 1; i >= 1; i-- {
		from := filepath.Join(logDirName, logFileName+"."+itoa(i))
		to := filepath.Join(logDirName, logFileName+"."+itoa(i+1))
		if _, err := os.Stat(from); err == nil {
			os.Rename(from, to)
		}
	}

	cur := filepath.Join(logDirName, logFileName)
	if _, err := os.Stat(cur); err == nil {
		os.Rename(cur, filepath.Join(logDirName, logFileName+".1"))
	}

	logBytes = 0
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

func Logging(next http.Handler) http.Handler {
	logMu.Lock()
	if logFile == nil {
		openLog()
	}
	logMu.Unlock()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: 200}

		next.ServeHTTP(wrapped, r)

		entry := LogEntry{
			Timestamp:  start.UTC().Format(time.RFC3339),
			Method:     r.Method,
			Path:       r.URL.Path,
			Client:     clientPseudonym(ClientIP(r)),
			StatusCode: wrapped.statusCode,
			BytesSent:  wrapped.bytesWritten,
		}

		line, err := json.Marshal(entry)
		if err != nil {
			return
		}
		line = append(line, '\n')

		logMu.Lock()
		if logFile != nil {
			if logBytes+int64(len(line)) > maxLogBytes {
				logFile.Close()
				openLog()
			}
			n, werr := logFile.Write(line)
			if werr == nil {
				logBytes += int64(n)
			}
		}
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
