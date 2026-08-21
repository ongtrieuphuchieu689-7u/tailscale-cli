# Lệnh `up`

Xác thực và gia nhập Tailnet nhanh chóng (phiên bản rút gọn của `deploy` không bao gồm cấu hình Serve/Funnel).

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli up [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--dry-run` | `boolean` | `false` | Xem trước kế hoạch và thông số kết nối mà không thực sự join. |
| `--yes` | `boolean` | `false` | Tự động đồng ý các bước xác thực mà không hỏi tương tác (TTY). |
| `--apply-policy` | `boolean` | `false` | Cho phép tự động cấp `tagOwners` nếu tag chưa được định nghĩa trong ACL policy. |
| `--cleanup` | `boolean` | `false` | Quét và dọn dẹp các thiết bị offline cùng tên/tag sau khi gia nhập thành công. |
| `--ssh` / `--no-ssh` | `boolean` | `--ssh` | Bật hoặc tắt Tailscale SSH trên node. |
| `--key-expiry <value>`| `string` | `max` | Thời hạn auth key (`max`/`unlimited` tối đa 90 ngày, hoặc số giây). |
| `--tag-owner <owner...>`| `string[]` | `undefined` | Chỉ định chủ sở hữu khi tự động tạo `tagOwners`. |
| `--state-dir <path>` | `string` | `undefined` | Thư mục lưu file trạng thái `tailscaled`. |
| `--backup-dir <path>` | `string` | `./.tailscale-cli`| Thư mục lưu bản sao lưu ACL Policy. |
| `--json` | `boolean` | `false` | Xuất kết quả định dạng JSON envelope. |

---

## 2. Ví dụ Sử dụng Thực tế

### Gia nhập Tailnet với Auth Key có sẵn:
```bash
export TS_AUTH_KEY="tskey-auth-..."
tailsacle-cli up --yes --json
```

### Gia nhập Tailnet qua OAuth Client Secret và bật SSH:
```bash
export TS_CLIENT_SECRET="tskey-client-..."
tailsacle-cli up --apply-policy --ssh --yes
```

---

## 3. Cấu trúc JSON Output

```json
{
  "ok": true,
  "command": "up",
  "resolved": {
    "status": "running",
    "node": {
      "id": "n123456CNTRL",
      "hostname": "worker-node",
      "dnsName": "worker-node.tailnet.ts.net",
      "ips": ["100.69.183.44"]
    }
  },
  "warnings": [],
  "durationMs": 1850
}
```
