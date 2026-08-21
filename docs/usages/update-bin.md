# Lệnh `update-bin`

Tải và cập nhật phiên bản nhị phân Tailscale chính thức mới nhất vào thư mục cache của gói (SHA256 checksummed) mà không bao giờ ghi đè lên các bản cài đặt cấp hệ điều hành (như apt/yum/brew). Trên Windows, hỗ trợ tải và cài đặt MSI âm thầm khi có quyền Administrator.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli update-bin [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--dry-run` | `boolean` | `false` | Kiểm tra phiên bản mới nhất trên máy chủ Tailscale mà không tải hay cài đặt. |
| `--yes` | `boolean` | `false` | Bỏ qua xác nhận cài đặt. |
| `--force` | `boolean` | `false` | Bắt buộc tải lại bản nhị phân kể cả khi phiên bản trong cache đã là mới nhất. |
| `--skip-checksum` | `boolean` | `false` | Bỏ qua bước kiểm tra mã băm SHA256 integrity (không khuyến nghị). |
| `--track <track>` | `string` | `stable` | Kênh phân phối phát hành (hiện tại hỗ trợ kênh `stable`). |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Thực tế

### Kiểm tra phiên bản Tailscale mới nhất có sẵn:
```bash
tailsacle-cli update-bin --dry-run --json
```

### Tự động tải và cập nhật vào cache:
```bash
tailsacle-cli update-bin --yes --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "update-bin",
  "resolved": {
    "cached": true,
    "version": "1.102.3",
    "path": "C:\\Users\\user\\.tailsacle-cli\\bin\\tailscale.exe",
    "sha256": "3a7f42299e1d61a56f1b1831..."
  },
  "warnings": [],
  "durationMs": 1200
}
```
