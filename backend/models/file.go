package models

import "time"

type FileMetadata struct {
	Token        string    `json:"token"`
	StoredName   string    `json:"stored_name"`
	OriginalHash string    `json:"original_hash"`
	OriginalName string    `json:"original_name"`
	Size         int64     `json:"size"`
	FileType     string    `json:"file_type"`
	ExpiresAt    time.Time `json:"expires_at"`
	MaxDownloads int       `json:"max_downloads"`
	Downloads    int       `json:"downloads"`
	Encrypted    bool      `json:"encrypted"`
	CreatedAt    time.Time `json:"created_at"`
}

type UploadSession struct {
	UploadID     string    `json:"upload_id"`
	Token        string    `json:"token"`
	TotalParts   int       `json:"total_parts"`
	TotalSize    int64     `json:"total_size"`
	StoredName   string    `json:"stored_name"`
	Filename     string    `json:"filename"`
	Encrypted    bool      `json:"encrypted"`
	MaxDownloads int       `json:"max_downloads"`
	IP           string    `json:"ip"`
	CreatedAt    time.Time `json:"created_at"`
}

func (m *FileMetadata) IsExpired() bool {
	return time.Now().After(m.ExpiresAt)
}
