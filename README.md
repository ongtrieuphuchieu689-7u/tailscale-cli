# tailsacle-cli

Safe TypeScript CLI for real Tailscale deployment workflows. Official binaries are `tailsacle-cli` and `tscli`.

## What it does

`tailsacle-cli` now provides a production-oriented local deployment path:

- resolves configuration and credentials without logging raw secrets;
- discovers the installed Tailscale binary and can explicitly update it;
- creates a Tailscale auth key through the API when `TS_AUTH_KEY` is not supplied;
- joins/configures the current machine with `tailscale up` and verifies `BackendState=Running`;
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
npx tailsacle-cli funnel 3000 --https 443 --path api --json
```

Funnel ports are validated before execution; supported public HTTPS ports are 443, 8443 and 10000.

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
| `TS_TAILNET` | Tailnet/domain used by API calls |
| `TS_HOSTNAME` | Node hostname |
| `TS_TAGS` | Comma-separated node tags without or with `tag:` prefix |
| `TS_PROFILE` | `ci`, `container`, `vm`, `windows`, `dev`, `funnel-app`, `subnet-router`, `exit-node` |
| `TS_SSH` | Enable SSH intent, default `true` |
| `TS_ACCEPT_DNS` | Accept DNS, default `true` |
| `TS_ACCEPT_ROUTES` | Accept subnet/exit routes when enabled by profile |
| `TS_EPHEMERAL` | Override ephemeral node behavior |
| `TS_REUSABLE` | Override auth-key reuse behavior |
| `TS_AUTH_KEY` | Pre-created node auth key |
| `TS_API_KEY` | Tailscale API key |
| `TS_ACCESS_TOKEN` | Bearer access token |
| `TS_OAUTH_CLIENT_ID` | OAuth client ID |
| `TS_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `TS_POLICY_FILE` | Default policy file path |
| `TS_CLEANUP_OFFLINE_AFTER` | Cleanup threshold in seconds; default 3600 |
| `TS_PROTECTED_DEVICES` | Comma-separated protected device IDs/names |
| `TS_TAILSCALE_BIN` | Explicit Tailscale binary path |
| `TS_UNATTENDED` | Windows unattended join intent |

Secrets are never returned raw by `doctor` and are not written to logs by the CLI.

## Development

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run pack:check
```

CI tests Linux and Windows on Node 22 and Node 24. Release publishing is tag-based and uses npm provenance.
