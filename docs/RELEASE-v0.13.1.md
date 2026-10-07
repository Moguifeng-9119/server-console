# ServerConsole v0.13.1

Overview GPU gauges now use two columns by default and four when the containing server card has at least 600 px of content width. The layout no longer creates three- or five-column rows. An odd GPU count leaves the final grid slot empty; it never adds a fake GPU.

The gauges have a consistent 88 px size. Large filled tile backgrounds have been removed, and memory, temperature and owner text use consistent spacing and clearer sizing. Matching GPUs retain an accent memory label; hover and keyboard focus remain visible.

Local production-renderer checks passed 30 combinations covering 1, 2, 3, 4 and 8 GPUs, 900/1280/1600 px windows, and light/dark themes. Existing monitoring interactions passed all eight checks. These illustrations use explicitly simulated snapshots. The database retention and capacity policy from 0.13.0 is unchanged.

See the [validation ledger](VALIDATION-0.13.1.md). Desktop packages remain unsigned; verify downloads against the release checksum manifest.
