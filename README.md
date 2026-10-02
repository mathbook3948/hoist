# Hoist · Bun prototype

1GB/2GB 서버에서 쓸 수 있는 작은 배포 패널입니다. Bun API 서버와 Vite·React 웹 화면으로 구성했습니다. 웹 빌드와 Bun 런타임을 포함한 단일 실행파일로 배포할 수 있습니다. **미리 빌드한 파일을 업로드하고, 서버 관리자가 등록한 sh 스크립트를 실행**합니다. 이 프로젝트 자체는 실제 서비스를 배포하거나 압축을 풀지 않습니다.

## 빠른 시작

Linux 서버와 Bun 1.4.2 이상이 필요합니다. 코드를 내려받은 뒤 저장소 폴더에서 실행하세요. 설정과 업로드는 코드 폴더 밖에 보관합니다.

```bash
git clone https://github.com/mathbook3948/hoist.git
cd hoist
bun install --frozen-lockfile
bun run build:web

# 설정/계정/업로드/로그는 코드 밖의 지정한 설치 폴더에 저장
bun run cli init --data-dir "$HOME/.local/share/hoist"

# 비밀번호가 argv나 셸 기록에 들어가지 않도록 stdin 사용
read -rs -p 'Admin password (12+ chars, <=72 UTF-8 bytes): ' HOIST_PASSWORD; printf '\n'
printf '%s\n' "$HOIST_PASSWORD" | bun run cli user set admin --password-stdin --data-dir "$HOME/.local/share/hoist"
unset HOIST_PASSWORD

# 무해한 예제: 파일/서비스를 변경하지 않고 받은 인수만 로그에 출력
mkdir -p "$HOME/.local/share/hoist/scripts"
cp examples/deploy.sh "$HOME/.local/share/hoist/scripts/demo.sh"
bun run cli project set demo --name 'Demo' --script "$HOME/.local/share/hoist/scripts/demo.sh" --timeout 300 --data-dir "$HOME/.local/share/hoist"

bun run cli serve --data-dir "$HOME/.local/share/hoist"
```

서버 실행 후 `http://127.0.0.1:3000`을 열어 직접 만든 계정으로 로그인합니다. 원격 서버에서는 SSH 터널을 권장합니다: `ssh -L 3000:127.0.0.1:3000 server`. 초기 계정, 기본 비밀번호, 공개 포트는 제공하지 않습니다. `serve`를 첫 명령으로 실행해도 폴더와 `hoist.sqlite`가 생성됩니다. 빈 계정 목록으로는 로그인이 불가능하므로 서버를 멈추고 계정을 만드세요.

## 설치 폴더 구조

```text
DATA_DIR/
  hoist.sqlite                # 0600: 설정·관리자·프로젝트·파일 정보·배포 이력
  hoist.sqlite-wal / -shm      # 실행 중 SQLite가 관리하는 WAL/공유 메모리
  scripts/                    # 선택 사항, 관리자가 직접 두는 신뢰된 스크립트
  runtime.lock/pid             # 단일 서버/CLI 변경 락
  projects/PROJECT/
    artifacts/RANDOM_UUID.bin  # 원래 파일명은 메타데이터에만 저장
    logs/RANDOM_UUID.log       # stdout + stderr, 크기 제한
```

DATA_DIR은 0700입니다. 코드와 데이터 폴더를 분리하고, 데이터 폴더를 패널의 OS 사용자만 쓸 수 있게 유지하세요. 서버 시작 중에는 CLI 설정 변경이 잠깁니다. 전역 설정은 서버를 멈춘 뒤 `config set`으로 변경하고 재시작합니다. `HOIST_DATA_DIR` 환경 변수로 설치 폴더를 지정할 수도 있습니다.

