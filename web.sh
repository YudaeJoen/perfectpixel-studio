#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && [[ "${PP_LOCAL:-0}" != "1" ]]; then
  echo "Starting Docker web service on http://localhost:${PP_PORT:-8080}"
  echo "Open: http://localhost:${PP_PORT:-8080}"
  exec docker compose up --build
fi

GO_BIN="$(command -v go || true)"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$GO_BIN" && -x /tmp/opencode/go/bin/go ]]; then
  GO_BIN=/tmp/opencode/go/bin/go
fi
if [[ -z "$NODE_BIN" && -x /tmp/opencode/node-v22.22.1-linux-x64/bin/node ]]; then
  NODE_BIN=/tmp/opencode/node-v22.22.1-linux-x64/bin/node
fi
if [[ -z "$NPM_BIN" && -x /tmp/opencode/node-v22.22.1-linux-x64/bin/npm ]]; then
  NPM_BIN=/tmp/opencode/node-v22.22.1-linux-x64/bin/npm
fi

if [[ -z "$GO_BIN" || -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "Docker 또는 Go 1.25+와 Node.js 18+가 필요합니다." >&2
  echo "Docker: docker compose up --build" >&2
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):$(dirname "$GO_BIN"):$PATH"
if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install)
fi
(cd frontend && npm run build)

mkdir -p .web-bin
CGO_ENABLED=0 "$GO_BIN" build -tags web -trimpath -o .web-bin/perfectpixel-web .

export PP_WEB=1
export PP_WEB_ADDR="${PP_WEB_ADDR:-127.0.0.1:8080}"
export PP_DATA_DIR="${PP_DATA_DIR:-$ROOT_DIR/.web-data}"
mkdir -p "$PP_DATA_DIR"
echo "Starting local web service on http://${PP_WEB_ADDR}"
echo "Open: http://${PP_WEB_ADDR}"
exec .web-bin/perfectpixel-web
