# Lệnh `serve`

Chia sẻ và định tuyến dịch vụ nội bộ bên trong mạng Tailnet (chỉ các thiết bị trong Tailnet của bạn mới có thể truy cập, không mở ra Internet).

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli serve <target> [options]
```

| Tham số / Cờ | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `<target>` | `string` (bắt buộc) | | Địa chỉ đích: `http://127.0.0.1:8080`, `3000`, hoặc `tcp://127.0.0.1:5432`. |
| `--https <port>` | `number` | `undefined` | Lắng nghe cổng HTTPS trong Tailnet (định tuyến theo MagicDNS Host header). |
| `--http <port>` | `number` | `undefined` | Lắng nghe cổng HTTP trong Tailnet (định tuyến theo MagicDNS Host header). |
| `--tcp <port>` | `number` | `undefined` | Chuyển tiếp TCP raw trực tiếp — **cho phép truy cập bằng Tailscale IP trực tiếp** mà không cần Host header matching. |
| `--path <path>` | `string` | `/` | Đặt URL path prefix. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope. |

---

## 2. Ví dụ Sử dụng Thực tế

### Trường hợp 1: Serve Web App HTTP cổng 80 trong Tailnet (Truy cập bằng MagicDNS)
```bash
tailsacle-cli serve "http://127.0.0.1:3000" --http 80 --json
# Truy cập: http://<node-name>.<tailnet>.ts.net/
```

### Trường hợp 2: Serve TCP Raw cho PostgreSQL (Truy cập bằng Tailscale IP)
```bash
tailsacle-cli serve "tcp://127.0.0.1:5432" --tcp 5432 --json
# Truy cập trực tiếp: psql -h 100.x.y.z -p 5432
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "serve",
  "resolved": {
    "target": "tcp://127.0.0.1:5432",
    "public": false,
    "path": "/"
  },
  "warnings": [],
  "durationMs": 120
}
```
