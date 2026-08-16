# user_requirement addendum: defaults and zero-configuration policy

Cập nhật: 2026-08-16

Đây là phần chốt bổ sung cho [`docs/user_requirement.md`](./user_requirement.md). Khi có mâu thuẫn, tài liệu này được ưu tiên.

## 1. Quyết định đã chốt

| Hạng mục | Quyết định |
| --- | --- |
| Môi trường | Đa môi trường: CI runner, Docker/K8s, VM Linux, Windows Server và máy dev |
| Policy file | Được phép tự động ghi để đạt mục tiêu, nhưng luôn warning, backup, validate, diff tối thiểu và retry conflict bằng ETag |
| Quyền hệ thống | Không bắt buộc root/Administrator nếu userspace đủ; nếu không đủ thì warning nêu chính xác quyền cần cấp và fallback/tính năng bị mất |
| Domain | Chỉ dùng domain mặc định của Tailscale, MagicDNS và `*.ts.net`; không custom domain, không rename tailnet |
| Funnel | Hỗ trợ nhiều port, nhiều path và TCP khi Tailscale/bản triển khai cho phép; thiếu cấu hình thì auto-detect default và warning |
| macOS | Chưa hỗ trợ trong scope hiện tại |
| OIDC workload identity | Không hỗ trợ trong scope hiện tại; chỉ OAuth client/trust credential |
| Split-DNS/custom nameserver | Không cấu hình; dùng DNS mặc định của Tailscale |
| Binary | Thiếu binary thì tải latest stable; binary đã có thì dùng bản hiện tại; chỉ `--update-bin` mới tải bản latest để thay thế |
| Cleanup | Tự cleanup device offline quá 60 phút, giới hạn theo hostname/tag của deployment và phải warning trước khi xoá |

## 2. Tên package và bin aliases

Package npm cần publish với các bin aliases:

```json
{
  "bin": {
    "tailsacle-cli": "dist/cli.js",
    "tscli": "dist/cli.js"
  }
}
```

`tailsacle-cli` là tên theo yêu cầu hiện tại, dù khác chính tả phổ biến `tailscale-cli`. Không tự đổi tên. Có thể thêm alias `tailscale-cli` chỉ khi user duyệt vì đó là thay đổi public API của package.

Registry mặc định: npm public, trừ khi package config chỉ rõ private registry.

## 3. Default ưu tiên quyền cao và ít cấu hình

Mục tiêu là **ít config nhất nhưng đủ quyền để triển khai nhiều loại project**. CLI phải resolve theo thứ tự:

```text
CLI flag > config file > named env > auto-scan env > OS/runtime detection > safe default
```

Nhưng “quyền nhiều nhất” không có nghĩa là log hoặc lưu secret nhiều hơn. Least privilege vẫn áp dụng cho OAuth scopes; CLI chỉ yêu cầu scope theo feature được bật.

### 3.1 Defaults bắt buộc

| Tham số | Default mới | Hành vi |
| --- | --- | --- |
| `--ssh` | `true` | Bật Tailscale SSH trong node preferences/policy nếu scope và policy cho phép; warning nếu policy chưa cho phép |
| `--key-expiry` | Giá trị lớn nhất mà API/tailnet policy chấp nhận | Không hard-code số không được docs đảm bảo; nếu API không cho “unlimited”, dùng giá trị tối đa được server chấp nhận và warning giá trị thực tế |
| `--preauthorized` | `true` | Tạo auth key pre-authorized để CI/non-interactive chạy được |
| `--reusable` | Theo profile | `false` cho CI/container ephemeral; `true` cho VM/Windows Server long-lived, kèm warning vì key có thể tái sử dụng |
| `--ephemeral` | Auto theo môi trường | `true` cho CI/container/serverless; `false` cho VM/dev/Windows Server long-lived |
| `--accept-dns` | `true` | Dùng DNS mặc định Tailscale; không cấu hình split-DNS/custom nameserver |
| `--accept-routes` | `true` khi profile cần route | Warning nếu route yêu cầu quyền hoặc policy approval |
| `--hostname` | Auto từ `os.hostname()` rồi slug | CI thêm project/run id để tránh collision |
| `--tags` | `TS_TAGS`, sau đó tags được phép của OAuth client | Không bịa tag tùy ý nếu OAuth client không được phép; nếu cần tag tự sinh thì patch `tagOwners` và warning |
| `--tailnet` | `-` | Tailnet mặc định của trust credential |
| `--track` | `stable` | Dùng latest stable chỉ khi thiếu binary hoặc có `--update-bin` |
| `--log-format` | `pretty` khi TTY, `json` khi non-TTY | Secret luôn mask |
| `--yes` | `false` khi TTY, `true` chỉ khi CI có `TS_CLI_YES=true` | Policy write/delete vẫn phải ghi warning vào output |

