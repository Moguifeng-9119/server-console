# Contributing

ServerConsole focuses on finding a suitable Linux/NVIDIA GPU and doing work through SSH. Prefer a concrete user problem and acceptance criteria over unrelated protocols or unsupported platform claims.

## Local workflow

Use Node.js 22. Run `npm ci`, then `npm run dev` for the browser demo or `npm run electron:dev` for the desktop. Use synthetic identities in tests; do not include real credentials, keys or private infrastructure in screenshots or issues.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`, `npm run build`, then `npm run test:ui` and `npm run test:workflow`. A supported local Chrome or `npx playwright-core install chromium` is needed for renderer checks. `SC_BROWSER_PATH` can specify an executable. `SC_SCREENSHOT_DIR` controls screenshots; default results go to ignored `test-artifacts/`.

For native checks, build the current package, set `SC_ELECTRON_PATH` to its **unpacked app executable** (not the portable launcher wrapper), and run `npm run e2e:terminal`. This uses isolated app data and compares the package's backend/assets with current source SHA-256. `SC_TERMINAL_ARTIFACTS` controls the output directory.

Vitest exercises behavioral helpers, smoke tests use real SFTP against fake servers, and browser checks use simulated metrics. The native fixture adds packaged Electron IPC and terminal checks using a local shell. NVIDIA sampling, OS key stores, other operating systems and direct rsync need their own environment-specific evidence. Do not present mock evidence as a production result.

## Review expectations

- Transfer edits: compare actual destination bytes, check failure preservation and exercise cancellation/recovery where relevant.
- Monitoring edits: state source commands and units, preserve missing values/timestamps, test multi-GPU PID associations when changing parsing.
- UI edits: check both themes, English/Simplified Chinese, 900px viewport, keyboard navigation and stacked dialogs. Respect reduced motion.
- Credentials: OS encryption or session-only storage; never add recoverable plaintext fallback. Preserve corrupt configuration and display errors.

ESLint and react-hooks check maintained source/scripts/tests in CI. Locale tests enforce complete keys and interpolation, not native-speaker fluency. Run the workflow browser check when changing text, locale loading, keyboard controls or draft handling. See [validation](docs/VALIDATION-0.12.0.md) before making performance/platform claims.

A useful PR description gives the concrete trigger, before/after behavior, validation and remaining limits. Screenshots should show the current source version and mark simulated data.
