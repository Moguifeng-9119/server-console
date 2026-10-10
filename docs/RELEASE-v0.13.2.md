# ServerConsole v0.13.2

Overview GPU grids now default to four columns across all supported server card widths. Server cards prefer a width of at least 430 px so standard desktop window layouts maintain clear spacing.

On narrow server cards, the layout preserves the four-column grid while proportionally reducing gauge dimensions, inter-item spacing, and auxiliary metric text, allowing memory labels to wrap cleanly. Odd GPU counts leave trailing grid slots empty; the layout never introduces placeholder or phantom GPU cards, and prevents horizontal overflow.

Local production builds and browser probes verified 40 simulated combinations covering GPU counts (1, 2, 3, 4, 8), window dimensions (900, 920, 1280, 1600 px), and themes (light/dark), validating zero horizontal tile overflow and strict four-column alignment.

See the [validation ledger](VALIDATION-0.13.2.md). Desktop packages remain unsigned; verify downloads against the release checksum manifest.
