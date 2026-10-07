# Validation ledger — 0.13.2 local update

Overview GPUs use four columns at every supported card width. Server cards prefer at least 430 px so normal windows provide enough room. Narrow cards keep four columns and reduce gauge size, spacing and auxiliary text, allowing memory text to wrap.

The production build passed. A browser probe passed 40 simulated GPU-count/window/theme combinations with an explicit assertion that every GPU grid has four columns, its real GPU count, bounded tiles and no tile horizontal overflow. [Layout receipt](evidence/gpu-layout-0.13.2-local.json).

The local Windows NSIS payload was extracted into an owned temporary directory and launched with isolated data. Its version, preload, four-column CSS in both narrow/wide packaged-window fixtures, and actual SQLite worker query passed. [Installer receipt](evidence/installer-launch-0.13.2-local.json). No registry installation or installed-user-data upgrade was performed. A local installer check does not establish a public GitHub binary release or three-platform CI success.
