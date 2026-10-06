# Roadmap

Priorities, not release promises. Recovery journals, prefix progress, file/relay keyboard flows, shared locale catalogs, detailed guides and lint are implemented. In 0.12.2, whole packaged-main crash recovery and direct rsync passed on two real hosts. See the [validation ledger](VALIDATION-0.12.2.md) for exact evidence.

| Priority | Remaining problem | Completion evidence |
| --- | --- | --- |
| 1 | Additional real cross-server failure scenarios | Healthy direct rsync, whole-main crash recovery and exact owned-key cleanup passed on two hosts; controlled connectivity loss and broader cancellation/race scenarios remain |
| 1 | Package confidence beyond automation | Intel macOS, real Keychain/Linux secret-service, signing/notarization, installer/update and complete packaged remote-terminal workflows; real Connection PTY computed output/resize passed |
| 1 | Physical GPU semantics | Real multi-GPU PID, missing fields, MIG/permissions; six H100 cards detected and three approximate CPU samples matched independent vmstat on one host; exact-window/container-quota comparison remains |
| 2 | Wording and screen readers | Native-speaker review of machine-assisted drafts and native reader acceptance; locale contract and keyboard regressions already exist |
| 2 | Actual user feedback | Lab users complete GPU → work → transfer tasks; simulated demonstration does not substitute for feedback |
| 2 | Large-prefix/fleet performance | Real 100 GB prefix timing and 10/30-host parser/UI/network profiling; full prefix verification remains |
| 2 | Source changes and remote coordination | Source snapshots, symlink aliases and cross-config physical target semantics |
| 2 | Module boundaries | Use measured complexity/performance to guide further IPC/store decomposition; checkJs is not strict TypeScript |
| 3 | Deep GPU diagnostics | Concrete lab need before implementing full NVML/MIG/process-tree capabilities |

Team SSO, RBAC, web deployment and cluster reservations change the trust/data model and require separate product decisions. They are not existing capabilities.
