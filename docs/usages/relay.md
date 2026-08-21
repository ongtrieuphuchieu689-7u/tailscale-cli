# Lệnh `relay`

Khởi chạy trạm trung chuyển TCP relay proxy hiệu năng cao (userspace full-duplex) để chuyển tiếp kết nối TCP giữa các máy chủ (đơn cổng, đa cổng lặp lại, hoặc qua file cấu hình JSON/JSONC). Tự động kích hoạt socket `keepalive (30s)` và `TCP_NODELAY`.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli relay [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `-l, --listen <port>` | `number` | `undefined` | Cổng TCP relay cục bộ lắng nghe (ví dụ `5432`). |
| `-t, --target <host:port>` | `string` | `undefined` | Địa chỉ đích cần chuyển tiếp tới (ví dụ `100.x.y.z:5432` hoặc `[fd7a::1]:5432`). |
| `-m, --map <mapping...>` | `string[]` | `[]` | Cấu hình mapping lặp lại: `5432:5433`, `5432:192.168.50.79:5433`, hoặc `[::1]:5432:[fd7a::1]:5433`. |
| `-f, --file <path>` | `string` | `undefined` | Đường dẫn file cấu hình JSON/JSONC chứa mảng các cổng relay. |
| `--host <address>` | `string` | `0.0.0.0` | IP lắng nghe mặc định (`0.0.0.0` cho Tailnet/LAN, `127.0.0.1` cho nội bộ máy). |
| `--target-host <address>` | `string` | `127.0.0.1` | Host đích mặc định khi cú pháp mapping ở dạng rút gọn `listenPort:targetPort`. |
| `--serve` | `boolean` | `false` | Tự động cấu hình `tailscale serve` cho các cổng relay vào trong Tailnet. |
| `--funnel` | `boolean` | `false` | Tự động cấu hình `tailscale funnel` công khai ra Internet (yêu cầu `--serve`). |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Thực tế

### Trường hợp 1: Chuyển tiếp 1 cổng đơn giản
```bash
tailsacle-cli relay -l 5432 -t 192.168.50.79:5433
```

### Trường hợp 2: Chuyển tiếp nhiều cổng cùng lúc bằng `--map`
```bash
tailsacle-cli relay \
  --map 5432:192.168.50.79:5432 \
  --map 5433:192.168.50.79:5433 \
  --map 6379:192.168.50.79:6379 \
  --json
```

### Trường hợp 3: Chạy từ file cấu hình JSON/JSONC
```jsonc
// relays.jsonc
[
  { "listen": 5432, "target": "100.85.22.51:5432" },
  { "listen": 3306, "target": "192.168.1.100:3306" }
]
```
```bash
tailsacle-cli relay --file ./relays.jsonc
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "relay",
  "resolved": {
    "status": "running",
    "relayCount": 2,
    "mappings": [
      { "listenPort": 5432, "targetHost": "100.85.22.51", "targetPort": 5432 },
      { "listenPort": 3306, "targetHost": "192.168.1.100", "targetPort": 3306 }
    ]
  },
  "warnings": [],
  "durationMs": 45
}
```
