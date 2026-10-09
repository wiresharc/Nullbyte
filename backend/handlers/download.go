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

	// a preview is a read, not a download: it must never consume the single
	// allowed download or burn the file, otherwise merely looking at a link
	// destroys it
	isPreview := r.URL.Query().Get("preview") == "1"

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

	exhausted := false
	if !isPreview {
		meta.Downloads++
		exhausted = meta.Downloads >= meta.MaxDownloads
		if !exhausted {
			h.store.Save(token, *meta)
		}
	}

	disposition := "attachment"
	if isPreview {
		disposition = "inline"
	}
	if name := storage.SanitizeFilename(meta.OriginalName); name != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	} else {
		w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": "file.bin"}))
	}
	http.ServeFile(w, r, filePath)

	// burn after the bytes are written, never before
	if exhausted {
		h.store.Delete(token)
	}
}
