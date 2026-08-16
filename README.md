# tailsacle-cli

Safe TypeScript CLI for real Tailscale deployment workflows. Official binaries are `tailsacle-cli` and `tscli`.

## What it does

`tailsacle-cli` now provides a production-oriented local deployment path:

- resolves configuration and credentials without logging raw secrets;
- discovers the installed Tailscale binary and can explicitly update it;
- creates a Tailscale auth key through the API when `TS_AUTH_KEY` is not supplied;
- joins/configures the current machine with `tailscale up` and verifies `BackendState=Running`;
- auto-provisions the tailnet so a tagged deployment can connect: adds missing `tagOwners`, adds the `funnel` node attribute and enables tailnet HTTPS certificates when `--yes` is passed, each change is warned, validated, backed up and ETag-protected;
- configures private Serve or public Funnel exposures;
- reads tailnet DNS settings;
- performs guarded HuJSON policy validation/diff/write with backup, ETag and confirmation;
- finds and removes only exact matching offline devices after a confirmation gate;
- exposes stable JSON envelopes for automation and an agent manifest.

Policy and cleanup writes are intentionally guarded. Missing permissions and API failures are reported as failures; the CLI never claims a remote side effect it did not verify.

## Requirements

- Node.js 22 or newer
- Tailscale installed and available on `PATH` for `up`, `status`, Serve and Funnel
- For API-driven auth-key/policy/DNS/cleanup operations, one of:
  - `TS_API_KEY`
  - `TS_ACCESS_TOKEN`
  - `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET`
- Or `TS_AUTH_KEY` for a pre-created node auth key

## Install and run

```bash
npm install
npm run build
node dist/cli.js doctor --detect-credentials --json
node dist/cli.js status --json
```

The published package exposes both `tailsacle-cli` and `tscli`.

## GitHub Packages mirror (fast CI installs)

Every tag release is also published to GitHub Packages as
`@ongtrieuphuchieu689-7u/tailsacle-cli`. Installing it with a repo scoped token inside
GitHub Actions avoids the npmjs round-trip and is noticeably faster:

```yaml
- uses: actions/setup-node@v7
  with:
    node-version: 24
    registry-url: https://npm.pkg.github.com
- run: npm i -D @ongtrieuphuchieu689-7u/tailsacle-cli
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

For private packages, keep an `.npmrc` with `@ongtrieuphuchieu689-7u:registry=https://npm.pkg.github.com`
and token auth. `tailsacle-cli` on npmjs remains the canonical package; the scoped copy is
a fast mirror for CI only. GitHub Packages requires the token with `packages: read` scope.

## Common deployment

```bash
export TS_TAILNET='example.com'
export TS_HOSTNAME='web-01'
export TS_TAGS='prod,web'
export TS_API_KEY='...'

npx tailsacle-cli doctor --detect-credentials --json
npx tailsacle-cli deploy --json
```

For a pre-created auth key:

```bash
export TS_AUTH_KEY='tskey-auth-...'
npx tailsacle-cli up --json
```

Dry-run first when changing deployment intent:

```bash
npx tailsacle-cli deploy --dry-run --expose 3000 --json
```

## Serve and Funnel

```bash
npx tailsacle-cli serve 3000 --https 443 --path api --json
npx tailsacle-cli funnel 3000 --https 443 --path api --yes --json
```

Funnel ports are validated before execution; supported public HTTPS ports are 443, 8443 and 10000.

With `--yes`, `funnel` and `deploy` auto-provision what the tailnet is missing (tagged auth keys, `tagOwners`, the `funnel` node attribute, and tailnet HTTPS certificates) with warnings, so a trust credential can reach a working connection end to end.

## Policy

Policy sync is deliberately destructive-operation gated:

```bash
npx tailsacle-cli policy --file ./policy.hujson --dry-run --json
npx tailsacle-cli policy --file ./policy.hujson --sync --yes --json
```

