# Implementation plan — tailsacle-cli / tscli

> Kế hoạch triển khai chính thức cho `user_requirement`. Cập nhật: 2026-08-16.

## 1. Audit xung đột requirements

### Cần chốt thành quy tắc triển khai

| Requirement A | Requirement B | Kết luận bắt buộc |
| --- | --- | --- |
| "Phải chạy được, tự cấu hình" | Policy file thay đổi toàn tailnet, xoá device là destructive | Tự động resolve và chuẩn bị patch được; ghi policy/xoá device phải có warning, diff, backup và confirmation theo chế độ chạy. Không âm thầm xoá/ghi. |
| `--ssh=true` mặc định | SSH cần policy/permission phù hợp | Mặc định bật intent SSH; nếu policy không cho phép thì warning + patch đề xuất, không giả vờ SSH đã hoạt động. |
| `--key-expiry=max` | Auth-key expiry khác node-key expiry; server có thể giới hạn | Gửi giá trị lớn nhất API chấp nhận; không hard-code “vĩnh viễn”, không hứa disable node key expiry. |
| "ít cấu hình, quyền nhiều nhất" | OAuth least privilege và secret safety | Auto-resolve nhiều nhất có thể, nhưng chỉ yêu cầu scope theo feature; không log/lưu secret và không tự cấp quyền hệ điều hành. |
| Binary có sẵn thì dùng | Cần Funnel/Serve mới yêu cầu version đủ mới | Dùng binary hiện tại nếu đạt capability/version tối thiểu; nếu thiếu capability thì fail có hướng dẫn hoặc chỉ tải khi thiếu. Chỉ `--update-bin` mới thay bản đang có. |
| Cleanup offline > 60 phút tự động | Xoá device là destructive | Tự động tìm và đề xuất candidate; TTY hỏi xác nhận, CI chỉ xoá khi `--yes`/`TS_CLI_YES=true`; thiếu scope thì join vẫn thành công, cleanup skipped. |
| `tailsacle-cli` và `tscli` | Tài liệu trước dùng `tailscale-cli` | Public bin chính thức là `tailsacle-cli` và `tscli`. Không tự thêm alias thứ ba. |
| Funnel nhiều port/path/TCP | Tailscale Funnel có giới hạn/cú pháp riêng | Parse/validate trước, map từng exposure thành lệnh Tailscale hợp lệ; không hứa TCP nếu binary/account không hỗ trợ. |
| "tất cả env tự xử lý" | Nhiều credential match có thể là nhiều tailnet | Một match thì auto dùng; nhiều match trong non-interactive phải fail yêu cầu `--credential-env`, không chọn bừa. |

### Những điều không được suy diễn

- Không hỗ trợ macOS, OIDC workload identity, custom domain, rename tailnet, split-DNS/custom nameserver trong v1.
- Không coi chuỗi `tskey-client-*` là cặp client ID/secret nếu token endpoint/API adapter không xác thực được format; trả `CREDENTIAL_FORMAT_UNSUPPORTED`.
- Không dùng `JSON.parse` để rewrite policy HuJSON.

## 2. Stack được chọn

- Runtime: **Node.js 24 Active LTS**; hỗ trợ Node 22 Maintenance LTS nếu không dùng API riêng của 24. Khai báo `engines.node >=22`.
- Language: **TypeScript 6.x**, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Module: ESM-first, `module: NodeNext`, `moduleResolution: NodeNext`; `package.json` có `type: module`, `exports`, `types`, `bin`.
- CLI parser: **Commander 15** vì phổ biến, type support tốt, ESM phù hợp. Không tự xây parser.
- Interactive menu: **@inquirer/prompts** vì API hiện đại, TypeScript-friendly, hỗ trợ input/select/confirm/checkbox và dễ bỏ qua khi non-TTY.
- Validation: **Zod** cho config/env/manifest schema.
- HTTP: native `fetch` + `AbortSignal.timeout`, không thêm client nặng nếu không cần.
- Logging: **pino** cho JSON logs, pretty transport chỉ ở dev/TTY; secret redaction bắt buộc.
- HuJSON: thư viện HuJSON tương thích Tailscale, bọc trong `PolicyDocument` adapter; không để parser rò ra toàn codebase.
- Tests: Vitest unit/integration; `tsd` cho public type declarations; Playwright không cần cho CLI.
- Quality: ESLint flat config + typescript-eslint, Prettier, c8/Vitest coverage.

