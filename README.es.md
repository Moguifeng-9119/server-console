# ServerConsole

**Encuentra una GPU con memoria libre suficiente, identifica quién la usa y abre terminal o archivos en el mismo escritorio.**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[Descargar](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.13.0) · [Informar de un problema](https://github.com/Moguifeng-9119/server-console/issues)

**0.13.0:** indicadores circulares por GPU, cambio inmediato con datos en caché, paneles de archivos conservados e historial visible de 30 minutos, 1 hora, 12 horas, 1 día y 1 semana. SQLite elimina automáticamente muestras originales a las 24 horas y resúmenes por minuto a los 30 días. La aplicación debe estar abierta para recopilar datos. Instala `ServerConsole-Setup-0.13.0.exe`. [Validación y capacidad](docs/VALIDATION-0.13.0.md)

**Los archivos Windows no están firmados. SmartScreen puede advertir. Compare el SHA-256 con el archivo de la versión.**

![Recursos GPU: datos simulados](assets/screenshots/workbench-en.png)

**Novedades de 0.12.0**

Registro persistente para recuperar y limpiar archivos temporales propios; progreso visible de SHA-256 y explicación de tareas antiguas. Se añadieron controles de archivos y retransmisión por teclado, protección del texto sin guardar y ESLint/Hooks. Los diez idiomas tienen 702 claves; aún falta la revisión nativa de todos los borradores asistidos por traducción automática.

0.12.2 validó cargas de 16 MiB y rsync en dos servidores Linux reales, recuperación tras terminar todo el proceso principal, progreso del prefijo y limpieza de claves/directorios propios. Las cifras 0.11.1 siguientes son históricas. Alcance actual: [0.12.2](docs/VALIDATION-0.12.2.md).

![27-second simulated workflow](assets/demo/workflow.gif)

<p><img src="assets/screenshots/relay-en.png" alt="Simulated server relay" width="49%"> <img src="assets/screenshots/transfer-en.png" alt="Simulated resume verification" width="49%"></p>

Las capturas muestran v0.12.0 con datos simulados. v0.12.0 ofrece Windows x64 portátil, AppImage Linux x86_64 y DMG universal macOS con sumas SHA-256. Los paquetes no están firmados; macOS no está notarizado.

[Detailed usage and recovery (English)](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## Funciones

Una herramienta personal para servidores compartidos **Linux / NVIDIA GPU**, mediante SSH sin agente de monitorización remoto.

- Filtrar GiB libres por GPU, modelo y usuario, ordenar por memoria libre y abrir directamente monitorización, terminal o archivos.
- Consultar procesos, varias GPU por PID, CPU Linux por diferencias de contadores, actualidad e historial con marcas de tiempo y huecos.
- Colas de transferencia, reanudación verificada, recuperación tras reiniciar, rsync directo o retransmisión SFTP; importar SSH config, grupos, ProxyJump, comandos y reenvío de puertos.
- Alertas activas/resueltas y como máximo dos avisos descartables; la demo no envía alertas externas.

No incluye cuentas de equipo, reservas, planificación de clústeres, telemetría AMD/Intel GPU ni diagnóstico NVML completo. Memoria libre no equivale a reserva.

## Primeros pasos

Descarga tu paquete, prueba y añade un servidor o importa SSH config. GPU requiere nvidia-smi remoto; sistema usa Linux /proc. Para el código necesitas Node.js 22 y npm:

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

El navegador es una simulación identificada. SSH, credenciales, terminal y SFTP reales requieren el proceso de escritorio:

```sh
npm run electron:dev
```

Indica los GiB libres por tarjeta, modelo o usuario. Los ajustes están agrupados. Ctrl/Cmd+K abre la paleta; los diálogos principales admiten Tab, Shift+Tab, Escape y restauración del foco.

## Transferencias y credenciales

- Un destino arbitrario no se usa como prefijo de reanudación: archivos temporales propios y comparación SHA-256 de todo el prefijo.
- SFTP verifica bytes y tamaño/fecha de la fuente antes de sustituir, serializa destinos solapados y conserva datos al fallar. Si falla la limpieza al cancelar/eliminar, mantiene el registro de recuperación y comunica el error.
- MD5 opcional se verifica antes de sustituir archivos individuales; directorios y retransmisiones no se presentan como verificados por MD5.
- El envío directo exige rsync en ambas máquinas y acceso de origen a destino, con clave SSH temporal y huella confiable; si no, SFTP con archivos de preparación. Alternativas tar/scp que sobrescribían directamente desactivadas.
- Un almacén seguro del sistema cifra contraseñas y frases secretas. Si falta o es Linux basic_text, las nuevas credenciales quedan solo en la sesión y se reintroducen tras reiniciar. Los ajustes muestran el modo real; las claves privadas mantienen su ruta.

Tamaño/fecha no bloquean una fuente modificada en paralelo. Consulte [seguridad](SECURITY.md); rsync real y limpieza tras un fallo pasaron pruebas aisladas.

## Validación

v0.11.1 pasó en cada sistema Windows/Linux/macOS tipado, 84 pruebas de regresión, smoke SFTP, compilación y 22 comprobaciones de navegador. Cada aplicación empaquetada pasó 16 comprobaciones nativas: IPC, shell SSH local, tamaño, reenvío y reinicio autenticado.

Windows DPAPI se probó realmente. macOS usa MockKeychain, sin validar Keychain real; ejecución en arm64, no Intel. Linux comprueba credenciales de sesión sin almacén seguro. GPU/MIG físicas, PTY remoto completo, rsync/red en producción, almacenes macOS/Linux reales, instaladores y actualizaciones requieren pruebas. El benchmark de 10/30 sesiones SSH simuladas no demuestra rendimiento de clúster ni ahorro porcentual.

## Desarrollo

React, TypeScript, Electron, Vite y ssh2; versiones exactas en [package.json](package.json) y archivo de bloqueo. Comprobaciones:

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

Define SC_ELECTRON_PATH con el ejecutable actual desempaquetado y ejecuta npm run e2e:terminal. dist:win:lite, dist:win:nsis, dist:linux y dist:mac desactivan publicación automática. El [CI de paquetes](.github/workflows/package.yml) valida antes de subir. ESLint y React-Hooks están configurados; npm run lint se ejecuta en CI.

## Idiomas y colaboración

README en diez idiomas; la interfaz tiene diez archivos completos de claves y carga idiomas bajo demanda. La revisión nativa de todos los textos sigue pendiente. [LOCALIZATION](docs/LOCALIZATION.md).

[Evidencias](docs/VALIDATION-0.11.1.md) · [Metodología](docs/BENCHMARKS.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Contribuir](CONTRIBUTING.md) · [Hoja de ruta](docs/ROADMAP.md) · [Cambios](CHANGELOG.md) · [Licencia MIT](LICENSE)