The workflow fetches the current policy, shows a diff, validates the candidate HuJSON remotely, writes a local backup of the fetched policy, then performs an ETag-protected update and re-reads the policy to verify the write.

## Cleanup

```bash
npx tailsacle-cli cleanup --dry-run --json
npx tailsacle-cli cleanup --yes --json
```

Cleanup is restricted to devices that are offline beyond `TS_CLEANUP_OFFLINE_AFTER` and match the configured hostname/tag set. Protected device names can be supplied through `TS_PROTECTED_DEVICES`.

## Configuration

| Variable | Purpose |
|---|---|
| `TS_TAILNET` | Tailnet/domain used by API calls (custom non-`*.ts.net` domains warn; Funnel relies on a Tailscale-hosted domain) |
| `TS_HOSTNAME` | Node hostname |
| `TS_TAGS` | Comma-separated node tags without or with `tag:` prefix |
| `TS_PROFILE` | `ci`, `container`, `vm`, `windows`, `dev`, `funnel-app`, `subnet-router`, `exit-node` (`funnel-app` defaults to non-ephemeral) |
| `TS_SSH` | Enable SSH intent, default `true` |
| `TS_ACCEPT_DNS` | Accept DNS, default `true` |
| `TS_ACCEPT_ROUTES` | Accept subnet/exit routes when enabled by profile |
| `TS_PREAUTHORIZED` | Create pre-authorized auth keys, default `true` |
| `TS_KEY_EXPIRY` | Auth-key lifetime in seconds, `max` or `unlimited` (default `max`). `max`/`unlimited` use the documented 90-day ceiling — this is NOT an API-discovered maximum. Set `TS_KEY_EXPIRY=3600` to pin a shorter lifetime. This is the auth-key expiry, not the node key-expiry policy |
| `TS_EPHEMERAL` | Override ephemeral node behavior (ephemeral nodes cannot publish public Funnel DNS) |
| `TS_REUSABLE` | Override auth-key reuse behavior |
| `TS_TAG_BASE` | Base for the deterministic auto-tag when `TS_TAGS` is unset (`tag:<base>`; on CI the `GITHUB_REPOSITORY`/`GITLAB_PROJECT_PATH` is preferred) |
| `TS_AUTH_KEY` | Pre-created node auth key |
| `TS_API_KEY` | Tailscale API key |
| `TS_ACCESS_TOKEN` | Bearer access token |
| `TS_CLIENT_SECRET` | Tailscale OAuth trust credential (`tskey-client-…`); client ID is derived from it |
| `TS_CLIENT_ID` | OAuth client ID when the secret is not a self-describing trust credential |
| `TS_OAUTH_CLIENT_ID` | OAuth client ID (alternative to `TS_CLIENT_ID`) |
| `TS_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `TS_POLICY_FILE` | Default policy file path |
| `TS_CLEANUP_OFFLINE_AFTER` | Cleanup threshold in seconds; default 3600 |
| `TS_NO_CLEANUP` | `true`/`1` disables the automatic cleanup step at the end of a `--cleanup` deploy |
| `TS_TAG_OWNER` | Comma-separated owners used when auto-provisioning missing `tagOwners` (otherwise a single existing owner set is reused; mixed-owner policies require this or `--tag-owner`) |
| `TS_PROTECTED_DEVICES` | Comma-separated protected device IDs/names |
| `TS_BIN_DIR` | Binary cache directory for `update-bin`/auto-download |
| `TS_TAILSCALE_BIN` | Explicit Tailscale binary path |
| `TS_TAILSCALE_SOCKET` | Explicit path to the tailscaled Unix socket (default: `/var/run/tailscale/tailscaled.sock`) |
| `TS_TAILSCALE_SOCKET` | Socket path for a userspace tailscaled (default `/var/run/tailscale/tailscaled.sock`); when set, every local `tailscale` call passes `--socket=` |
| `TS_TAILSCALED_STATE` | State path for a userspace tailscaled (default `/var/lib/tailscale/tailscaled.state`) |
| `TS_CLI_YES` | `true`/`1` answers every confirmation like `--yes` (for embedded automation) |
| `TS_UNATTENDED` | Windows unattended join intent |

Any env var whose value starts with `tskey-client-` is auto-detected as an OAuth trust
credential; use `--credential-env <name>` to select one explicitly when several are
present. Secrets are never returned raw by `doctor` and are not written to logs; server
error text is scrubbed for `tskey-…` and `Authorization` material.

## Interactive menu and safety flags

Running `tailsacle-cli` with no arguments in a TTY opens an interactive menu that prompts
for the profile, target/port, policy action and binary update, then prints the equivalent
non-interactive command before executing it.

Safety scoping: `--yes` only skips confirmation prompts. Auto-provisioning side effects
are gated behind explicit flags so a plain `--yes` never quietly rewrites tailnet policy:

| Flag | Effect |
|---|---|
| `--apply-policy` | Allow HuJSON-preserving `tagOwners`/`nodeAttrs` provisioning (with plan + warning) |
| `--enable-https` | Allow enabling tailnet-wide HTTPS (required for Serve/Funnel) |
| `--key-expiry <value>` | Auth-key expiry for this run (`max`, `unlimited`, seconds; overrides `TS_KEY_EXPIRY`) |
| `--tag-owner <owner...>` | Owner(s) for auto-provisioned `tagOwners` (overrides `TS_TAG_OWNER`) |
| `--cleanup` | Run the exact-match offline device cleanup at the end of a deploy on **any** profile (auto-cleanup otherwise defaults to CI/container) |
| `--verify-timeout <sec>` | Funnel public-DNS propagation timeout (default 120s) |
| `funnel --tcp 10000:5432` | TCP Funnel instead of HTTPS (public endpoint is verified too) |
| `funnel --expose 443=3000 --expose 443/api=3001` | Multiple HTTPS Funnel targets/paths (all are reported in `resolved.exposures`) |
| `dns --enable-magicdns --yes` | Enable MagicDNS on the tailnet (post + read-after-write verify) |
| `update-bin --force --skip-checksum` | Force a fresh verified download; skip the SHA256 check (not recommended) |
| `daemon status` | Report the local tailscaled state and any userspace daemon tracked in the pidfile |
| `daemon stop` | Stop a userspace tailscaled started and tracked by this tool |

`funnel` refuses ephemeral nodes (they never publish public DNS), auto-detects the target
from `$PORT` when none is given, and verifies the public A record before reporting success.

With `deploy --funnel --yes`, the funnel node attribute is checked **before** the local
`funnel` command runs: it is auto-provisioned when `--apply-policy` is present, otherwise
the deploy fails fast with `FUNNEL_ATTR_REQUIRED`. Enable tailnet HTTPS for Funnel with
`--enable-https`; tailnet HTTPS is never enabled implicitly.

On Windows there is no portable binary: `update-bin`/auto-download resolve the MSI from the
stable index, verify its SHA256 and install it silently when running as Administrator;
without Administrator privileges the exact `msiexec /i "<cache>\…msi" /qn` command is
returned.

## Development

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run pack:check
npm run version:bump:verify   # bump version to now (Asia/Ho_Chi_Minh, 1.YYMMDD.1HHmm)
```

CI tests Linux and Windows on Node 22 and Node 24. Release publishing is tag-based: every
tag `v*.*.*` runs `release.yml`, which builds with cached node_modules on node24-runtime
actions, publishes to npmjs with npm provenance (Trusted Publisher OIDC) and mirrors the
package to GitHub Packages for fast CI installs. Versions use `1.YYMMDD.1HHmm`
(Asia/Ho_Chi_Minh, 24h), e.g. `1.260816.11417`.
