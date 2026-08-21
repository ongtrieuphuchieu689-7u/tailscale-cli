# Lệnh `opencode` (`tailscale-cli-opencode`)

Khởi chạy và tự động hóa toàn bộ quy trình OpenCode AI: tự động cài đặt `opencode` (thông qua `npx -y opencode-ai`), cấp toàn bộ quyền thực thi (ghi file `opencode.json` với `"permission": "allow"` tương đương cờ `--auto`), khởi chạy `opencode serve` ở chế độ nền, gia nhập mạng Tailnet và xuất bản dịch vụ ra Internet công khai qua Tailscale Funnel. Sau đó, tiến hành xác minh bản ghi public DNS và bắt tay live TLS/HTTP thật trước khi trả về URL.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailscale-cli-opencode [options]
# hoặc: tailsacle-cli opencode [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `--port <number>` | `number` | `3000` | Cổng cục bộ mà `opencode serve` sẽ lắng nghe. |
| `--install` | `boolean` | `false` | Bắt buộc cài đặt/cập nhật opencode qua `npx -y opencode-ai` kể cả khi đã có nhị phân. |
| `--opencode-config <path>` | `string` | (mặc định ~/.config/opencode/opencode.json) | Đường dẫn tới file `opencode.json` cấu hình phân quyền headless. |
| `--no-verify` | `boolean` | `false` | Bỏ qua bước kiểm tra public DNS và live TLS endpoint sau khi tạo Funnel. |
| `--verify-timeout <seconds>` | `number` | `120` | Thời gian tối đa (giây) chờ DNS lan truyền và TLS endpoint sẵn sàng. |
| `--dry-run` | `boolean` | `false` | Chỉ lập kế hoạch chạy, không cài đặt, không serve và không deploy. |
| `--stop` | `boolean` | `false` | Dừng tiến trình `opencode serve` và userspace `tailscaled` đang được theo dõi. |
| `--apply-policy` | `boolean` | `false` | Tự động cập nhật ACL Policy (cấp `tagOwners` và node attribute `funnel`). |
| `--enable-https` | `boolean` | `false` | Tự động kích hoạt HTTPS trên Tailnet (bắt buộc đối với Funnel). |
| `--yes` | `boolean` | `false` | Bỏ qua các bước xác nhận tương tác. |
| `--state-dir <path>` | `string` | `undefined` | Thư mục lưu trạng thái `tailscaled`. |
| `--backup-dir <path>` | `string` | `./.tailscale-cli` | Thư mục lưu backup ACL policy. |
| `--tag-owner <owner...>` | `string[]` | `undefined` | Chủ sở hữu cho tag được auto-provision. |
| `--credential-env <name>` | `string` | `undefined` | Tên biến môi trường chứa Tailscale trust credential. |
| `--profile <profile>` | `string` | `undefined` | Ghi đè profile Tailscale active. |
| `--config <path>` | `string` | `undefined` | Đường dẫn file `tailscale-cli.config.json`. |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Các Tình huống Sử dụng Thực tế

### Trường hợp 1: Chạy OpenCode Funnel một lệnh duy nhất
```bash
export TS_CLIENT_SECRET="tskey-client-..."
tailscale-cli-opencode --yes --apply-policy --enable-https --json
# -> Public URL: https://<hostname>.<tailnet>.ts.net/
```

### Trường hợp 2: Chạy trên Google Colab / Remote VM
```bash
npx tailscale-cli-opencode \
  --install \
  --port 3000 \
  --yes \
  --apply-policy \
  --enable-https
```

### Trường hợp 3: Dừng OpenCode và giải phóng tài nguyên
```bash
tailscale-cli-opencode --stop --json
```

---

## 3. Cấu trúc Output JSON Envelope (`--json`)

```json
{
  "ok": true,
  "command": "opencode",
  "resolved": {
    "opencode": {
      "runner": "npx",
      "pid": 14200,
      "command": "opencode serve --port 3000",
      "port": 3000,
      "configPath": "/root/.config/opencode/opencode.json",
      "permissionConfig": { "permission": "allow" },
      "permissionWritten": true,
      "permissionExisting": false,
      "logPath": "/root/.tailsacle-cli/cache/opencode-serve.log"
    },
    "deployment": {
      "status": "running",
      "node": {
        "hostname": "opencode-colab",
        "dnsName": "opencode-colab.tailnet.ts.net",
        "ips": ["100.69.183.44"]
      }
    },
    "dnsName": "opencode-colab.tailnet.ts.net",
    "urls": ["https://opencode-colab.tailnet.ts.net/"],
    "verified": true,
    "verifyAttempts": 2
  },
  "warnings": [],
  "durationMs": 7500
}
```