```bash
bun run cli config list --data-dir /absolute/data
bun run cli config set port 3001 --data-dir /absolute/data
bun run cli config set maxArtifactBytes 1073741824 --data-dir /absolute/data
bun run cli user list --data-dir /absolute/data
bun run cli user remove USER --data-dir /absolute/data
bun run cli project list --data-dir /absolute/data
bun run cli project remove PROJECT --data-dir /absolute/data
```

`user set`은 기존 관리자 계정의 비밀번호 변경에도 사용합니다. 관리자 계정은 하나만 지원합니다. `project set`은 설정을 갱신합니다. 프로젝트 등록 해제는 데이터 삭제가 아닙니다. 남은 파일은 전체 저장 용량 제한에 포함되므로 불필요한 데이터는 서버를 멈춘 뒤 관리자가 정리해야 합니다. 비정상 종료 후 실제 프로세스가 없으면 PID 락을 복구합니다. PID가 없는 락은 안전을 위해 자동 삭제하지 않습니다. 프로세스가 없는 것을 확인하고 정리하세요.

## 웹 프로젝트 관리

로그인 후 **프로젝트 관리**에서 프로젝트를 등록하고, 선택한 프로젝트의 이름·배포 스크립트 경로·실행 제한 시간을 수정할 수 있습니다. 스크립트는 서버에 미리 만들어 두고 절대 경로로 지정합니다. 프로젝트 ID는 등록 후 변경할 수 없습니다.

프로젝트 변경은 서버를 재시작하지 않고 바로 적용되며 SQLite에 저장됩니다. 업로드·배포 요청 처리 중에는 프로젝트 변경이 차단됩니다. **등록 해제**는 확인 후 진행하며 파일과 배포 이력을 보관합니다. 같은 ID로 다시 등록하면 보관된 데이터가 복원됩니다.

## 기본 제한 / 설정

전역 설정은 첫 실행에 SQLite에 생성됩니다. 기본값:

- `host`: `127.0.0.1`, `port`: `3000`, `publicOrigin`: `null`
- `maxArtifactBytes`: 1 GiB, `maxStorageBytes`: 100 GiB (전체 설치 폴더의 보관된 artifact 파일)
- `uploadTimeoutSeconds`: 3600초 (업로드 전체 제한 시간)
- `artifactRetention`: 프로젝트당 최근 5개, `historyRetention`: 최근 30회
- `maxLogBytes`: 배포당 64 KiB + 짧은 잘림 표시
- `sessionHours`: 8시간, 프로젝트 `timeoutSeconds`: CLI 기본 300초
- 관리자 계정 1개, 프로젝트 최대 32개, 한 번에 배포 1개, 업로드 1개, 로그인 해시 검증 1개

`maxArtifactBytes`는 최대 64 GiB, `maxStorageBytes`는 최대 1 TiB까지 설정할 수 있습니다. `config list`로 값을 확인하고 `config set KEY VALUE`로 변경합니다. `publicOrigin`은 HTTPS origin 또는 문자열 `null`을 받습니다.

설정·관리자 계정·프로젝트·배포 파일 정보·배포 이력은 Bun 내장 SQLite의 별도 테이블에 저장합니다. 배포 파일 원본과 배포 로그는 호스트의 파일 시스템에 보관합니다. WAL 모드와 트랜잭션을 사용하며, 세션과 실행 중인 프로세스 상태는 메모리에 유지합니다. 기존 SQLite DB는 자동 마이그레이션으로 이어서 사용합니다. 이전 JSON 형식의 `config.json`/`state.json` 가져오기는 지원하지 않습니다.

서버를 정상 종료한 뒤 설치 폴더 전체를 복사하면 DB·파일·로그를 함께 백업할 수 있습니다. 실행 중인 DB 파일만 복사하면 WAL의 변경 내용이 빠질 수 있습니다. 시작할 때 미완료 업로드와 이력 없는 로그를 정리하고, 누락된 배포 파일의 정보는 제거하되 배포 이력은 유지합니다.

