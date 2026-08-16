# Usage

Commands: `doctor`, `deploy`, `up`, `funnel`, `serve`, `dns`, `policy`, `status`, `cleanup`, `agent-manifest`.

Use `--json` for the stable envelope. `doctor --detect-credentials --json` has no side effects. `TS_PROFILE` supports ci, container, vm, windows, dev, funnel-app, subnet-router and exit-node. Defaults are SSH on, preauthorized on, accept-dns on, key expiry `max`, and cleanup threshold 60 minutes.

Policy writes and device deletion are guarded operations: candidate/diff, warning, backup, validation, ETag and confirmation are required. Missing permissions never become a fake success.
