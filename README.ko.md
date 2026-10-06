# ServerConsole

**여유 GPU 메모리를 찾고 사용자를 확인한 뒤, 한 데스크톱에서 모니터링·터미널·파일을 엽니다.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[데스크톱 다운로드](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.0) · [문제 신고](https://github.com/Moguifeng-9119/server-console/issues)

![GPU 작업 공간: 모의 데이터](assets/screenshots/workbench-en.png)

**0.12.0 변경 사항**

작업 소유 임시 파일의 영구 기록, 복구 및 재연결 시 정리를 추가했습니다. SHA-256 검증 진행률, 이전 작업 안내, 파일·중계 키보드 조작, 미저장 텍스트 보호, ESLint/Hooks 검사를 추가했습니다. 10개 언어 모두 635개 키를 갖추며 기계 번역을 활용한 나머지 문구의 원어민 검토는 아직 필요합니다.

현재 실제 검증: H100 6개가 있는 Linux 호스트에서 SSH/SFTP 복구를 확인했습니다. 두 번째 호스트에 연결할 수 없어 서버 간 실제 rsync는 미검증입니다. 아래 0.11.1 수치는 과거 결과입니다. [0.12.0](docs/VALIDATION-0.12.0.md).

![27-second simulated workflow](assets/demo/workflow.gif)

<p><img src="assets/screenshots/relay-en.png" alt="Simulated server relay" width="49%"> <img src="assets/screenshots/transfer-en.png" alt="Simulated resume verification" width="49%"></p>

스크린샷은 v0.12.0의 모의 데이터입니다. v0.12.0은 Windows x64 포터블, Linux x86_64 AppImage, macOS 유니버설 DMG와 SHA-256 파일을 제공합니다. 패키지는 서명되지 않았고 macOS 공증도 없습니다. [검증 기록](docs/VALIDATION-0.12.0.md)을 확인하세요.

[Detailed usage and recovery (English)](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## 어떤 작업을 위한 도구인가요?

ServerConsole은 공유 **Linux / NVIDIA GPU 서버**를 위한 개인용 데스크톱 도구입니다. SSH로 자원 탐색, 터미널, 두 패널 SFTP, 서버 간 전송을 통합하며 원격 모니터링 에이전트가 필요하지 않습니다.

- GPU별 여유 GiB, 모델, 사용자로 검색하고 여유 메모리 순으로 정렬합니다. 모니터링·터미널·파일을 바로 엽니다.
- GPU와 프로세스, 한 PID의 여러 GPU 연결, Linux CPU 시간 차이, 실제 수집 시각과 누락 구간을 확인합니다.
- 전송 대기열, 검증된 재개, 재시작 복구, rsync 직접 전송 또는 SFTP 중계를 제공합니다.
- SSH config 가져오기, 그룹, ProxyJump, 빠른 명령, 포트 포워딩을 지원합니다. 활성/복구 알림과 닫을 수 있는 안내 최대 두 개를 표시하며, 데모는 외부 이상 알림을 보내지 않습니다.

팀 계정, 자원 예약, 클러스터 스케줄링, AMD/Intel GPU 지표, 완전한 NVML 진단은 제공하지 않습니다. 여유 메모리는 관측값이며 예약이나 독점 사용 권한을 뜻하지 않습니다.

## 시작하기

[릴리스](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.0)에서 운영체제에 맞는 패키지를 받으세요. 서버 관리에서 연결을 테스트하고 추가하거나 SSH config를 가져옵니다. GPU 지표에는 원격 nvidia-smi, 시스템 지표에는 Linux /proc가 필요합니다. 소스 실행에는 Node.js 22와 npm을 사용합니다.

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

브라우저는 모의 데이터임을 표시하는 데모입니다. 실제 SSH, 인증 정보, 터미널, SFTP에는 데스크톱 프로세스가 필요합니다.

```sh
npm run electron:dev
```

카드당 필요한 여유 GiB를 입력하고 모델이나 사용자를 검색한 후 모니터링·터미널·파일을 엽니다. 설정은 외관, 모니터링, 보안, 작업 흐름, 활동/도움말로 나뉩니다. Ctrl/Cmd+K로 명령 팔레트를 열며, 주요 대화상자는 Tab, Shift+Tab, Escape와 포커스 복원을 지원합니다.

## 전송과 인증 정보

- 임의의 기존 대상 파일을 재개용 데이터로 쓰지 않습니다. SFTP 작업은 전용 임시 파일을 사용하고 전체 기존 접두 부분을 SHA-256으로 비교한 뒤 재개합니다.
- 대상 교체 전 바이트 수와 원본 크기/수정 시간을 확인하고 겹치는 대상 경로를 순차 처리합니다. 실패 시 재시도 데이터를 보존합니다. 취소/제거의 정리가 실패하면 복구 기록을 보존하고 오류를 알립니다.
- 선택적 MD5 검사는 개별 파일 교체 전에 실행하며 디렉터리나 중계를 MD5 검증 완료로 표시하지 않습니다.
- 직접 전송에는 양쪽 rsync와 원본에서 대상으로 연결 가능한 네트워크가 필요합니다. 임시 SSH 키와 신뢰한 지문을 사용하며, 불가능하면 단계적 SFTP 중계로 전환합니다. 바로 덮어쓰는 tar/scp 대체 경로는 비활성화되었습니다.
- 안전한 OS 키 저장소가 있으면 비밀번호와 개인 키 암호를 암호화합니다. 없거나 Linux basic_text이면 새 비밀 정보는 세션 메모리에만 남고 재시작 후 다시 입력해야 합니다. 보안 설정은 실제 방식을 표시하며 개인 키는 기존 경로에 남습니다.

[보안 설명](SECURITY.md)을 참고하세요. 크기/수정 시간 확인은 동시에 변경 중인 원본을 잠그지 않습니다. 실제 원격 서버 간 rsync는 아직 검증하지 않았습니다.

## 검증한 범위

v0.11.1은 Windows, Linux, macOS 각각에서 타입 검사, 회귀 테스트 84개, SFTP 스모크, 빌드, 브라우저 검사 22개를 통과했습니다. 패키징된 앱은 각 OS에서 네이티브 검사 16개를 통과했습니다: 실제 IPC, 로컬 SSH shell, 크기 변경, 포워딩, 인증 후 재시작을 확인합니다. Windows DPAPI는 실제 검사했지만 macOS 자동화는 MockKeychain이며 실제 Keychain 검증은 아닙니다. Linux는 안전한 키 저장소가 없을 때 세션 전용 정책을 확인합니다. macOS 실행은 arm64에서 이루어졌고 Intel은 실행하지 않았습니다.

실제 GPU/MIG, 완전한 원격 PTY, 운영 환경 rsync/네트워크 성능, 실제 macOS/Linux 키 저장소, 설치 프로그램과 업데이트는 추가 검증이 필요합니다. 로컬 모의 SSH 세션 10/30개 벤치마크는 실제 클러스터 성능이나 절감률을 보장하지 않습니다. [검증](docs/VALIDATION-0.11.1.md)과 [측정 방법](docs/BENCHMARKS.md)을 확인하세요.

## 개발과 빌드

React, TypeScript, Electron, Vite, ssh2의 정확한 버전은 [package.json](package.json)과 잠금 파일에 있습니다. 검사 명령:

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npx playwright-core install chromium
npm run test:ui
npm run test:workflow
npm run benchmark
```

SC_ELECTRON_PATH를 현재 압축 해제된 앱 실행 파일로 지정한 뒤 npm run e2e:terminal을 실행합니다. dist:win:lite, dist:win:nsis, dist:linux, dist:mac은 자동 공개를 끕니다. [패키지 CI](.github/workflows/package.yml)는 네이티브 검사 후 서명되지 않은 결과물을 업로드합니다. ESLint 및 React-Hooks가 설정되어 있으며 CI에서 npm run lint를 실행합니다.

## 언어와 기여

README와 UI 리소스는 10개 언어를 지원하며 필요한 언어만 불러옵니다. 모든 문구의 원어민 검토는 아직 완료되지 않았습니다. [LOCALIZATION](docs/LOCALIZATION.md).

[구조](docs/ARCHITECTURE.md) · [기여 안내](CONTRIBUTING.md) · [로드맵](docs/ROADMAP.md) · [변경 기록](CHANGELOG.md) · [MIT 라이선스](LICENSE)