배포 파일은 스트리밍으로 저장합니다. 역방향 프록시를 쓰는 경우 요청 크기와 업로드 시간 제한도 이 설정에 맞춰야 합니다.

배포 실행 중인 프로젝트에는 업로드할 수 없습니다. 용량이 꽉 차 있으면 새 업로드는 거절되며 자동으로 기존 파일을 지워 공간을 만들지 않습니다. 보관 개수를 초과한 정상 업로드 후에만 가장 오래된 파일을 삭제합니다. 압축 파일을 풀었을 때의 크기 및 스크립트가 생성하는 파일은 패널의 업로드 용량 제한에 포함되지 않습니다. filesystem quota와 디스크 모니터링은 별도로 필요합니다.

## 스크립트 계약 / 최소 권한

등록된 절대 경로의 스크립트를 아래 방식으로 실행합니다:

```text
/bin/sh /absolute/trusted-script.sh /absolute/random-artifact.bin VERSION
```

artifact 경로와 version은 **분리된 argv**입니다. 업로드 파일명을 셸 명령에 끼워 넣지 않습니다. 스크립트의 작업 디렉터리는 스크립트가 있는 폴더이고 stdin은 닫혀 있습니다. 환경은 PATH와 LANG만 전달합니다. 스크립트는 관리자만 변경할 수 있어야 하며 업로드 폴더/정적 웹 파일은 스크립트로 등록할 수 없습니다.

스크립트 안에서도 인수를 따옴표로 감싸고 `eval`, `sh -c "$2"` 같은 실행을 피하세요. 압축 해제 시 절대경로, `../`, 심볼릭 링크, 압축 폭탄을 검사하세요. 이 책임은 로컬 배포 스크립트에 있습니다. Bun과 스크립트는 같은 비특권 OS 계정으로 실행됩니다. root, 광범위한 sudo, Docker socket 접근을 주지 마세요. 필요한 특정 서비스 디렉터리와 작업만 허용하세요.

취소/타임아웃은 Linux 프로세스 그룹에 SIGTERM, 2초 후 SIGKILL을 보냅니다. 정상 종료 시에도 같은 그룹의 남은 자식을 정리합니다. 운영 시에는 `examples/hoist.service`를 참고해 systemd 같은 감독 프로세스를 사용하고 **KillMode=control-group**을 유지하세요. 예제는 설치/활성화하지 않았으며 실행파일 경로와 비특권 사용자 및 배포 대상 폴더를 서버에 맞게 검토해야 합니다. daemonize/setsid로 그룹을 탈출하는 스크립트는 이 방식으로 통제할 수 없습니다. 서버가 SIGKILL/호스트 장애로 종료된 경우 자식 정리 및 서비스 상태 복원은 보장되지 않습니다. 다음 시작에서 진행 중 이력은 `interrupted`로 기록하고 재실행하지 않습니다. 롤백은 없습니다.

## 인증 / 네트워크

- bcrypt cost 12, 평문 비밀번호 저장 안 함, 기본 계정 없음
- 256-bit 임의 세션/CSRF 토큰, HttpOnly + SameSite=Strict 쿠키
- Origin + Host 검사, 변경 요청 CSRF 확인 (로그인은 Origin 검사)
- IP당 15분에 실패/진행 중 로그인 10회, 최대 128개 세션
- 로그인 파서/해시 검증 직렬화, 제한된 JSON body(8 KiB/절대 10초), 파일 streaming 저장(기본 최대 1시간)
- MIME sniffing/iframe 차단, CSP, no-store; 사용자 출력은 텍스트로 표시

