package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	"file2file/storage"
)

const captchaTokenTTL = 5 * time.Minute
const maxCaptchaTokens = 50000

var (
	captchaMu     sync.Mutex
	captchaTokens = make(map[string]time.Time)
)

func sweepCaptchaLocked(now time.Time) {
	for token, exp := range captchaTokens {
		if now.After(exp) {
			delete(captchaTokens, token)
		}
	}
}

func GenerateCaptchaToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	token := hex.EncodeToString(b)
	now := time.Now()

	captchaMu.Lock()
	sweepCaptchaLocked(now)
	if len(captchaTokens) >= maxCaptchaTokens {
		captchaMu.Unlock()
		return "", errors.New("captcha capacity reached")
	}
	captchaTokens[token] = now.Add(captchaTokenTTL)
	captchaMu.Unlock()

	return token, nil
}

// must run after the multipart form has been parsed
func ValidateUpload(w http.ResponseWriter, r *http.Request) bool {
	if r.FormValue("website") != "" {
		http.Error(w, "bot detected", http.StatusForbidden)
		return false
	}

	token := r.FormValue("captcha_token")
	if token == "" {
		http.Error(w, "captcha required", http.StatusForbidden)
		return false
	}

	if !storage.ValidToken(token) {
		http.Error(w, "invalid captcha", http.StatusForbidden)
		return false
	}

	captchaMu.Lock()
	exp, ok := captchaTokens[token]
	if ok {
		delete(captchaTokens, token)
	}
	captchaMu.Unlock()

	if !ok || time.Now().After(exp) {
		http.Error(w, "invalid captcha", http.StatusForbidden)
		return false
	}

	return true
}
