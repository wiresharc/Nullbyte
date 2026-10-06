package models

import "time"

type FileMetadata struct {
	Token        string    `json:"token"`
	StoredName   string    `json:"stored_name"`
	OriginalHash string    `json:"original_hash"`
	Size         int64     `json:"size"`
	FileType     string    `json:"file_type"`
	ExpiresAt    time.Time `json:"expires_at"`
	MaxDownloads int       `json:"max_downloads"`
	Downloads    int       `json:"downloads"`
	Encrypted    bool      `json:"encrypted"`
	CreatedAt    time.Time `json:"created_at"`
}

func (m *FileMetadata) IsExpired() bool {
	return time.Now().After(m.ExpiresAt)
}
