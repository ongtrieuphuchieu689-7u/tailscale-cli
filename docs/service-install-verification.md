# Kiểm chứng triển khai: `service` command

> **Tài liệu tham chiếu:** [service-install-plan.md](./service-install-plan.md)  
> **Mục đích:** Checklist kiểm chứng đầy đủ sau khi hoàn thành Phase 1 & Phase 2.  
> **Cách dùng:** Đánh dấu `[x]` từng mục sau khi xác nhận thực tế. Tất cả phải pass trước khi bump version và push release.

---

## Mục lục

- [A. Kiểm chứng static (trước khi chạy)](#a-kiểm-chứng-static)
- [B. Kiểm chứng unit tests](#b-unit-tests)
- [C. Kiểm chứng thực tế Linux (systemd)](#c-linux-systemd)
- [D. Kiểm chứng thực tế Windows (SCM)](#d-windows-scm)
- [E. Kiểm chứng edge cases & lỗi](#e-edge-cases)
- [F. Kiểm chứng logs](#f-logs)
- [G. Kiểm chứng CI (GitHub Actions)](#g-ci-github-actions)
- [H. Kiểm chứng tích hợp với relay](#h-tích-hợp-với-relay)
- [I. Kiểm chứng uninstall sạch](#i-uninstall-sạch)
- [J. Acceptance gate](#j-acceptance-gate)

---

## A. Kiểm chứng static

Chạy trước khi bất kỳ test thực tế nào.

```bash
npm run typecheck   # zero error, strict + exactOptionalPropertyTypes
npm run build       # tsc -p tsconfig.build.json -> dist/ không lỗi
npm run format:check
npm test            # tất cả test phải green
npm run smoke       # --help in ra "service" command; agent-manifest có "service" tool
```

| # | Kiểm tra | Lệnh kiểm tra | Kết quả mong đợi |
|---|---|---|---|
| A1 | TypeScript không lỗi | `npm run typecheck` | Exit 0, zero error |
| A2 | Build thành công | `npm run build` | `dist/` có `service/index.js`, `service/linux.js`, `service/windows.js` |
| A3 | Format đúng | `npm run format:check` | All matched files use Prettier code style |
| A4 | All tests green | `npm test` | 0 failing |
| A5 | `--help` có service | `node dist/cli.js --help` | Output chứa dòng `service` |
| A6 | Subcommands đủ | `node dist/cli.js service --help` | Liệt kê: `init`, `install`, `uninstall`, `status`, `logs`, `start`, `stop`, `restart`, `list` |
| A7 | Manifest cập nhật | `node dist/cli.js agent-manifest` | JSON có `"name": "service"` trong mảng `tools` |
| A8 | Không rò secret | `node dist/cli.js service --help 2>&1` | Không có token, key, secret nào xuất hiện |

---

## B. Unit Tests

Phải có coverage đầy đủ cho các module trong `src/service/`.

### B1. `config.ts` — Load & validate & generate

| # | Test case | Đầu vào | Kết quả mong đợi |
|---|---|---|---|
| B1-1 | Load valid config | File JSON hợp lệ | Trả về `ServiceConfig` object đúng fields |
| B1-2 | Load JSONC với comment | File có `// comment` và trailing comma | Vẫn parse thành công |
| B1-3 | Tên service không hợp lệ | `name: "my service!"` | Throw `SERVICE_NAME_INVALID` |
| B1-4 | Thiếu field bắt buộc | Không có `name` | Throw `SERVICE_CONFIG_MISSING_FIELD: name` |
| B1-5 | `workingDir` không tồn tại | `workingDir: "/nonexistent"` | Throw `SERVICE_WORKDIR_NOT_FOUND` |
| B1-6 | Generate mẫu | `generateSampleConfig("my-relay")` | Trả về string JSONC hợp lệ, có field `name: "my-relay"` |
| B1-7 | `user: "current"` resolve | `process.env.USER` = "alice" | Resolve thành "alice" |
| B1-8 | Env secrets mask | `env.TS_CLIENT_SECRET = "tskey-abc"` | Secret bị mask trong log output |

### B2. `registry.ts` — Track installed services

| # | Test case | Kết quả mong đợi |
|---|---|---|
| B2-1 | Ghi service mới | `registry.add(info)` → file JSON có entry |
| B2-2 | Đọc danh sách | `registry.list()` → trả về mảng đúng |
| B2-3 | Xóa service | `registry.remove("name")` → không còn entry |
| B2-4 | Registry file không tồn tại | `registry.list()` → trả về `[]` (không throw) |
| B2-5 | Concurrent write | Ghi đồng thời 2 service → không bị mất data (file lock) |

### B3. `linux.ts` — systemd unit generation

| # | Test case | Kết quả mong đợi |
|---|---|---|
| B3-1 | Render system unit | Config đầy đủ | File `.service` có đủ `[Unit]`, `[Service]`, `[Install]` sections |
| B3-2 | User field đúng | `user: "alice"` | `User=alice` trong `[Service]` |
| B3-3 | Env vars | `env: {A: "1", B: "2"}` | `Environment=A=1` và `Environment=B=2` trong unit |
| B3-4 | Restart policy | `maxRetries: 5, delaySeconds: 10` | `RestartSec=10s` trong unit |
| B3-5 | User service path | `--user` flag | Unit file path là `~/.config/systemd/user/<name>.service` |
| B3-6 | System service path | Không có `--user` | Unit file path là `/etc/systemd/system/<name>.service` |
| B3-7 | SyslogIdentifier | Service name "my-relay" | `SyslogIdentifier=my-relay` |
| B3-8 | Mock execSync | Stub `execSync` | `systemctl daemon-reload` và `systemctl enable --now` được gọi đúng thứ tự |

### B4. `windows.ts` — WinSW / node-windows

| # | Test case | Kết quả mong đợi |
|---|---|---|
| B4-1 | Chỉ load trên win32 | `process.platform = 'linux'` | `import()` không được gọi |
| B4-2 | Config truyền đúng | `name, description, script, args` | node-windows.Service nhận đúng params |
| B4-3 | Env vars | `env: {A: "1"}` | Truyền vào `env` array của node-windows |
| B4-4 | Log dir | `log.dir: "./logs"` | `logpath` được set đúng |

### B5. `index.ts` — Platform dispatch

| # | Test case | Kết quả mong đợi |
|---|---|---|
| B5-1 | Linux dispatch | `process.platform = 'linux'` | Trả về `LinuxServiceManager` |
| B5-2 | Windows dispatch | `process.platform = 'win32'` | Trả về `WindowsServiceManager` |
| B5-3 | Unsupported platform | `process.platform = 'freebsd'` | Throw `SERVICE_PLATFORM_UNSUPPORTED` |

---

## C. Kiểm chứng thực tế — Linux (systemd)

> **Môi trường:** Ubuntu 22.04 LTS, Debian 12, hoặc RHEL 9 (bất kỳ distro có systemd).  
> **Chuẩn bị:** Node.js 22+, `tailsacle-cli` built và linked (`npm link`).

### C1. Happy path — System service (cần sudo)

```bash
# Sinh config
tailsacle-cli service init --name ts-relay-test --out /tmp/ts-relay-test.jsonc

# Kiểm tra file được sinh ra
cat /tmp/ts-relay-test.jsonc
```

- [ ] C1-1: File tồn tại tại path chỉ định
- [ ] C1-2: File là valid JSON (có thể bỏ comment qua `jsonc-parser` hoặc strip)
- [ ] C1-3: Field `name` = `"ts-relay-test"`
- [ ] C1-4: Field `args` có giá trị mặc định hợp lý
- [ ] C1-5: Comment giải thích từng field (JSONC format)

```bash
# Chỉnh config để dùng relay đơn giản (echo server test, không cần TS)
# Sửa: "args": ["relay", "--listen", "19999", "--target", "127.0.0.1:9999"]

sudo tailsacle-cli service install --file /tmp/ts-relay-test.jsonc --yes
```

- [ ] C1-6: In log cài đặt rõ ràng (các bước: write unit → daemon-reload → enable → start → verify)
- [ ] C1-7: Unit file tồn tại: `ls /etc/systemd/system/ts-relay-test.service`
- [ ] C1-8: Service đang chạy: `systemctl is-active ts-relay-test` → `active`
- [ ] C1-9: Service enabled (boot): `systemctl is-enabled ts-relay-test` → `enabled`
- [ ] C1-10: JSON output (`--json`) có đủ: `{ installed, name, unitPath, status, pid }`

### C2. Happy path — User service (không cần sudo)

```bash
tailsacle-cli service install --file /tmp/ts-relay-test.jsonc --user --yes
```

- [ ] C2-1: Unit file tồn tại: `~/.config/systemd/user/ts-relay-test.service`
- [ ] C2-2: Service active: `systemctl --user is-active ts-relay-test` → `active`
- [ ] C2-3: Không yêu cầu sudo trong quá trình install
- [ ] C2-4: Warn về `loginctl enable-linger` nếu chưa bật

### C3. Status

```bash
tailsacle-cli service status --name ts-relay-test
tailsacle-cli service status --name ts-relay-test --json
```

- [ ] C3-1: Hiển thị `active`, PID, uptime
- [ ] C3-2: `--json` trả về `{ name, status, pid, uptime, restartCount }`
- [ ] C3-3: Nếu service không tồn tại → error rõ ràng `SERVICE_NOT_FOUND`

### C4. Logs

```bash
tailsacle-cli service logs --name ts-relay-test --lines 50
tailsacle-cli service logs --name ts-relay-test --follow &
sleep 3 && kill %1
```

- [ ] C4-1: `--lines 50` in ra 50 dòng log gần nhất
- [ ] C4-2: `--follow` stream real-time (journalctl -f)
- [ ] C4-3: Ctrl+C thoát cleanly (không để process zombie)

### C5. Stop / Start / Restart

```bash
tailsacle-cli service stop --name ts-relay-test
systemctl is-active ts-relay-test  # → inactive/dead

tailsacle-cli service start --name ts-relay-test
systemctl is-active ts-relay-test  # → active

tailsacle-cli service restart --name ts-relay-test
```

- [ ] C5-1: Stop → `inactive`
- [ ] C5-2: Start → `active`  
- [ ] C5-3: Restart → service được restart, PID thay đổi
- [ ] C5-4: Mỗi lệnh in status sau khi thực hiện

### C6. List

```bash
tailsacle-cli service list
tailsacle-cli service list --json
```

- [ ] C6-1: Liệt kê `ts-relay-test` trong danh sách
- [ ] C6-2: Hiển thị status (active/inactive), platform, install time
- [ ] C6-3: `--json` trả về mảng JSON

---

## D. Kiểm chứng thực tế — Windows (SCM)

> **Môi trường:** Windows 10/11 Pro hoặc Server 2019/2022 (bất kỳ edition).  
> **Chuẩn bị:** Node.js 22+, .NET Runtime 6+ (hoặc .NET Framework 4.6.1+), Terminal mở với quyền Administrator.

### D1. Happy path

```powershell
# Sinh config
tailsacle-cli service init --name ts-relay-test --out C:\tmp\ts-relay-test.jsonc

# Install
tailsacle-cli service install --file C:\tmp\ts-relay-test.jsonc --yes
```

- [ ] D1-1: File config sinh ra là valid JSON
- [ ] D1-2: Install in ra các bước rõ ràng (write config → sc.exe register → start → verify)
- [ ] D1-3: Service xuất hiện trong Services (`services.msc`): tên "ts-relay-test"
- [ ] D1-4: Service đang Running
- [ ] D1-5: Start type = Automatic
- [ ] D1-6: `sc query ts-relay-test` → `STATE: 4 RUNNING`

### D2. Status

```powershell
tailsacle-cli service status --name ts-relay-test --json
```

- [ ] D2-1: `{ name, status: "running", pid }` 
- [ ] D2-2: Nếu service không tồn tại → error `SERVICE_NOT_FOUND`

### D3. Logs (Windows)

```powershell
tailsacle-cli service logs --name ts-relay-test --lines 50
tailsacle-cli service logs --name ts-relay-test --follow
```

- [ ] D3-1: `--lines 50` đọc từ WinSW log file `<logDir>\ts-relay-test.out.log`
- [ ] D3-2: `--follow` stream real-time (tail file bằng fs.watch + readline)
- [ ] D3-3: Ctrl+C thoát clean

### D4. Stop / Start / Restart

```powershell
tailsacle-cli service stop --name ts-relay-test
# sc query ts-relay-test → STOPPED

tailsacle-cli service start --name ts-relay-test
# sc query ts-relay-test → RUNNING

tailsacle-cli service restart --name ts-relay-test
```

- [ ] D4-1: Stop → `STOPPED`
- [ ] D4-2: Start → `RUNNING`
- [ ] D4-3: Restart → `RUNNING`, PID thay đổi

### D5. Không phải Admin

```powershell
# Mở PowerShell KHÔNG phải Administrator
tailsacle-cli service install --file C:\tmp\ts-relay-test.jsonc --yes
```

- [ ] D5-1: Lỗi rõ ràng: `SERVICE_REQUIRES_ADMIN: Run terminal as Administrator`
- [ ] D5-2: Không crash, không để trạng thái lửng

### D6. .NET thiếu

- [ ] D6-1: Nếu không tìm thấy .NET → error `SERVICE_DOTNET_REQUIRED` kèm link download
- [ ] D6-2: Không crash unhandled

---

## E. Edge Cases & Error Handling

| # | Tình huống | Lệnh | Kết quả mong đợi |
|---|---|---|---|
| E1 | Cài service đã tồn tại | `service install` lần 2 | Error `SERVICE_ALREADY_EXISTS` — không overwrite ngầm |
| E2 | Uninstall service chưa install | `service uninstall --name ghost` | Error `SERVICE_NOT_FOUND` |
| E3 | Config file không tồn tại | `service install --file /no/file.json` | Error `SERVICE_CONFIG_NOT_FOUND` |
| E4 | Port đang bị chiếm | Service relay port 5432 đã được bind | WARN in ra, không fail install |
| E5 | Tên service chứa ký tự đặc biệt | `name: "my relay!"` | Error `SERVICE_NAME_INVALID: only alphanumeric and hyphens allowed` |
| E6 | Script path không tồn tại | `script: "/no/such/script.js"` | Error `SERVICE_SCRIPT_NOT_FOUND` |
| E7 | Service crash ngay sau start | Script throw ngay lập tức | WARN sau 3s + print cuối log |
| E8 | Uninstall khi đang running | `service uninstall` service đang active | Tự động stop trước rồi uninstall; không để orphan |
| E9 | Interrupt install giữa chừng | Ctrl+C khi đang install | Rollback: xóa unit file đã ghi nếu chưa enable |
| E10 | `--json` kèm error | Bất kỳ error nào | JSON envelope `{ ok: false, error: "CODE", message: "..." }` |

---

## F. Kiểm chứng Logs

### F1. Format log output

Chạy `service install` và capture output:

```
[tailsacle-service] 2026-08-19T16:04:41+07:00  INFO   Installing service "ts-relay-test"...
[tailsacle-service] 2026-08-19T16:04:42+07:00  INFO   Writing unit file: /etc/systemd/system/ts-relay-test.service
[tailsacle-service] 2026-08-19T16:04:42+07:00  INFO   Running: systemctl daemon-reload
[tailsacle-service] 2026-08-19T16:04:43+07:00  INFO   Running: systemctl enable --now ts-relay-test
[tailsacle-service] 2026-08-19T16:04:44+07:00  OK     Service is active (running) — PID 12345
[tailsacle-service] 2026-08-19T16:04:44+07:00  OK     Port 19999: LISTEN ✓
```

- [ ] F1-1: Prefix `[tailsacle-service]` trên mỗi dòng
- [ ] F1-2: Timestamp ISO 8601 local timezone
- [ ] F1-3: Level rõ ràng: `INFO`, `OK`, `WARN`, `ERROR`
- [ ] F1-4: Màu ANSI khi chạy trong TTY (OK=xanh lá, WARN=vàng, ERROR=đỏ)
- [ ] F1-5: Không có màu khi pipe sang file: `tailsacle-cli service install ... 2>&1 | cat`
- [ ] F1-6: Secrets bị mask: `TS_CLIENT_SECRET=tskey-****`

### F2. `--json` output format

```json
{
  "ok": true,
  "command": "service install",
  "result": {
    "installed": true,
    "name": "ts-relay-test",
    "platform": "linux",
    "unitPath": "/etc/systemd/system/ts-relay-test.service",
    "status": "active",
    "pid": 12345,
    "portsListening": [19999]
  },
  "warnings": [],
  "durationMs": 1234
}
```

- [ ] F2-1: Đúng structure envelope
- [ ] F2-2: Không có màu ANSI trong JSON
- [ ] F2-3: Secrets vẫn bị mask

---

## G. CI — GitHub Actions

### G1. Linux workflow (`.github/workflows/service-install-test.yml`)

Trigger: `workflow_dispatch` + `push` vào `main` khi có thay đổi trong `src/service/`.

```yaml
# Kiểm tra cần có:
jobs:
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - service init → verify file
      - service install --user --yes → verify systemctl --user is-active
      - service status --json → parse JSON và assert status=active
      - service logs --lines 10 → verify có output
      - service stop → verify inactive
      - service start → verify active
      - service restart → verify PID thay đổi
      - service uninstall --yes → verify unit file xóa
      - service list → verify không còn entry
```

- [ ] G1-1: Workflow file tồn tại tại `.github/workflows/service-install-test.yml`
- [ ] G1-2: Job `test-linux` pass trên `ubuntu-latest`
- [ ] G1-3: Mỗi step in step summary rõ ràng
- [ ] G1-4: Không dùng sudo (test user service với `--user`)

### G2. Windows workflow

```yaml
jobs:
  test-windows:
    runs-on: windows-latest
    steps:
      - Cần chạy với elevated: sử dụng `shell: pwsh` + UAC bypass cho GitHub runner
      - service init → verify file  
      - service install --yes (system service) → sc query verify RUNNING
      - service status --json → assert status=running
      - service logs → verify output
      - service stop/start/restart → verify state transitions
      - service uninstall --yes → verify removed from SCM
```

- [ ] G2-1: Workflow file tồn tại
- [ ] G2-2: Job `test-windows` pass trên `windows-latest`
- [ ] G2-3: .NET Runtime available trên runner (mặc định có)

### G3. Unit test trong CI

- [ ] G3-1: `npm test` chạy trong cả Ubuntu và Windows runner
- [ ] G3-2: Tests cho `linux.ts` chạy được trên Windows (mock `execSync`) 
- [ ] G3-3: Tests cho `windows.ts` chạy được trên Linux (mock `import()`)

---

## H. Tích hợp với Relay

> Đây là use case chính: dùng `service install` để chạy `relay` multi-port dưới dạng daemon.

### H1. End-to-end: relay service với file config

```bash
# Chuẩn bị relay config
cat > /tmp/relays.jsonc << 'EOF'
[
  { "listen": 15432, "target": "127.0.0.1:5432" },
  { "listen": 15433, "target": "127.0.0.1:5433" }
]
EOF

# Sinh service config trỏ vào relay file
tailsacle-cli service init --name pg-relay-svc --out /tmp/pg-relay-svc.jsonc
# Chỉnh: "args": ["relay", "--file", "/tmp/relays.jsonc"]

# Install
sudo tailsacle-cli service install --file /tmp/pg-relay-svc.jsonc --yes
```

- [ ] H1-1: Service chạy thành công
- [ ] H1-2: Port 15432 đang LISTEN: `ss -tlnp | grep 15432`
- [ ] H1-3: Port 15433 đang LISTEN: `ss -tlnp | grep 15433`
- [ ] H1-4: `service logs --follow` in ra relay connection logs
- [ ] H1-5: Sau `service restart` — relay tự reconnect, ports vẫn LISTEN

### H2. Survive reboot

- [ ] H2-1 (Linux): Sau `sudo reboot`, service tự start lại: `systemctl is-active pg-relay-svc` → `active`
- [ ] H2-2 (Windows): Sau restart, service ở trạng thái `RUNNING` trong Services
- [ ] H2-3: Log ghi nhận restart count > 0 sau reboot

---

## I. Uninstall sạch

Sau khi `service uninstall --name <name> --yes`:

| # | Kiểm tra | Linux | Windows |
|---|---|---|---|
| I1 | Unit/service file bị xóa | `/etc/systemd/system/<name>.service` không còn | Registry entry trong SCM bị xóa |
| I2 | Service không còn trong systemd/SCM | `systemctl status <name>` → `not-found` | `sc query <name>` → `FAILED 1060` |
| I3 | Registry file cập nhật | `service list` không còn entry | Như Linux |
| I4 | Log files còn lại (Windows) | N/A | WinSW `.out.log`, `.err.log` không bị xóa (data bảo tồn) |
| I5 | Port được giải phóng | Port không còn LISTEN sau vài giây | Như Linux |

---

## J. Acceptance Gate

> Tất cả mục dưới đây phải **pass** trước khi merge và bump version.

```
[ ] npm run check       → exit 0 (typecheck + test)
[ ] npm run build       → exit 0
[ ] npm run format:check → exit 0
[ ] npm run smoke       → exit 0, output có "service" command

[ ] Tất cả mục A1–A8   (static checks)
[ ] Tất cả mục B1–B5   (unit tests)
[ ] ≥ 80% mục C        (Linux thực tế)
[ ] ≥ 80% mục D        (Windows thực tế)
[ ] Tất cả mục E       (edge cases)
[ ] Tất cả mục F       (logs format)
[ ] Tất cả mục G       (CI workflows)
[ ] Mục H1–H4          (relay integration)
[ ] Tất cả mục I       (uninstall sạch)
```

> **Ghi chú:** Các mục C/D chưa kiểm thử thực địa sẽ được ghi nhận là `[UNTESTED]` trong
> file này và trong CHANGELOG. Phần H2 (survive reboot) được đánh dấu `[UNTESTED-REBOOT]`
> vì không thể kiểm thử trong CI runner hiện tại (runner không hỗ trợ reboot).
