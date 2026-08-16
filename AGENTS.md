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
npm run version:bump:verify   # bump version to now (VN time), check > published
```

Run `npm run check` and `npm run build` before every commit. Keep output JSON-safe and
mask secrets. Update `README.md`/`docs/` whenever flags, envelopes or defaults change.

## Versioning — REQUIRED (read carefully)

### Format: `1.YYMMDD.1HHmm` (Asia/Ho_Chi_Minh, 24h)

Example: 2026-08-16 14:17 ICT → **`1.260816.11417`** → tag `v1.260816.11417`.

The leading `1` before `HHmm` makes the 5-digit patch never start with zero and grow with
every minute of the day; `YYMMDD` grows daily. The scheme is strictly monotonic, so
`npm i tailsacle-cli` always resolves the newest published build.

**Always use the script, never hand-edit `package.json`:**

```bash
npm run version:bump          # sets version to current VN time; errors if not increasing
npm run version:bump:verify   # also asserts the pending version is > latest published on npmjs
```

History / mapping from the originally requested `1.YY.MMDD.HHmm`:

| Requested | Implemented | Why |
|---|---|---|
| `1` | `1` | major |
| `YY.MMDD` | `YYMMDD` (one group) | semver allows only 3 numeric dot-separated segments |
| `HHmm` | `1HHmm` (e.g. `0708` → `10708`) | numeric identifiers with leading zeroes are invalid semver; the `1` prefix keeps the patch 5 digits and strictly increasing |

**Critical:** the literal `1.YY.MMDD.HHmm` (e.g. `1.26.0816.0700`) is NOT valid semver;
`npm publish` auto-corrects it to garbage (`1.26.81-6.700`) and rejects it as a prerelease.
Never use leading zeros in any numeric segment, never a 4th dot segment. The old
`1.YYMMDD.HHmm` (UTC, zero-stripped, e.g. `1.260816.708`) is deprecated but remains on the
registry; the `1HHmm` form is always higher.

### Rules

1. **Every change that alters the published artifact** (src, package.json, README, docs,
   workflows) bumps `package.json` `version` via `npm run version:bump:verify` **before**
   committing and pushing.
2. Never commit a version already on the registry. The script errors if you retry within
   the same VN minute (time must strictly increase).
3. `src/cli.ts` reads the version from `package.json` at runtime — do not hardcode it.
4. Release = push a tag `v<version>` to `main` (must match the `v*.*.*` glob in
   `.github/workflows/release.yml`). The workflow runs on node24-runtime actions
   (`checkout@v7`, `setup-node@v7`, `cache@v6`):
   - `publish` job → npmjs with provenance via **Trusted Publisher (OIDC)** (configured on
     npmjs.com for `ongtrieuphuchieu689-7u/tailscale-cli` + workflow `release.yml`). Keep
     `permissions: id-token: write`, keep `NODE_AUTH_TOKEN` unset, and do NOT set
     `registry-url` on `setup-node` — it writes a placeholder `_authToken` into `.npmrc`
     and short-circuits the OIDC handshake. `package.json` needs a `repository.url`
     matching `https://github.com/ongtrieuphuchieu689-7u/tailscale-cli` (missing →
     E422 provenance failure).
   - `publish-github-packages` job (runs after a successful npmjs publish) publishes a
     scoped mirror `@ongtrieuphuchieu689-7u/tailsacle-cli` to GitHub Packages
     (`npm.pkg.github.com`) using `secrets.GITHUB_TOKEN` with permission `packages: write`,
     through `scripts/publish-github.mjs`. This is a fast-install mirror for CI, not the
     canonical package.
5. **Acceptance condition after every release:** from a clean machine (or this one) run
   `npm i tailsacle-cli` (or `npm view tailsacle-cli version`) and confirm the installed
   version equals the published one; also confirm `npm view @ongtrieuphuchieu689-7u/tailsacle-cli
   --registry=https://npm.pkg.github.com version` returns the same version (needs a token
   for private packages). If any job failed, fix and re-push the tag (delete + re-tag, or
   `npm run version:bump:verify` for a fresh timestamp).

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
