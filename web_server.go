//go:build web

package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"perfectpixel/internal/config"
)

const (
	defaultWebAddr = ":8080"
	maxJSONBody    = 128 << 20
	maxUploadBytes = 64 << 20
)

type progressState struct {
	mu      sync.RWMutex
	version uint64
	data    any
}

func (p *progressState) emit(_ string, data any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.version++
	p.data = data
}

func (p *progressState) snapshot() (uint64, any) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.version, p.data
}

type webServer struct {
	app      *App
	progress *progressState
	dataDir  string
	exports  string
	slots    chan struct{}
}

func runWebServer() error {
	if err := os.Setenv("PP_WEB", "1"); err != nil {
		return err
	}
	dataDir := os.Getenv("PP_DATA_DIR")
	if dataDir == "" {
		dataDir = filepath.Join(".", ".web-data")
	}
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return fmt.Errorf("data directory: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	// config.Load uses os.UserConfigDir. Keep all web-mode state under the
	// configured data volume unless the operator explicitly supplied a config root.
	if os.Getenv("XDG_CONFIG_HOME") == "" && os.Getenv("APPDATA") == "" {
		if err := os.Setenv("XDG_CONFIG_HOME", filepath.Join(dataDir, "config")); err != nil {
			return err
		}
	}

	progress := &progressState{}
	s := &webServer{
		progress: progress,
		dataDir:  dataDir,
		exports:  filepath.Join(dataDir, "exports"),
		slots:    make(chan struct{}, 3),
	}
	s.app = NewWebApp(progress.emit)
	if err := os.MkdirAll(s.exports, 0o755); err != nil {
		return fmt.Errorf("create exports directory: %w", err)
	}

	addr := os.Getenv("PP_WEB_ADDR")
	if addr == "" {
		addr = defaultWebAddr
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           s.handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      40 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}
	fmt.Printf("PerfectPixel web server listening on %s (data: %s)\n", addr, dataDir)
	return server.ListenAndServe()
}

func (s *webServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/settings", s.settings)
	mux.HandleFunc("/api/settings/provider", s.setProvider)
	mux.HandleFunc("/api/settings/model", s.setModel)
	mux.HandleFunc("/api/settings/key", s.saveKey)
	mux.HandleFunc("/api/directions", s.directions)
	mux.HandleFunc("/api/presets", s.presets)
	mux.HandleFunc("/api/progress", s.progressSnapshot)
	mux.HandleFunc("/api/generation/cancel", s.cancel)
	mux.HandleFunc("/api/session", s.session)
	mux.HandleFunc("/api/character/upload", s.uploadCharacter)
	mux.HandleFunc("/api/character/generate", s.generateCharacter)
	mux.HandleFunc("/api/state/generate", s.generateState)
	mux.HandleFunc("/api/frames/mirror", s.mirrorFrames)
	mux.HandleFunc("/api/export", s.exportProject)
	mux.HandleFunc("/api/gallery", s.gallery)
	mux.HandleFunc("/api/gallery/path", s.galleryPath)
	mux.HandleFunc("/api/gallery/image", s.galleryImage)

	static, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(static))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
		if path != "." {
			if f, err := fs.Stat(static, path); err == nil && !f.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// React is a single-page app: unknown browser routes receive index.html.
		clone := r.Clone(r.Context())
		clone.URL.Path = "/"
		fileServer.ServeHTTP(w, clone)
	})
	return withJSONHeaders(withRecover(mux))
}

func withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func withJSONHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func (s *webServer) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *webServer) settings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, s.app.GetSettings())
}

