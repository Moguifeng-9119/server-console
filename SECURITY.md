# Security behavior

ServerConsole uses the SSH account privileges you supply. It is not a shared-cluster authorization boundary. Process termination, service restart and remote file changes require server permissions.

## Credentials and host trust

Passwords/passphrases use Electron safeStorage when OS encryption is available and the backend is not Linux `basic_text`. Otherwise new credentials stay in memory for the current session. Configuration contains private-key paths, not private-key content. Settings → Security displays the actual mode/backend.

Startup migrates legacy `plain:` and known `basic_text` records into the current policy. Malformed records or write failures preserve the original file, expose a migration error and block further saves until it is repaired/restored. This is a logical update, not secure erasure of disk blocks, backups or previous exports. Existing secure encrypted records are retained when the key store is temporarily unavailable.

TOFU learns a host key on first connection and rejects subsequent changes. First-use trust is not independent identity verification. Disabling automatic first-use trust rejects unknown hosts while retaining verification for known hosts. Trust/options files fail closed on corruption; a new key is accepted only after its record is saved. Removing a trusted host allows a subsequent first-use decision.

## Transfers

SFTP uses task-owned staging and renames after length/source checks. SHA-256 comparisons verify resume prefixes. Optional MD5 verifies single-file uploads/downloads before replacement. MD5 checks accidental corruption, not authenticity. Unavailable checks are reported explicitly.

Size/mtime comparisons do not lock a source; remote mtime may have one-second resolution. A rewrite with preserved metadata or a change after the final check may evade detection. Use stable sources/snapshots. Directory transfers commit individual files and are not transactional whole-tree updates. Unsupported remote rename returns an error without deleting the old target as fallback.

Local path normalization and parent/child locks prevent overlapping tasks on the same configured endpoint. Separately configured accounts may refer to the same machine; symlink aliases and other applications' writes need external coordination.

Direct rsync requires both tools and source-to-target reachability. It creates a temporary key, adds a tagged public key on the destination, uses its trusted fingerprint, and attempts cleanup in `finally`. The user's primary private key is not uploaded. Connecting does not sweep other sessions' tagged keys or temporary directories. A crash, disconnect or cleanup failure can leave temporary state; verify cleanup during real direct-transfer validation. Streaming tar/scp overwrite fallbacks are disabled.

Failed SFTP transfers retain tracked staging for retry. Cancel/remove attempts cleanup; cleanup failures retain the recovery record/manifest and display an error. Closing the panel does not stop transfer; exiting the app can interrupt it.

## Local data and reporting

OS userData contains connections, recovery paths/server IDs, history, host trust, preferences and logs. Exports/logs can contain sensitive commands or path metadata. There is no required cloud account or telemetry service; optional user webhooks and update checks make network requests. Demo anomalies send neither notifications nor webhooks.

Production uses CSP and Electron's preload bridge. OS-key-store behavior, packaged apps and real rsync require environment-specific validation; mock tests do not establish those guarantees.

Use the repository's private security-reporting channel if enabled. Otherwise request a private contact in an issue without sensitive details. No response-time or paid security-audit guarantee is currently offered.
