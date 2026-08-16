# AGENTS.md

Agent guardrails and project conventions for `tailsacle-cli`.

## Project

`tailsacle-cli` is a safe, zero-config TypeScript CLI (ESM, Node >=22, strict) for real
Tailscale deployment workflows: join a node, provision the tailnet (tags/funnel/HTTPS)
when `--yes` is passed, configure Serve/Funnel, read DNS, guarded policy sync, and
guarded device cleanup. Published to the public npm registry; bins: `tailsacle-cli`, `tscli`.

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit (strict, exactOptionalPropertyTypes)
npm test            # vitest
npm run check       # typecheck + test  (must pass before commit)
npm run build       # tsc -p tsconfig.build.json -> dist/
npm run smoke       # build + run --help + agent-manifest
npm run pack:check  # build + npm pack --dry-run
```

Run `npm run check` and `npm run build` before every commit. Keep output JSON-safe and
mask secrets. Update `README.md`/`docs/` whenever flags, envelopes or defaults change.

## Versioning — REQUIRED (read carefully)

### Format: `1.YYMMDD.HHmm` (UTC, 24h)

Example: 2026-08-16 07:00 UTC → **`1.260816.700`** → tag `v1.260816.700`.

Mapping from the originally requested `1.YY.MMDD.HHmm`:

| Requested | Implemented | Why |
|---|---|---|
| `1` | `1` | major |
| `YY.MMDD` | `YYMMDD` (one group) | semver allows only 3 numeric dot-separated segments |
| `HHmm` | `HHmm` | zero-padded removed (e.g. `0700` → `700`) because numeric identifiers with leading zeroes are invalid semver |

**Critical:** the literal `1.YY.MMDD.HHmm` (e.g. `1.26.0816.0700`) is NOT valid semver.
`npm publish` auto-corrects it to garbage (`1.26.81-6.700`) and rejects it as a
prerelease. Do not use leading zeros in any numeric segment. Do not use a 4th dot segment.

The scheme is strictly monotonic: patch grows with `MMDD.HHmm`, so
`npm i tailsacle-cli` on any machine always resolves the newest published build.

### Rules

1. **Every change that alters the published artifact** (src, package.json, README, docs,
   workflows) bumps `package.json` `version` to the current UTC timestamp:
   ```bash
   date -u +%y%m%d.%H%M        # -> 260816.703 ; then zero-strip leading zeros of HHmm
   node -e "const v=require('./package.json'); v.version='1.'+require('child_process').execSync('date -u +%y%m%d').toString().trim()+'.'+require('child_process').execSync('date -u +%H%M').toString().trim().replace(/^0/,''); require('fs').writeFileSync('package.json', JSON.stringify(v,null,2)+'\n')"
   ```
2. Bump **before** committing; never commit a version already present on the registry
   (same `YYMMDD.HHmm` twice in one day only if the first was never published; otherwise
   use the current time so the patch strictly increases).
3. `src/cli.ts` reads the version from `package.json` at runtime — do not hardcode it.
4. Release = push a tag `v<version>` to `main` (must match the `v*.*.*` glob in
   `.github/workflows/release.yml`). The workflow publishes with npm provenance and
   authenticates via **Trusted Publisher (OIDC)**, configured on npmjs.com against
   `ongtrieuphuchieu689-7u/tailscale-cli` + workflow `release.yml` — no token secret used.
   The workflow must keep `permissions: id-token: write` and must NOT set
   `NODE_AUTH_TOKEN` (npm uses OIDC automatically; a dead token would break auth).
   `package.json` needs a `repository.url` matching `https://github.com/ongtrieuphuchieu689-7u/tailscale-cli`
   (missing `repository` fails provenance with E422).
5. **Acceptance condition after every release:** from a clean machine (or this one), run
   `npm i tailsacle-cli` (or `npm view tailsacle-cli version`) and confirm the installed
   version equals the published one. If `release.yml` failed (auth, secret missing,
   provenance), fix and re-push the tag (delete + re-tag, or bump time again).

## Tailscale connection (zero-config contract)

- Credential precedence: `TS_AUTH_KEY` > `TS_CLIENT_SECRET` trust credential
  (`tskey-client-…`, OAuth client ID is derived from it) > `TS_OAUTH_CLIENT_ID` +
  `TS_OAUTH_CLIENT_SECRET` > `TS_ACCESS_TOKEN` > `TS_API_KEY`.
- With `--yes`, `deploy`/`funnel` auto-provision whatever the tailnet lacks and always
  warn: missing `tagOwners` (owned by `autogroup:admin`), missing `funnel` node attribute,
  and tailnet HTTPS (`PATCH /tailnet/-/settings {"httpsEnabled":true}`, requires `all`
  scope). Every policy change is validated remotely, backed up and ETag-protected.
- `tailscale funnel` hangs when HTTPS is disabled — always enable HTTPS via the API
  **before** running the local `funnel` command.

## Guardrails (do not violate)

- Never log or persist raw secrets; always mask (`maskSecret`).
- Policy writes: fetch → diff → validate → backup → ETag → verify. Require confirmation
  (`--yes` or TTY).
- Cleanup deletes only exact offline matches (hostname/tag + threshold) after confirmation.
- Permission/scope failures are non-retryable: surface them, do not retry.
- Do not invent arbitrary tags; only auto-provision tags that were explicitly requested
  via `TS_TAGS`/config.
