#!/usr/bin/env bash
# PerfectPixel 웹 서버를 systemd 서비스로 설치해 재부팅 시 자동 실행되게 합니다.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-/opt/perfectpixel}"
DATA_DIR="${DATA_DIR:-/var/lib/perfectpixel}"
SERVICE_NAME="perfectpixel-web"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
USER_NAME="perfectpixel"

usage() {
  cat <<EOF
Usage: sudo $0 {install|uninstall|status|restart|reinstall}

  install     프론트엔드·바이너리 빌드 후 systemd 서비스로 등록하고
              부팅 시 자동 실행(enable)합니다.
  reinstall   바이너리를 다시 빌드·설치하고 서비스를 재시작합니다.
  uninstall   서비스 중지 및 등록 해제(disable)합니다. (데이터는 유지)
  status      서비스 상태를 표시합니다.
  restart     서비스를 재시작합니다.

환경 변수:
  PREFIX       설치 경로          (기본: /opt/perfectpixel)
  DATA_DIR     데이터 저장 경로    (기본: /var/lib/perfectpixel)
EOF
}

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "이 작업은 root 권한이 필요합니다. sudo로 다시 실행하세요." >&2
    exit 1
  fi
}

# systemd 사용 가능 여부 확인
need_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd 를 찾을 수 없습니다. 이 스크립트는 systemd 기반 리눅스에서 동작합니다." >&2
    exit 1
  fi
}

# 프론트엔드 + 웹 바이너리 빌드 (.web-bin/perfectpixel-web 생성)
build_binary() {
  local go_bin node_bin npm_bin
  go_bin="$(command -v go || true)"
  node_bin="$(command -v node || true)"
  npm_bin="$(command -v npm || true)"
  if [[ -z "$go_bin" && -x /tmp/opencode/go/bin/go ]]; then
    go_bin=/tmp/opencode/go/bin/go
  fi
  if [[ -z "$node_bin" && -x /tmp/opencode/node-v22.22.1-linux-x64/bin/node ]]; then
    node_bin=/tmp/opencode/node-v22.22.1-linux-x64/bin/node
  fi
  if [[ -z "$npm_bin" && -x /tmp/opencode/node-v22.22.1-linux-x64/bin/npm ]]; then
    npm_bin=/tmp/opencode/node-v22.22.1-linux-x64/bin/npm
  fi
  if [[ -z "$go_bin" ]]; then
    echo "Go 1.25+ 가 필요합니다." >&2
    exit 1
  fi
  export PATH="$(dirname "$go_bin"):$PATH"

  if [[ -n "$node_bin" && -n "$npm_bin" ]]; then
    export PATH="$(dirname "$node_bin"):$PATH"
    echo "==> 프론트엔드 빌드 중..."
    (cd "$ROOT_DIR/frontend" && npm ci && npm run build)
  elif [[ -d "$ROOT_DIR/frontend/dist" ]]; then
    echo "==> node/npm 가 없어 기존 frontend/dist 를 사용합니다. (프론트엔드 변경 시 node 설치 후 재빌드 필요)"
  else
    echo "Node.js 18+ 가 필요합니다 (frontend/dist 도 없음)." >&2
    exit 1
  fi

  echo "==> 웹 바이너리 빌드 중 (-tags web)..."
  mkdir -p "$ROOT_DIR/.web-bin"
  CGO_ENABLED=0 "$go_bin" build -tags web -trimpath -ldflags="-s -w" \
    -o "$ROOT_DIR/.web-bin/perfectpixel-web" .
}

# 바이너리·.env·데이터 디렉터리·사용자 설치
install_files() {
  echo "==> 전용 시스템 사용자($USER_NAME) 준비 중..."
  if ! id "$USER_NAME" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
  fi

  echo "==> 설치 디렉터리($PREFIX) 준비 중..."
  mkdir -p "$PREFIX"
  install -m 0755 "$ROOT_DIR/.web-bin/perfectpixel-web" "$PREFIX/perfectpixel-web"
  if [[ -f "$ROOT_DIR/.env" ]]; then
    install -m 0600 "$ROOT_DIR/.env" "$PREFIX/.env"
    echo "    .env 복사됨 (API 키 환경변수)"
  elif [[ -f "$ROOT_DIR/.env.example" ]]; then
    install -m 0600 "$ROOT_DIR/.env.example" "$PREFIX/.env"
    echo "    주의: .env 가 없어 .env.example 을 복사했습니다. $PREFIX/.env 에 API 키를 채우세요."
  fi

  echo "==> 데이터 디렉터리($DATA_DIR) 준비 중..."
  mkdir -p "$DATA_DIR"
  chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR" "$PREFIX"
  chmod 750 "$PREFIX"
}

# systemd 유닛 설치·활성화·시작
enable_service() {
  echo "==> systemd 유닛 설치 중..."
  mkdir -p "$(dirname "$SERVICE_FILE")"
  install -m 0644 "$ROOT_DIR/deploy/${SERVICE_NAME}.service" "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
}

cmd_install() {
  need_systemd
  build_binary   # 일반 사용자로 빌드 (node_modules root 소유 방지)
  if [[ "$(id -u)" -ne 0 ]]; then
    exec sudo -E "$0" __install_root
  fi
  install_files
  enable_service
  print_success
}

cmd_reinstall() {
  need_systemd
  build_binary
  if [[ "$(id -u)" -ne 0 ]]; then
    exec sudo -E "$0" __reinstall_root
  fi
  install_files
  systemctl restart "$SERVICE_NAME"
  print_success
}

# 내부 전용: 이미 빌드된 바이너리를 root 권한으로 설치한다.
__install_root() {
  need_root
  install_files
  enable_service
  print_success
}

__reinstall_root() {
  need_root
  install_files
  systemctl restart "$SERVICE_NAME"
  print_success
}

cmd_uninstall() {
  need_root
  echo "==> 서비스 중지 및 등록 해제 중..."
  systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
  echo "서비스가 제거되었습니다."
  echo "  - 데이터는 유지됨: $DATA_DIR"
  echo "  - 바이너리는 유지됨: $PREFIX"
}

cmd_status() { systemctl status "$SERVICE_NAME"; }
cmd_restart() { need_root; systemctl restart "$SERVICE_NAME"; echo "재시작됨."; }

print_success() {
  local port="${PP_WEB_ADDR:-:8080}"
  echo
  echo "완료! 재부팅 시 자동 실행됩니다."
  echo "  접속:     http://localhost:${port#:}"
  echo "  상태:     sudo systemctl status $SERVICE_NAME"
  echo "  로그:     sudo journalctl -u $SERVICE_NAME -f"
  echo "  환경변수 변경 후: sudo $0 restart  (또는 sudo systemctl restart $SERVICE_NAME)"
  echo "  업그레이드:      sudo $0 reinstall"
}

case "${1:-}" in
  install)        cmd_install ;;
  reinstall)      cmd_reinstall ;;
  uninstall)      cmd_uninstall ;;
  status)         cmd_status ;;
  restart)        cmd_restart ;;
  __install_root)   __install_root ;;
  __reinstall_root) __reinstall_root ;;
  *)              usage; exit 1 ;;
esac