기본 loopback HTTP는 SSH 터널이나 같은 서버의 역방향 프록시 뒤에서 사용합니다. 외부에 직접 노출하지 마세요. 외부 접근이 꼭 필요하면 TLS reverse proxy, 접근 제어/VPN, 요청 크기·연결·시간 제한을 먼저 준비하고 `publicOrigin`을 정확한 HTTPS origin으로 설정하세요. 프록시는 해당 Origin/Host를 보존해야 합니다. HTTPS 설정 시 쿠키에 Secure가 붙습니다. 프록시의 전달 IP 헤더는 신뢰하지 않으므로 로그인 속도 제한은 프록시 IP에 함께 적용됩니다. 네트워크를 직접 바꾸거나 TLS를 구성하는 기능은 없습니다.

단일 관리자 계정으로 운영합니다. RBAC, MFA, 감사 로그의 변조 방지, 서명된 artifact, 바이러스 검사, 다중 서버 조정은 구현하지 않았습니다. 신뢰할 수 있는 관리자용 초기 프로토타입이며 공개 서비스용 보안 인증을 받은 제품이 아닙니다.

## 코드 구조

Bun workspaces로 세 앱을 관리합니다. 서버는 독립 실행할 수 있고 CLI의 `serve` 명령도 같은 서버를 시작합니다. 웹은 React 컴포넌트와 상태 훅을 사용하며, 배포 시에는 Vite가 생성한 정적 파일을 Bun 서버가 제공합니다.

```text
apps/
  cli/                       @hoist/cli
    src/index.ts             CLI 실행 진입점
    src/main.ts              계정·프로젝트·설정 명령
    build.ts                 Vite 빌드 후 단일 실행파일 생성
  server/                    @hoist/server
    src/index.ts             독립 서버 진입점
    src/runtime.ts           PID 잠금과 서버 시작·종료
    src/server.ts            HTTP·정적 파일·API 연결
    src/store.ts             SQLite 저장소와 자동 마이그레이션
    src/migrations/          순서가 고정된 SQL 마이그레이션
    src/auth.ts              인증과 세션
    src/artifacts.ts         업로드와 용량 제한
    src/deployments.ts       배포 스크립트 실행과 취소
    src/projects.ts          프로젝트 관리
  web/                       @hoist/web
    index.html               Vite 진입 HTML
    src/App.tsx              React 앱 진입 화면
    src/components/          로그인·프로젝트·배포·로그 화면과 폼
    src/console.ts           세션·API·업로드·배포 상태와 폴링
    src/style.css            화면 스타일
    src/assets.ts            서버에서 Vite 빌드 파일 읽기
    vite.config.ts           React HMR·개발 API 프록시·테스트 설정
    tests/                   React Testing Library 컴포넌트 테스트
    dist/                    Vite 빌드 결과 (Git 제외)
scripts/dev.ts               API 서버와 Vite 동시 실행·종료
tests/                      서버·마이그레이션·실행파일 테스트
dist/                       실행파일과 검사 결과 (Git 제외)
```

```bash
bun run cli --help
bun run server --data-dir /absolute/data
# 서버로 웹 화면을 제공하려면 먼저 bun run build:web 실행
```

## DB 마이그레이션

서버 시작 또는 CLI 명령 실행 시 `Store`가 DB를 열면서 `apps/server/src/migrations/index.ts`의 미적용 마이그레이션을 자동 적용합니다. 별도 수동 migrate 명령은 필요하지 않습니다. `hoist init --data-dir DIR`로 서버를 띄우기 전에 적용할 수도 있습니다.

- `schema_migrations`에 번호·이름·SQL SHA-256·적용 시각을 기록합니다.
- 기존 SQLite DB는 `001-initial.sql`을 첫 버전으로 등록하며 계정·설정·프로젝트·이력을 보존합니다.
- SQLite `BEGIN IMMEDIATE` 트랜잭션에서 미적용 항목 전체를 순서대로 실행합니다. 중간에 실패하면 이번 실행의 스키마 변경과 이력이 함께 롤백되며 서버가 시작되지 않습니다.
- 이미 적용된 SQL이 바뀌었거나 DB가 실행파일보다 최신이면 시작을 거부합니다. 적용된 파일은 수정하지 말고 다음 번호의 파일을 추가하세요.