func (s *webServer) setProvider(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req struct {
		Provider string `json:"provider"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.SetProvider(req.Provider); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *webServer) setModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.SaveProviderModel(req.Provider, req.Model); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *webServer) saveKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.SaveProviderKey(req.Provider, req.Key); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *webServer) directions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, s.app.ListDirections())
}

func (s *webServer) presets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, s.app.ListPresets())
}

func (s *webServer) progressSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	version, data := s.progress.snapshot()
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "data": data})
}

func (s *webServer) cancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	s.app.CancelGeneration()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *webServer) session(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]string{"data": s.app.LoadSession()})
	case http.MethodPut, http.MethodPost:
		var req struct {
			Data string `json:"data"`
		}
		if err := readJSON(w, r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if len(req.Data) > 16<<20 {
			writeError(w, http.StatusRequestEntityTooLarge, errors.New("세션 데이터가 너무 큽니다"))
			return
		}
		if err := s.app.SaveSession(req.Data); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case http.MethodDelete:
		if err := s.app.ClearSession(); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		methodNotAllowed(w)
	}
}

func (s *webServer) uploadCharacter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("이미지 업로드 실패: %w", err))
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("이미지 파일이 필요합니다"))
		return
	}
	defer file.Close()
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil || len(data) > maxUploadBytes {
		writeError(w, http.StatusBadRequest, errors.New("이미지 파일이 너무 큽니다"))
		return
	}
	img, err := decodeImage(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := pngDataURL(img)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *webServer) generateCharacter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if err := s.acquire(r.Context()); err != nil {
		writeError(w, http.StatusRequestTimeout, err)
		return
	}
	defer s.release()
	var args GenerateCharacterArgs
	if err := readJSON(w, r, &args); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.generateCharacter(r.Context(), args)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *webServer) generateState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if err := s.acquire(r.Context()); err != nil {
		writeError(w, http.StatusRequestTimeout, err)
		return
	}
	defer s.release()
	var args GenerateStateArgs
	if err := readJSON(w, r, &args); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.generateState(r.Context(), args)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *webServer) mirrorFrames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var frames []string
	if err := readJSON(w, r, &frames); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(frames) > 100 {
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("프레임 수가 너무 많습니다"))
		return
	}
	result, err := s.app.MirrorFrames(frames)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *webServer) acquire(ctx context.Context) error {
	select {
	case s.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *webServer) release() {
	<-s.slots
}

func (s *webServer) exportProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var args ExportArgs
	if err := readJSON(w, r, &args); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(args.States) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("내보낼 애니메이션이 없습니다"))
		return
	}
	if len(args.States) > 100 {
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("애니메이션 상태가 너무 많습니다"))
		return
	}
	for _, state := range args.States {
		if len(state.Frames) == 0 || len(state.Frames) > 20 {
			writeError(w, http.StatusBadRequest, errors.New("상태별 프레임 수는 1~20 사이여야 합니다"))
			return
		}
	}
	if err := s.acquire(r.Context()); err != nil {
		writeError(w, http.StatusRequestTimeout, err)
		return
	}
	defer s.release()
	s.app.emit("progress", map[string]any{"phase": "export", "message": "스프라이트시트·GIF 내보내는 중..."})
	defer s.app.emit("progress", map[string]any{"phase": "idle", "message": ""})
	name := sanitizeName(args.Character)
	if name == "" {
		name = "character"
	}
	outDir := filepath.Join(s.exports, fmt.Sprintf("%s-%d", name, time.Now().UnixNano()))
	zipPath := outDir + ".zip"
	defer os.RemoveAll(outDir)
	defer os.Remove(zipPath)
	if err := exportProjectToDir(args, outDir); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := zipDirectory(outDir, zipPath); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name+".zip"))
	http.ServeFile(w, r, zipPath)
}

func (s *webServer) galleryPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, "server gallery")
}

func (s *webServer) gallery(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		items, err := s.app.ListGalleryImages()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		out := make([]GalleryImage, 0, len(items))
		for _, item := range items {
			item.Path = "/api/gallery/image?name=" + url.QueryEscape(filepath.Base(item.Path))
			out = append(out, item)
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	methodNotAllowed(w)
}

func (s *webServer) galleryImage(w http.ResponseWriter, r *http.Request) {
	name, err := safeQueryName(r.URL.Query().Get("name"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	dir, err := config.GalleryDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	path := filepath.Join(dir, name)
	switch r.Method {
	case http.MethodGet:
		data, mime, err := readImageFile(path)
		if err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		if r.URL.Query().Get("thumb") != "" {
			maxDim := 200
			if _, err := fmt.Sscanf(r.URL.Query().Get("thumb"), "%d", &maxDim); err != nil || maxDim <= 0 {
				maxDim = 200
			}
			if img, err := decodeImage(data); err == nil {
				if b := img.Bounds(); b.Dx() > maxDim || b.Dy() > maxDim {
					if thumb, err := s.app.LoadImageThumb(path, maxDim); err == nil {
						thumbData, err := decodeDataURL(thumb)
						if err == nil {
							data = thumbData
							mime = "image/png"
						}
					}
				}
			}
		}
		w.Header().Set("Content-Type", mime)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	case http.MethodDelete:
		if err := s.app.DeleteGalleryImage(path); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		methodNotAllowed(w)
	}
}

func safeQueryName(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || name == "." || name == ".." {
		return "", errors.New("잘못된 이미지 이름입니다")
	}
	return name, nil
}

func zipDirectory(srcDir, dst string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	var paths []string
	if err := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			paths = append(paths, path)
		}
		return nil
	}); err != nil {
		return err
	}
	sort.Strings(paths)
	for _, path := range paths {
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		h, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		h.Method = zip.Deflate
		w, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(w, in)
		closeErr := in.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return f.Close()
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, POST, PUT, DELETE")
	writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}
