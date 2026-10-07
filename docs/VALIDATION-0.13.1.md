# Validation ledger — 0.13.1

This patch changes overview GPU CSS and the application version. It fixes the column count to two or four, removes large filled gauge tiles and normalizes gauge sizing/text spacing. The 0.13.0 monitoring/database implementation remains unchanged; its storage measurement is recorded in the [previous ledger](VALIDATION-0.13.0.md).

Local production build and all eight monitoring interaction checks passed. A separate visual/geometry probe passed 30 combinations: 1/2/3/4/8 GPUs, window widths of 900/1280/1600 px, and light/dark themes. It checked two/four column counts, actual item counts, bounded tile geometry, circular aspect ratio and renderer errors. [GPU layout receipt](evidence/gpu-layout-0.13.1-local.json). These browser checks use explicitly simulated IPC and GPU snapshots.

Fresh platform workflow, packaging and public download receipts will be added after completion. A browser illustration does not establish actual registry installation or installed-version upgrade behavior.
