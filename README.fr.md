# ServerConsole

Trouvez un GPU avec assez de mémoire libre, identifiez son utilisateur et ouvrez le terminal ou les fichiers.

[Télécharger une version de bureau](https://github.com/Moguifeng-9119/server-console/releases) · [English guide](README.md) · [中文指南](README.zh-CN.md)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

![Resource workbench — simulated metrics](assets/screenshots/workbench-en.png)

Les captures montrent le code v0.11.0 avec des données simulées. Les paquets publiés peuvent être plus anciens.

La nouvelle interface est maintenue en anglais et chinois simplifié ; les nouveaux textes non traduits utilisent l’anglais.

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
