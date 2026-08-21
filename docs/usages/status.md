# Lệnh `status`

Hiển thị trạng thái kết nối Tailscale của node hiện tại, bao gồm Backend State, địa chỉ IPv4/IPv6 Tailscale, MagicDNS domain và chi tiết phân giải credential.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli status [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--show-resolution` | `boolean` | `false` | Bổ sung thêm thông tin về nguồn gốc credential (`source`, `type`, `masked`) vào JSON kết quả. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Thực tế

### Xem trạng thái văn bản đơn giản:
```bash
tailsacle-cli status
```

### Xem chi tiết JSON phục vụ tự động hóa và AI Agent:
```bash
tailsacle-cli status --show-resolution --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "status",
  "resolved": {
    "status": {
      "BackendState": "Running",
      "Self": {
        "HostName": "DESKTOP-281KMLH",
        "DNSName": "desktop-281kmlh.tailnet.ts.net.",
        "TailscaleIPs": ["100.69.183.44", "fd7a:115c:a1e0::2e01:b7ba"],
        "Online": true
      },
      "CurrentTailnet": {
        "Name": "my-tailnet",
        "MagicDNSEnabled": true
      }
    },
    "credential": {
      "source": "TS_CLIENT_SECRET",
      "type": "oauth_client",
      "masked": "tskey-client-***"
    }
  },
  "durationMs": 45
}
```
