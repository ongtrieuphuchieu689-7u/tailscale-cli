# Deploying a node

`deploy` (alias `up`) joins a node, can create a tagged auth key through the API, configures
Serve/Funnel, and can run guarded cleanup. Everything below is also reflected by
`agent-manifest`.

## 1. Credential and tag plan

Credential precedence (highest first): `TS_AUTH_KEY` → OAuth trust credential
(`TS_CLIENT_SECRET` or any `tskey-client-…` env var, selected with `--credential-env`) →
OAuth client pair (`TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET`) → `TS_ACCESS_TOKEN`
/`TS_API_TOKEN` → `TS_API_KEY`. `doctor --detect-credentials` prints the resolved source
(masked) with `auth.kind`.

Tags:

- Set `TS_TAGS` explicitly for reproducible ownership.
- Without `TS_TAGS` (non-`dev` profiles) a deterministic tag is derived
  (`TS_TAG_BASE` → CI repo path → `tailsacle-cli`/hostname) and a loud `AUTO_TAG` warning
  is emitted.
- Auto-provisioning missing `tagOwners` happens only with `--apply-policy`. The owner is
  taken from a single existing owner set, or from `--tag-owner`/`TS_TAG_OWNER`. A policy
  with no `tagOwners` or with mixed owners fails with `POLICY_TAG_OWNER_REQUIRED` instead of
  silently assuming `autogroup:admin`.

## 2. Funnel in deploy

`deploy --funnel --yes` **pre-verifies** the funnel node attribute before the local
`funnel` command runs:

- Policy read fails on scope (`policy_file:read` absent) → warning `FUNNEL_ATTR_UNVERIFIABLE`,
  deploy continues and relies on the local error.
- Attribute missing and `--apply-policy` present → HuJSON-preserving `nodeAttrs` write
  (validated, pre-merge backup, ETag) then funnel retries with backoff.
- Attribute missing and no `--apply-policy` → fails fast with `FUNNEL_ATTR_REQUIRED`.

Tailnet HTTPS is only enabled when `--enable-https` is passed (it is never implicit).
Ports are restricted to 443/8443/10000.

## 3. Auth-key expiry

`resolveKeyExpiry` accepts `max`, `unlimited` and positive seconds. `max`/`unlimited` map to
the **documented 90-day ceiling** — there is no API endpoint that reports the real server
limit, so the CLI states the ceiling and warns. Override per run with
`deploy --key-expiry 3600` or `TS_KEY_EXPIRY`.

## 4. Cleanup

- Explicit `deploy --cleanup` runs the exact-match offline-device pruning on **every**
  profile (`TS_NO_CLEANUP=1` still disables it).
- Without `--cleanup`, no cleanup runs anywhere.
- Criteria: offline longer than `TS_CLEANUP_OFFLINE_AFTER` (default 3600s), exact
  hostname + tag set match, never protected (`TS_PROTECTED_DEVICES`), never a node without
  `lastSeen`.

## 5. Binary and daemon

- Linux: SHA256-verified tarball into `TS_BIN_DIR`/cache, versioned file + symlink, download
  lock (`.download.lock`), never overwrites package-managed binaries. `update-bin` refreshes
  it; `--skip-checksum` is warned as unsafe.
- Windows: the MSI is resolved from the stable index, checksummed and installed silently when
  running as Administrator; otherwise the exact `msiexec /i "<cache>\…msi" /qn` command is
  returned. There is no portable Windows binary.
- Daemon: `systemd` → `sudo systemctl enable --now tailscaled` → userspace fallback
  (`tailscaled --tun=userspace-networking --state=… --socket=…`). Userspace start is skipped
  under CI; set `TS_TAILSCALE_SOCKET`/`TS_TAILSCALED_STATE` to relocate the socket/state.

## 6. Verification

```bash
node dist/cli.js doctor --deep --json            # read-only capability probes
node dist/cli.js deploy --dry-run --json          # plan without joining
node dist/cli.js dns --json                       # read tailnet DNS
```