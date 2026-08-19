# Kế hoạch: Tích hợp `service` command — Cài đặt System Service trên Windows & Linux

> **Trạng thái:** ✅ **Đã triển khai (Phase 1 + Phase 2 core)** — 2026-08-19, xem [service-install-verification.md](./service-install-verification.md)  
> **Phiên bản kế hoạch:** 2026-08-19 (v1) → **2026-08-19 (v2, đã review)** → **2026-08-19 (v3, đã triển khai)**  
> **Tác giả:** Thiết kế bởi Antigravity  
> **Ghi chú review v3 (sau khi code):** hệ thống đã code theo đúng thiết kế v2: `src/service/*` (types/config/registry/linux/windows/windows-scheduler/index), CLI `service` 9 subcommands, JSONC config qua `parseHuJson`, registry `~/.tailsacle-cli/services.json`, systemd system/user unit (bỏ `User=` khi user scope — systemd error 216), WinSW XML + `node-windows` dynamic import (optionalDependency), Task Scheduler qua `schtasks` (`--scheduler`), check `loginctl enable-linger`, port detection từ `--listen/--map/--file` (qua `/proc/net/tcp`), poll status + port sau install, secret env mask `****`, rollback unit file khi enable fail. Unit tests B1–B5 + CI workflow `service-install-test.yml` (Linux user service + Windows SCM). macOS launchd để Phase 2 (chưa làm).

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

**Cơ chế thực tế đã triển khai:** Trích xuất binary `winsw.exe` & `winsw.exe.config` từ package `node-windows` (được dynamic import qua `createRequire`), tự sinh file XML cấu hình qua `renderWinSwXml()`, và trực tiếp thực thi `winsw.exe install` / `winsw.exe start`.

