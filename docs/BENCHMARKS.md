# Reproducible benchmark

Run `npm run benchmark`. It starts 10, then 30 loopback fake SSH servers with a newly generated test host key, connects through the real `ssh2` transport, collects once cold and five times warm, and writes `test-artifacts/benchmark.json`. `SC_BENCHMARK_OUTPUT` can change the output path.

GPU/process readings are synthetic. The measurement includes Node clients **and fake servers**, excludes Electron and the renderer, and has no network latency or physical GPU. It is a local transport/parser baseline, not a deployment benchmark or a comparison against other projects.

## Local measured sample — 2026-10-05

Windows x64, Node v22.22.3, AMD Ryzen 9 8945HX, 32 logical CPUs. Raw result: [benchmark-local.json](evidence/benchmark-local.json).

| Synthetic sessions | Cold connect + collect | Warm collection median / max | Snapshot payload / fleet round | Combined Node RSS | Event loop p99 |
| --- | --- | --- | --- | --- | --- |
| 10 | 101.33 ms | 19.56 / 24.71 ms | 15,110 bytes | 68.84 MiB | 21.14 ms |
| 30 | 185.73 ms | 45.93 / 57.88 ms | 45,330 bytes | 74.96 MiB | 42.01 ms |

Five warm rounds give an illustrative median/max, not a confidence interval. RSS is a process snapshot, not peak application memory; the event-loop histogram includes startup. This harness does not run IPC's production stagger/background polling policy. There is no baseline comparison demonstrating a percentage reduction.

## Measurements still needed

For real fleet claims record node count, real RTT/loss, metric/process payload sizes, polling interval, focused/background scheduling, reconnects, renderer update latency, app RSS and CPU. For transfer claims record file counts/sizes, disk speeds, cipher, compression, network throughput and checksums on both ends. Separate cold authentication, warm polling, directory traversal and byte streaming. Repeat comparable trials before describing a speedup.
