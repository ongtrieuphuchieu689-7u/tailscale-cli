# Lệnh `daemon`

Kiểm tra trạng thái của daemon `tailscaled` cục bộ và quản lý tiến trình userspace daemon do CLI tự động khởi chạy khi hệ thống chưa có daemon hệ thống.

---

## 1. Cú pháp & Tham số

```bash
tailsacle-cli daemon <status|stop> [options]
```

- `<action>`:
  - `status`: Báo cáo trạng thái `tailscaled` đang chạy và tiến trình userspace được theo dõi trong pidfile cache.
  - `stop`: Gửi tín hiệu `SIGTERM` (sau đó là `SIGKILL`) để dừng **chỉ** tiến trình userspace `tailscaled` do CLI tạo ra (không can thiệp vào daemon do systemd hay hệ điều hành quản lý).

---

## 2. Ví dụ Sử dụng Thực tế

### Kiểm tra trạng thái daemon:
```bash
tailsacle-cli daemon status --json
```

### Dừng daemon userspace:
```bash
tailsacle-cli daemon stop --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "daemon",
  "resolved": {
    "action": "status",
    "running": true,
    "tracked": true,
    "trackedAlive": true,
    "pid": 12840,
    "socket": "C:\\Users\\user\\.tailsacle-cli\\cache\\tailscaled.sock"
  },
  "durationMs": 30
}
```
