# Lệnh `service`

Quản lý toàn diện vòng đời chạy ngầm 24/7 (Background Daemon) của relay hoặc bất kỳ script nào. Hỗ trợ 4 nền tảng chính:
- **Linux systemd system service** (cần `sudo`)
- **Linux systemd user service** (rootless, không cần `sudo`)
- **Windows SCM Service** (WinSW qua `node-windows`, yêu cầu quyền Administrator)
- **Windows Task Scheduler** (`--scheduler`, không cần quyền Administrator)

---

## 1. Danh sách Subcommands & Bảng Tham số

### `service init` - Khởi tạo file cấu hình mẫu
```bash
tailsacle-cli service init [--name <name>] [--out <file>]
```
- `--name <name>`: Tên service (mặc định `tailsacle-relay`).
- `--out <file>`: Đường dẫn file xuất ra (mặc định `.tailsacle-service.jsonc`).

---

### `service install` - Cài đặt và kích hoạt service
```bash
tailsacle-cli service install --file <config.jsonc> [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--file <config>` | `string` (bắt buộc) | | Đường dẫn file cấu hình JSON/JSONC của service. |
| `--user` | `boolean` | `false` | Cài dưới dạng systemd user service trên Linux (không cần sudo). |
| `--scheduler` | `boolean` | `false` | Cài qua Windows Task Scheduler thay vì Windows SCM (không cần Admin). |
| `--yes` | `boolean` | `false` | Bỏ qua bước hỏi xác nhận trước khi cài đặt. |

---

### `service uninstall` - Gỡ bỏ và xoá service
```bash
tailsacle-cli service uninstall --name <name> [--yes]
```
- Dừng service và gỡ bỏ hoàn toàn file unit/task definition.

---

### `service status` - Xem trạng thái chi tiết
```bash
tailsacle-cli service status --name <name> [--json]
```
- Trả về: `status` (`running`/`stopped`/`error`), `pid`, `uptimeSeconds`, `restartCount`.

---

### `service logs` - Xem và theo dõi nhật ký log
```bash
tailsacle-cli service logs --name <name> [--lines <n>] [--follow]
```
- `--lines <n>`: Số dòng log xem gần nhất (mặc định `50`).
- `--follow`: Stream log theo thời gian thực (như `journalctl -f` hoặc `tail -f`).

---

### `service start` / `stop` / `restart` - Điều khiển tiến trình
```bash
tailsacle-cli service start --name <name>
tailsacle-cli service stop --name <name>
tailsacle-cli service restart --name <name>
```

---

### `service list` - Liệt kê tất cả service đã cài đặt
```bash
tailsacle-cli service list [--json]
```

---

## 2. Cấu trúc File Cấu hình Service (`.tailsacle-service.jsonc`)

```jsonc
{
  "name": "pg-relay-service",
  "description": "PostgreSQL Relay & NexQL MCP Service",
  "workingDir": "/home/app/relays", // hoặc "C:\\relays" trên Windows
  "args": [
    "relay-mcp-postgres",
    "--file", "./relays.jsonc",
    "--mcp-port", "8787",
    "--mcp-bind", "0.0.0.0",
    "--allow-partial",
    "--primary-fallback"
  ],
  "env": {
    "NEXQL_MCP_HTTP_TOKEN": "my-secret-token"
  },
  "restart": {
    "policy": "always", // "always" | "on-failure" | "never"
    "delaySeconds": 5
  },
  "log": {
    "dir": "/home/app/.tailsacle-cli/logs",
    "maxSizeMb": 10,
    "keepFiles": 5
  }
}
```

---

## 3. Ví dụ Triển khai Thực tế

### Trên Windows không cần Admin:
```cmd
tailsacle-cli service install --file ./service.jsonc --scheduler --yes
tailsacle-cli service status --name pg-relay-service --json
```

### Trên Linux không cần Sudo:
```bash
tailsacle-cli service install --file ./service.jsonc --user --yes
# Bật tự khởi động khi boot (không cần đăng nhập session):
loginctl enable-linger $USER
```
