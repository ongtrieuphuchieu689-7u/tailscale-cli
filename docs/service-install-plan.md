# Kế hoạch: Tích hợp `service` command — Cài đặt System Service trên Windows & Linux

> **Trạng thái:** Draft — chưa triển khai  
> **Phiên bản kế hoạch:** 2026-08-19 (v1) → **2026-08-19 (v2, đã review)**  
> **Tác giả:** Thiết kế bởi Antigravity  
> **Ghi chú review v2:** Sửa 4 điểm sau khi kiểm chứng thực tế: (1) làm rõ "user service không cần admin" chỉ áp dụng Linux; (2) sửa sai kỹ thuật — `node-windows.svc.install()` **không** tự bật UAC prompt, cần check `isAdminUser()` + elevate chủ động; (3) thống nhất bản WinSW giữa 2 phương án (node-windows dùng bản .NET Framework cũ, không phải v3); (4) đưa Windows Task Scheduler (`--scheduler`, không cần admin) từ Phase 3 lên Phase 1 làm fallback thật sự cho SCM.

---

## 1. Mục tiêu

Bổ sung lệnh `tailsacle-cli service` để:

1. **Sinh file cấu hình** (`service init`) — tạo file JSON/JSONC mẫu cho relay service, người dùng điền vào.
2. **Cài đặt service** (`service install`) — đọc file cấu hình, đăng ký service với SCM (Windows) hoặc systemd (Linux).
3. **Gỡ cài đặt** (`service uninstall`) — xóa service sạch hoàn toàn.
4. **Kiểm tra trạng thái** (`service status`) — xem service đang chạy, dừng, hay lỗi; kèm log tail.
5. **Xem logs** (`service logs`) — đuôi journal (Linux) hoặc event log (Windows).
6. **Start / Stop / Restart** (`service start|stop|restart`).

Yêu cầu cốt lõi:
- **Lệnh thống nhất** giữa Windows và Linux.
- **Không phụ thuộc vào loại Windows** (Home, Pro, Server).
- **Logs rõ ràng**, có thể tail real-time.
- Có thể chạy relay nhiều port từ một file cấu hình.
- Hỗ trợ chạy dưới dạng **user service** (không cần root/admin) khi có thể — **chỉ áp dụng cho Linux** (`systemd --user`). Trên Windows, đăng ký service với SCM luôn yêu cầu quyền Administrator theo thiết kế của hệ điều hành, không có cơ chế "user-level SCM" tương đương; đây là giới hạn cứng, không phải điều CLI có thể lách qua. Với Windows, phương án không-cần-admin là Task Scheduler (xem §9), nhưng đó không phải service thật (không auto-start trước khi user login, restart-on-crash yếu hơn SCM).

---

## 2. Nghiên cứu & Quyết định chọn thư viện

### 2.1 Kết quả đánh giá npm packages (Windows)

| Package | Downloads/tuần | Cập nhật lần cuối | Cơ chế | Kết luận |
|---|---|---|---|---|
| **`node-windows`** | ~3,500 | 2021 (v1.0.0-beta.8) | Bundled WinSW + wrapper.js | ✅ Khả dụng tốt nhất |
| `winser` | ~150 | 2015 (v1.0.3) | Bundled NSSM 2014 | ❌ Deprecated — NSSM cũ gây crash Win10/11 |
| `os-service` | ~500 | 2020 (v2.2.0) | Native C++ (node-gyp) | ❌ Không build được trên Node 20/22/24 |
| `node-windows-service-controller` | <50 | 2016 | sc.exe wrapper | ❌ Không install service, chỉ control |
| **Direct WinSW v3 XML** | N/A | Đang maintain (Jenkins) | Standalone exe + XML | ✅ Phương án dự phòng tốt nhất |

> **Điểm quyết định chọn Windows:**
> - Windows SCM yêu cầu process phải implement StartServiceCtrlDispatcher — node.exe thuần không làm được, cần wrapper.
> - `os-service` đòi node-gyp + Visual Studio C++ Build Tools — không phù hợp với một CLI zero-config.
> - `winser` dùng NSSM 2014 (32-bit) — thường xuyên crash trên Win11/Server 2022 64-bit.
> - `node-windows` dùng **WinSW** (được dùng bởi Jenkins, Nexus, nhiều enterprise tool lớn) — ổn định và không cần build tools.
> - **Phương án 2:** Tự bundle WinSW v3 binary và generate XML config — không phụ thuộc vào npm package có thể bị abandon, kiểm soát hoàn toàn.

