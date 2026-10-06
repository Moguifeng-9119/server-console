## 0.12.0 — Transfer recovery and multilingual workflows / 传输恢复与多语言工作流

- Durable task-owned staging journal: restore after a crash, retain cleanup failures and retry exact owned files after reconnect. Unknown legacy remote stages are preserved for manual inspection.
- Full SHA-256 resume-prefix verification now shows separate byte/file progress and can be paused or canceled. Checking bytes never count as transferred bytes.
- Explicit legacy-task recovery explanations; metadata-only removal for old unowned stages.
- Ten locale files with 635 matching keys, migrated file/import/relay/editor labels, on-demand locale loading, keyboard file/relay actions and unsaved/saving text protection. Machine-assisted wording still needs full native-speaker review.
- Detailed English/Chinese guides, shared ten-language README navigation, a 27-second clearly simulated workflow demonstration and transfer screenshots.

Validation: all three OS source CI jobs passed 106 tests, typecheck, lint, loopback SFTP smoke, build, 22 workbench checks and 23 file/editor/relay/language checks. Windows/Linux/macOS packages each passed 16 native checks. One real six-H100 Linux host passed 16 MiB upload/download final SHA-256, forced transfer-subprocess recovery and remote staging cleanup. The second authorized host was unreachable, so real cross-server rsync remains unverified.

本版修复暂存文件崩溃恢复与清理、续传前缀校验进度、旧任务升级说明，并补齐键盘工作流、语言资源和详细文档。三系统 CI/打包原生验收均通过；真实 SSH/SFTP 恢复已测。跨机 rsync、全部非中英文文案的母语审校、真实 macOS/Linux 密钥库、Intel macOS 执行、安装器/更新仍有验收边界。

Unsigned packages; macOS is not notarized. macOS automation uses MockKeychain and runs on arm64; this is not evidence for real Keychain or Intel execution. GPU telemetry targets Linux NVIDIA hosts over SSH; a local 5070 Ti Laptop read is not a new Windows-local collector.

[Validation ledger](https://github.com/Moguifeng-9119/server-console/blob/main/docs/VALIDATION-0.12.0.md) · [中文使用与恢复指南](https://github.com/Moguifeng-9119/server-console/blob/main/docs/USER-GUIDE.zh-CN.md)
