package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"file2file/models"
)

type Store struct {
	uploadDir   string
	maxBytes    int64
	mu          sync.RWMutex
	metadataDir string
}

func NewStore(uploadDir string, maxBytes int64) *Store {
	metaDir := filepath.Join(uploadDir, ".meta")
	os.MkdirAll(metaDir, 0755)
	return &Store{
		uploadDir:   uploadDir,
		maxBytes:    maxBytes,
		metadataDir: metaDir,
	}
}

func (s *Store) Save(token string, data models.FileMetadata) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	metaPath := s.metaPath(token)
	f, err := os.Create(metaPath)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	return enc.Encode(data)
}

func (s *Store) Load(token string) (*models.FileMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	metaPath := s.metaPath(token)
	f, err := os.Open(metaPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var meta models.FileMetadata
	dec := json.NewDecoder(f)
	if err := dec.Decode(&meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func (s *Store) Delete(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	meta, err := s.Load(token)
	if err != nil {
		return err
	}

	os.Remove(filepath.Join(s.uploadDir, meta.StoredName))
	os.Remove(s.metaPath(token))
	return nil
}

func (s *Store) CleanupExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, _ := os.ReadDir(s.metadataDir)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		metaPath := filepath.Join(s.metadataDir, entry.Name())

		f, err := os.Open(metaPath)
		if err != nil {
			continue
		}

		var meta models.FileMetadata
		dec := json.NewDecoder(f)
		if err := dec.Decode(&meta); err != nil {
			f.Close()
			continue
		}
		f.Close()

		if time.Now().After(meta.ExpiresAt) {
			os.Remove(filepath.Join(s.uploadDir, meta.StoredName))
			os.Remove(metaPath)
		}
	}
}

func (s *Store) CurrentUsage() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var total int64
	entries, _ := os.ReadDir(s.uploadDir)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		total += info.Size()
	}
	return total
}

func (s *Store) HasSpace(needed int64) bool {
	return s.CurrentUsage()+needed <= s.maxBytes
}

func (s *Store) metaPath(token string) string {
	return filepath.Join(s.metadataDir, token+".json")
}

func (s *Store) GetUploadDir() string {
	return s.uploadDir
}

func HashFilename(name string) string {
	h := sha256.Sum256([]byte(name))
	return hex.EncodeToString(h[:])
}

func DetectFileType(data []byte) string {
	if len(data) < 12 {
		return "application/octet-stream"
	}

	// PDF
	if data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46 {
		return "application/pdf"
	}
	// PNG
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}
	// JPEG
	if data[0] == 0xFF && data[1] == 0xD8 {
		return "image/jpeg"
	}
	// GIF
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
		return "image/gif"
	}
	// ZIP
	if data[0] == 0x50 && data[1] == 0x4B && (data[2] == 0x03 || data[2] == 0x05 || data[2] == 0x07) {
		return "application/zip"
	}
	// MP3
	if data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33 {
		return "audio/mpeg"
	}
	// MP4
	if string(data[4:8]) == "ftyp" {
		return "video/mp4"
	}
	// DOCX (ZIP-based)
	if data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04 {
		if len(data) > 30 && string(data[30:38]) == "[Content" {
			return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		}
	}

	return "application/octet-stream"
}
