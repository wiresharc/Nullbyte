package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"file2file/storage"
)

type UploadHandlerStatus struct {
	store *storage.Store
}

func NewUploadHandlerStatus(store *storage.Store) *UploadHandlerStatus {
	return &UploadHandlerStatus{store: store}
}

// the upload id arrives in the body on purpose: it is a bearer capability and
// must never end up in a request path, because request paths are written to disk
func (h *UploadHandlerStatus) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(8 << 10); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}

	uploadID := strings.TrimSpace(r.FormValue("upload_id"))
	if !storage.ValidToken(uploadID) {
		http.Error(w, "invalid upload id", http.StatusBadRequest)
		return
	}

	session, err := h.store.LoadSession(uploadID)
	if err != nil {
		http.Error(w, "unknown upload session", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"upload_id":   session.UploadID,
		"token":       session.Token,
		"total_size":  session.TotalSize,
		"total_parts": session.TotalParts,
		"received":    h.store.ReceivedParts(session.UploadID, session.TotalParts),
		"done":        false,
	})
}
