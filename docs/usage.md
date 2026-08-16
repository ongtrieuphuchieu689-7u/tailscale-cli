# Usage

## First run

Run `tailsacle-cli doctor --detect-credentials --json` first. The command does not modify the tailnet or local Tailscale state.

Running `tailsacle-cli` with no arguments in a TTY opens the interactive menu (profile, target/port, policy action, binary update) and prints the equivalent non-interactive command before executing it.

## Deployment

`deploy` resolves the runtime profile, uses an existing `TS_AUTH_KEY` or creates an auth key through the Tailscale API (auto-detecting an OAuth trust credential in any `tskey-client-…` env var, or the one named by `--credential-env`), runs `tailscale up`, verifies a Running backend, and can configure Serve/Funnel exposures.

- `--dry-run` inspects the resolved deployment plan without joining the tailnet.
- `--apply-policy` allows HuJSON-preserving `tagOwners` provisioning (never with plain `--yes` alone).
- `--enable-https` allows enabling tailnet-wide HTTPS for Funnel exposures.
- `--cleanup` prunes exact-match offline devices for the deployment at the end (ci/container profiles; disable with `TS_NO_CLEANUP=1`).
- When `TS_TAGS` is unset and the profile is not `dev`, a deterministic tag is used: `TS_TAG_BASE`, else the CI repository path, else `tailsacle-cli`/hostname.
- Missing Tailscale binaries are auto-downloaded (SHA256-verified) into the cache; `update-bin` downloads the latest stable build there and never overwrites package-managed binaries.

## Guarded operations

Policy writes require a fetched remote policy, diff, remote validation, local backup, ETag-protected write and a final confirmation. Provisioning merges into the existing HuJSON text so comments and trailing commas are preserved (`policy.hujson` sync writes the file verbatim). Device cleanup requires an exact hostname/tag match (never substring), devices without `lastSeen` are never treated as offline, and cleanup permission failures are non-fatal in deploy. In CI/non-TTY environments use `--yes` explicitly.

## Funnel and DNS

- `funnel` refuses ephemeral nodes (they never publish public DNS), auto-detects the target from `$PORT`, supports `--tcp <public:local>` and repeatable `--expose 443=3000 --expose 443/api=3001`, and verifies the public A record (dns.google + getent) up to `--verify-timeout` (default 120s) before reporting the public URL.
- `dns --enable-magicdns --yes` enables MagicDNS on the tailnet; plain `dns` reads nameservers/preferences/search paths.
- Custom `TS_TAILNET` domains (not `*.ts.net`) emit a warning because Funnel DNS and HTTPS rely on a Tailscale-hosted domain.

## Automation

Pass `--json` to commands that support stable JSON output. Every envelope carries `ok`, `command`, `durationMs`, `resolved`, `warnings`, `requiredPrivileges`, `sideEffects`, `retryable` and `error`. The versioned `agent-manifest` contract (`manifestVersion: 2`) describes per-tool inputs/outputs, scopes, privileges, side effects, retryability, confirmation requirements and warning codes. Exit codes: `1` general, `3` credential, `4` permission/scope, `5` binary, `6` local Tailscale, `7` funnel/DNS, `8` policy, `9` privilege, `75` retryable. Secrets are masked and server error text is scrubbed (`tskey-…`, `Authorization`) before surfacing.
