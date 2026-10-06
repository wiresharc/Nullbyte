package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"file2file/handlers"
	"file2file/middleware"
	"file2file/storage"
)

func main() {
	uploadDir := "./uploads"
	os.MkdirAll(uploadDir, 0755)

	store := storage.NewStore(uploadDir, 100*1024*1024*1024)

	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			store.CleanupExpired()
		}
	}()

	uploadHandler := handlers.NewUploadHandler(store)
	downloadHandler := handlers.NewDownloadHandler(store)
	infoHandler := handlers.NewInfoHandler(store)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/upload", uploadHandler.Handle)
	mux.HandleFunc("/api/download/", downloadHandler.Handle)
	mux.HandleFunc("/api/info/", infoHandler.Handle)
	mux.HandleFunc("/api/captcha/token", func(w http.ResponseWriter, r *http.Request) {
		token := middleware.GenerateCaptchaToken()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	})

	var handler http.Handler = mux
	handler = middleware.Logging(handler)
	handler = middleware.RateLimit(handler, 20, 60)
	handler = middleware.CORS(handler)

	// workin on a weeknd like usual

	srv := &http.Server{
		Addr:         ":8080",
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	log.Println("File2File server starting on :8080")
	log.Fatal(srv.ListenAndServe())
}
