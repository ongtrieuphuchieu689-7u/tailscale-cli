# Lệnh `policy`

Đồng bộ ACL Policy của Tailnet có cơ chế bảo vệ nghiêm ngặt: tải policy hiện tại → so sánh diff (bảo toàn HuJSON comments/trailing commas) → xác thực cú pháp từ xa qua `/acl/validate` → sao lưu cục bộ → ghi với `If-Match` ETag.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli policy [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--file <path>` | `string` | (env `TS_POLICY_FILE`) | Đường dẫn tới file `policy.hujson` cục bộ. |
| `--sync` | `boolean` | `false` | Thực hiện đồng bộ ghi lên Tailnet (khi không dùng `--dry-run`). |
| `--dry-run` | `boolean` | `true` | So sánh diff và validate từ xa mà không ghi đè lên Tailnet. |
| `--yes` | `boolean` | `false` | Bỏ qua bước hỏi xác nhận ghi đè. |
| `--backup-dir <path>` | `string` | `./.tailscale-cli` | Thư mục lưu trữ bản sao lưu policy cũ trước khi ghi. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Thực tế

### Kiểm tra diff và validate policy (Dry-run):
```bash
tailsacle-cli policy --file ./policy.hujson --dry-run --json
```

### Đồng bộ và áp dụng ACL Policy lên Tailnet:
```bash
tailsacle-cli policy --file ./policy.hujson --sync --yes --json
```

---

## 3. Cấu trúc JSON Output (`--json`)

```json
{
  "ok": true,
  "command": "policy",
  "resolved": {
    "valid": true,
    "changed": true,
    "diff": "--- remote\n+++ local\n@@ -10,3 +10,4 @@\n+    \"tag:mcp-agent\": [\"autogroup:admin\"],\n",
    "backupFile": "./.tailscale-cli/policy-backup-1724219000.hujson",
    "written": true,
    "etag": "\"etag-string-123\""
  },
  "warnings": [],
  "durationMs": 420
}
```
