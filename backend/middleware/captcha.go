package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

var (
	captchaMu     sync.Mutex
	captchaTokens = make(map[string]bool)
)

func GenerateCaptchaToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	token := hex.EncodeToString(b)

	captchaMu.Lock()
	captchaTokens[token] = true
	captchaMu.Unlock()

	go func() {
		time.Sleep(5 * time.Minute)
		captchaMu.Lock()
		delete(captchaTokens, token)
		captchaMu.Unlock()
	}()

	return token
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

	captchaMu.Lock()
	valid := captchaTokens[token]
	if valid {
		delete(captchaTokens, token)
	}
	captchaMu.Unlock()

	if !valid {
		http.Error(w, "invalid captcha", http.StatusForbidden)
		return false
	}

	return true
}