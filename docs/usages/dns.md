# Lệnh `dns`

Đọc cấu hình DNS của tailnet (nameservers, search paths, domain preferences) hoặc kích hoạt tính năng MagicDNS trên toàn bộ Tailnet.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli dns [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--enable-magicdns` | `boolean` | `false` | Yêu cầu bật tính năng MagicDNS trên tailnet. |
| `--dry-run` | `boolean` | `false` | Xem trước kế hoạch bật MagicDNS mà không thực thi thay đổi. |
| `--yes` | `boolean` | `false` | Bỏ qua bước hỏi xác nhận tương tác. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope. |

---

## 2. Ví dụ Sử dụng Thực tế

### Đọc cấu hình DNS hiện tại của Tailnet:
```bash
tailsacle-cli dns --json
```

### Bật MagicDNS cho Tailnet:
```bash
tailsacle-cli dns --enable-magicdns --yes --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "dns",
  "resolved": {
    "magicDNSEnabled": true,
    "nameservers": ["100.100.100.100"],
    "domains": ["tailnet.ts.net"],
    "routes": {}
  },
  "warnings": [],
  "durationMs": 180
}
```
