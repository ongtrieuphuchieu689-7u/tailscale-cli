# Lệnh `deploy`

Triển khai node toàn diện: giải quyết thông tin xác thực, tạo node auth key nếu cần, thực thi `tailscale up`, xác minh trạng thái `Running`, tự động cấu hình Serve hoặc Funnel và dọn dẹp thiết bị offline.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli deploy [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--dry-run` | `boolean` | `false` | Chỉ lập kế hoạch triển khai và kiểm tra cấu hình, không thay đổi trạng thái node hay tailnet. |
| `--yes` | `boolean` | `false` | Bỏ qua các bước xác nhận tương tác (bắt buộc trong môi trường CI/CD không có TTY). |
| `--expose <target...>` | `string[]` | `[]` | Cổng/URL cần chia sẻ: `3000`, `http://127.0.0.1:8080`, hoặc ánh xạ cổng công khai `PUBLIC=LOCAL` (`443=3000`, `8443=3001`, `10000=5432`). |
| `--funnel` | `boolean` | `false` | Xuất bản dịch vụ ra ngoài Internet công khai qua Tailscale Funnel. |
| `--apply-policy` | `boolean` | `false` | Cho phép tự động cập nhật ACL Policy (thêm `tagOwners`, node attribute `funnel`) với định dạng HuJSON được bảo toàn. |
| `--enable-https` | `boolean` | `false` | Cho phép tự động bật HTTPS trên toàn bộ tailnet nếu đang bị tắt (yêu cầu quyền `all` scope). |
| `--cleanup` | `boolean` | `false` | Tự động quét và xoá các thiết bị offline khớp chính xác hostname/tags sau khi deploy thành công. |
| `--ssh` / `--no-ssh` | `boolean` | `--ssh` | Bật hoặc tắt Tailscale SSH trên node này. |
| `--key-expiry <value>`| `string` | `max` | Thời hạn auth key (`max`/`unlimited` trần 90 ngày, hoặc số giây cụ thể). |
| `--tag-owner <owner...>`| `string[]` | `undefined` | Chủ sở hữu (`autogroup:admin`, email, group) khi tự động cấp `tagOwners`. |
| `--bin <path>` | `string` | `undefined` | Đường dẫn tới file nhị phân `tailscale` tùy chỉnh. |
| `--state-dir <path>` | `string` | `undefined` | Thư mục lưu trạng thái cho tiến trình `tailscaled`. |
| `--backup-dir <path>` | `string` | `./.tailscale-cli`| Thư mục lưu bản sao lưu ACL Policy trước khi ghi đè. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Các Tình huống Sử dụng Thực tế

### Trường hợp 1: Deploy Web Service và mở Funnel công khai ra Internet
```bash
export TS_CLIENT_SECRET="tskey-client-..."
tailsacle-cli deploy \
  --expose 443=3000 \
  --funnel \
  --apply-policy \
  --enable-https \
  --yes \
  --json
```

### Trường hợp 2: Chạy Dry-run để kiểm tra trước kế hoạch
```bash
tailsacle-cli deploy --expose 8080 --dry-run --json
```

### Trường hợp 3: Deploy Backend Node với Tailscale SSH và Cleanup máy cũ
```bash
tailsacle-cli deploy \
  --ssh \
  --cleanup \
  --yes
```

---

## 3. Cấu trúc Output JSON Envelope (`--json`)

```json
{
  "ok": true,
  "command": "deploy",
  "resolved": {
    "status": "running",
    "node": {
      "id": "n123456CNTRL",
      "hostname": "web-prod-01",
      "dnsName": "web-prod-01.tailnet.ts.net",
      "ips": ["100.69.183.44"]
    },
    "exposures": [
      {
        "type": "funnel",
        "port": 443,
        "target": "http://127.0.0.1:3000",
        "url": "https://web-prod-01.tailnet.ts.net/"
      }
    ],
    "policyUpdated": true,
    "httpsEnabled": true
  },
  "warnings": [],
  "durationMs": 4200
}
```
