package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"file2file/models"
)

const orphanGracePeriod = 2 * time.Hour
const stagingDirName = ".staging"
const stagingSuffix = ".part"
const sessionSuffix = ".session.json"
const IncompleteSessionTTL = 6 * time.Hour

type Store struct {
	uploadDir   string
	maxBytes    int64
	mu          sync.RWMutex
	metadataDir string
	stagingDir  string
	usage       atomic.Int64
	staging     atomic.Int64
}

func NewStore(uploadDir string, maxBytes int64) *Store {
	metaDir := filepath.Join(uploadDir, ".meta")
	os.MkdirAll(metaDir, 0755)
	staging := filepath.Join(uploadDir, stagingDirName)
	os.MkdirAll(staging, 0700)
	s := &Store{
		uploadDir:   uploadDir,
		maxBytes:    maxBytes,
		metadataDir: metaDir,
		stagingDir:  staging,
	}
	s.usage.Store(dirSize(uploadDir))
	s.staging.Store(dirSize(staging))
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
	s.CleanupStaging()
	s.usage.Store(dirSize(s.uploadDir))
	s.staging.Store(dirSize(s.stagingDir))
}

func (s *Store) SessionPath(uploadID string) string {
	return filepath.Join(s.stagingDir, uploadID+sessionSuffix)
}

func (s *Store) PartPath(uploadID string, index int) string {
	return filepath.Join(s.stagingDir, uploadID+"."+strconv.Itoa(index)+stagingSuffix)
}

func (s *Store) LoadSession(uploadID string) (*models.UploadSession, error) {
	data, err := os.ReadFile(s.SessionPath(uploadID))
	if err != nil {
		return nil, err
	}
	var session models.UploadSession
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Store) SaveSession(session models.UploadSession) error {
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return os.WriteFile(s.SessionPath(session.UploadID), data, 0600)
}

func (s *Store) DropSession(session models.UploadSession) {
	os.Remove(s.SessionPath(session.UploadID))
	for i := 0; i < session.TotalParts; i++ {
		os.Remove(s.PartPath(session.UploadID, i))
	}
}

func (s *Store) CleanupStaging() {
	entries, err := os.ReadDir(s.stagingDir)
	if err != nil {
		return
	}

	cutoff := time.Now().Add(-IncompleteSessionTTL)
	live := make(map[string]bool)

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), sessionSuffix) {
			continue
		}
		uploadID := strings.TrimSuffix(entry.Name(), sessionSuffix)
		session, err := s.LoadSession(uploadID)
		if err != nil {
			continue
		}
		if session.CreatedAt.Before(cutoff) {
			s.DropSession(*session)
			continue
		}
		live[uploadID] = true
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), stagingSuffix) {
			continue
		}
		base := strings.TrimSuffix(entry.Name(), stagingSuffix)
		dot := strings.LastIndex(base, ".")
		if dot <= 0 {
			continue
		}
		if live[base[:dot]] {
			continue
		}
		path := filepath.Join(s.stagingDir, entry.Name())
		info, err := os.Stat(path)
		if err != nil || info.ModTime().Before(cutoff) {
			os.Remove(path)
		}
	}
}

func (s *Store) SessionStagedBytes(uploadID string, totalParts int) int64 {
	var total int64
	for i := 0; i < totalParts; i++ {
		if info, err := os.Stat(s.PartPath(uploadID, i)); err == nil {
			total += info.Size()
		}
	}
	return total
}

func (s *Store) AddStaging(n int64) {
	s.staging.Add(n)
}

func (s *Store) ReleaseStaging(n int64) {
	s.staging.Add(-n)
}

func (s *Store) HasSpaceForStaging(n int64) bool {
	return s.usage.Load()+s.staging.Load()+n <= s.maxBytes
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

func SanitizeFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if cut := strings.IndexAny(name, "\";"); cut >= 0 {
		name = name[:cut]
	}
	name = strings.TrimSpace(name)

	if name == "" || name == "." || name == ".." {
		return ""
	}
	if len(name) > 200 {
		name = name[:200]
	}
	return name
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
