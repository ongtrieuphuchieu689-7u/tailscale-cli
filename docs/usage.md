# Usage

## First run

Run `tailsacle-cli doctor --detect-credentials --json` first. The command does not modify the tailnet or local Tailscale state.

## Deployment

`deploy` resolves the runtime profile, uses an existing `TS_AUTH_KEY` or creates an auth key through the Tailscale API, runs `tailscale up`, verifies a Running backend, and can configure Serve/Funnel exposures.

Use `--dry-run` to inspect the resolved deployment plan without joining the tailnet.

## Guarded operations

Policy writes require a fetched remote policy, diff, remote validation, local backup, ETag-protected write and a final confirmation. Device cleanup requires an exact candidate set and confirmation. In CI/non-TTY environments use `--yes` explicitly.

## Automation

Pass `--json` to commands that support stable JSON output. The `agent-manifest` contract lists available commands and safety rules. Secrets are masked and never returned raw.
