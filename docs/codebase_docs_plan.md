# Codebase-aligned docs and package deliverables

> Addendum bắt buộc cho [`implementation_plan.md`](./implementation_plan.md). Agents không được chỉ viết tài liệu mẫu: mọi tài liệu dưới đây phải phản ánh code, command, schema và scripts thực tế trong repository.

## 1. Quy tắc đồng bộ docs với code

- Mọi command được ghi trong docs phải tồn tại trong `src/commands/` và được đăng ký trong `src/cli.ts`.
- Mọi flag/env được ghi trong docs phải có type/schema trong `src/core/` và test resolve tương ứng.
- Mọi JSON example phải validate được bằng schema thật hoặc được đánh dấu rõ là pseudocode.
- Mọi `npm run ...` trong docs phải tồn tại trong `package.json` và chạy được trên Node 22/24.
- Mọi đường dẫn file trong docs phải tồn tại sau khi phase tương ứng hoàn thành.
- Không ghi capability chưa implement như đã hoạt động; dùng nhãn `planned` hoặc `not implemented`.
- Khi code thay đổi command/flag/output, phải cập nhật docs cùng commit.

## 2. Files phải triển khai trong codebase

### Root files

```text
package.json
package-lock.json
README.md
LICENSE
.gitignore
.editorconfig
.prettierignore
.prettierrc.json
.eslintrc.cjs hoặc eslint.config.js
vitest.config.ts
tsconfig.json
tsconfig.build.json
.nvmrc hoặc .node-version
```

### VS Code files

```text
.vscode/settings.json
.vscode/extensions.json
.vscode/launch.json
.vscode/tasks.json
```

### Source files

```text
src/cli.ts
src/index.ts
src/types.ts
src/commands/deploy.command.ts
src/commands/doctor.command.ts
src/commands/up.command.ts
src/commands/funnel.command.ts
src/commands/serve.command.ts
src/commands/dns.command.ts
src/commands/policy.command.ts
src/commands/status.command.ts
src/commands/cleanup.command.ts
src/commands/update-bin.command.ts
```

### Tests

```text
tests/unit/config-resolver.test.ts
tests/unit/credential-resolver.test.ts
tests/unit/redaction.test.ts
tests/unit/profile-detector.test.ts
tests/unit/port-detector.test.ts
tests/unit/manifest.test.ts
tests/integration/cli-help.test.ts
tests/integration/json-envelope.test.ts
tests/integration/non-tty-no-prompt.test.ts
tests/fixtures/config/minimal.json
tests/fixtures/policy/minimal.hujson
```

## 3. `package.json` contract

The implementation must ship a runnable package, not only a plan. Minimum contract:

```json
{
  "name": "tailsacle-cli",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": {
    "tailsacle-cli": "./dist/cli.js",
    "tscli": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE", "docs"],
  "scripts": {
    "dev": "tsx src/cli.ts",
    "dev:menu": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:types": "tsd",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm run test",
    "clean": "rimraf dist coverage",
    "pack:check": "npm run build && npm pack --dry-run",
    "smoke": "npm run build && node dist/cli.js --help && node dist/cli.js agent-manifest --json",
    "prepublishOnly": "npm run check && npm run pack:check"
  }
}
```

Required dependency policy:

- Runtime: `commander`, `@inquirer/prompts`, `zod`, `pino` and the selected HuJSON adapter.
- Development: `typescript`, `tsx`, `@types/node`, `vitest`, `@vitest/coverage-v8`, `eslint`, `typescript-eslint`, `prettier`, `tsd`, `rimraf`.
- Pin versions through lockfile. No install script may download or execute Tailscale during `npm install`.
- `npm run smoke` must work without credentials and must not perform network writes.

## 4. Documentation set to implement from the code

### `README.md`

Must contain: what the package does, supported OS/runtime, install, 30-second zero-config quickstart, bin aliases, command table, credential resolution, security warning, profile behavior, links to detailed docs, development commands, troubleshooting, and current limitations.

The quickstart must use safe dry-run first:

```bash
npx tscli doctor --detect-credentials --json
npx tscli deploy --dry-run --json
npx tscli deploy --yes
```

### `docs/usage.md`

Must contain: interactive menu, every command/flag, precedence rules, all supported env names, JSON envelope, warning codes, exit codes, examples for CI/container/VM/Windows, multi-port/path expose syntax, cleanup controls, and `--credential-env` behavior.

### `docs/deploy.md`

Must contain the exact deploy pipeline implemented by `deploy.command.ts`: doctor → binary → daemon → policy diff/write → auth key → join → DNS → Serve/Funnel → verify → cleanup. Document side effects and required scopes/privileges per step.

### `docs/development.md`

Must contain: Node version, install, scripts, project layout, TypeScript/ESM rules, VS Code setup, test strategy, mocking boundaries, how to add a command/flag/env, release/pack checks, and secret-handling rules.

### `docs/agent.md`

Must contain: `agent-manifest --json` contract, tool schemas, mandatory first call, JSON-only operation, retry policy, confirmation gates, side effects, warning handling, and idempotence rules.

### `docs/security.md`

Must contain: secret redaction, environment scanning constraints, token memory-only cache, auth-key handling, policy write warnings/backups, cleanup deletion safeguards, and no-secret npm artifact check.

### `docs/troubleshooting.md`

Must map error codes to remediation: credential format/auth, missing scopes, binary download/checksum, daemon privileges, Funnel prerequisites, DNS/TLS verification, policy ETag conflicts, and cleanup skipped.

### Existing requirement docs

`docs/user_requirement.md`, `docs/user_requirement_addendum_2026-08-16.md`, and `docs/implementation_plan.md` remain source-of-truth requirements/plans. They must link to these implementation-facing docs and must not claim unimplemented behavior.

## 5. Agent implementation order

1. Create root config and `package.json`; run `npm install`, `npm run typecheck`, `npm run smoke`.
2. Implement `src/types.ts`, schemas, exit codes, envelope and redaction.
3. Implement CLI registration and `--help`, then menu only when `process.stdin.isTTY && process.stdout.isTTY`.
4. Implement credential resolver and `doctor` with no side effects.
5. Implement binary/runtime adapters.
6. Implement API/policy adapters with dry-run/diff/backup/validate/ETag.
7. Implement profiles, `up`, DNS, Serve/Funnel, verify and cleanup.
8. Implement agent manifest and all JSON schemas.
9. Write/update docs from actual `--help`, manifest and test fixtures.
10. Run `npm run check`, `npm run smoke`, `npm pack --dry-run`, and OS matrix before merge.

## 6. Merge gate

A PR is not complete unless:

- `npm ci` works on Node 22 and 24 on Linux and Windows.
- `npm run check` passes.
- Both `tailsacle-cli --help` and `tscli --help` work after `npm pack` install.
- `README.md`, `docs/usage.md`, `docs/deploy.md`, `docs/development.md`, `docs/agent.md`, `docs/security.md`, and `docs/troubleshooting.md` match the current code.
- No secret appears in logs, snapshots, fixtures, build output or npm tarball.
- Non-TTY commands never hang waiting for menu input.
- Policy writes and deletions are guarded as specified.
- Any deviation is documented in an ADR and linked from the PR.
