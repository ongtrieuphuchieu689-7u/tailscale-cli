# Security

Trust credentials, client secrets, access tokens and auth keys are masked and never persisted. Environment scanning only checks exact `tskey-client-` values and reports variable names, never values. Policy writes require a minimal diff, backup, validation, ETag protection and confirmation. Cleanup only targets matching offline devices and is never a broad offline delete.

## Tarball supply-chain guard

Before publishing, `check:secrets` scans every file in the `dist/`, `docs/`, `README.md` and `LICENSE` artifacts for Tailscale credential patterns (`tskey-client-*`, `tskey-auth-*`, `tskey-static-*`, `tskey-api-*`, `tskey-access-*`). Placeholders documented in the source are allow-listed; real-format credentials with sufficient entropy cause the build to fail, preventing accidental secret inclusion in the npm tarball. The same pattern is used at CI time via `prepublishOnly` and `pack:check`.
