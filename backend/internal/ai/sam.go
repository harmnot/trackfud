package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
)

// CropBox is a normalized [0,1] bounding box for a dish/ID/proof crop.
type CropBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// CropRequest asks for one subject crop.
type CropRequest struct {
	// FileSHA256 identifies the source photo (hex of the bytes).
	FileSHA256 string
	// Subject is dish, id_front, id_back, bike, or proof.
	Subject string
	// Hint is free text (dish name, "motor or battery") for the live model.
	Hint string
}

// Cropper finds the subject box. Implementations must be safe with no key.
type Cropper interface {
	Crop(ctx context.Context, req CropRequest) (CropBox, CallRecord, error)
}

// StubCropper is the no-key SAM stand-in: a deterministic, content-derived
// center-ish box (stable per photo+subject) so menu import, trust brief,
// and proof check all work offline. It never claims a real segmentation.
func StubCropper() Cropper { return stubCropper{} }

type stubCropper struct{}

func (stubCropper) Crop(_ context.Context, req CropRequest) (CropBox, CallRecord, error) {
	sum := sha256.Sum256([]byte(req.FileSHA256 + "|" + req.Subject))
	// Deterministic jitter in [0.10, 0.20] keeps boxes stable per photo.
	jx := 0.10 + float64(sum[0]%11)/100
	jy := 0.10 + float64(sum[1]%11)/100
	box := CropBox{X: jx, Y: jy, Width: 0.80 - jx, Height: 0.80 - jy}
	rec := CallRecord{Feature: "sam_crop", Model: "sam-stub", Fallback: true}
	return box, rec, nil
}

// MetaCropper calls the SAM 3.1 endpoint when a key exists and degrades to
// the stub otherwise. The crop is advisory (dish thumbnails, ID readability
// hints); humans review IDs and bans.
type MetaCropper struct {
	cfg Config
}

// NewMetaCropper builds the live cropper.
func NewMetaCropper(cfg Config) *MetaCropper {
	return &MetaCropper{cfg: cfg.withDefaults()}
}

// Crop implements Cropper.
func (m *MetaCropper) Crop(ctx context.Context, req CropRequest) (CropBox, CallRecord, error) {
	if m.cfg.APIKey == "" {
		return StubCropper().Crop(ctx, req)
	}
	// The Meta segmentation call needs the raw image bytes; the app layer
	// passes a content hash only, so the live path reuses the stub box and
	// records the model that WOULD serve it once byte upload lands (P1).
	// This keeps the interface honest: no fake "AI cropped this" claims.
	box, _, err := StubCropper().Crop(ctx, req)
	if err != nil {
		return CropBox{}, CallRecord{}, err
	}
	rec := CallRecord{Feature: "sam_crop", Model: m.cfg.SAMModel, Fallback: true,
		ErrText: "byte-upload pending; stub box recorded"}
	return box, rec, nil
}

// HashBytes returns the hex SHA-256 of file bytes for crop/fallback keys.
func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
