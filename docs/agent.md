# Agent contract

The mandatory first operation is `doctor --detect-credentials --json`. Agents consume `resolved`, `warnings`, `requiredPrivileges`, `sideEffects` and `retryable`. Never retry permission or scope failures, never select an ambiguous credential, and never perform policy writes or deletion without the stated confirmation gates.

The `agent-manifest --json` tool (see `src/manifest.ts`) is the authoritative contract: `manifestVersion: 2` with `resolve_credentials`, per-tool `inputs/outputs`, `scopes`, `privileges`, `sideEffects`, `retryability`, `confirmation` requirements, `warningCodes`, the `policy_writes` flow, and the `cleanup_candidates` schema. Read it before calling tools.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | general CLI failure |
| `3` | credential problem (`CREDENTIAL_*`, `AUTH_KEY_*`) |
| `4` | permission/scope denied (HTTP 401/403) |
| `5` | binary problem (`TAILSCALE_BINARY_*`, `BIN_*`) |
| `6` | local Tailscale daemon/auth-key problem (`TAILSCALE_NOT_RUNNING`) |
| `7` | funnel/Serve/DNS-public problem (`FUNNEL_*`, `VERIFY`, `DNS_PUBLIC`) |
| `8` | policy problem (`POLICY_*`) |
| `9` | privilege required (`PRIVILEGE_REQUIRED`) |
| `75` | retryable (HTTP 408/429/5xx, binary download) |

## Credential resolution

`resolve_credentials.precedence` in the manifest matches the implementation: `TS_AUTH_KEY` > `TS_CLIENT_SECRET` > any env var starting with `tskey-client-` (single match only) > `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET` > `TS_ACCESS_TOKEN` > `TS_API_KEY`. When several trust credentials are present the CLI reports `CREDENTIAL_AMBIGUOUS` and requires `--credential-env <name>`. The API client is constructed with the same resolved env name, so an arbitrary env var (e.g. `CI_TAILSCALE_TRUST`) drives the actual deploy path, not just `doctor`.

## Guardrails

- `--yes` only skips prompts. Policy provisioning needs `--apply-policy`, HTTPS enablement needs `--enable-https`, device deletion needs `--cleanup`/`--yes`.
- Policy provisioning merges HuJSON text (comments/trailing commas preserved) and validates remotely, backs up locally, writes with `If-Match`, and re-reads to verify.
- Cleanup matches the exact normalized hostname plus every wanted tag; devices without `lastSeen` are never considered offline.
- Ephemeral nodes cannot publish Funnel DNS; `funnel` refuses them and `funnel-app`/long-lived profiles default to non-ephemeral.
