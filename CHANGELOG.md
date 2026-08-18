# Changelog

이 프로젝트의 주요 변경 사항입니다.

## [0.0.2] - 2026-08-18

### 1. 사진 → 픽셀 캐릭터 변환

업로드한 사진 한 장으로 베이스 캐릭터를 만드는 기능입니다.

- 캐릭터 패널에 **사진 변환** 탭 추가 (기존: 이미지 업로드 / AI 생성)
  - **얼굴만 변환**: 턱선 아래에서 잘린 얼굴 아이콘 1장 생성 → 정적 상태(`kind: "static"`)로 상태 목록에 보관
  - **전신 변환 + 대기**: 머리부터 발끝까지의 전신 베이스 생성 후 `idle` 애니메이션까지 자동 생성
- `GenerateCharacter`가 `sourceImage`(원본 dataURL)와 `mode`(`face`/`full`) 인자 지원
- `sprite.BuildPhotoCharacterPrompt`: 얼굴 전용/전신 전용 프레이밍을 고정하는 전용 프롬프트 (어깨·상반신 노출, 반신 크롭 거부 조항 포함)
- `sprite.PhotoPostProcess` / `PhotoPaletteSizeForStyle`: 사진 변환용 팔레트 후처리. 애니메이션보다 큰 팔레트(`retro16`=64색, `pixel`=128색)로 눈·머리·옷 디테일 보존
- 원본 사진을 세션에 `photoSource`로 보존해 재변환 가능 (구버전 세션은 기존 베이스 이미지를 원본으로 대체)
- 변환 결과는 갤러리와 작업 세션에 자동 저장
- 한국어/영어/스페인어/중국어 i18n 문자열 추가
- 프롬프트 프레이밍 유닛 테스트 추가 (`internal/sprite/prompt_test.go`)

### 2. 웹 서비스 모드 (`web` 빌드 태그)

데스크톱 앱과 동일한 생성 파이프라인을 브라우저에서 쓸 수 있는 HTTP 서버입니다.

- `web_server.go` / `web_main.go`: `-tags web` 로 빌드하는 단일 관리자(싱글 어드민) HTTP 서버 (기본 포트 8080)
  - 세션, 설정, 갤러리, 생성, 미러링, 내보내기, 진행률 폴링(`/api/progress`) REST API
  - 내보내기는 네이티브 폴더 대화상자 대신 ZIP 다운로드로 제공
- Wails 런타임 의존을 `runtime_desktop.go` / `runtime_web.go` 빌드 태그로 분리하고 `assets.go`로 프론트엔드 임베드를 공유화
- 프론트엔드 `frontend/src/lib/backend.ts`: Wails 바인딩과 HTTP API를 런타임에 자동 전환하는 어댑터 (모든 컴포넌트가 이 모듈을 통해 백엔드 호출)
- 웹 모드에서는 API 키를 환경변수로만 읽음(`.env` 파일 무시), 설정 대화상자 저장분은 `/data` 볼륨에 저장
- 배포 자산
  - `Dockerfile`: 멀티스테이지(프론트엔드 → Go → 런타임), 비 root 사용자, 헬스체크 포함
  - `docker-compose.yml`: `perfectpixel-data` 볼륨, 프로바이더 키 환경변수 전달
  - `web.sh`: Docker 사용 가능 시 `docker compose up --build`, 아니면 로컬 빌드 후 실행
  - `install-service.sh` + `deploy/perfectpixel-web.service`: systemd 서비스 설치/제거/재시작 스크립트 (보안 강화 옵션 포함)
- 인증 없음: 신뢰할 수 있는 내부 네트워크에서만 사용 권장

### 3. 개선 및 수정

- **이미지 입력 검증 강화**: 디코딩 크기 32MB 제한, 최대 4096×4096 / 3,200만 픽셀 제한, 내보내기·스트립 셀 크기 상한 1024
- **Gemini 3 Pro**: 1:1 이외에만 적용되던 2K 이미지 크기 조건을 모든 화면비로 적용하도록 수정
- 갤러리 PNG 저장 실패를 호출자에게 반환하도록 변경 (`saveGalleryPNG`)
- `.gitignore`에 웹 모드 로컬 데이터(`.web-data/`, `.web-bin/`) 추가
- README에 웹 서비스(Docker) 섹션 추가
- `AGENTS.md` 추가: 저장소 기여/빌드 가이드

## [0.0.1] - 초기 릴리스

- Wails 데스크톱 앱 (React 18 / Vite 프론트엔드)
- Gemini / OpenAI / OpenRouter / fal.ai / BytePlus 프로바이더 지원
- 상태별 스트라이프 생성, 프레임 품질 스코어링, 8방향 세트, 미러링
- 스프라이트시트·매니페스트·Aseprite JSON·GIF·APNG 내보내기
- 갤러리, 세션 저장/복원, 다국어 UI (ko/en/es/zh)
