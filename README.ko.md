# ServerConsole

**GPU 여유 메모리와 사용자를 확인하고 한 데스크톱에서 실험, 터미널, 파일을 엽니다.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[다운로드](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## 0.19.0 변경 사항

- 훈련 Run은 명령, 매개변수, 종료 코드, JSONL/텍스트 지표, 곡선과 진단 근거를 저장합니다. 홈에서 리소스와 실험 보기를 전환할 수 있습니다. 훈련 지표는 30일 후 자동 정리됩니다.

- GPU·시스템·프로세스 계층 수집을 실제 스케줄러에 연결했습니다. 알 수 없는 값과 누락 구간을 보존하며 GPU 계기판은 한 줄에 4개입니다.

- 실험 작업 공간에 서버, 디렉터리, GPU, tmux, 로그, 서비스를 저장합니다. 터미널 검색, 분할 레이아웃, 파일 바로가기로 작업 맥락을 유지합니다.

- 작업 종료 코드와 중지 결과가 실제 실행을 반영합니다. 시작 식별자로 PID 재사용을 검사하며 오프라인 상태를 알림 규칙과 모바일 요약에 전달합니다.

- 기록 범위는 30분, 1시간, 12시간, 1일, 1주입니다. GPU 비교, 디스크·네트워크, 내보내기와 이벤트 표시를 지원합니다. 원본 24시간, 분 집계 30일 후 자동 정리합니다.

- 작업 카드, 증분 학습 로그, GPU 가용 알림, 규칙, 컨테이너, 서비스 터널을 제공합니다. Slurm 작업·상세·로그는 읽기 전용이며 호스트 지원이 필요합니다.

- 동기화 전 변경과 제외 규칙을 검토합니다. 저장 후 업로드는 대기·업로드·성공·실패를 구별하며 완료 후에만 성공 시간을 갱신합니다.

- 진단과 자격 증명 없는 설정 백업으로 복구·이전을 돕습니다. HTTPS Webhook은 기본 비활성입니다. 별도 실행하는 헤드리스 수집기는 데스크톱 종료 후에도 기록을 저장합니다.

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## 시작하기

Release에 첨부된 패키지를 선택하세요. Windows는 서명되지 않아 SmartScreen 경고가 표시될 수 있습니다. 해당 버전의 SHA-256과 대조하세요. macOS/Linux는 실제 워크플로와 공개 첨부 파일 기준입니다.

SSH를 추가하거나 가져오고 지문을 확인한 뒤 개요 또는 작업대를 엽니다. GPU는 nvidia-smi, 시스템은 Linux /proc가 필요합니다. 여유 메모리는 예약이 아닙니다.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## 개발

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

브라우저는 표시된 모의 데모입니다. 실제 SSH, 터미널, SFTP는 Electron 데스크톱이 필요합니다.

```sh
npm run electron:dev
```

React 18 · TypeScript · Electron · Vite · ssh2 · SQLite. [package.json](package.json) · [Architecture](docs/ARCHITECTURE.md)

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
```

## 검증 범위

최신 기록에서 명령, 결과와 미검증 항목을 확인하세요. 실제 Linux 2대에서 GPU 스트림, 3계층 수집, 자원 카운터, 종료 코드 7의 전용 작업을 확인했습니다. 대규모 환경, 100GB 전송, Slurm/MIG, 모든 설치 프로그램을 검증한 것은 아닙니다.

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## 언어와 가이드

앱과 README는 10개 언어를 제공합니다. 기계 보조 번역은 원어민 검토가 필요합니다. 원격 출력은 원문을 유지하며 아래 이미지는 이전 버전의 모의 화면입니다.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
