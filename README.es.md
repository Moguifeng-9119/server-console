# ServerConsole

**Encuentra una GPU con memoria libre suficiente y abre tus experimentos, terminal y archivos desde un escritorio.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Descargar](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## Novedades de 0.19.0

- Las ejecuciones de entrenamiento conservan comandos, parámetros, códigos de salida, métricas JSONL/texto, curvas y evidencias de diagnóstico. Alterna Recursos y Experimentos en Inicio; las métricas caducan a los 30 días.

- La recogida por niveles de GPU, sistema y procesos está conectada al planificador real. Conserva valores desconocidos, marcas temporales y lagunas. La vista general mantiene cuatro indicadores GPU por fila.

- Los espacios de experimento guardan servidor, directorio, GPU, tmux, registros y servicios. La búsqueda y división del terminal y los accesos a archivos conservan el contexto.

- Los códigos de salida y resultados de parada reflejan la ejecución remota. Se comprueba la identidad de inicio del proceso frente a PID reutilizados. El estado sin conexión llega a alertas y resumen móvil.

- Historial de 30 minutos, 1 hora, 12 horas, 1 día y 1 semana, comparación GPU, disco/red, exportaciones y eventos. Los datos originales caducan a las 24 horas y los resúmenes al cabo de 30 días.

- Incluye tareas, registros incrementales, avisos de GPU disponible, reglas, contenedores y túneles. Slurm ofrece trabajos, detalles y registros de solo lectura cuando el servidor lo admite.

- Revisa cambios y exclusiones antes de sincronizar. La subida al guardar distingue cola, transferencia, éxito y fallo; registra el éxito tras completar la transferencia.

- Diagnóstico y copias de configuración sin credenciales para recuperar y migrar. Webhooks HTTPS opcionales, desactivados por defecto. El recolector sin interfaz se inicia aparte para guardar historial con el escritorio cerrado.

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## Primeros pasos

Elige un paquete adjunto en Releases. Windows no está firmado y puede mostrar SmartScreen. Comprueba SHA-256 con el archivo del mismo lanzamiento. macOS/Linux dependen de sus flujos y archivos publicados.

Añade o importa SSH, verifica la huella y abre la vista general o el área de trabajo. GPU requiere nvidia-smi y sistema Linux /proc. La memoria libre no constituye una reserva.

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## Desarrollo

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

El navegador es una demostración simulada identificada. SSH, terminal y SFTP reales requieren Electron.

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

## Validación y alcance

El registro actual recoge comandos, resultados y pruebas pendientes. Dos servidores Linux reales verificaron flujo GPU, tres niveles, contadores y una tarea propia con salida 7. No acredita flotas, transferencias de 100GB, Slurm/MIG reales ni todos los instaladores.

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## Idiomas y guías

Aplicación y README en diez idiomas. Las traducciones asistidas requieren revisión nativa. La salida remota conserva su idioma. Las imágenes son ejemplos simulados de versiones anteriores.

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
