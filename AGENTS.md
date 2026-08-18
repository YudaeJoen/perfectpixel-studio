# Repository Guidance

- This is a Go 1.25 Wails desktop app with a React 18/Vite frontend; `internal/sprite`, `internal/gen`, and `internal/config` are shared by the GUI and headless tools.
- `main.go` embeds `frontend/dist`; run `cd frontend && npm install && npm run build` before root `go test ./...`, `go vet ./...`, or `go build ./...`.
- Desktop development uses `./dev.sh`; production desktop builds use `wails build`. Wails bindings under `frontend/wailsjs/` are generated and must not be hand-edited.
- Web mode is a separate `web` build tag: `docker compose up --build` builds the frontend and runs the unauthenticated HTTP server on port 8080.
- `./web.sh` is the local shortcut: it uses Docker when available, otherwise builds the frontend and `-tags web` binary before starting the server.
- Web API keys can come from Docker environment variables or the web Settings dialog; persist `/data` as the Docker volume for config, session, gallery, and temporary exports.
- The web service is single-admin/global state, not multi-user, and has no authentication; keep it on a trusted internal network.
- Frontend scripts are only `npm run dev`, `npm run build` (`tsc && vite build`), and `npm run preview`; there is no frontend test/lint script.
- Live Go tests require `PP_LIVE_TEST=1 FAL_KEY=...` and consume fal.ai credits; use focused package tests for offline work.
- `go run ./cmd/ppgen -dump` and `go run ./cmd/ppvalidate -dump` do not call an API; generation/validation commands do.
- `ppverify` requires the ignored `sample/` corpus, while `ppsamples` can modify tracked files under `report-images/`.
- `videos/perfectpixel-promo/` is a separate HyperFrames project; follow its nested `AGENTS.md` and `CLAUDE.md` there.
