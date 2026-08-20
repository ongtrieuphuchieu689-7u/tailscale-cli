# Usage

## First run

Run `tailsacle-cli doctor --detect-credentials --json` first. The command does not modify the tailnet or local Tailscale state; `doctor --deep` additionally runs read-only API probes (credentials, `devices:core`/`policy_file`/`dns`/`all` scopes, HTTPS, MagicDNS, funnel attribute readiness, daemon, root) with no side effects.

Running `tailsacle-cli` with no arguments in a TTY opens the interactive menu (profile, target/port, policy action, binary update) and prints the equivalent non-interactive command before executing it. When no credentials are found and the terminal is a TTY, the CLI prompts interactively for a `tskey-client-` trust credential.

## Configuration file

Place `tailscale-cli.config.json` in your project root or pass `--config <path>`. Config file values are used as defaults; environment variables always override:

```json
{
  "profile": "vm",
  "hostname": "web-01",
  "tags": ["prod", "web"],
  "keyExpiry": "max",
  "ephemeral": false,
  "credentialEnv": "CI_TAILSCALE_TRUST"
}
```

`credentialEnv` names the env var that holds the OAuth trust credential (the value itself
must come from the environment); it is the config-file equivalent of
`--credential-env`/`TS_CREDENTIAL_ENV` and selects the credential explicitly instead of
auto-detecting.

## Deployment

`deploy` resolves the runtime profile, uses an existing `TS_AUTH_KEY` or creates an auth key through the Tailscale API (auto-detecting an OAuth trust credential in any `tskey-client-…` env var, or the one named by `--credential-env`), runs `tailscale up`, verifies a Running backend, and can configure Serve/Funnel exposures.

- `--dry-run` inspects the resolved deployment plan without joining the tailnet.
- `--expose <target>` repeatable: a local port/URL (`3000`, `localhost:8080`, `http://…`), or a public-port mapping `PUBLIC=LOCAL` with an optional `#path` (`443=8443`, `443=3000#/api`, `8443=3001`) for Funnel — `PUBLIC` must be 443/8443/10000 when `--funnel` is set.
- `--apply-policy` allows HuJSON-preserving `tagOwners`/`nodeAttrs` provisioning (never with plain `--yes` alone).
- `--enable-https` allows enabling tailnet-wide HTTPS for Funnel exposures (HTTPS is never enabled implicitly).
- `--key-expiry <value>` overrides the auth-key lifetime for this run (`max`/`unlimited` map to the documented 90-day ceiling; seconds are passed through verbatim, clamped with a `KEY_EXPIRY_CLAMPED` warning when above the ceiling).
- `--tag-owner <owner...>` sets the owner(s) for auto-provisioned `tagOwners`; mixed-owner policies without it fail with `POLICY_TAG_OWNER_REQUIRED` instead of guessing.
- `--cleanup` prunes exact-match offline devices for the deployment at the end on **any** profile (without the flag, no cleanup runs anywhere; `TS_NO_CLEANUP=1` still disables it).
- With `deploy --funnel`, the funnel node attribute is verified **before** the local `funnel` command runs: auto-provisioned when `--apply-policy` is present, otherwise the deploy fails fast with `FUNNEL_ATTR_REQUIRED`.
- When `TS_TAGS` is unset and the profile is not `dev`, a deterministic tag is used: `TS_TAG_BASE`, else the CI repository path, else `tailsacle-cli`/hostname.
- Missing Tailscale binaries are auto-downloaded (SHA256-verified) into the cache; `update-bin` downloads the latest stable build there and never overwrites package-managed binaries. On Windows the MSI is downloaded, checksummed and installed silently when running as Administrator (otherwise the exact `msiexec /i … /qn` command is returned).

## Guarded operations

