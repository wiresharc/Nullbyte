package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
)

var captchaSecret string

func init() {
	captchaSecret = os.Getenv("TURNSTILE_SECRET")
}

func Captcha(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only check on POST requests (uploads)
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}

		// Parse form to get captcha token
		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form", http.StatusBadRequest)
			return
		}

		token := r.FormValue("cf-turnstile-response")
		if token == "" {
			http.Error(w, "captcha required", http.StatusForbidden)
			return
		}

		// Verify with Cloudflare
		resp, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", url.Values{
			"secret":  {captchaSecret},
			"response": {token},
			"remoteip": {r.RemoteAddr},
		})
		if err != nil {
			http.Error(w, "captcha verification failed", http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var result struct {
			Success bool `json:"success"`
		}
		json.Unmarshal(body, &result)

		if !result.Success {
			http.Error(w, "captcha failed", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
