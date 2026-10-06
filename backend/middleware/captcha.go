package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"
)

var captchaTokens = make(map[string]bool)

func Captcha(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}

		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form", http.StatusBadRequest)
			return
		}

		honeypot := r.FormValue("website")
		if honeypot != "" {
			http.Error(w, "bot detected", http.StatusForbidden)
			return
		}

		captchaToken := r.FormValue("captcha_token")
		if captchaToken == "" {
			http.Error(w, "captcha required", http.StatusForbidden)
			return
		}

		if !captchaTokens[captchaToken] {
			http.Error(w, "invalid captcha", http.StatusForbidden)
			return
		}

		delete(captchaTokens, captchaToken)

		next.ServeHTTP(w, r)
	})
}

func GenerateCaptchaToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	token := hex.EncodeToString(b)
	captchaTokens[token] = true
	go func() {
		time.Sleep(5 * time.Minute)
		delete(captchaTokens, token)
	}()
	return token
}
