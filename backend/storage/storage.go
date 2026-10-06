package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"file2file/models"
)

const orphanGracePeriod = 2 * time.Hour

type Store struct {
	uploadDir   string
	maxBytes    int64
	mu          sync.RWMutex
	metadataDir string
	usage       atomic.Int64
}

func NewStore(uploadDir string, maxBytes int64) *Store {
	metaDir := filepath.Join(uploadDir, ".meta")
	os.MkdirAll(metaDir, 0755)
	s := &Store{
		uploadDir:   uploadDir,
		maxBytes:    maxBytes,
		metadataDir: metaDir,
	}
	s.usage.Store(dirSize(uploadDir))
	return s
}

func ValidToken(token string) bool {
	if len(token) != 32 {
		return false
	}
	for i := 0; i < len(token); i++ {
		c := token[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func dirSize(dir string) int64 {
	var total int64
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if info, err := entry.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

func (s *Store) Save(token string, data models.FileMetadata) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.save(token, data)
}

func (s *Store) save(token string, data models.FileMetadata) error {
	f, err := os.Create(s.metaPath(token))
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	return enc.Encode(data)
}

func (s *Store) AddUsage(n int64) {
	s.usage.Add(n)
}

func (s *Store) Load(token string) (*models.FileMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.load(token)
}

func (s *Store) load(token string) (*models.FileMetadata, error) {
	f, err := os.Open(s.metaPath(token))
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
	freed, err := s.delete(token)
	s.mu.Unlock()

	if err == nil {
		s.usage.Add(-freed)
	}
	return err
}

func (s *Store) delete(token string) (int64, error) {
	meta, err := s.load(token)
	if err != nil {
		return 0, err
	}

	os.Remove(filepath.Join(s.uploadDir, meta.StoredName))
	os.Remove(s.metaPath(token))
	return meta.Size, nil
}

func (s *Store) CleanupExpired() {
	entries, err := os.ReadDir(s.metadataDir)
	if err != nil {
		return
	}

	referenced := make(map[string]struct{}, len(entries))
	var expired []string

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		token := strings.TrimSuffix(entry.Name(), ".json")
		if !ValidToken(token) {
			continue
		}

		meta, err := s.Load(token)
		if err != nil {
			continue
		}

		referenced[meta.StoredName] = struct{}{}

		if meta.IsExpired() {
			expired = append(expired, token)
		}
	}

	for _, token := range expired {
		s.Delete(token)
	}

	s.reclaimOrphans(referenced)
	s.usage.Store(dirSize(s.uploadDir))
}

func (s *Store) reclaimOrphans(referenced map[string]struct{}) {
	blobs, err := os.ReadDir(s.uploadDir)
	if err != nil {
		return
	}

	cutoff := time.Now().Add(-orphanGracePeriod)

	for _, blob := range blobs {
		if blob.IsDir() {
			continue
		}
		if _, ok := referenced[blob.Name()]; ok {
			continue
		}

		info, err := blob.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}

		os.Remove(filepath.Join(s.uploadDir, blob.Name()))
	}
}

func (s *Store) CurrentUsage() int64 {
	return s.usage.Load()
}

func (s *Store) HasSpace(needed int64) bool {
	return s.usage.Load()+needed <= s.maxBytes
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

	if data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46 {
		return "application/pdf"
	}
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}
	if data[0] == 0xFF && data[1] == 0xD8 {
		return "image/jpeg"
	}
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
		return "image/gif"
	}
	if data[0] == 0x50 && data[1] == 0x4B && (data[2] == 0x03 || data[2] == 0x05 || data[2] == 0x07) {
		return "application/zip"
	}
	if data[0] == 0x49 && data[1] == 0x44 && data[2] == 0x33 {
		return "audio/mpeg"
	}
	if string(data[4:8]) == "ftyp" {
		return "video/mp4"
	}
	if data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04 {
		if len(data) > 30 && string(data[30:38]) == "[Content" {
			return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		}
	}

	return "application/octet-stream"
}
