package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"file2file/storage"
)

type InfoHandler struct {
	store *storage.Store
}

func NewInfoHandler(store *storage.Store) *InfoHandler {
	return &InfoHandler{store: store}
}

func (h *InfoHandler) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := strings.TrimPrefix(r.URL.Path, "/api/info/")
	if !storage.ValidToken(token) {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	meta, err := h.store.Load(token)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	if meta.IsExpired() {
		h.store.Delete(token)
		http.Error(w, "file expired", http.StatusGone)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"size":          meta.Size,
		"file_type":     meta.FileType,
		"expires_at":    meta.ExpiresAt.Format(time.RFC3339),
		"max_downloads": meta.MaxDownloads,
		"downloads":     meta.Downloads,
		"encrypted":     meta.Encrypted,
	})
}
