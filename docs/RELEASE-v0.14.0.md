# ServerConsole v0.14.0

### High-Frequency Monitoring & Smooth 60 FPS Telemetry Engine

ServerConsole v0.14.0 introduces an end-to-end high-frequency monitoring architecture designed for responsive, truthful GPU telemetry without compromising UI performance or SSH connection stability.

#### Key Highlights

1. **Decoupled Telemetry Store (`useSyncExternalStore`)**:
   - Per-server isolated external store subscriptions prevent high-frequency metric frames from triggering React root Context re-render cascades.
   - Host A metric updates never re-render Host B cards or unrelated panels.

2. **60 FPS Shared RAF Smooth Circular Gauge (`GpuGauge`)**:
   - Global singleton `requestAnimationFrame` loop drives all visible GPU gauges with exponential smoothing ($\tau = 100\text{ms}$).
   - Mutates SVG `<circle>` DOM attributes directly (`ref`), bypassing React reconciler overhead.
   - Automatically pauses on hidden or background tabs (`document.hidden`), respects `prefers-reduced-motion`, and displays truthful metrics (no fabricated readings).

3. **Tiered Multi-Rate Sampling (`TieredScheduler`)**:
   - Decoupled independent collection lanes: `gpu` (200ms / 500ms for focused servers), `system` (1s), and `processes` (3s).
   - Strict non-reentrancy per host and per lane ensures slow `ps` commands never delay rapid GPU metrics.
   - Capability probing detects `nvidia-smi`, loop query support, and remote environment.

4. **1-Second Statistical Bucket History (`HistoryAggregator`)**:
   - Aggregates high-frequency snapshots into 1-second statistical buckets with min/max peak preservation, trapezoidal integral, and sample counts.
   - Batched SQLite transactions via `raw_buckets` prevent database file bloating while preserving 100ms/200ms workload spikes.

5. **Persistent Streaming & Adaptive Rate Control**:
   - `StreamChannel`: Long-lived `nvidia-smi -lms` continuous streaming over SSH with incremental UTF-8 line decoding and idle watchdog.
   - `RateController`: AIMD (Additive Increase Multiplicative Decrease) adaptive rate controller halves frequency on congestion/latency and safely recovers upon stability.
   - `PublishBuffer`: Coalesces rapid updates to regulate IPC publication volume.

#### Verification

- **27 test files, 201 automated unit and integration tests passing at 100%**.
- TypeScript strict typecheck: 0 errors (`tsc -b && tsc -p tsconfig.electron.json`).
- ESLint: 0 warnings, 0 errors.
- End-to-end loopback SSH smoke tests: dual SSH daemon verified.

See the [0.14.0 validation ledger](VALIDATION-0.14.0.md).
