# ServerConsole

여유 메모리가 충분한 GPU를 찾고 사용자를 확인한 뒤 터미널과 파일 관리로 이동하는 데스크톱 도구입니다.

[데스크톱 릴리스 다운로드](https://github.com/Moguifeng-9119/server-console/releases) · [English guide](README.md) · [中文指南](README.zh-CN.md)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

![Resource workbench — simulated metrics](assets/screenshots/workbench-en.png)

스크린샷은 v0.11.0 소스와 모의 데이터입니다. 공개된 설치 파일은 이전 버전일 수 있습니다.

새 화면은 영어와 중국어 간체를 우선 유지하며 새 번역이 없는 문구는 영어로 표시됩니다.

[Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE)

## Source demo

Node.js 22 / npm:

```sh
npm ci
npm run dev
# Desktop SSH / SFTP:
npm run electron:dev
```

Browser mode uses simulated data. Real connections require the desktop process and a Linux SSH host; GPU telemetry requires nvidia-smi. Platform package availability must be checked in the release attachments.