### 2.2 Kết quả đánh giá packages (Linux)

| Package | Downloads/tuần | Cập nhật lần cuối | Cơ chế | Kết luận |
|---|---|---|---|---|
| `node-linux` | ~800 | 2017 (v0.1.1) | SysV init.d | ❌ Init.d lỗi thời, không hỗ trợ systemd |
| `systemd-install` / `service-systemd` | N/A | ~2015 | systemd | ❌ Abandoned |
| **Direct systemd template** | N/A | N/A | Native systemctl | ✅ Chuẩn industry |

> **Điểm quyết định chọn Linux:**
> - Tất cả distro hiện đại (Ubuntu 18.04+, Debian 9+, RHEL 8+, Arch, Fedora) đều dùng systemd.
> - File `.service` chỉ là plain INI text — Node.js tự sinh bằng fs.writeFileSync, không cần package nào.
> - Log tự động vào journald — có rotation, query, filter mà không cần cấu hình thêm.
> - Hỗ trợ **rootless user service** (`~/.config/systemd/user/`) không cần sudo.
> - Zero dependencies, zero overhead.

### 2.3 Cross-platform evaluation

| Tool | Linux | Windows | macOS | Verdict |
|---|---|---|---|---|
| `pm2` | ✅ tốt | ❌ không có pm2 startup Win | ✅ | Quá nặng, AGPL license |
| `forever` | ❌ deprecated | ❌ deprecated | ❌ | Bỏ qua |
| Corey Butler suite | ❌ SysV | ✅ WinSW | ✅ launchd | Linux không phù hợp |
| **Hybrid (kế hoạch này)** | ✅ systemd | ✅ node-windows / WinSW | ✅ launchd plist | ✅ **Chọn** |

---

## 3. Thiết kế lệnh (CLI Unified Interface)

### Nguyên tắc thiết kế
- **Lệnh hoàn toàn giống nhau trên cả Windows và Linux** — khác biệt nằm bên trong implementation.
- Mọi hành động quan trọng đều in JSON envelope (flag `--json`) để agent/CI dễ parse.
- Cần xác nhận trước khi install/uninstall (flag `--yes` hoặc TTY prompt).

### 3.1 Subcommands

```
tailsacle-cli service <subcommand> [options]
```

| Subcommand | Mô tả |
|---|---|
| `service init [--name <name>] [--out <file>]` | Tạo file cấu hình mẫu (JSON/JSONC), người dùng chỉnh sửa |
| `service install [--file <config>] [--user] [--scheduler] [--yes]` | Đọc config, cài đặt và enable service. `--user`: systemd user service (Linux only, không cần sudo). `--scheduler`: Task Scheduler thay vì SCM (Windows only, không cần admin, xem §9) |
| `service uninstall [--name <name>] [--yes]` | Gỡ cài đặt và xóa file unit |
| `service status [--name <name>] [--json]` | Xem trạng thái + uptime + restart count |
| `service logs [--name <name>] [--lines <n>] [--follow]` | Xem logs (journal tail hoặc WinSW log) |
| `service start [--name <name>]` | Khởi động service |
| `service stop [--name <name>]` | Dừng service |
| `service restart [--name <name>]` | Restart service |
| `service list` | Liệt kê tất cả service được quản lý bởi tailsacle-cli |

### 3.2 File cấu hình service (.tailsacle-service.jsonc)

Được sinh bởi `service init`, người dùng chỉnh sửa rồi dùng cho `service install`:

```jsonc
// .tailsacle-service.jsonc — generated by: tailsacle-cli service init
{
  // Tên service (phải là slug, ký tự alphanumeric và dấu gạch nối)
  "name": "tailsacle-relay",

  // Mô tả hiện thị trong SCM / systemd
  "description": "Tailscale TCP Relay Service — managed by tailsacle-cli",

  // Người dùng chạy service: "current" = user đang chạy lệnh install
  // Windows: "LocalSystem" hoặc ".\username"  |  Linux: "username"
  "user": "current",

  // Thư mục làm việc (mặc định: thư mục chứa file config này)
  "workingDir": ".",

  // Node.js entrypoint — để trống để dùng tailsacle-cli binary tự động
  "script": "",

  // Arguments truyền vào script
  "args": ["relay", "--file", "./relays.jsonc"],

  // Biến môi trường (secrets sẽ được mask trong log)
  "env": {
    "NODE_ENV": "production",
    "TS_CLIENT_SECRET": ""
  },

  // Chính sách restart
  "restart": {
    "onFailure": true,
    "delaySeconds": 5,
    "maxRetries": 10
  },

  // Log settings (chỉ áp dụng Windows — Linux dùng journald tự động)
  "log": {
    "dir": "./logs",
    "maxSizeMb": 10,
    "keepFiles": 5
  }
}
```