Policy writes require a fetched remote policy, diff, remote validation, local backup, ETag-protected write and a final confirmation. Provisioning merges into the existing HuJSON text so comments and trailing commas are preserved (`policy.hujson` sync writes the file verbatim). Device cleanup requires an exact hostname/tag match (never substring), devices without `lastSeen` are never treated as offline, and cleanup permission failures are non-fatal in deploy. In CI/non-TTY environments use `--yes` explicitly.

## Funnel, Serve, TCP Relay and DNS

- `funnel` refuses ephemeral nodes (they never publish public DNS), auto-detects the target from `$PORT`, supports `--tcp <public:local>` and repeatable `--expose 443=3000 --expose 443/api=3001`, and verifies the public A record (dns.google + cloudflare-dns.com + getent) **and the live endpoint** up to `--verify-timeout` (default 120s) before reporting the public URL: HTTPS funnels are probed with a TLS handshake + HTTP request per public port (`tlsVerified`/`tlsVerifiedPorts`), TCP funnels with a raw TCP connect (`tcpVerified`). DNS alone is never reported as success; an unreachable endpoint fails with `FUNNEL_ENDPOINT_UNREACHABLE`.
- `serve` shares a local or remote target inside the tailnet (e.g. `tailsacle-cli serve --tcp 5432 tcp://100.x.y.z:5432`).
- `relay` runs a high-performance, full-duplex TCP relay proxy to forward connections across machines. Supports single target (`-l 5432 -t 192.168.50.79:5433`), multi-port mapping (`--target-host 192.168.50.79 --map 5432:5432 --map 5433:5433`), and JSON configuration files (`--file relays.json`) for running as a persistent background service. It optionally accepts `--serve` to automatically configure Tailscale Serve for the listening port in the tailnet, and `--funnel` to expose it publicly.
- `relay-mcp-postgres` runs the same TCP relays but additionally spawns a [nexql-mcp](https://www.npmjs.com/package/nexql-mcp) HTTP MCP server that exposes **every database** on the relayed PostgreSQL instance — the agent picks a database at runtime via `setup_connection`/`run_select`, so you do not need one MCP config per database.
  ```bash
  # Relay local :15433 -> Postgres 192.168.50.79:5433, MCP HTTP on :8787
  PGPASSWORD=*** tailsacle-cli relay-mcp-postgres \
    --map 15433:192.168.50.79:5433 --map 15434:192.168.50.79:5434 \
    --mcp-port 8787 --token "$MCP_TOKEN" --database postgres
  ```
  Secrets never appear in argv/process listings: the DB password travels via `--password`/`PGPASSWORD`/`TS_PGPASSWORD` into the child's `PGPASSWORD` env, and the MCP bearer token via `NEXQL_MCP_HTTP_TOKEN` (or `--token`). Output masks both (`mcpToken`, `connectionString`). An ephemeral token is auto-generated when none is provided. The command **keeps the MCP server alive even when the PostgreSQL machine is down or not yet booted**: a supervisor spawns nexql-mcp and respawns it every `--db-retry-interval` ms (default 5000) until the database accepts connections; if the DB dies mid-flight and comes back, the MCP endpoint recovers automatically. `nexql-mcp` itself exits when the database is unreachable, so the supervisor only reports readiness once a real connection succeeds. **Important:** `setup_connection` can only target ports that are already relayed via `--map`/`--file`/`--listen` — the agent cannot open new relay ports at runtime; declare every port it may need up front. A pidfile (`nexql-mcp.pid.json` in the binary cache) tracks the spawned server; `SIGINT`/`SIGTERM` stops it, and connection strings/pidfile commands are masked.
- `dns --enable-magicdns --yes` enables MagicDNS on the tailnet; `dns --enable-magicdns --dry-run` previews the action without applying; plain `dns` reads nameservers/preferences/search paths.
- Custom `TS_TAILNET` domains (not `*.ts.net`) emit a warning because Funnel DNS and HTTPS rely on a Tailscale-hosted domain.

## Daemon lifecycle

`daemon status` reports the local tailscaled state and any userspace daemon this tool started (tracked via a pidfile in the binary cache). `daemon stop` sends SIGTERM (then SIGKILL) to a tracked userspace tailscaled process; it will not stop system-managed daemons.

- The socket path defaults to `TS_TAILSCALE_SOCKET` or `/var/run/tailscale/tailscaled.sock`.
- When running as root, the daemon is started directly; otherwise a `sudo` invocation is attempted with a clear warning when it fails.
- The pidfile is only written when the CLI itself spawns the daemon; existing tailscaled instances started by systemd or manual commands are not tracked.

## Service management (`service`)

Runs a relay (or any Node script) as a background service: **systemd** on Linux (system unit with `sudo`, or rootless `--user` unit) and **Windows SCM** (WinSW via `node-windows`) or **Windows Task Scheduler** (`--scheduler`, no admin required).

```bash
# 1. Generate a sample config (JSONC with comments)
tailsacle-cli service init --name tailsacle-relay --out .tailsacle-service.jsonc

# 2. Edit args/env/restart, then install:
#    Linux system service (sudo) | rootless user service | Windows SCM | Task Scheduler
sudo tailsacle-cli service install --file .tailsacle-service.jsonc --yes
tailsacle-cli service install --file .tailsacle-service.jsonc --user --yes   # Linux rootless
tailsacle-cli service install --file .tailsacle-service.jsonc --yes           # Windows (admin)
tailsacle-cli service install --file .tailsacle-service.jsonc --scheduler --yes  # Windows, no admin

# 3. Manage
tailsacle-cli service status --name tailsacle-relay --json
tailsacle-cli service logs --name tailsacle-relay --follow
tailsacle-cli service start|stop|restart --name tailsacle-relay
tailsacle-cli service list
tailsacle-cli service uninstall --name tailsacle-relay --yes
```

Notes:

- Config is JSON/JSONC (comments + trailing commas supported). `args` example: `["relay", "--file", "./relays.jsonc"]` for multi-port relay daemons.
- Linux `--user` services need `loginctl enable-linger <user>` to auto-start on boot — the CLI warns when it is missing.
- Linux system services require root (`SERVICE_REQUIRES_ADMIN`); Windows SCM requires an elevated terminal (Administrator). `--scheduler` on Windows needs no admin but only starts after login (Task Scheduler, weaker crash-restart than SCM).
- Env values that look like secrets (`tskey-`, `secret`, `token`, `password`, `api_key`, `credential`) are masked as `****` in logs.
- Errors: `SERVICE_NAME_INVALID`, `SERVICE_CONFIG_MISSING_FIELD`, `SERVICE_WORKDIR_NOT_FOUND`, `SERVICE_SCRIPT_NOT_FOUND`, `SERVICE_CONFIG_NOT_FOUND`, `SERVICE_ALREADY_EXISTS`, `SERVICE_NOT_FOUND`, `SERVICE_PLATFORM_UNSUPPORTED`, `SERVICE_SYSTEMCTL_FAILED`, `SERVICE_WINDOWS_NATIVE_REQUIRED`, `SERVICE_CONFIRMATION_REQUIRED`.

## Automation

Pass `--json` to commands that support stable JSON output. Every envelope carries `ok`, `command`, `durationMs`, `resolved`, `warnings`, `requiredPrivileges`, `sideEffects`, `retryable` and `error`. Errors include a `docsUrl` linking to relevant documentation. The `status --show-resolution` flag includes credential source and masked value in the resolved output. The versioned `agent-manifest` contract (`manifestVersion: 2`) describes per-tool inputs/outputs, scopes, privileges, side effects, retryability, confirmation requirements and warning codes. Exit codes: `1` general, `3` credential, `4` permission/scope, `5` binary, `6` local Tailscale, `7` funnel/DNS, `8` policy, `9` privilege, `75` retryable. Secrets are masked and server error text is scrubbed (`tskey-…`, `Authorization`) before surfacing.