변경을 추가할 때는 `apps/server/src/migrations/002-description.sql` 파일을 만들고 `index.ts`에서 텍스트로 가져와 `migrations` 배열 끝에 등록합니다.

```ts
import description from "./002-description.sql" with { type: "text" };
// migrations 배열에 추가:
{ id: 2, name: "description", sql: description }
```

Bun이 빌드할 때 SQL 내용을 실행파일에 포함하므로 배포 시 `.sql` 파일을 별도로 복사할 필요가 없습니다. 줄바꿈은 LF로 정규화하여 Windows와 Linux에서 같은 체크섬을 사용합니다. 그 외 공백을 포함한 적용된 SQL 내용은 유지하세요. SQL 안에 `BEGIN`·`COMMIT`·`ROLLBACK`을 넣지 마세요. 실행기가 트랜잭션을 관리합니다. 다운 마이그레이션은 제공하지 않으며, 업그레이드 전에는 서버를 정상 종료하고 데이터 폴더 전체를 백업하세요.

## 단일 실행파일 빌드

```bash
bun install --frozen-lockfile
bun run build        # 현재 OS: dist/hoist (Windows: dist/hoist.exe)
bun run build:linux  # Linux x64: dist/hoist-linux-x64
```

Bun의 `--compile`에 해당하는 `Bun.build({ compile: ... })`를 사용합니다. Bun 런타임, 서버 코드·마이그레이션·Vite가 빌드한 React 화면을 실행파일에 포함하므로 배포 서버에는 별도의 Bun 설치나 소스 코드가 필요 없습니다. DB·업로드·로그와 관리자가 등록한 배포 스크립트는 외부 데이터 폴더에 유지됩니다. Linux 교차 빌드 시 대상 Bun 런타임을 처음 내려받기 위한 네트워크 연결이 필요할 수 있습니다.

Linux에서는 `dist/hoist-linux-x64`를 원하는 위치에 `hoist`라는 이름으로 복사하고 실행 권한을 준 뒤 실행하세요.

```bash
chmod +x ./hoist
./hoist --help
./hoist init --data-dir /absolute/data
# 빠른 시작과 같은 방식으로 비밀번호를 stdin으로 전달해 계정을 먼저 생성
./hoist serve --data-dir /absolute/data
```