### 3.3 Ví dụ sử dụng end-to-end

```bash
# Bước 1: Sinh file cấu hình mẫu
tailsacle-cli service init --name tailsacle-relay --out .tailsacle-service.jsonc

# Bước 2: Điền thông tin (TS_CLIENT_SECRET, args, v.v.)

# Bước 3: Cài đặt (cần admin/sudo, hoặc --user cho rootless Linux)
tailsacle-cli service install --file .tailsacle-service.jsonc --yes

# Kiểm tra trạng thái
tailsacle-cli service status --name tailsacle-relay --json

# Xem logs real-time
tailsacle-cli service logs --name tailsacle-relay --follow

# Gỡ cài đặt khi không cần
tailsacle-cli service uninstall --name tailsacle-relay --yes
```

---

## 4. Kiến trúc module

```
src/
├── service/
│   ├── index.ts        # Dispatch theo process.platform; export ServiceManager interface
│   ├── types.ts        # ServiceConfig, ServiceStatus, ServiceInfo interfaces
│   ├── config.ts       # Load/validate/generate .tailsacle-service.jsonc
│   ├── registry.ts     # Track installed services (~/.tailsacle-cli/services.json)
│   ├── windows.ts      # node-windows / WinSW XML generation
│   ├── linux.ts        # systemd unit file generation + systemctl
│   └── macos.ts        # (Future) launchd plist generation + launchctl
```

### Interface ServiceManager

```typescript
export interface ServiceManager {
  install(config: ServiceConfig): Promise<ServiceInstallResult>;
  uninstall(name: string): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  status(name: string): Promise<ServiceStatus>;
  logs(name: string, opts: LogOptions): Promise<void>; // streams to stdout
  list(): Promise<ServiceInfo[]>;
}
```

---

## 5. Chi tiết triển khai theo Platform

### 5.1 Windows (src/service/windows.ts)

**Cơ chế:** `node-windows` (ưu tiên) → fallback sang tự generate WinSW v3 XML.

**Quy trình install:**
1. Validate config (tên hợp lệ, script tồn tại, ports không conflict).
2. **Check quyền admin trước tiên** bằng `node-windows.isAdminUser()`. `svc.install()` **không** tự kích hoạt UAC prompt — nếu process hiện tại không chạy elevated, nó fail thẳng với lỗi "access denied", không có popup nào tự bật lên. Đây là hành vi thực tế đã kiểm chứng của package, không phải giả định.
3. Nếu chưa elevated:
   - User thuộc nhóm Administrators nhưng terminal chưa "Run as Administrator" → tự re-spawn process qua PowerShell `Start-Process -Verb RunAs` để bật UAC prompt thật, rồi tiếp tục install trong process con.
   - User là Standard User thật sự (không thuộc nhóm Administrators) → không có cách nào vượt UAC từ code. In lỗi rõ ràng: "Cần chạy trong terminal Administrator, hoặc dùng `service install --scheduler` (Task Scheduler, không cần admin, xem §9)".
4. Resolve đường dẫn tuyệt đối của node.exe và script.
5. Tạo WinSW service definition qua `node-windows.Service`.
6. Gọi `svc.install()` (đã chắc chắn elevated ở bước 3).
7. Set `StartType = Automatic` để service tự start khi boot.
8. Ghi vào registry.json.
9. In JSON envelope với service name, executable path, log dir.

**Log (Windows):**
- WinSW ghi stdout/stderr vào `<logDir>/<name>.out.log` và `<name>.err.log`.
- `service logs --follow` sẽ tail -f hai file này (dùng fs.watch hoặc readline).
- Rotation: theo `maxSizeMb` + `keepFiles` trong config.

**Privilege:**
- Cần Admin để đăng ký service — giới hạn cứng của Windows SCM (`CreateService` API luôn đòi admin token), không phụ thuộc lib nào (`node-windows`, WinSW tự bundle, hay `sc.exe` thẳng đều như nhau).
- Check bằng `isAdminUser()` (không dùng `net session` — lệnh đó cũng cần elevated để chạy đúng, dễ false-negative).
- Nếu không phải admin → in hướng dẫn cụ thể như bước 3 ở trên, không chỉ nói chung chung "mở lại terminal".

