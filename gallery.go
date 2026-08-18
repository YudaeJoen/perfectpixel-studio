package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	xdraw "golang.org/x/image/draw"
	"perfectpixel/internal/config"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	_ "image/jpeg"
)

// GalleryImage는 갤러리/폴더 이미지 파일의 메타데이터입니다.
type GalleryImage struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"` // Unix 밀리초
}

var imageExtMime = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
}

const (
	maxImageFileBytes = 64 << 20 // 단일 이미지 로드 상한
	maxFolderEntries  = 2000     // 폴더 나열 상한
)

func ensureGalleryDir() (string, error) {
	dir, err := config.GalleryDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// GetGalleryPath는 갤러리 디렉토리를 보장하고 경로를 반환합니다.
func (a *App) GetGalleryPath() (string, error) {
	return ensureGalleryDir()
}

func listImagesIn(dir string) ([]GalleryImage, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("폴더를 읽을 수 없습니다: %w", err)
	}
	items := make([]GalleryImage, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || imageExtMime[strings.ToLower(filepath.Ext(e.Name()))] == "" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, GalleryImage{
			Name:    e.Name(),
			Path:    filepath.Join(dir, e.Name()),
			Size:    info.Size(),
			ModTime: info.ModTime().UnixMilli(),
		})
		if len(items) >= maxFolderEntries {
			break
		}
	}
	return items, nil
}

// ListGalleryImages는 갤러리 이미지를 최신순으로 반환합니다.
func (a *App) ListGalleryImages() ([]GalleryImage, error) {
	dir, err := ensureGalleryDir()
	if err != nil {
		return nil, err
	}
	items, err := listImagesIn(dir)
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ModTime > items[j].ModTime })
	return items, nil
}

// ListFolderImages는 지정한 폴더의 이미지를 이름순으로 반환합니다.
func (a *App) ListFolderImages(dir string) ([]GalleryImage, error) {
	items, err := listImagesIn(dir)
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

// PickFolder는 폴더 선택 대화상자를 열고 선택된 경로를 반환합니다 (취소 시 빈 문자열).
func (a *App) PickFolder() (string, error) {
	return openDirectoryDialog(a.ctx, "이미지 폴더 선택")
}

// DeleteGalleryImage는 갤러리 디렉토리 내부의 이미지만 삭제합니다.
func (a *App) DeleteGalleryImage(path string) error {
	dir, err := ensureGalleryDir()
	if err != nil {
		return err
	}
	clean := filepath.Clean(path)
	if filepath.Dir(clean) != dir {
		return errors.New("갤러리 폴더의 이미지만 삭제할 수 있습니다")
	}
	return os.Remove(clean)
}

func readImageFile(path string) ([]byte, string, error) {
	mime := imageExtMime[strings.ToLower(filepath.Ext(path))]
	if mime == "" {
		return nil, "", errors.New("지원하지 않는 이미지 형식입니다")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, "", fmt.Errorf("파일을 읽을 수 없습니다: %w", err)
	}
	if info.Size() > maxImageFileBytes {
		return nil, "", fmt.Errorf("이미지가 너무 큽니다 (%.1fMB)", float64(info.Size())/(1<<20))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("파일을 읽을 수 없습니다: %w", err)
	}
	return data, mime, nil
}

// LoadImageFull은 원본 이미지를 재인코딩 없이 dataURL로 반환합니다.
func (a *App) LoadImageFull(path string) (string, error) {
	data, mime, err := readImageFile(path)
	if err != nil {
		return "", err
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// LoadImageThumb은 maxDim 안에 들어가는 다운스케일 썸네일 dataURL을 반환합니다.
func (a *App) LoadImageThumb(path string, maxDim int) (string, error) {
	if maxDim <= 0 {
		maxDim = 200
	}
	data, mime, err := readImageFile(path)
	if err != nil {
		return "", err
	}
	orig := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	img, err := decodeImage(data)
	if err != nil {
		return orig, nil // 디코딩 실패 시 원본 렌더링에 위임
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxDim && h <= maxDim {
		return orig, nil
	}
	scale := float64(maxDim) / float64(max(w, h))
	nw := max(1, int(float64(w)*scale))
	nh := max(1, int(float64(h)*scale))
	dst := image.NewNRGBA(image.Rect(0, 0, nw, nh))
	xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)
	return pngDataURL(dst)
}

var gallerySeq uint32

func galleryStamp() string {
	n := atomic.AddUint32(&gallerySeq, 1) % 1000
	return fmt.Sprintf("%s-%03d", time.Now().Format("20060102-150405"), n)
}

// saveGalleryPNG는 생성 결과 한 장을 갤러리에 보관합니다.
func saveGalleryPNG(name string, img image.Image) error {
	dir, err := ensureGalleryDir()
	if err != nil {
		return err
	}
	return writePNG(filepath.Join(dir, name+".png"), img)
}

// composeStrip는 프레임들을 가로로 이어 붙여 하나의 스프라이트 스트립으로 만듭니다.
func composeStrip(frames []*image.NRGBA) *image.NRGBA {
	if len(frames) == 0 {
		return nil
	}
	if len(frames) == 1 {
		return frames[0]
	}
	totalW, maxH := 0, 0
	for _, f := range frames {
		b := f.Bounds()
		totalW += b.Dx()
		if b.Dy() > maxH {
			maxH = b.Dy()
		}
	}
	strip := image.NewNRGBA(image.Rect(0, 0, totalW, maxH))
	x := 0
	for _, f := range frames {
		b := f.Bounds()
		xdraw.Copy(strip, image.Point{X: x, Y: 0}, f, b, xdraw.Over, nil)
		x += b.Dx()
	}
	return strip
}

// saveGalleryFrames는 상태 생성 결과를 하나의 가로 스프라이트 스트립으로 갤러리에 보관합니다.
func saveGalleryFrames(state string, frames []*image.NRGBA) {
	strip := composeStrip(frames)
	if strip == nil {
		return
	}
	_ = saveGalleryPNG(fmt.Sprintf("%s-%s", sanitizeName(state), galleryStamp()), strip)
}
