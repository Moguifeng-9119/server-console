# Roadmap

These are priorities, not release promises. The product focus is getting from a suitable Linux/NVIDIA GPU to SSH work with clear observations and dependable data movement.

| Priority | Next problem | Evidence for completion |
| --- | --- | --- |
| 1 | Complete release confidence beyond current CI | v0.11.1 three-platform packages and 16 native checks per platform passed, including resize, forwarding and restart. Remaining: Intel macOS execution, signing/notarization, installer/update, real macOS/Linux key stores and full remote PTY |
| 1 | Real direct relay and failure recovery | Two owned test hosts: rsync, loss of source-to-target reachability, cancellation, mismatch/source changes, crash and temporary-key cleanup; destination-byte checks |
| 1 | Physical GPU observations | CPU comparison against Linux counters; multi-GPU PID, unavailable NVIDIA fields, MIG/permissions behavior; timestamp freshness under slow polling |
| 2 | Remaining translation and keyboard gaps | Migrate importer/files/terminal/parallel labels, add locale coverage, native screen-reader checks and controls with accessible names |
| 2 | Product demonstration | Ten README guides exist; add a 20–30 second find-GPU → inspect → terminal → transfer demonstration and transfer screenshots, with simulated/real data labelled |
| 2 | Large-fleet responsiveness | Real 10/30-host profiling and parser/UI timing; split broad React store only when measurements justify it; cap concurrent collection if needed |
| 2 | Transfer source snapshots and remote coordination | Define semantics for changing files, filesystem symlink aliases and separate configurations pointing at one physical target |
| 2 | Stronger engineering checks | ESLint/react-hooks rules, renderer/native regression jobs and dependency-update review |
| 3 | Deep GPU diagnostics | Compare whether NVML/MIG/process detail improves a concrete lab task before adding dependencies |

Team SSO, RBAC, web deployment and cluster reservations change the trust/data model. Treat them as separate product decisions after native reliability and resource discovery have evidence, rather than making the current README imply they exist.
