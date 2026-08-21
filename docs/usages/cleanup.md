# Lệnh `cleanup`

Tìm kiếm và xoá an toàn các thiết bị Tailscale đã offline quá thời hạn cho phép. Lệnh chỉ xoá khi khớp **chính xác hostname và tags** (không bao giờ dùng so khớp chuỗi con) và các thiết bị không có trường `lastSeen` sẽ không bao giờ bị coi là offline.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli cleanup [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--dry-run` | `boolean` | `false` | Liệt kê các node offline ứng viên mà không xoá. |
| `--yes` | `boolean` | `false` | Bỏ qua bước xác nhận tương tác trước khi xoá thiết bị. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Thực tế

### Quét xem các thiết bị offline có thể dọn dẹp:
```bash
tailsacle-cli cleanup --dry-run --json
```

### Xoá các thiết bị offline sau khi xác nhận:
```bash
tailsacle-cli cleanup --yes --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "cleanup",
  "resolved": {
    "candidates": [
      {
        "id": "node-123456",
        "hostname": "ci-runner-old",
        "dnsName": "ci-runner-old.tailnet.ts.net",
        "tags": ["tag:ci"],
        "lastSeen": "2026-08-19T10:00:00Z",
        "offlineSinceSeconds": 172800
      }
    ],
    "deleted": ["node-123456"]
  },
  "warnings": ["destructive: exact candidates only"],
  "durationMs": 890
}
```
