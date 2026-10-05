# 本地 Windows 预览

本轮版本为 0.11.0，发布入口为 [GitHub Release](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.11.0)。桌面包位于被 Git 忽略的 release/0.11.0-local/，使用 Electron 44.5.1、Windows x64，未签名。

- 便携版：`release/0.11.0-local/ServerConsole 0.11.0.exe`。
- 已执行原生检查的解包程序：`release/0.11.0-local/win-unpacked/ServerConsole.exe`；运行时需要保留整个 win-unpacked 文件夹。
- 原生检查使用独立临时数据目录，不会添加测试服务器到日常配置。正常打开程序后可进入“服务器”添加自己的连接。
- 源码浏览器预览使用明确标注的模拟数据，真实 SSH/SFTP 需要桌面程序。

原生检查确认：版本一致，全部 Electron CJS/生产资源 SHA-256 与当前源码构建一致，preload IPC 可用，连接配置写入失败不改变内存列表，命令通过真实本机 SSH shell 执行，切换标签保留输出，可同时使用两个会话。运行脚本需先将 SC_ELECTRON_PATH 指向解包程序，再执行 `npm run e2e:terminal`。

这不等于真实 GPU、远程 rsync、系统密钥库、安装器/更新器或其他系统已经验证。完整记录见 [验证清单](VALIDATION.md)、[原生回执](evidence/native-terminal-local.json) 与 [本地检查回执](evidence/checks-local.json)。
