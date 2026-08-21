# Lệnh `funnel`

Xuất bản dịch vụ cục bộ ra Internet công khai (Public Funnel) với tên miền `*.ts.net`. Lệnh tự động phát hiện target từ `$PORT`, kiểm tra quyền hạn, tự cấp `funnel` node attribute/HTTPS (nếu dùng `--apply-policy`), và **xác minh bản ghi A public DNS cùng với bắt tay TLS/TCP thật** trước khi trả về URL.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli funnel [target] [options]
```

| Tham số / Cờ | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `[target]` | `string` | `$PORT` hoặc `3000` | Target cục bộ: `3000`, `localhost:8080`, `http://127.0.0.1:3000`, hoặc `tcp://127.0.0.1:5432`. |
| `--https <port>` | `number` | `443` | Cổng HTTPS công khai (chỉ chấp nhận `443`, `8443`, hoặc `10000`). |
| `--tcp <public:local>` | `string` | `undefined` | Chuyển tiếp TCP raw thay vì HTTPS (ví dụ `10000:5432`). |
| `--expose <target...>` | `string[]` | `[]` | Cấu hình nhiều ánh xạ cổng công khai lặp lại (`443=3000`, `443/api=3001`, `8443=3002`). |
| `--path <path>` | `string` | `/` | Đường dẫn URL path prefix. |
| `--yes` | `boolean` | `false` | Tự động đồng ý cấu hình mà không hỏi xác nhận. |
| `--apply-policy` | `boolean` | `false` | Cho phép tự động thêm `funnel` node attribute vào ACL Policy nếu thiếu. |
| `--enable-https` | `boolean` | `false` | Bật tính năng cấp chứng chỉ HTTPS cho toàn bộ tailnet qua API. |
| `--verify-timeout <sec>`| `number` | `120` | Thời gian tối đa (giây) chờ public DNS lan truyền và endpoint phản hồi HTTP/TLS thật. |
| `--state-dir <path>` | `string` | `undefined` | Thư mục trạng thái của `tailscaled`. |
| `--json` | `boolean` | `false` | Xuất kết quả định dạng JSON envelope. |

---

## 2. Ví dụ Sử dụng Thực tế

### Trường hợp 1: Funnel cổng 3000 ra HTTPS Internet cổng 443
```bash
tailsacle-cli funnel 3000 --apply-policy --enable-https --yes --json
```

### Trường hợp 2: Funnel TCP Raw cổng 10000 chuyển tiếp tới Postgres cục bộ 5432
```bash
tailsacle-cli funnel --tcp 10000:5432 --yes
```

### Trường hợp 3: Expose nhiều service trên cùng 1 domain với các path khác nhau
```bash
tailsacle-cli funnel \
  --expose 443=3000 \
  --expose 443/api=3001 \
  --expose 8443=8080 \
  --yes
```

---

## 3. Cấu trúc Output JSON Envelope (`--json`)

```json
{
  "ok": true,
  "command": "funnel",
  "resolved": {
    "target": "http://127.0.0.1:3000",
    "dnsName": "my-server.tailnet.ts.net",
    "urls": ["https://my-server.tailnet.ts.net/"],
    "verified": true,
    "verifyAttempts": 3
  },
  "warnings": [],
  "durationMs": 5400
}
```

---

## 4. Lưu ý An toàn & Khắc phục Lỗi
- `FUNNEL_EPHEMERAL`: Node ephemeral không bao giờ được cấp DNS công khai; phải đặt `TS_EPHEMERAL=false`.
- `FUNNEL_ENDPOINT_UNREACHABLE`: Public DNS đã trỏ nhưng server cục bộ chưa chạy hoặc không trả lời HTTP request.
- `HTTPS_DISABLED`: Tailnet chưa bật HTTPS; thêm `--enable-https` để CLI tự động bật qua API.