위 소스 실행 예제의 `bun run cli`를 실행파일 경로로 바꾸면 동일한 명령을 사용할 수 있습니다. Windows에서는 `./dist/hoist.exe --help`로 확인할 수 있습니다. HTTP 화면과 CLI 개발은 Windows에서도 가능하며, 실제 배포는 `/bin/sh`와 Linux 프로세스 그룹을 사용합니다. 빌드 방식은 [Bun 단일 실행파일 문서](https://bun.sh/docs/bundler/executables)를 참고하세요.

## 개발 서버

```bash
bun run dev
# mise로 Bun을 설치했고 PATH에 없다면
mise exec -- bun run dev
```

웹 개발 화면은 `http://127.0.0.1:5173`입니다. `bun run dev`가 Vite와 Bun API 서버를 함께 띄우고 종료합니다. 개발 데이터는 `.data/`에 저장하며 `HOIST_DATA_DIR`로 바꿀 수 있습니다. API 서버 포트는 해당 DB 설정을 사용합니다 (기본 3000). React·CSS 수정은 HMR로 반영되고 서버 코드 수정은 서버를 재시작합니다. 서버 재시작 시 로그인 세션은 초기화됩니다.

각 앱만 실행하려면 `bun run dev:web` 또는 `bun run dev:server`를 사용하세요. 웹만 실행할 때 API 주소를 바꾸려면 `HOIST_API_ORIGIN`을 지정합니다 (기본 `http://127.0.0.1:3000`). 개발 프록시는 `http://127.0.0.1:5173`의 Origin만 API Origin으로 바꾸고 다른 Origin은 그대로 전달해 서버가 거부하도록 합니다.

최초 로그인에 필요한 관리자 계정은 서버를 멈춘 뒤 만드세요. PowerShell에서는 아래 명령으로 비밀번호를 입력할 수 있습니다 (12자 이상, UTF-8 기준 72바이트 이하).

```powershell
Read-Host -MaskInput 'Admin password' | mise exec -- bun run cli user set admin --password-stdin --data-dir .data
```

Linux에서는 위 빠른 시작의 `--password-stdin` 예제에서 데이터 폴더를 `.data`로 지정하세요. 실제 배포 스크립트 실행은 Linux 환경이 필요합니다.

## 코드 포맷

개발 의존성을 설치한 뒤 Prettier 기본 규칙으로 포맷을 적용합니다.

```bash
bun install --frozen-lockfile
bun run format
bun run format:check
```

## 검증

```bash
# 저장소 폴더에서 실행
bun run test
bun run check
bun tests/measure-memory.ts
bun run test:frontend
bun run test:binary
```

`test:binary`는 현재 OS 실행파일을 빌드한 뒤 임시 폴더로 복사하고, PATH를 비운 상태에서 CLI·SQLite·Vite 빌드 파일 전체·로그인·API를 검증합니다. 전체 서버 테스트는 Linux에서 실행하세요. 파일 권한, 심볼릭 링크, `/bin/sh`, 프로세스 그룹을 검증하는 테스트가 포함되어 있습니다.

통합 테스트는 /tmp에서 임의로 생성한 계정과 테스트 스크립트만 사용하고 종료 시 삭제합니다. 인증, Origin/CSRF, path rejection, shell injection, 업로드 크기/부분파일 정리, 배포 동시 실행 차단, 로그 제한, 취소, 타임아웃, 실패 상태, CLI 락, 재시작/세션 무효화를 검증합니다. Bun build는 문법/번들 컴파일 검사이며 TypeScript의 `tsc --noEmit` 타입 검사는 아닙니다. React 앱은 `tsc --noEmit`으로 타입 검사하며 서버는 Bun 번들 검사로 확인합니다.

실측 Linux/x64, Bun 1.4.2 결과는 `MEASUREMENTS.json`에 있습니다. `/proc/PID/status` VmRSS로 **Bun 서버 프로세스만** 측정했습니다. 설치/테스트 클라이언트, OS 파일 캐시, 배포 스크립트 메모리는 제외입니다. 64 MiB 스트리밍 업로드 기준 SQLite 전환 후 cold idle 약 16.2 MiB, 로그인 후 idle 16.8 MiB, 업로드 peak 26.2 MiB, 5초 후 idle 19.6 MiB였습니다. 하나의 합성 테스트 결과이며 실제 배포 스크립트가 빌드/압축 해제 등에 쓰는 메모리는 추가됩니다. 이전 idle 수준으로 완전히 돌아온다고 보장하지 않습니다.

React Testing Library와 jsdom으로 로그인·중복 요청·파일 선택·업로드·배포·문자열 로그·탭 숨김·취소·프로젝트 전환·등록·설정·등록 해제·세션 만료·로그아웃을 검사합니다. 마이그레이션 테스트는 신규 DB, 기존 SQLite 데이터 보존, 재시작 시 중복 적용 방지, 실패 시 전체 배치 롤백, 변경된 SQL·최신 DB 거부를 검사합니다. 실제 Linux 배포 스크립트와 파일 권한 테스트는 Linux에서 실행해야 합니다.

실제 브라우저에서 Vite 개발 화면과 실행파일에 포함된 React 화면의 로그인·프로젝트 설정을 확인했습니다. 자동 컴포넌트 테스트는 브라우저와 Linux 배포 시나리오 전체를 대체하지 않습니다.