**Compatibility:**
- `node-windows` bundle theo **WinSW bản cũ** (biên dịch .NET Framework, không phải WinSW v3/.NET 6) — bản này thường **đã có sẵn** trên Windows 10/11 (built-in .NET Framework), nên bước check `dotnet --version` là **thừa** khi dùng `node-windows` và nên bỏ.
- Chỉ cần check `.NET 6+ Runtime` nếu đi theo "Phương án 2: tự bundle WinSW v3" (§8) — hai phương án đang dùng 2 bản WinSW khác nhau, cần chọn 1 và xóa ghi chú compatibility của phương án còn lại để tránh nhầm lẫn khi code.

### 5.2 Linux (src/service/linux.ts)

**Cơ chế:** Generate systemd unit file + gọi systemctl.

**System service** (/etc/systemd/system/<name>.service — cần sudo):

```ini
[Unit]
Description={{description}}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={{user}}
WorkingDirectory={{workingDir}}
ExecStart={{nodePath}} {{scriptArgs}}
Restart=on-failure
RestartSec={{delaySeconds}}s
Environment=KEY=VALUE
StandardOutput=journal
StandardError=journal
SyslogIdentifier={{name}}

[Install]
WantedBy=multi-user.target
```

**User service** (~/.config/systemd/user/<name>.service — không cần sudo, flag --user):
- Thay `WantedBy=multi-user.target` → `WantedBy=default.target`
- Dùng `systemctl --user enable --now <name>`

**Quy trình install:**
1. Detect systemd có chạy không.
2. Resolve node path (which node hoặc process.execPath).
3. Render template → write unit file.
4. `systemctl daemon-reload`
5. `systemctl enable --now <name>`
6. Verify: `systemctl is-active <name>` phải trả về "active".
7. Ghi vào registry.json.

**Log (Linux):**
- `service logs --follow` → spawn `journalctl -u <name> -f -n 50` và pipe stdout.
- `service logs --lines 100` → `journalctl -u <name> -n 100 --no-pager`.
- Không cần cấu hình rotation — journald tự quản lý.

**Privilege:**
- System service: cần sudo. Nếu thiếu → gợi ý --user flag.
- User service: không cần sudo, nhưng cần `loginctl enable-linger <user>` để auto-start khi boot.

### 5.3 Kiểm tra sau install (tích hợp trong service install)

```
[tailsacle-service] INFO  Installing service "tailsacle-relay"...
[tailsacle-service] OK    Service file written: /etc/systemd/system/tailsacle-relay.service
[tailsacle-service] OK    daemon-reload: done
[tailsacle-service] OK    Service enabled and started
[tailsacle-service] OK    Status: active (running) — PID 12345, uptime 3s
[tailsacle-service] OK    Port 5432: LISTEN ✓
[tailsacle-service] OK    Port 5433: LISTEN ✓
[tailsacle-service] OK    Port 5434: LISTEN ✓
```

---

## 6. Logging design

### Format thống nhất

```
[tailsacle-service] 2026-08-19T16:04:41+07:00  INFO   Installing service "tailsacle-relay"...
[tailsacle-service] 2026-08-19T16:04:42+07:00  INFO   Writing unit file...
[tailsacle-service] 2026-08-19T16:04:43+07:00  OK     Service is active — PID 12345
[tailsacle-service] 2026-08-19T16:04:43+07:00  WARN   loginctl linger not enabled — service won't auto-start on boot
[tailsacle-service] 2026-08-19T16:04:43+07:00  ERROR  Port 5432 is already in use
```

- Level: `INFO`, `OK`, `WARN`, `ERROR`
- Màu ANSI: xanh lá (OK), vàng (WARN), đỏ (ERROR) — tắt khi không phải TTY hoặc khi --json
- Flag `--json` → toàn bộ output là JSON envelope chuẩn (như các command khác trong CLI)

---

## 7. Roadmap triển khai (Phases)

### Phase 1 — Core (Linux + Windows)

