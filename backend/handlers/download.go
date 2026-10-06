package handlers

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"file2file/storage"
)

type DownloadHandler struct {
	store *storage.Store
}

func NewDownloadHandler(store *storage.Store) *DownloadHandler {
	return &DownloadHandler{store: store}
}

func (h *DownloadHandler) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// extract token from path
	token := strings.TrimPrefix(r.URL.Path, "/api/download/")
	if !storage.ValidToken(token) {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	meta, err := h.store.Load(token)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	// check expiry and download limit
	if meta.IsExpired() {
		h.store.Delete(token)
		http.Error(w, "file expired", http.StatusGone)
		return
	}

	if meta.Downloads >= meta.MaxDownloads {
		h.store.Delete(token)
		http.Error(w, "download limit reached", http.StatusGone)
		return
	}

	filePath := filepath.Join(h.store.GetUploadDir(), meta.StoredName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "file missing", http.StatusNotFound)
		return
	}

	meta.Downloads++
	exhausted := meta.Downloads >= meta.MaxDownloads
	if !exhausted {
		h.store.Save(token, *meta)
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	if name := storage.SanitizeFilename(meta.OriginalName); name != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	} else {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "file.bin"}))
	}
	http.ServeFile(w, r, filePath)

	// burn after the bytes are written, never before
	if exhausted {
		h.store.Delete(token)
	}
}