### 3.2 `--key-expiry` không được hiểu nhầm

`--key-expiry` là expiry của **auth key dùng để join**, không phải key expiry của node sau khi join. Tailscale node key expiry là chính sách tailnet/device và có thể cần thao tác riêng trong admin console/API. CLI phải báo rõ hai khái niệm, không hứa “vĩnh viễn” nếu server không hỗ trợ.

Docs: [Auth keys](https://tailscale.com/docs/features/access-control/auth-keys) · [Key expiry](https://tailscale.com/docs/features/access-control/key-expiry) · [Secure auth keys](https://tailscale.com/docs/features/access-control/auth-keys/how-to/secure-auth-keys)

## 4. Cleanup device offline > 60 phút

### 4.1 Default behavior

Sau `up`, `deploy`, `status --cleanup` hoặc khi kết thúc CI, CLI gọi API devices và tìm các node:

- `lastSeen`/`lastSeenTime` cũ hơn **60 phút**;
- cùng normalized hostname hoặc deployment identity;
- cùng một hoặc nhiều deployment tags;
- không phải node hiện tại;
- không thuộc protected list/config.

CLI chỉ xoá node matching criteria. Không xoá toàn bộ node offline của tailnet.

### 4.2 Safety

- `--cleanup-offline-after 60m` là default.
- `--no-cleanup` tắt cleanup.
- `--cleanup-dry-run` chỉ in candidates.
- `--cleanup-protect <device-id-or-hostname>` bảo vệ node.
- Luôn warning danh sách candidate, lý do match và link docs trước khi xoá.
- Trong TTY hỏi xác nhận; CI cần `--yes` hoặc `TS_CLI_YES=true`.
- Nếu thiếu `devices:core`/quyền xoá, không fail join; warning và trả `cleanup.skipped=true`.
- Ephemeral nodes vẫn ưu tiên vì Tailscale tự cleanup loại node này; explicit cleanup là fallback cho node non-ephemeral.

Docs: [Ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes) · [Tailscale API](https://github.com/tailscale/tailscale/blob/main/api.md)

## 5. Credential auto-detection: sửa quy tắc chính xác

Input dạng `tskey-client-k522tBdJ5D21CNTRL-xxxxxxxxxxxxxx` phải được nhận diện trong mọi env nếu không có cấu hình rõ ràng.

Precedence:

```text
--client-secret / --credential-env
> TS_CLIENT_SECRET
> TS_TRUST_CREDENTIAL / TS_API_TRUST / TAILSCALE_TRUST_CREDENTIAL / TAILSCALE_API_TRUST
> toàn bộ process.env, exact prefix tskey-client-
> interactive prompt
```

Nếu có nhiều match, non-interactive mode phải fail rõ với `--credential-env <NAME>` thay vì tự chọn. TTY có thể cho menu chọn tên biến nhưng không hiển thị giá trị. Không log toàn bộ `process.env`.

Các lệnh:

```bash
tscli doctor --detect-credentials
tscli up --credential-env CI_TAILSCALE_TRUST
tscli status --show-resolution
```

Lưu ý: prefix phải được xác nhận với API adapter thực tế; nếu chuỗi chỉ là auth key hoặc không thể dùng cho OAuth token endpoint thì trả `CREDENTIAL_FORMAT_UNSUPPORTED`, không tự đoán client id/secret.

Docs: [Trust credentials](https://tailscale.com/docs/reference/trust-credentials) · [OAuth clients](https://tailscale.com/docs/features/oauth-clients)

## 6. Environment matrix: ít biến nhưng phủ nhiều deployment

### 6.1 Core env

| Env | Mặc định/ý nghĩa |
| --- | --- |
| `TS_CLIENT_ID` | OAuth client id; chỉ cần khi credential không tự chứa/không suy ra được id |
| `TS_CLIENT_SECRET` | Secret/trust credential ưu tiên cao |
| `TS_TRUST_CREDENTIAL`, `TS_API_TRUST`, `TAILSCALE_TRUST_CREDENTIAL`, `TAILSCALE_API_TRUST` | Tên chuẩn để truyền trust credential |
| `TS_TAILNET` | `-` |
| `TS_TAGS` | Tags override; không có thì resolve từ OAuth client/policy |
| `TS_HOSTNAME` | Hostname override |
| `TS_PROFILE` | `ci`, `container`, `vm`, `windows`, `dev`, `subnet-router`, `exit-node`, `funnel-app` |
| `TS_EXPOSE` | Danh sách expose; thiếu thì auto-detect `PORT`/listener |
| `PORT` | Local port fallback cho Funnel/Serve |
| `TS_SSH` | `true` |
| `TS_KEY_EXPIRY` | `max` hoặc giá trị server tối đa |
| `TS_EPHEMERAL` | Auto theo profile |
| `TS_REUSABLE` | Auto theo profile |
| `TS_PREAUTHORIZED` | `true` |
| `TS_ACCEPT_DNS` | `true` |
| `TS_ACCEPT_ROUTES` | Auto theo profile |
| `TS_STATE_DIR` | OS/runtime-specific |
| `TS_BIN_DIR`, `TS_BIN_VERSION`, `TS_TRACK` | Binary resolution/update |
| `TS_CLEANUP_OFFLINE_AFTER` | `60m` |
| `TS_NO_CLEANUP` | `true` để tắt |
| `TS_CLI_YES` | `true` chỉ khi user/CI chủ động bật |
| `TS_CLI_LOG_LEVEL`, `TS_CLI_LOG_FORMAT` | Logging |

### 6.2 Không cần env cho các phần đã chốt

Không thêm env cho macOS, OIDC, split-DNS, custom nameserver, custom domain hoặc rename tailnet trong scope hiện tại. Các feature này không được tự bật do env lạ.

## 7. Updated command examples

```bash
# zero-config nhất: tự detect credential, binary, profile, tags, hostname
npx tscli deploy

# long-lived VM/Windows Server, SSH bật mặc định, auth key expiry max
npx tscli up --profile vm

# Funnel auto-detect local port/path, warning nếu thiếu --expose
npx tscli funnel

# cleanup candidates offline hơn 60 phút, chỉ xem trước
npx tscli cleanup --cleanup-dry-run

# cập nhật binary latest stable, không tự update trong deploy
npx tscli --update-bin

# machine-readable agent flow
npx tscli doctor --detect-credentials --json
npx tscli agent-manifest --json
```

## 8. Agent flow cập nhật

```text
doctor --detect-credentials
→ resolve client/trust credential và scopes
→ detect OS/profile/privilege/binary
→ nếu thiếu binary: tải stable; nếu có: dùng hiện tại
→ policy diff + warning + backup + validate
→ policy sync nếu cần
→ up với ssh=true, preauthorized=true, key-expiry=max-supported
→ dns dùng mặc định Tailscale
→ funnel/serve với expose auto-detect nếu thiếu
→ status + cleanup offline > 60m
```

Agent phải đọc `resolved`, `warnings`, `required_privileges`, `cleanup.candidates` và `side_effects` từ JSON output; không được tự retry lỗi permission/scope hoặc tự xoá node ngoài candidate list.

## 9. Các câu hỏi đã đóng

- Package/bin: aliases `tailsacle-cli` và `tscli`.
- macOS: chưa cần.
- Federated OIDC: không.
- Cleanup: có, offline quá 60 phút và chỉ matching hostname/tag/deployment.
- Binary: thiếu thì tải latest stable; có thì dùng; `--update-bin` tải latest stable.
- DNS: dùng mặc định Tailscale, không split-DNS/custom nameserver.
