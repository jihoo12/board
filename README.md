# Inkboard ✍️

Excalidraw처럼 손그림 느낌으로 그리고, Figma처럼 정리하고, 같이 실시간으로 편집하는 노트 보드 앱.
Cloudflare Workers + D1 + Durable Objects 위에서 동작합니다.

## 기능

- **무한 캔버스**: 팬/줌 (휠, Ctrl+휠, 트랙패드 핀치, 터치 두 손가락)
- **도형**: 사각형 · 마름모 · 원 · 선 · 화살표 · 펜 · 텍스트 · 스티키 노트 · 이미지 · 프레임
- **손그림 스타일**(roughjs): 손그림 정도, 빗금/격자/단색 채우기, 실선/파선/점선, 둥근 모서리
- **화살표 연결**: 도형 위에서 시작/끝내면 도형에 붙어서 같이 움직임. 선 가운데 점을 끌면 꺾임 추가, 곡선 옵션
- **정리 도구**: 스마트 가이드 스냅, 격자 스냅, 정렬/분배, 그룹, 잠금, 레이어 순서, 프레임(안의 요소와 함께 이동)
- **텍스트**: 도형/스티키 안에 글쓰기(자동 줄바꿈, 한글 지원), 손글씨/기본/코드 글꼴
- **실시간 협업**: 다른 사람 커서·선택 영역·레이어 포인터가 실시간으로 보임, 아바타 클릭 시 그 사람 위치로 이동
- **LaTeX 수식**: 수식 도구(M)로 클릭해서 입력하거나 `$...$` / `$$...$$` 텍스트를 붙여넣기. MathJax로 렌더링하고, 수식이 있는 보드에서만 엔진을 불러와요
- **공유**: 비공개 / 링크로 보기(로그인 불필요) / 링크로 편집(로그인 필요)
- **초대 전용 로그인**: `ALLOWED_USERS`에 적은 사람만 로그인 가능 (보기 링크는 누구나 볼 수 있음)
- **기타**: 실행 취소/다시 실행, 복사/붙여넣기(이미지 붙여넣기·드래그 앤 드롭 포함), Alt+드래그 복제, PNG/JSON 내보내기, JSON 가져오기,
  다크 모드, 템플릿(칸반 · 브레인스토밍 · 플로우차트 · 회고), 대시보드 썸네일

`?` 버튼에서 전체 단축키를 볼 수 있어요.

## 구조

```
worker/          Cloudflare Worker (API, OAuth, 정적 파일)
  index.ts       라우팅 · 보드 API · 이미지 업로드
  auth.ts        GitHub / Google OAuth, 세션 쿠키, 개발용 로그인
  room.ts        BoardRoom Durable Object — 보드별 WebSocket 방, 변경 병합, D1에 주기적 저장
shared/types.ts  클라이언트·서버 공용 타입 (요소, 메시지 프로토콜, 병합 규칙)
src/editor/      캔버스 에디터 엔진 (React 독립)
  editor.ts      상태 · 입력 처리 · 히스토리 · 동기화 · 렌더 루프
  render.ts      roughjs / perfect-freehand 렌더링
  geometry.ts    히트 테스트 · 바운딩 박스 · 화살표 연결점
  sync.ts        WebSocket 클라이언트 (배치 전송, 자동 재연결)
src/pages, src/ui  React UI
migrations/      D1 스키마
```

**동기화 방식**: 각 요소는 `version`/`nonce`를 가지고, 더 높은 version이 이깁니다(같으면 nonce가 작은 쪽).
클라이언트는 변경된 요소만 Durable Object로 보내고, DO는 받아들인 변경을 다른 접속자에게 전달한 뒤
2초 뒤에 D1의 `boards.data`에 저장합니다. DO 자체 스토리지에도 즉시 기록하므로 D1 저장 전에 DO가 내려가도 유실되지 않아요.
오프라인 중 변경은 다시 연결될 때 자동으로 보내집니다.

## 로컬 개발

```sh
npm install
cp .dev.vars.example .dev.vars      # DEV_LOGIN=true 로 OAuth 없이 이름만으로 로그인 가능
npm run db:migrate:local
npm run dev                          # http://localhost:5173
```

> **NixOS**: npm이 받는 workerd 바이너리는 일반 리눅스용이라 그대로는 실행이 안 됩니다.
> `npm install` 시 `scripts/nixos-patch-workerd.sh`가 자동으로 nix의 glibc로 patchelf 해줍니다
> (NixOS가 아니면 아무것도 안 함). 수동으로는 `sh scripts/nixos-patch-workerd.sh`.

## 배포

```sh
npx wrangler login
npx wrangler d1 create inkboard-db           # 출력된 database_id 를 wrangler.jsonc 에 넣기
npm run db:migrate:remote
npx wrangler secret put GITHUB_CLIENT_ID      # 쓰고 싶은 로그인만 설정하면 됩니다
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_USERS         # 선택: 초대 목록 (아래 참고)
npm run deploy
```

OAuth 콜백 URL:

| Provider | 설정 위치 | Callback / Redirect URI |
| --- | --- | --- |
| GitHub | Settings → Developer settings → OAuth Apps | `https://<도메인>/auth/github/callback` |
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client (Web) | `https://<도메인>/auth/google/callback` |

로컬에서 실제 OAuth를 테스트하려면 `http://localhost:5173/auth/<provider>/callback`도 등록하고 `.dev.vars`에 키를 넣으세요.
**프로덕션에서는 `DEV_LOGIN`을 설정하지 마세요** (누구나 아무 이름으로 로그인할 수 있게 됩니다).

### 초대 전용 로그인

`ALLOWED_USERS`를 설정하면 그 목록에 있는 사람만 로그인할 수 있어요. 비워 두면 누구나 로그인할 수 있습니다.

```sh
npx wrangler secret put ALLOWED_USERS
# 입력 예: me@gmail.com, github:jihoo12, friend@example.com
```

- 항목은 **이메일**(GitHub/Google에서 인증된 이메일만 인정) 또는 **`provider:아이디`**(`github:jihoo12`, 로컬은 `dev:alice`). 대소문자 무관, 쉼표·공백·줄바꿈으로 구분.
- 목록에서 빼면 그 사람의 기존 로그인도 바로 끊겨요. 초대받지 않은 사람은 DB에 아무것도 남지 않습니다.
- 로그인 없이도 "링크로 보기"로 공유한 보드는 누구나 볼 수 있으니, 보여주고 싶은 보드는 보기 링크로 공유하면 돼요.
- 이 기능을 쓰려면 `0002_user_login.sql` 마이그레이션이 필요해요 (`npm run db:migrate:remote`).

## 제한 사항

- 이미지는 D1에 BLOB으로 저장합니다 (업로드 전에 최대 1600px / WebP로 줄이고, 1장당 약 1.9MB까지). 이미지를 많이 쓸 거라면 R2로 옮기는 게 좋아요.
- 보드 하나의 데이터는 D1 행 하나(JSON)에 저장되므로 아주 큰 보드(수 MB)는 한계가 있어요.
- 도형 회전은 아직 지원하지 않아요.
- 수식 엔진(MathJax, 약 2.2MB / gzip 후 수백 KB)은 수식이 있는 보드를 처음 열 때 한 번 받아요.
