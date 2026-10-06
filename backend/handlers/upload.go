package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"file2file/middleware"
	"file2file/models"
	"file2file/storage"
)

type UploadHandler struct {
	store        *storage.Store
	slots        chan struct{}
	quotaBytes   int64
	readTimeout  time.Duration
	writeTimeout time.Duration
	maxFileBytes int64
}

func NewUploadHandler(store *storage.Store, maxConcurrent int, quotaBytes int64, maxFileBytes int64, readTimeout, writeTimeout time.Duration) *UploadHandler {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &UploadHandler{
		store:        store,
		slots:        make(chan struct{}, maxConcurrent),
		quotaBytes:   quotaBytes,
		readTimeout:  readTimeout,
		writeTimeout: writeTimeout,
		maxFileBytes: maxFileBytes,
	}
}

func (h *UploadHandler) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	case <-r.Context().Done():
		http.Error(w, "request cancelled", http.StatusRequestTimeout)
		return
	case <-time.After(30 * time.Second):
		http.Error(w, "server busy, retry shortly", http.StatusServiceUnavailable)
		return
	}

	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Now().Add(h.readTimeout))
	rc.SetWriteDeadline(time.Now().Add(h.writeTimeout))

	r.Body = http.MaxBytesReader(w, r.Body, h.maxFileBytes+(32<<20))
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "file too large", http.StatusBadRequest)
		return
	}
	defer r.MultipartForm.RemoveAll()

	if !middleware.ValidateUpload(w, r) {
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "no file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size <= 0 {
		http.Error(w, "empty file", http.StatusBadRequest)
		return
	}

	if header.Size > h.maxFileBytes {
		http.Error(w, "file exceeds size limit", http.StatusRequestEntityTooLarge)
		return
	}

	ip := middleware.ClientIP(r)
	if !middleware.AllowQuota(ip, header.Size, h.quotaBytes) {
		http.Error(w, "daily upload quota exceeded", http.StatusTooManyRequests)
		return
	}

	if !h.store.HasSpace(header.Size) {
		http.Error(w, "storage full", http.StatusInsufficientStorage)
		return
	}

	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	fileType := storage.DetectFileType(buf[:n])

	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	storedName := token + ".bin"
	destPath := filepath.Join(h.store.GetUploadDir(), storedName)

	file.Seek(0, io.SeekStart)
	dest, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	defer dest.Close()

	written, err := io.Copy(dest, file)
	if err != nil {
		os.Remove(destPath)
		http.Error(w, "upload failed", http.StatusInternalServerError)
		return
	}

	maxDownloads := 1
	if r.FormValue("downloads") == "multi" {
		maxDownloads = 10
	}

	meta := models.FileMetadata{
		Token:        token,
		StoredName:   storedName,
		OriginalHash: storage.HashFilename(header.Filename),
		Size:         written,
		FileType:     fileType,
		ExpiresAt:    time.Now().Add(24 * time.Hour),
		MaxDownloads: maxDownloads,
		Downloads:    0,
		Encrypted:    r.FormValue("encrypted") == "true",
		CreatedAt:    time.Now(),
	}

	if err := h.store.Save(token, meta); err != nil {
		os.Remove(destPath)
		http.Error(w, "metadata error", http.StatusInternalServerError)
		return
	}

	h.store.AddUsage(written)
	middleware.ConsumeQuota(ip, written)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":     token,
		"expires":   meta.ExpiresAt.Format(time.RFC3339),
		"size":      written,
		"file_type": fileType,
	})
}

func (h *UploadHandler) GetStore() *storage.Store {
	return h.store
}
