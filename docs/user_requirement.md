# user_requirement — tailscale-cli

> Đặc tả yêu cầu người dùng cho npm package `tailscale-cli` (TypeScript, chạy được trên Windows + Linux).
> Cập nhật lần cuối: 2026-08-16. Mọi mục đều kèm link tài liệu Tailscale để tra lại khi cần.

---

## 0. Mục lục

1. [Input gốc](#1-input-gốc)
2. [Mục tiêu sản phẩm](#2-mục-tiêu-sản-phẩm)
3. [Quyết định đã chốt](#3-quyết-định-đã-chốt)
4. [Đầu vào: trust credentials](#4-đầu-vào-trust-credentials)
5. [Quản lý binary](#5-quản-lý-binary---update-bin)
6. [Join tailnet](#6-join-tailnet)
7. [Funnel và Serve](#7-funnel-và-serve)
8. [Tailnet domain / DNS](#8-tailnet-domain--dns)
9. [Tailnet policy file (JSON config)](#9-tailnet-policy-file-json-config)
10. [Auto-resolve và chính sách cảnh báo](#10-auto-resolve-và-chính-sách-cảnh-báo)
11. [Ma trận đa môi trường](#11-ma-trận-đa-môi-trường)
12. [Command surface và args](#12-command-surface-và-args)
13. [Biến môi trường](#13-biến-môi-trường)
14. [Interactive menu](#14-interactive-menu)
15. [Agent interface (MCP-style)](#15-agent-interface-mcp-style)
16. [Logging, exit code](#16-logging-exit-code)
17. [Ràng buộc kỹ thuật](#17-ràng-buộc-kỹ-thuật)
18. [Câu hỏi còn mở](#18-câu-hỏi-còn-mở)
19. [Tổng hợp link](#19-tổng-hợp-link)

---

## 1. Input gốc

Tôi cần một npm package để triển khai tailscale, dạng cli:

- Đầu vào là trust creds (trong đây có client id và client secret, có thể lấy access token để dùng api).
- Đầu ra: có thể khởi động tailscale để join vào mạng, cấu hình tới funnel, cấu hình tailnet domain.
- Yêu cầu: dùng typescript để thực hiện, có thể chạy trên win, linux
  - Có kiểm tra binary, hông có thì tải về, có thì chạy, khi nào cần cập nhật library thì chạy lệnh `--update-bin` riêng, chạy update thì tải mới nhất về
  - Tất cả env nếu hông truyền thì xử lý tự động, ví dụ chưa có tags nào thì phải tags tự động
  - Có thể cập nhật json config trên tailscale phù hợp với các hình thức triển khai: như phải cấu hình các tham số phù hợp để đạt yêu cầu.
  - Có log rõ ràng

Bổ sung vòng 2:

- Chạy đa môi trường.
- Cho phép ghi policy file nhưng phải có warning; tự động xử lý để đạt mục tiêu cuối, luôn phải chạy được.
- Nếu logic cần quyền root/Administrator thì cảnh báo để người dùng biết mà đáp ứng.
- Dùng domain mặc định của hệ thống Tailscale.
- Funnel có thể nhiều port/path; không cấu hình thì dùng default kèm warning.
- Bổ sung args và hướng dẫn dạng MCP để agent hiểu luồng hoạt động.
- Có menu để chọn khi chạy `tailscale-cli` không kèm tham số.

---

## 2. Mục tiêu sản phẩm

Một npm package viết bằng TypeScript, dùng như CLI (chạy được qua `npx`) và như library, nhận vào trust credentials của Tailscale rồi tự động hoá toàn bộ vòng đời triển khai một node:

1. Lấy access token từ OAuth client (client credentials flow).
2. Đảm bảo có binary `tailscale`/`tailscaled` phù hợp OS/arch (tải nếu chưa có).
3. Tạo auth key rồi đưa node join tailnet (tags, hostname, ephemeral… tự suy luận).
4. Bật/cấu hình Funnel và Serve cho service local.
5. Cấu hình tailnet domain / DNS (MagicDNS, HTTPS cert) trên domain mặc định của Tailscale.
6. Cập nhật tailnet policy file (HuJSON) cho khớp kiểu triển khai: `tagOwners`, `nodeAttrs: ["funnel"]`, `autoApprovers`, grants.
7. Log rõ ràng, mask secret, exit code chuẩn cho CI, và có interface cho AI agent.

**Nguyên tắc xuyên suốt: "phải chạy được".** Thiếu tham số thì tự chọn giá trị an toàn + warning nêu rõ đã dùng gì và cách override. Chỉ dừng khi thực sự không thể tiếp tục (sai creds, thiếu scope, không có quyền ghi).

---

## 3. Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Môi trường | Đa môi trường: CI runner, Docker/K8s, VM Linux, Windows Server, dev máy cá nhân. CLI tự detect và chọn profile |
| Ghi policy file | Được phép ghi, nhưng bắt buộc: warning trước, hiện diff, backup bản cũ, idempotent merge. Tự xử lý để đạt mục tiêu cuối |
| Root / Administrator | Không bắt buộc. Nếu logic cần quyền cao (subnet router, exit node, TUN, cài MSI) thì cảnh báo rõ việc gì cần quyền gì, hướng dẫn cách cấp, và fallback userspace nếu có thể |
| Tailnet domain | Chỉ dùng domain mặc định của Tailscale (`*.ts.net` qua MagicDNS). Không rename tailnet, không map custom domain |
| Funnel | Hỗ trợ nhiều port và nhiều path. Không cấu hình thì dùng default (`443` → port local dò được) kèm warning |
| Tags | Không truyền thì cảnh báo tên biến env sẽ đọc, đọc tags của OAuth client; nếu vẫn không có thì tự sinh giá trị hợp lệ để chạy được |

---

## 4. Đầu vào: trust credentials

**Trust credentials** là framework quyền truy cập có scope của Tailscale, gồm 2 dạng: **OAuth client** (`client_id` + `client_secret`, đúng cái đang dùng) và **federated OIDC workload identity**.

### 4.1 Lấy access token

```bash
curl -d "client_id=$TS_CLIENT_ID" \
     -d "client_secret=$TS_CLIENT_SECRET" \
     https://api.tailscale.com/api/v2/oauth/token
```

- Token ngắn hạn (mặc định khoảng 1 giờ) nên CLI phải cache trong memory và tự refresh. Không bao giờ log token.
- Base API: `https://api.tailscale.com/api/v2`. Dùng `-` làm tailnet id để chỉ tailnet mặc định của credential.

### 4.2 Scopes cần thiết

| Việc CLI làm | Scope cần | Ghi chú |
| --- | --- | --- |
| Tạo auth key để join | `auth_keys` | OAuth client bắt buộc có tags khi dùng scope này |
| Đọc/ghi device, gán tag, authorize, xoá node | `devices:core` | Cần cho cleanup node cũ |
| Đọc cấu hình tổng quát | `all:read` | Khuyến nghị chính thức của Tailscale GitHub Action |
| Cấu hình DNS | `dns:read`, `dns:write` | preferences, nameservers, searchpaths, split-dns |
| Sửa policy file | scope policy file (`policy_file:read` / `policy_file:write`, verify lại trên trang scopes) | Quyền rủi ro cao, xem §9 |

`tailscale-cli doctor` phải kiểm tra scope thực tế của token và báo thiếu scope nào trước khi chạy, thay vì để fail giữa luồng.

### 4.3 Cạm bẫy đã biết về tag của OAuth client

> Auth key tạo bằng OAuth client **bắt buộc phải có tags**, và tags đó phải **trùng khớp** tags của OAuth client (hoặc là tag được owned bởi tag của client). Sai chỗ này sẽ ra lỗi `requested tags [tag:x] are invalid or not permitted (400)`.

Issue tham khảo: [#15456](https://github.com/tailscale/tailscale/issues/15456) · [#12402](https://github.com/tailscale/tailscale/issues/12402) · [#8299](https://github.com/tailscale/tailscale/issues/8299)

**Hệ quả thiết kế:** khi user không truyền tags, CLI phải đọc tags của chính OAuth client và dùng đúng tags đó, không được bịa `tag:auto`. Nếu muốn tag riêng thì tag đó phải được khai trong `tagOwners` là owned bởi tag của client, và CLI tự thêm entry đó (kèm warning).

Docs: [trust-credentials](https://tailscale.com/docs/reference/trust-credentials) · [oauth-clients](https://tailscale.com/docs/features/oauth-clients) · [cmd/get-authkey](https://github.com/tailscale/tailscale/blob/main/cmd/get-authkey/main.go)

---

## 5. Quản lý binary (`--update-bin`)

### 5.1 Luồng xử lý

1. **Resolve**: tìm `tailscale`/`tailscaled` theo thứ tự: đường dẫn user truyền → cache của package (`~/.cache/tailscale-cli/bin`, Windows: `%LOCALAPPDATA%\tailscale-cli\bin`) → `$PATH` → vị trí mặc định của OS.
2. **Verify**: chạy `tailscale version`, so với version tối thiểu (đề xuất **>= 1.52** vì CLI Funnel/Serve đổi cú pháp từ 1.52).
3. **Không có / quá cũ** → tải về. Chỉ tải tự động khi thiếu, **không tự nâng cấp ngầm**.
4. `tailscale-cli --update-bin` → tải bản mới nhất trên track `stable` và thay cache. Có `--track` và `--bin-version` để pin.

### 5.2 Nguồn tải

| OS | Cách lấy | Lưu ý |
| --- | --- | --- |
| Linux (mọi distro) | Static tarball `tailscale_VERSION_ARCH.tgz` từ [pkgs.tailscale.com/stable](https://pkgs.tailscale.com/stable/) (mirror [dl.tailscale.com](https://dl.tailscale.com/stable/)) | Gồm `tailscale` + `tailscaled` + mẫu systemd. Không cần root nếu chạy userspace |
| Linux (có package manager) | `curl -fsSL https://tailscale.com/install.sh \| sh`, hỗ trợ env `TRACK`, `TAILSCALE_VERSION` | Cần root/sudo |
| Windows | MSI theo kiến trúc (`tailscale-setup-<ver>-<arch>.msi`) hoặc EXE full installer | MSI phụ thuộc kiến trúc; cài im lặng cần Administrator |

> **Không có link cố định kiểu `latest.tgz`** — issue [#3414](https://github.com/tailscale/tailscale/issues/3414) vẫn mở. CLI phải parse trang pkgs để tìm version stable mới nhất. Bản stable mới nhất lúc viết doc: **1.102.2**.

**Bắt buộc khi tải**: verify SHA256 (file `.sha256` đi kèm), atomic replace, retry với backoff, hỗ trợ `HTTPS_PROXY`, detect arch (`amd64`, `arm64`, `386`, `arm`), không ghi đè binary do package manager quản lý.

Docs: [static binaries](https://tailscale.com/docs/install/static) · [install Linux](https://tailscale.com/docs/install/linux) · [installer.sh](https://github.com/tailscale/tailscale/blob/main/scripts/installer.sh)

---

## 6. Join tailnet

1. `POST /api/v2/tailnet/-/keys` tạo auth key (tags, `ephemeral`, `reusable`, `preauthorized`, `expirySeconds`).
2. Khởi động daemon nếu cần: `tailscaled --state=... --tun=userspace-networking --socket=...` (Linux non-root/container) hoặc dựa vào service sẵn có (Windows).
3. `tailscale up --auth-key=... --advertise-tags=... --hostname=... --accept-dns`. **Flags không persist giữa các lần chạy**, thiếu flag nào là reset về default.
4. Thay đổi lẻ về sau dùng `tailscale set` (không làm gián đoạn kết nối). Lưu ý `tailscale up` đã bị **freeze**, flag mới chỉ thêm vào `set`.
5. Chờ trạng thái `Running` qua `tailscale status --json` thay vì sleep cứng.

Docs: [`tailscale up`](https://tailscale.com/docs/reference/tailscale-cli/up) · [CLI index](https://tailscale.com/docs/reference/tailscale-cli) · [up bị freeze (#15460)](https://github.com/tailscale/tailscale/issues/15460)

---

## 7. Funnel và Serve

### 7.1 Điều kiện tiên quyết (CLI tự kiểm tra và tự xử lý)

- **MagicDNS** bật.
- **HTTPS Certificates** bật trên tailnet (Funnel dùng tailnet name để cấp cert).
- Node có **nodeAttr `funnel`** trong policy file, nếu không sẽ lỗi `Funnel not available; "funnel" node attribute not set`.

```json
"nodeAttrs": [
  { "target": ["tag:my-app"], "attr": ["funnel"] }
]
```

### 7.2 Lệnh

```bash
tailscale funnel --bg 3000          # expose port local ra internet (background)
tailscale funnel status
tailscale funnel reset
tailscale serve --bg 3000           # chỉ trong tailnet
```

Funnel chỉ nhận traffic trên tập cổng public giới hạn (**443 / 8443 / 10000**, verify lại theo docs hiện hành); mapping tới port local là tuỳ ý qua `--https=`, `--set-path`, `--proxy`. Cú pháp đã đổi từ **1.52**.

### 7.3 Nhiều port / nhiều path

CLI hỗ trợ khai báo dạng list, ví dụ:

```bash
tailscale-cli funnel --expose 443:3000 --expose 8443:9000
tailscale-cli funnel --expose 443/api=3001 --expose 443/=3000
tailscale-cli funnel --tcp 10000:5432        # TCP funnel (không phải HTTPS)
```

Không truyền gì thì default: `443` → port local dò được (đọc `PORT`, hoặc port đang LISTEN duy nhất), kèm warning nêu rõ đã chọn port nào và cách override.

### 7.4 Lỗi thực tế cần handle và báo rõ

- nodeAttr thiếu → [#6922](https://github.com/tailscale/tailscale/issues/6922), [#6827](https://github.com/tailscale/tailscale/issues/6827)
- Funnel báo "on" nhưng TLS handshake treo → [#19290](https://github.com/tailscale/tailscale/issues/19290)
- DNS record public chưa propagate / `tailscale cert` trả 500 → [#18652](https://github.com/tailscale/tailscale/issues/18652), [#6923](https://github.com/tailscale/tailscale/issues/6923)

CLI phải có bước **`verify`**: check `funnel status` + resolve DNS public + thử TLS handshake, retry có timeout, rồi in URL cuối cùng.

Docs: [Funnel](https://tailscale.com/docs/features/tailscale-funnel) · [funnel cmd](https://tailscale.com/docs/reference/tailscale-cli/funnel) · [serve cmd](https://tailscale.com/docs/reference/tailscale-cli/serve) · [Funnel examples](https://tailscale.com/docs/reference/examples/funnel) · [bật HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)

---

## 8. Tailnet domain / DNS

**Chốt: chỉ dùng domain mặc định của Tailscale.** Node sẽ ở dạng `<hostname>.<tailnet>.ts.net`. Không rename tailnet, không map custom domain.

Việc CLI làm:

- `GET/PATCH /dns/preferences` để đảm bảo MagicDNS bật.
- Kiểm tra HTTPS Certificates đã bật; nếu chưa thì cảnh báo và hướng dẫn (bật ở trang DNS của admin console), vì đây là điều kiện cứng cho Funnel.
- Đọc tailnet name đang active để in URL cuối cùng.
- `tailscale set --accept-dns` để node dùng DNS của tailnet.
- `/dns/nameservers`, `/dns/searchpaths`, `/dns/split-dns` chỉ chạm khi user chủ động yêu cầu.

Docs: [tailnet-name](https://tailscale.com/docs/concepts/tailnet-name) · [dns-in-tailscale](https://tailscale.com/docs/reference/dns-in-tailscale) · [split-DNS endpoints (PR #11922)](https://github.com/tailscale/tailscale/pull/11922)

---

## 9. Tailnet policy file (JSON config)

- `GET /api/v2/tailnet/:tailnet/acl` và `POST` để ghi; có `/acl/validate` để test trước khi apply.
- File là **HuJSON** (JSON có comment + trailing comma) nên phải parse/serialize bằng HuJSON. **Không** dùng `JSON.parse` rồi ghi lại (mất hết comment của team).
- Bắt buộc: merge có chủ đích (chỉ thêm/sửa đúng entry của mình, idempotent), dùng **ETag / If-Match** để tránh ghi đè đồng thời, luôn hiện **diff**, có `--dry-run`.

Các section CLI cần chạm: `tagOwners`, `nodeAttrs` (funnel), `autoApprovers` (subnet route / exit node), `grants`/`acls`, `ssh`.

### 9.1 Chính sách ghi

Được phép ghi để đạt mục tiêu cuối, nhưng luồng bắt buộc:

1. Đọc policy hiện tại → tính patch tối thiểu.
2. In **WARNING** rõ ràng: thay đổi này ảnh hưởng toàn tailnet, kèm diff từng dòng.
3. Backup policy cũ ra `./.tailscale-cli/policy-backup-<timestamp>.hujson`.
4. `POST /acl/validate` trước khi ghi thật.
5. Ghi với ETag. Nếu conflict thì đọc lại và tính patch lại.
6. `--no-policy-write` để chỉ in patch, `--yes` để bỏ prompt (dành cho CI).

Docs: [tailnet-policy-file](https://tailscale.com/docs/features/tailnet-policy-file) · [manage policies](https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies) · [api.md](https://github.com/tailscale/tailscale/blob/main/api.md)

---

## 10. Auto-resolve và chính sách cảnh báo

### 10.1 Thứ tự ưu tiên giá trị

```
CLI flag  >  file config  >  biến môi trường  >  auto-detect  >  default cứng
```

Mỗi giá trị đã resolve phải log kèm nguồn: `tags = tag:ci  (source: env TS_TAGS)`.

### 10.2 Mẫu warning bắt buộc

Khi một tham số không được truyền, CLI phải nói đủ 3 điều: đọc biến env nào, đã tự chọn gì, và cách override.

```
[WARN] tags: chưa truyền --tags và chưa có env TS_TAGS.
       → đã dùng tags của OAuth client: tag:ci-runner
       → override: --tags tag:my-app  hoặc  TS_TAGS=tag:my-app
       → docs: https://tailscale.com/docs/features/oauth-clients
```

### 10.3 Bảng auto-resolve

| Tham số | Env | Auto-detect | Default cứng |
| --- | --- | --- | --- |
| tags | `TS_TAGS` | tags của OAuth client | `tag:<slug(package.json name)>` + tự thêm `tagOwners` |
| hostname | `TS_HOSTNAME` | `os.hostname()`; trong CI thì repo-branch-runid | `tscli-<random6>` |
| ephemeral | `TS_EPHEMERAL` | true khi là CI hoặc container | `false` |
| profile | `TS_PROFILE` | theo §11 | `vm` |
| port funnel | `PORT` | port đang LISTEN duy nhất | `443:3000` |
| state dir | `TS_STATE_DIR` | `/var/lib/tailscale` nếu có quyền, else `$XDG_STATE_HOME`; Windows `%ProgramData%` | cache của package |
| tailnet | `TS_TAILNET` | `-` | `-` |
| track | `TS_TRACK` | — | `stable` |
| log level | `TS_CLI_LOG_LEVEL` | `json` khi không phải TTY | `info` |

### 10.4 Cảnh báo quyền

Không bắt buộc root/Administrator. Khi một bước cần quyền cao, CLI phải:

1. Nói rõ bước nào cần quyền gì (ví dụ: tạo TUN device cần root; cài MSI cần Administrator).
2. In lệnh cụ thể để user tự chạy lại với quyền phù hợp.
3. Fallback nếu có (userspace networking), kèm cảnh báo mất tính năng gì (subnet router, exit node).
4. Chỉ fail hẳn khi không có đường fallback nào.

---

## 11. Ma trận đa môi trường

CLI tự detect môi trường và chọn profile; `--profile` để ép thủ công.

| Profile | Dấu hiệu detect | Cấu hình tự áp |
| --- | --- | --- |
| `ci` | `CI=true`, `GITHUB_ACTIONS`, `GITLAB_CI` | ephemeral + preauthorized key, tag riêng, tự `logout`/xoá node khi kết thúc |
| `container` | `/.dockerenv`, cgroup docker/k8s, `KUBERNETES_SERVICE_HOST` | userspace networking, state trong volume, không cần TUN/NET_ADMIN |
| `vm` | Linux có systemd, không CI | non-ephemeral, key gia hạn, service tự khởi động |
| `windows` | `process.platform === 'win32'` | dùng Windows service, cài qua MSI, cần Administrator để cài |
| `dev` | có TTY và không CI | pretty log, prompt xác nhận, non-ephemeral, ưu tiên menu tương tác |
| `funnel-app` | chỉ bật khi có `--expose` | MagicDNS + HTTPS cert + nodeAttr funnel + port mapping + verify public URL |
| `subnet-router` / `exit-node` | có `--advertise-routes` / `--advertise-exit-node` | cần quyền cao, cảnh báo; thêm `autoApprovers` vào policy |

---

## 12. Command surface và args

### 12.1 Lệnh

```bash
tailscale-cli                     # không có args → mở interactive menu (§14)
tailscale-cli up                  # tạo authkey + join tailnet
tailscale-cli funnel <port...>    # bật funnel, tự lo prerequisites, verify URL
tailscale-cli serve <port...>     # chỉ trong tailnet
tailscale-cli dns                 # đảm bảo MagicDNS + HTTPS cert
tailscale-cli policy diff|sync    # diff hoặc apply patch policy file
tailscale-cli status              # trạng thái node + funnel + DNS
tailscale-cli doctor              # check creds, scopes, binary, quyền, DNS, cert
tailscale-cli deploy              # chạy full pipeline: bin → up → policy → dns → funnel → verify
tailscale-cli down | logout       # ngắt kết nối, xoá node nếu ephemeral
tailscale-cli --update-bin        # tải binary mới nhất
tailscale-cli agent-manifest      # in JSON schema mô tả toàn bộ tool cho AI agent (§15)
```

### 12.2 Global flags

| Flag | Mô tả | Default |
| --- | --- | --- |
| `--client-id <id>` | OAuth client id | env `TS_CLIENT_ID` |
| `--client-secret <secret>` | OAuth client secret | env `TS_CLIENT_SECRET` |
| `--creds-file <path>` | File JSON chứa trust creds | env `TS_CREDS_FILE` |
| `--tailnet <name>` | Tailnet id | `-` |
| `--config <path>` | File config khai báo | `./tailscale-cli.config.json` |
| `--profile <name>` | Ép profile môi trường | auto-detect |
| `--log-level <lvl>` | `error\|warn\|info\|debug\|trace` | `info` |
| `--log-format <fmt>` | `pretty\|json` | auto theo TTY |
| `--json` | Output máy đọc được cho mọi lệnh read | `false` |
| `--dry-run` | Không thực hiện hành động ghi nào | `false` |
| `--yes` | Bỏ mọi prompt xác nhận | `false` |
| `--no-color` | Tắt màu | auto |
| `--timeout <sec>` | Timeout mỗi bước | `120` |

### 12.3 Flags theo lệnh

**`up`**

| Flag | Mô tả | Default |
| --- | --- | --- |
| `--tags <list>` | Tags gán cho node | tags của OAuth client |
| `--hostname <name>` | Tên node | slug hostname máy |
| `--ephemeral` | Node tự xoá khi offline | auto theo profile |
| `--reusable` | Auth key dùng lại được | `false` |
| `--key-expiry <sec>` | Hạn auth key | `3600` |
| `--userspace` | Ép userspace networking | auto |
| `--state-dir <path>` | Nơi lưu state | auto |
| `--advertise-routes <cidrs>` | Subnet router | none |
| `--advertise-exit-node` | Làm exit node | `false` |
| `--ssh` | Bật Tailscale SSH | `false` |
| `--accept-dns` | Nhận DNS của tailnet | `true` |
| `--wait-running <sec>` | Chờ trạng thái Running | `60` |

**`funnel` / `serve`**

| Flag | Mô tả | Default |
| --- | --- | --- |
| `--expose <public[/path]=local>` | Có thể lặp lại nhiều lần | `443=<port dò được>` |
| `--tcp <public:local>` | TCP funnel thay vì HTTPS | none |
| `--bg` | Chạy background | `true` |
| `--reset-first` | Reset config funnel cũ trước | `false` |
| `--verify` | Verify DNS + TLS công khai sau khi bật | `true` |
| `--verify-timeout <sec>` | Timeout verify | `120` |

**`policy`**

| Flag | Mô tả | Default |
| --- | --- | --- |
| `--apply` | Ghi thật vào policy file | `false` với `diff`, `true` với `sync` |
| `--no-policy-write` | Chỉ in patch, không ghi | `false` |
| `--backup-dir <path>` | Nơi lưu backup policy | `./.tailscale-cli` |
| `--sections <list>` | Giới hạn section được sửa | `tagOwners,nodeAttrs,autoApprovers` |

**`--update-bin`**

| Flag | Mô tả | Default |
| --- | --- | --- |
| `--track <track>` | `stable\|unstable` | `stable` |
| `--bin-version <ver>` | Pin version cụ thể | latest của track |
| `--bin-dir <path>` | Nơi lưu binary | cache của package |
| `--force` | Tải lại dù đã mới nhất | `false` |
| `--skip-checksum` | Bỏ verify SHA256 (không khuyến khích) | `false` |

---

## 13. Biến môi trường

| Env | Tương ứng flag |
| --- | --- |
| `TS_CLIENT_ID` | `--client-id` |
| `TS_CLIENT_SECRET` | `--client-secret` |
| `TS_CREDS_FILE` | `--creds-file` |
| `TS_TAILNET` | `--tailnet` |
| `TS_TAGS` | `--tags` |
| `TS_HOSTNAME` | `--hostname` |
| `TS_EPHEMERAL` | `--ephemeral` |
| `TS_PROFILE` | `--profile` |
| `TS_STATE_DIR` | `--state-dir` |
| `TS_TRACK` | `--track` |
| `TS_BIN_DIR` | `--bin-dir` |
| `TS_BIN_VERSION` | `--bin-version` |
| `TS_EXPOSE` | `--expose` (phân tách bằng dấu phẩy) |
| `TS_CLI_LOG_LEVEL` | `--log-level` |
| `TS_CLI_LOG_FORMAT` | `--log-format` |
| `TS_CLI_YES` | `--yes` |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | proxy khi tải binary và gọi API |

---

## 14. Interactive menu

Chạy `tailscale-cli` không kèm tham số (và có TTY) sẽ mở menu. Không có TTY thì in help thay vì treo chờ input.

```
  tailscale-cli v0.1.0   profile: container (auto)   tailnet: tailnet-1a2b.ts.net
  creds: OAuth client ****f31a   binary: tailscale 1.102.2 (cache)

  ? Bạn muốn làm gì?  (dùng ↑ ↓, Enter để chọn)

  ❯ 1. Deploy full        bin → join → policy → dns → funnel → verify
    2. Join tailnet       tạo auth key và kết nối node
    3. Cấu hình Funnel    expose service ra internet (nhiều port/path)
    4. Cấu hình Serve     chia sẻ trong tailnet
    5. DNS / domain       MagicDNS + HTTPS certificate
    6. Policy file        xem diff và apply patch (có warning)
    7. Trạng thái         node, funnel, DNS, cert
    8. Doctor             kiểm tra creds, scopes, quyền, binary
    9. Cập nhật binary    tải bản stable mới nhất
   10. Ngắt kết nối       down / logout (+ xoá node ephemeral)
    0. Thoát
```

Yêu cầu cho menu:

- Sau khi chọn, prompt lần lượt các tham số còn thiếu, hiện giá trị auto-detect làm default để user chỉ cần Enter.
- Trước khi thực hiện hành động ghi, hiện bảng tổng hợp tham số + diff, hỏi xác nhận.
- Kết thúc mỗi hành động, **in ra lệnh non-interactive tương đương** để user copy vào CI.
- `--yes`, `--json`, hoặc không có TTY thì bỏ hoàn toàn menu.

---

## 15. Agent interface (MCP-style)

Mục tiêu: một AI agent chỉ cần đọc manifest là hiểu luồng và tự gọi đúng lệnh.

### 15.1 `tailscale-cli agent-manifest`

In ra JSON mô tả các "tool" (mỗi tool map 1:1 với một subcommand), input schema, output schema, tiền đề và tác dụng phụ:

```json
{
  "name": "tailscale-cli",
  "version": "0.1.0",
  "description": "Deploy a Tailscale node from trust credentials: join tailnet, configure Funnel, DNS and policy.",
  "auth": {
    "type": "oauth_client_credentials",
    "env": ["TS_CLIENT_ID", "TS_CLIENT_SECRET"],
    "required_scopes": ["auth_keys", "devices:core", "all:read", "dns:write", "policy_file:write"]
  },
  "tools": [
    {
      "name": "doctor",
      "description": "Validate credentials, scopes, binary, privileges, DNS and cert readiness. Always call this first.",
      "input_schema": { "type": "object", "properties": {}, "additionalProperties": false },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": { "type": "boolean" },
          "checks": { "type": "array", "items": { "type": "object" } },
          "blocking": { "type": "array", "items": { "type": "string" } }
        }
      },
      "side_effects": "none",
      "idempotent": true
    },
    {
      "name": "up",
      "description": "Create a tagged auth key and join the tailnet. Auto-resolves tags from the OAuth client when not provided.",
      "input_schema": {
        "type": "object",
        "properties": {
          "tags": { "type": "array", "items": { "type": "string" } },
          "hostname": { "type": "string" },
          "ephemeral": { "type": "boolean" },
          "userspace": { "type": "boolean" }
        }
      },
      "requires": ["binary_present"],
      "side_effects": "creates auth key, registers a device in the tailnet",
      "idempotent": true
    },
    {
      "name": "funnel",
      "description": "Expose local ports/paths to the public internet over the default ts.net domain.",
      "input_schema": {
        "type": "object",
        "properties": {
          "expose": {
            "type": "array",
            "items": { "type": "string", "pattern": "^\\d+(/[^=]*)?=\\d+$" },
            "description": "public[/path]=localPort, e.g. 443/api=3001"
          },
          "tcp": { "type": "array", "items": { "type": "string" } },
          "verify": { "type": "boolean", "default": true }
        }
      },
      "requires": ["node_running", "magicdns_enabled", "https_cert_enabled", "nodeattr_funnel"],
      "side_effects": "publishes a public URL",
      "idempotent": true
    },
    {
      "name": "policy_sync",
      "description": "HIGH RISK. Patch the tailnet policy file (tagOwners, nodeAttrs funnel, autoApprovers). Always run policy_diff first and surface the diff to the human.",
      "input_schema": {
        "type": "object",
        "properties": {
          "apply": { "type": "boolean", "default": false },
          "sections": { "type": "array", "items": { "type": "string" } }
        }
      },
      "side_effects": "modifies tailnet-wide access control",
      "requires_human_confirmation": true,
      "idempotent": true
    }
  ]
}
```

### 15.2 Luồng khuyến nghị cho agent

```
doctor  →  (nếu blocking: báo human)  →  --update-bin nếu thiếu binary
        →  policy diff  →  xin xác nhận  →  policy sync
        →  up  →  dns  →  funnel --verify  →  status
```

### 15.3 Quy tắc agent phải tuân

- Luôn chạy `doctor` trước; nếu có `blocking` thì dừng và báo người dùng, kèm link docs trong output.
- Mọi lệnh gọi phải kèm `--json` để parse output; không parse log pretty.
- Không tự ý chạy `policy sync --apply` khi chưa có xác nhận của con người.
- Không log/echo lại secret hay auth key nhận được trong output.
- Đọc trường `warnings[]` trong JSON output và truyền nguyên văn cho người dùng (đó là chỗ CLI nói đã tự chọn giá trị gì).
- Retry chỉ với lỗi có `retryable: true`. Lỗi quyền và lỗi scope thì không retry.

### 15.4 Envelope JSON output chuẩn

Mọi lệnh chạy với `--json` trả về cùng một hình dạng:

```json
{
  "ok": true,
  "command": "funnel",
  "durationMs": 8421,
  "resolved": { "expose": ["443=3000"], "source": { "expose": "auto-detect" } },
  "result": { "publicUrls": ["https://my-app.tailnet-1a2b.ts.net"] },
  "warnings": [
    { "code": "FUNNEL_PORT_AUTODETECTED", "message": "...", "docs": "https://tailscale.com/docs/reference/tailscale-cli/funnel" }
  ],
  "errors": []
}
```

---

## 16. Logging, exit code

- Level: `error | warn | info | debug | trace` qua `--log-level` hoặc `TS_CLI_LOG_LEVEL`.
- Hai chế độ output: **pretty** (TTY, có step, ✓/✗) và **JSON lines** (CI, log aggregator).
- **Mask bắt buộc**: client_secret, access token, auth key (in dạng `tskey-auth-****`).
- Mỗi bước log: bắt đầu → tham số đã resolve kèm nguồn → kết quả → thời gian.
- Lỗi phải có **mã lỗi + gợi ý fix + link docs** (ví dụ thiếu nodeAttr funnel thì in luôn đoạn JSON cần thêm).

| Exit code | Nghĩa |
| --- | --- |
| 0 | Thành công |
| 1 | Lỗi chung không xác định |
| 2 | Sai tham số / config không hợp lệ |
| 3 | Creds sai hoặc lấy token thất bại |
| 4 | Thiếu scope |
| 5 | Lỗi binary (tải, checksum, exec) |
| 6 | Join tailnet thất bại |
| 7 | Funnel/Serve verify thất bại |
| 8 | Policy file ghi thất bại hoặc conflict |
| 9 | Thiếu quyền root/Administrator và không có fallback |

---

## 17. Ràng buộc kỹ thuật

- TypeScript, build ra ESM (thêm CJS nếu cần), Node LTS >= 20, có type declarations để dùng như library.
- Cross-platform: Windows 10+/Server 2016+ và Linux (glibc + musl). Xử lý khác biệt: service vs process, đường dẫn socket, quyền admin/root, path binary.
- Không phụ thuộc `sudo` bắt buộc: hỗ trợ userspace mode.
- `--dry-run` cho mọi hành động ghi, `--json` cho mọi lệnh đọc.
- Config khai báo `tailscale-cli.config.json` để chạy idempotent, ưu tiên thấp hơn flag.
- Test: unit (mock API) + e2e trên tailnet thật (optional, chạy bằng secret).

---

## 18. Câu hỏi còn mở

- [ ] Tên package trên npm và tên lệnh `bin` chính thức? Public hay private registry?
- [ ] Có cần hỗ trợ macOS (input chỉ nói win/linux) không?
- [ ] Có cần hỗ trợ federated OIDC workload identity ngoài OAuth client không?
- [ ] Có cần tự cleanup device cũ trùng hostname/tag không, và theo tiêu chí nào?
- [ ] Binary luôn latest stable, hay pin version để build reproducible?
- [ ] Có cần split-DNS / custom nameservers không, hay chỉ MagicDNS là đủ?

---

## 19. Tổng hợp link

| Chủ đề | Link |
| --- | --- |
| Trust credentials | https://tailscale.com/docs/reference/trust-credentials |
| OAuth clients | https://tailscale.com/docs/features/oauth-clients · https://tailscale.com/docs/oauth |
| Tailscale API reference | https://github.com/tailscale/tailscale/blob/main/api.md · https://tailscale.com/api |
| Lấy authkey từ OAuth (ví dụ Go) | https://github.com/tailscale/tailscale/blob/main/cmd/get-authkey/main.go |
| CLI up / set | https://tailscale.com/docs/reference/tailscale-cli/up · https://tailscale.com/docs/reference/tailscale-cli |
| Funnel / Serve | https://tailscale.com/docs/features/tailscale-funnel · https://tailscale.com/docs/reference/tailscale-cli/funnel · https://tailscale.com/docs/reference/tailscale-cli/serve |
| HTTPS certificates | https://tailscale.com/docs/how-to/set-up-https-certificates |
| Tailnet name / DNS | https://tailscale.com/docs/concepts/tailnet-name · https://tailscale.com/docs/reference/dns-in-tailscale |
| Policy file | https://tailscale.com/docs/features/tailnet-policy-file · https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies |
| Tải binary | https://pkgs.tailscale.com/stable/ · https://tailscale.com/docs/install/static · https://github.com/tailscale/tailscale/blob/main/scripts/installer.sh |
| Client Go tham khảo | https://github.com/tailscale/tailscale-client-go-v2 |
