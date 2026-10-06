package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"file2file/handlers"
	"file2file/middleware"
	"file2file/storage"
)

func main() {
	// Ensure upload directory exists
	uploadDir := "./uploads"
	os.MkdirAll(uploadDir, 0755)

	// Initialize store
	store := storage.NewStore(uploadDir, 100*1024*1024*1024) // 100GB cap

	// Start cleanup goroutine
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			store.CleanupExpired()
		}
	}()

	// Initialize handlers
	uploadHandler := handlers.NewUploadHandler(store)
	downloadHandler := handlers.NewDownloadHandler(store)
	infoHandler := handlers.NewInfoHandler(store)

	// Router
	mux := http.NewServeMux()
	mux.HandleFunc("/api/upload", uploadHandler.Handle)
	mux.HandleFunc("/api/download/", downloadHandler.Handle)
	mux.HandleFunc("/api/info/", infoHandler.Handle)

	// Middleware chain: logging -> rate limit -> captcha -> handler
	var handler http.Handler = mux
	handler = middleware.Logging(handler)
	handler = middleware.RateLimit(handler, 20, 60) // 20 req/min per IP
	handler = middleware.Captcha(handler)

	// Server
	srv := &http.Server{
		Addr:         ":8080",
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // no timeout for large uploads
		IdleTimeout:  120 * time.Second,
	}

	log.Println("File2File server starting on :8080")
	log.Fatal(srv.ListenAndServe())
}