- [ ] `src/service/types.ts` — Define ServiceConfig, ServiceStatus, ServiceManager
- [ ] `src/service/config.ts` — Load, validate, generate config file
- [ ] `src/service/registry.ts` — Persist installed service list
- [ ] `src/service/linux.ts` — systemd implementation
- [ ] `src/service/windows.ts` — node-windows / WinSW implementation, kèm check `isAdminUser()` + elevate flow (§5.1)
- [ ] `src/service/windows-scheduler.ts` — fallback Task Scheduler (`--scheduler`, không cần admin, xem §9)
- [ ] `src/service/index.ts` — Platform dispatch
- [ ] `src/cli.ts` — Thêm `service` command với các subcommand
- [ ] `src/manifest.ts` — Cập nhật agent manifest
- [ ] Unit tests — mock execSync, mock fs.writeFileSync
- [ ] `service init` sinh file mẫu chính xác
- [ ] `service install` + verify
- [ ] `service uninstall`
- [ ] `service status` + --json
- [ ] `service logs` + --follow
- [ ] `service start|stop|restart`
- [ ] `service list`

### Phase 2 — Polish & Workflows

- [ ] `.github/workflows/service-install-test.yml` — CI test trên ubuntu-latest + windows-latest
- [ ] `examples/service-config.sample.jsonc` — file mẫu đầy đủ
- [ ] Cập nhật README.md, docs/usage.md, examples/README.md
- [ ] macOS launchd support (`src/service/macos.ts`)

### Phase 3 — Advanced

- [ ] Hỗ trợ nhiều config profile (--profile production|staging)
- [ ] `service upgrade` — cập nhật args mà không gỡ cài đặt
- [ ] Healthcheck endpoint tùy chỉnh (HTTP GET verify sau start)
- [ ] Windows Event Log integration

---

## 8. Dependencies cần thêm

```jsonc
// package.json — runtime dependencies
{
  "node-windows": "^1.0.0-beta.8"  // Windows only — dynamic import trong windows.ts
}
```

> **Ghi chú quan trọng:** `node-windows` chỉ được `import()` động trong `src/service/windows.ts`
> khi `process.platform === 'win32'`. Trên Linux/macOS, module này không bao giờ được load.
>
> **Phương án thay thế zero-dependency:** Bundle WinSW v3 binary trực tiếp vào package
> (trong `bin/winsw/`) và generate XML thủ công. Kiểm soát hoàn toàn, không phụ thuộc
> vào npm package có thể bị abandon. **Phương án an toàn nhất cho long-term.**

---

## 9. Điểm mở rộng tương lai

| Tính năng | Ghi chú |
|---|---|
| **Windows Task Scheduler** (`--scheduler`) | **Đưa vào Phase 1**, không để Phase 3 — vì SCM luôn cần admin (giới hạn cứng, xem §5.1), đây là con đường duy nhất chạy nền trên Windows không cần admin, tương đương vai trò của `systemd --user` bên Linux. `schtasks /create /sc onlogon` (không tick "run with highest privileges"). Giới hạn cần nêu rõ với user: chỉ start khi user đã login (không chạy trước khi login như service thật), và cơ chế retry-on-crash yếu hơn SCM/systemd (dùng thêm trigger `/ri` để retry định kỳ thay vì restart tức thời) |
| macOS launchd | Sinh .plist XML vào ~/Library/LaunchAgents/ |
| Docker/container | Không cần service install — relay --file làm entrypoint |
| Systemd socket activation | Service chỉ start khi có connection (lazy start) |
| Ansible/Terraform provisioner | service init --format ansible sinh task YAML |

---

## 10. Câu hỏi cần quyết định trước khi triển khai

1. **Bundle WinSW hay dùng `node-windows`?**
   - `node-windows`: ít code hơn, npm package khá cũ, bundle theo **WinSW bản .NET Framework cũ** (không phải v3) — nhưng chính vì thế thường **không cần cài thêm .NET runtime** trên Win10/11 (đã có sẵn), đơn giản hơn cho end-user.
   - Bundle WinSW v3: không phụ thuộc npm, thêm ~5MB binary, kiểm soát hoàn toàn, nhưng cần .NET 6+ runtime — có thể phải tự bundle self-contained build để tránh bắt user cài thêm.
   - *Gợi ý: Bắt đầu với `node-windows` (ít friction cài đặt hơn cho user), có kế hoạch migration nếu bị abandon. Dù chọn nhánh nào, quy trình elevate ở §5.1 (check `isAdminUser()` trước, không dựa vào UAC tự bật) áp dụng như nhau.*

2. **Có bổ sung macOS (Phase 1) hay để Phase 2?**

3. **User service (rootless) có phải default trên Linux không?**
   - Gợi ý: Default là system service (cần sudo), thêm `--user` flag cho rootless.
   - Cần lưu ý: phải chạy `loginctl enable-linger` để auto-start khi boot.

4. **Log streaming trên Windows**: dùng readline/fs.watch để tail file log của WinSW,
   hay tích hợp Windows Event Log API?