Tham khảo: [TypeScript](https://www.npmjs.com/package/typescript) · [Commander](https://github.com/tj/commander.js) · [Node TypeScript modules](https://nodejs.org/docs/latest/api/typescript.html) · [Node release schedule](https://github.com/nodejs/release/blob/main/schedule.json).

## 3. Cấu trúc repository bắt buộc

```text
src/
  cli.ts
  commands/{deploy,doctor,up,funnel,serve,dns,policy,status,cleanup,update-bin}.command.ts
  core/{config-resolver,environment,errors,exit-codes,logger,redaction}.ts
  credentials/{credential-resolver,oauth-client,scope-checker}.ts
  tailscale/{api-client,auth-key,device-client,local-cli,capabilities}.ts
  binary/{binary-manager,download,checksum,platform}.ts
  policy/{hujson-policy,policy-diff,policy-patch,policy-backup}.ts
  runtime/{profile-detector,privilege-detector,daemon-manager,port-detector}.ts
  menu/{interactive-menu,menu-actions}.ts
  agent/{manifest,schemas,envelope}.ts
  index.ts
  types.ts
tests/{unit,integration,fixtures}/
docs/{user_requirement.md,user_requirement_addendum_2026-08-16.md,implementation_plan.md}
```

## 4. Phase plan

### Phase 0: contract freeze

- Chuyển requirements thành JSON schemas/types.
- Chốt command names, bin aliases, precedence, exit codes, warning codes.
- Viết ADR cho các xung đột ở §1.
- Definition of done: `agent-manifest --json` có schema ổn định.

### Phase 1: package foundation

- Tạo `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.ts`, `vitest.config.ts`, `.editorconfig`, `.nvmrc`/Volta và workspace scripts.
- Cấu hình VS Code: `.vscode/settings.json`, `extensions.json`, `launch.json`, `tasks.json`.
- Build ESM, declaration, source map; kiểm tra `npm pack --dry-run`.

### Phase 2: config and credential resolution

- Implement precedence: flags > config > named env > env scan > runtime detection > defaults.
- Detect exact `tskey-client-*`, mask mọi output, nhiều match phải yêu cầu `--credential-env` trong non-TTY.
- OAuth token client với timeout/retry chỉ cho lỗi retryable, memory-only cache, scope checker.
- `doctor --detect-credentials --json` là contract đầu tiên cho agent.

### Phase 3: binary and runtime

- Detect OS/arch Linux + Windows, resolve PATH/cache/default path.
- Verify version/capabilities; thiếu binary thì download latest stable, checksum SHA256, atomic replace.
- Binary hiện có không tự update; `--update-bin` là đường duy nhất thay thế.
- Daemon manager: existing service → start service → userspace fallback; quyền thiếu thì warning có lệnh sửa.

### Phase 4: policy and API

- API adapters cho token, auth keys, devices, policy, DNS.
- Policy pipeline: GET → parse HuJSON → minimal patch → diff → backup → validate → ETag write → re-read verify.
- Tự thêm `tagOwners`, `nodeAttrs.funnel`, SSH/autoApprovers chỉ khi feature yêu cầu; không đụng section ngoài allowlist.
- Mọi policy write trả side effect + warning.

### Phase 5: join and profiles

- Profile detector: CI, container, VM, Windows, dev, funnel-app, subnet-router, exit-node.
- Tạo key: preauthorized=true; `ssh=true`; expiry=max-supported; ephemeral/reusable theo profile.
- `tailscale set` cho thay đổi incremental; không dùng `up` để reset ngoài ý muốn.
- Wait for Running bằng status JSON, không sleep cứng.

### Phase 6: DNS, Serve/Funnel and verify

- MagicDNS/default `*.ts.net`, no custom DNS.
- Parse multiple `--expose` and `--tcp`, auto-detect PORT/listener khi thiếu, warning resolved value.
- Ensure policy prerequisites, invoke Serve/Funnel, verify status + DNS + TLS with timeout.
- Return URLs and warnings in stable JSON envelope.

### Phase 7: cleanup and menu

- Candidate query: offline > 60m + same normalized hostname/deployment tags + not current/protected.
- Dry-run first; confirmation gate before delete; `--no-cleanup` and protect options.
- Menu via `@inquirer/prompts`; no TTY means help/error, never hang.

### Phase 8: agent contract and release

- Manifest tools: `doctor`, `resolve_credentials`, `update_bin`, `policy_diff`, `policy_sync`, `up`, `dns`, `funnel`, `status`, `cleanup`.
- JSON envelope, schemas, warnings, privileges, side effects, retryability.
- CI matrix Linux x64/arm64 + Windows x64/arm64; Node 22/24.
- npm provenance/attestation, packed artifact scan for secrets, smoke test both bins.

## 5. Agent non-negotiable rules

1. Always call `doctor --detect-credentials --json` first.
2. Never log or return raw client secret, trust credential, access token, auth key, or full environment.
3. Never choose randomly among multiple credential matches.
4. Resolve values using the declared precedence and return source + masked value.
5. Before policy write: show diff, backup, validate, ETag-check, then ask for confirmation unless explicit CI `--yes` is present.
6. Before device deletion: show exact candidates and require confirmation; never delete by broad offline filter alone.
7. Do not update an existing binary during normal deploy; only `--update-bin` may replace it.
8. Do not claim SSH/Funnel/DNS is active until local status and prerequisite verification pass.
9. Treat permission/scope errors as non-retryable; print exact remediation and docs link.
10. Use JSON output for agent calls; pretty logs are for humans only.
11. Preserve idempotence: rerunning deploy must converge, not create duplicate policy entries or duplicate exposure rules.
12. Keep public API types exported and compile with VS Code TypeScript language service without errors.

## 6. package.json baseline

```json
{
  "name": "tailsacle-cli",
  "version": "0.1.0",
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
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:types": "tsd",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm test",
    "pack:check": "npm pack --dry-run"
  }
}
```

`typescript`, `tsx`, `@types/node`, `commander`, `@inquirer/prompts`, `zod`, `pino`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `tsd` phải được pin bằng lockfile; Dependabot/Renovate chỉ tạo PR, không tự đổi runtime trong production.

## 7. VS Code acceptance checklist

- Open folder không có red squiggles với Node 22/24.
- `npm run typecheck` pass.
- ESM imports có extension sau build theo NodeNext.
- `declaration`, `declarationMap`, `sourceMap` bật.
- `.vscode/settings.json` dùng workspace TypeScript version.
- Debug `tsx src/cli.ts` và debug `dist/cli.js` đều chạy.
- IntelliSense resolve được `import { ... } from "tailsacle-cli"` sau `npm pack` + install local.
- `npm pack --dry-run` không chứa `.env`, secrets, test fixtures nhạy cảm.

## 8. Definition of done

- `npx tailsacle-cli` và `npx tscli` mở menu khi TTY.
- Non-TTY commands không prompt/hang.
- `doctor --detect-credentials --json` không làm side effect.
- `deploy --dry-run` in đầy đủ resolved values, warnings, privileges, policy diff, binary plan.
- Test matrix pass Linux/Windows và Node 22/24.
- Rerun idempotent.
- Không có secret trong logs, artifacts, snapshots hoặc npm tarball.
- Tài liệu README có quickstart, env matrix, agent flow, troubleshooting và link Tailscale docs.
