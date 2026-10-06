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
	store *storage.Store
}

func NewUploadHandler(store *storage.Store) *UploadHandler {
	return &UploadHandler{store: store}
}

func (h *UploadHandler) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024*1024+32*1024*1024)
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
		maxDownloads = 10 // configurable
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
		CreatedAt:    time.Now(),
	}

	if err := h.store.Save(token, meta); err != nil {
		os.Remove(destPath)
		http.Error(w, "metadata error", http.StatusInternalServerError)
		return
	}

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