**Quy trình install:**
1. Validate config (tên hợp lệ, script tồn tại, ports không conflict).
2. **Kiểm tra quyền admin:** hàm `isAdminUser()` kiểm tra role Administrator bằng PowerShell script `[Security.Principal.WindowsPrincipal]`.
3. Resolve binary WinSW từ `node-windows/bin/winsw/winsw.exe` và thư mục `ProgramData\tailsacle-cli\services\<name>\`.
4. Copy `winsw.exe` và `winsw.exe.config` sang thư mục đích, tạo file `<name>.xml` từ `renderWinSwXml()`.
5. Gọi `winsw.exe install` và `winsw.exe start`.
6. Ghi thông tin service vào registry `~/.tailsacle-cli/services.json`.
7. Trả về kết quả cài đặt và trạng thái service.

**Log (Windows):**
- WinSW ghi stdout/stderr vào `<logDir>/<name>.out.log` và `<name>.err.log`.
- `service logs --follow` tail hai file này bằng `watchFile` và readline.
- Rotation: cấu hình `<sizeThreshold>` và `<keepFiles>` trong XML dựa theo config.

**Privilege:**
- Cần Admin để đăng ký service SCM.
- Nếu không có quyền Admin, hướng dẫn dùng `service install --scheduler` (Windows Task Scheduler).

---

## 7. Roadmap triển khai (Phases)

### Phase 1 — Core (Linux + Windows) ✅ [Đã hoàn thành]

- [x] `src/service/types.ts` — Define ServiceConfig, ServiceStatus, ServiceManager
- [x] `src/service/config.ts` — Load, validate, generate config file
- [x] `src/service/registry.ts` — Persist installed service list (atomic write tmp + rename)
- [x] `src/service/linux.ts` — systemd implementation (system/user scope, lingering check, proc net tcp check)
- [x] `src/service/windows.ts` — node-windows standalone WinSW extraction + XML generator
- [x] `src/service/windows-scheduler.ts` — fallback Task Scheduler (`--scheduler`, không cần admin qua `schtasks`)
- [x] `src/service/index.ts` — Platform dispatch
- [x] `src/cli.ts` — Tích hợp 9 subcommand `service` (`init`, `install`, `uninstall`, `status`, `logs`, `start`, `stop`, `restart`, `list`)
- [x] Unit tests đầy đủ: `service-config.test.ts`, `service-registry.test.ts`, `service-linux.test.ts`, `service-windows.test.ts`, `service-index.test.ts`
- [x] CI workflow `.github/workflows/service-install-test.yml` kiểm thử cả Linux user unit và Windows SCM

### Phase 2 — Polish & Workflows [Đang triển khai]

- [x] `.github/workflows/service-install-test.yml` — CI test trên ubuntu-latest + windows-latest
- [ ] `examples/service-config.sample.jsonc` — file cấu hình mẫu chi tiết cho nhiều kịch bản relay
- [ ] Cập nhật tài liệu chính thức: `README.md`, `docs/usage.md`, `examples/README.md`
- [ ] macOS launchd support (`src/service/macos.ts`)

### Phase 3 — Advanced [Kế hoạch tiếp theo]

- [ ] Hỗ trợ nhiều config profile (`--profile production|staging`)
- [ ] `service upgrade` — cập nhật args và restart service mà không cần uninstall
- [ ] Healthcheck endpoint tùy chỉnh (HTTP GET verify sau start)
- [ ] Windows Event Log integration

---

## 8. Dependencies đã cấu hình

```jsonc
// package.json — optionalDependencies
{
  "optionalDependencies": {
    "node-windows": "^1.0.0-beta.8"  // Dynamic load trên Windows, không gây lỗi khi chạy trên Linux/macOS
  }
}
```

---

## 9. Điểm mở rộng và lưu ý kỹ thuật

| Tính năng | Ghi chú |
|---|---|
| **Windows Task Scheduler** (`--scheduler`) | Đã triển khai trong `src/service/windows-scheduler.ts`. Dùng `schtasks /create /sc onlogon`. Lưu ý: task chạy không cần admin, `service logs` hiện tại hiển thị metadata run history từ `schtasks /query /v`. |
| **macOS launchd** | Sinh file `.plist` XML vào `~/Library/LaunchAgents/` và dùng `launchctl load/unload`. |
| **Docker/container** | Không cần service install — chạy `relay --file` làm PID 1 entrypoint. |

---

## 10. Quyết định kỹ thuật đã chốt (Sau Implementation)

1. **WinSW**: Sử dụng binary bundle trong `node-windows` kết hợp với custom XML generator (`renderWinSwXml`) để không phụ thuộc vào wrapper runtime của package.
2. **macOS Support**: Để Phase 2.
3. **Linux Service Scope**: Mặc định là System service (yêu cầu sudo), hỗ trợ `--user` cho rootless user service (kèm cảnh báo `loginctl enable-linger`).
4. **Log Streaming Windows**: Dùng `watchFile` để tail file `.out.log` và `.err.log` sinh bởi WinSW.

---

## 11. Các công việc cần thực hiện tiếp theo (Action Items)

Dựa trên kết quả review codebase, các bước tiếp theo cần triển khai gồm:

1. **Bổ sung tích hợp UAC elevation trong CLI (`src/cli.ts` / `src/service/windows.ts`):**
   - Khi chạy `service install` trên Windows (không có flag `--scheduler`) mà `isAdminUser()` trả về `false`, tự động gọi `elevateCommand()` hoặc hiển thị thông báo hướng dẫn rõ ràng chuyển sang `--scheduler`.

2. **Cải tiến logging cho Task Scheduler (`src/service/windows-scheduler.ts`):**
   - Cập nhật `taskCommand` để redirect stdout/stderr ra file log trong `~/.tailsacle-cli/logs/<name>.log` để subcommand `service logs` có thể stream/tail log thật sự của tiến trình thay vì chỉ đọc metadata từ `schtasks`.

3. **Cập nhật Documentation & Examples:**
   - Thêm `examples/service-config.sample.jsonc`.
   - Cập nhật tài liệu lệnh `service` trong `README.md` và `docs/usage.md`.

4. **Triển khai Phase 2 — macOS launchd (`src/service/macos.ts`):**
   - Hỗ trợ tạo `.plist` và quản lý qua `launchctl`.
