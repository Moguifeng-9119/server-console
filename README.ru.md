# ServerConsole

**Найдите GPU с достаточной свободной памятью и откройте эксперимент, терминал и файлы на одном рабочем столе.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Скачать](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## Новое в 0.18.0

- Поуровневый сбор GPU, системы и процессов подключён к действующему планировщику. Неизвестные значения, время и пропуски сохраняются. В обзоре четыре индикатора GPU в строке.

- Рабочее пространство эксперимента сохраняет сервер, каталог, GPU, tmux, журналы и сервисы. Поиск и разделение терминала и переходы к файлам сохраняют контекст.

- Коды выхода и результаты остановки соответствуют удалённому выполнению. Проверка идентификатора запуска защищает от повторного использования PID. Отключения учитываются в правилах и мобильной сводке.

- История за 30 минут, 1 час, 12 часов, день и неделю: сравнение GPU, диски/сеть, экспорт и события. Исходные данные очищаются через 24 часа, минутные сводки через 30 дней.

- Задачи, инкрементальные журналы обучения, уведомления о GPU, правила, контейнеры и туннели. Задания, сведения и журналы Slurm доступны только для чтения при поддержке сервера.

- Перед синхронизацией проверьте изменения и исключения. Загрузка при сохранении различает очередь, передачу, успех и ошибку; время успеха записывается после завершения.

- Диагностика и резервирование настроек без учётных данных помогают восстановлению. HTTPS Webhook необязателен и изначально выключен. Отдельный фоновый сборщик хранит историю при закрытом приложении.

[0.18.0 release notes](docs/RELEASE-v0.18.0.md) · [Validation](docs/VALIDATION-0.18.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Начало работы

Выберите прикреплённый пакет Release. Windows не подписан; возможен SmartScreen. Сверьте SHA-256 с файлом того же выпуска. macOS/Linux подтверждаются фактическими workflow и опубликованными файлами.

Добавьте или импортируйте SSH и проверьте отпечаток. GPU требует nvidia-smi, системные показатели Linux /proc. Свободная память не является резервированием.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Разработка

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

Браузер показывает обозначенную симуляцию. Настоящие SSH, терминал и SFTP требуют Electron.

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

## Проверки и границы

В актуальном журнале указаны команды, результаты и непроверенные пункты. Два Linux-хоста проверили поток GPU, три уровня, счётчики и собственную задачу с кодом 7. Это не подтверждает парк серверов, передачу 100GB, реальный Slurm/MIG или все установщики.

[Current validation ledger](docs/VALIDATION-0.18.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Языки и руководства

Приложение и README доступны на десяти языках. Машинный перевод требует проверки носителями. Удалённый вывод сохраняет язык. Изображения — симуляции предыдущих версий.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
