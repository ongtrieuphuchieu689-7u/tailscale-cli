# Hướng dẫn `relay-mcp-postgres` trên Windows

Triển khai TCP Relay PostgreSQL + NexQL MCP Server trên Windows, bao gồm cài đặt, cấu hình, chạy nền (background), và khắc phục sự cố phổ biến.

---

## 1. Yêu cầu Hệ thống

| Thành phần | Phiên bản tối thiểu | Ghi chú |
| :--- | :--- | :--- |
| **Tailscale** | ≥ 1.60 | Đăng nhập lần đầu qua GUI hoặc `tailscale up` |
| **Node.js** | ≥ 22 | Cần `node` trong `PATH` |
| **PostgreSQL** | ≥ 14 | Database đích phải đang chạy và chấp nhận kết nối |
| **Windows** | 10/11, Server 2019+ | PowerShell 7+ khuyến nghị |

---

## 2. Cài đặt

```powershell
# Clone hoặc unzip project
cd H:\nodejs-tester\tailscale-cli
npm install
npm run build

# Xác minh
npx tailsacle-cli --version
npx tailsacle-cli doctor --json
```

---

## 3. Đăng nhập Tailscale (lần đầu)

```powershell
# Cách 1: Login qua GUI (đơn giản nhất)
# Mở Tailscale app → Sign in

# Cách 2: Login qua CLI với auth key
tailscale up --authkey=tskey-auth-XXXXX

# Xác minh
tailscale status
```

> **Lưu ý:** Sau lần đăng đầu tiên, mọi lần chạy `thu.bat` đều **không cần login lại**.

---

## 4. Cấu hình File `docs/deploy/relay-mcp-postgres.json`

```jsonc
[
  {
    "listen": 5431,
    "target": "localhost:5432",
    "user": "postgres",
    "password": "localpassword123",
    "database": "postgres"
  },
  {
    "listen": 5433,
    "target": "192.168.50.79:5433",
    "user": "app_user",
    "password": "app_secret_pass@123",
    "database": "production_db"
  },
  {
    "listen": 5436,
    "target": "192.168.50.79:5436",
    "user": "crm_reader",
    "password": "crm_pass%402026",
    "database": "crm_db"
  },
  {
    "listen": 5437,
    "target": "192.168.50.79:5437",
    "user": "analytics_reader",
    "password": "analytics_pass%402026",
    "database": "warehouse_db"
  }
]
```

---

## 5. Chạy nhanh (Cách 1 — `thu.bat`)

File `thu.bat` đã được cấu hình sẵn. Double-click hoặc chạy trong CMD:

```cmd
cd /d H:\nodejs-tester\tailscale-cli
thu.bat
```

**`thu.bat` sẽ tự động:**

| Bước | Hành vi |
| :--- | :--- |
| 1. Kill process cũ | `Stop-Process -Name node` (nếu có) |
| 2. Reset tailscale serve | Tắt tất cả serve/funnel cũ |
| 3. Check tag node | Verify node đã có tag qua API, skip `tailscale up` nếu đủ |
| 4. Provision tagOwners | Tạo tag + funnel attribute qua API (`--apply-policy`) |
| 5. Enable HTTPS | Bật tailnet HTTPS qua API (`--enable-https`) |
| 6. Start MCP Server | Chạy nền với `start /B`, output ghi vào `relay-output.log` |
| 7. Configure tailscale serve | HTTPS proxy + TCP forward 4 cổng relay |
| 8. Configure tailscale funnel | Công khai 4 cổng relay ra Internet |

**Kết quả:**

```
MCP Server:   http://localhost:8787/mcp (local)
              https://<hostname>.tailadac87.ts.net/mcp (Tailnet/Funnel)

TCP Relays:   5431 → localhost:5432 (Postgres local)
              5433 → 192.168.50.79:5433 (Postgres remote)
              5436 → 192.168.50.79:5436 (Postgres remote)
              5437 → 192.168.50.79:5437 (Postgres remote)
```

---

## 6. Chạy nhanh (Cách 2 — Command Line)

```powershell
$env:TS_CLIENT_SECRET="tskey-client-XXXXX"

node dist/cli.js relay-mcp-postgres `
  --file docs/deploy/relay-mcp-postgres.json `
  --mcp-port 8787 `
  --mcp-bind 0.0.0.0 `
  --token "my-secure-token-12345678" `
  --funnel --serve `
  --apply-policy `
  --enable-https `
  --allow-partial `
  --primary-fallback `
  --yes `
  --json
```

---

## 7. Cài đặt Service Chạy ngầm 24/7

### Cách A: Windows Task Scheduler (không cần Admin)

```powershell
npx tailsacle-cli service install `
  --name pg-relay `
  --file docs/deploy/relay-mcp-postgres.json `
  --scheduler `
  --yes
```

### Cách B: Windows SCM Service (cần Administrator)

```powershell
npx tailsacle-cli service install `
  --name pg-relay `
  --file docs/deploy/relay-mcp-postgres.json `
  --yes
```

### Quản lý Service

```powershell
npx tailsacle-cli service status --name pg-relay --json
npx tailsacle-cli service logs --name pg-relay --follow
npx tailsacle-cli service restart --name pg-relay
npx tailsacle-cli service uninstall --name pg-relay --yes
```

---

## 8. Kết nối từ AI Agent

### Claude Desktop / Cursor / Antigravity / OpenCode

Thêm vào file cấu hình MCP:

```json
{
  "mcpServers": {
    "tailscale-postgres": {
      "url": "https://<hostname>.tailadac87.ts.net/mcp",
      "headers": {
        "Authorization": "Bearer test-secret-token-12345678"
      }
    }
  }
}
```

Hoặc kết nối local (cùng máy):

```json
{
  "mcpServers": {
    "tailscale-postgres": {
      "url": "http://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer test-secret-token-12345678"
      }
    }
  }
}
```

---

## 9. Kết nối Direct TCP (psql, DBeaver, Prisma)

```powershell
# DB local qua relay port 5431
psql "postgres://postgres:localpassword123@localhost:5431/postgres"

# DB remote qua relay port 5433
psql "postgres://app_user:app_secret_pass%40123@localhost:5433/production_db"

# DB qua Tailnet IP
psql "postgres://app_user:app_secret_pass%40123@100.69.183.44:5433/production_db"

# DB qua MagicDNS
psql "postgres://crm_reader:crm_pass%402026@desktop-281kmlh.tailadac87.ts.net:5436/crm_db"
```

**Prisma `.env`:**
```env
DATABASE_URL="postgresql://app_user:app_secret_pass%40123@100.69.183.44:5433/production_db?sslmode=disable"
```

> Đường truyền Tailscale đã mã hóa ở tầng WireGuard L3 nên có thể dùng `sslmode=disable`.

---

## 10. Khắc phục sự cố (Troubleshooting)

### `tailscale serve` không hoạt động — "Serve is not available"

**Nguyên nhân:** Tailscale daemon (`tailscaled`) chưa chạy hoặc chưa login.

```powershell
# Kiểm tra daemon
tailscale status

# Nếu chưa login
tailscale up

# Nếu daemon chết, khởi động lại
tailscale daemon
```

### `tailscale funnel` lỗi "allowed nodes" / "does not include"

**Nguyên nhân:** Node chưa được phép dùng Funnel trong ACL policy.

**Giải pháp:** Chạy lại với `--apply-policy`:
```powershell
npx tailsacle-cli relay-mcp-postgres `
  --file docs/deploy/relay-mcp-postgres.json `
  --funnel --serve `
  --apply-policy `
  --enable-https `
  --yes --json
```

Hoặc thêm thủ công vào Tailscale Admin Console → ACL → `nodeAttrs`:
```jsonc
{
  "attrFunnel": true  // hoặc "tag:your-tag": true
}
```

### `tailscale up --advertise-tags` logout Windows

**Nguyên nhân:** Trên Windows, `tailscale up` với `--reset` (bắt buộc khi có flags) sẽ logout user.

**Giải pháp:** `relay-mcp-postgres` đã tự động skip bước này. Đảm bảo node đã có tag qua Admin Console trước khi chạy.

### Port 8787 bị trùng (`EADDRINUSE`)

```powershell
# Tìm process chiếm port
netstat -ano | findstr ":8787"

# Kill process
Stop-Process -Id <PID> -Force
```

### `tailscale serve` treo khi HTTPS chưa enable

**Giải pháp:** `relay-mcp-postgres` tự động enable HTTPS qua API trước khi chạy `tailscale funnel`. Nếu gặp lỗi, kiểm tra:

```powershell
# Xem tailscale serve status
tailscale serve status --json

# Nếu HTTPS chưa enable, chạy lại với --enable-https
npx tailsacle-cli relay-mcp-postgres `
  --enable-https --yes --json ...
```

### Xem log khi chạy nền

```powershell
# Xem output log
type relay-output.log

# Theo dõi real-time
Get-Content relay-output.log -Wait
```

---

## 11. Danh mục Kết quả JSON

```jsonc
{
  "ok": true,
  "command": "relay-mcp-postgres",
  "resolved": {
    "status": "running",
    "relayCount": 4,
    "mappings": [
      {
        "listenPort": 5431,
        "targetHost": "localhost",
        "targetPort": 5432,
        "serve": true,
        "funnel": true,
        "user": "postgres",
        "password": "***"
      }
      // ...更多 relays
    ],
    "mcp": {
      "port": 8787,
      "bind": "0.0.0.0",
      "token": "***",
      "url": "http://0.0.0.0:8787/mcp"
    },
    "tailscale": {
      "httpsEnabled": true,
      "serveConfigured": true,
      "funnelConfigured": true,
      "tags": ["tag:desktop-281kmlh"],
      "tagOwnersProvisioned": true
    }
  },
  "warnings": [],
  "durationMs": 12345
}
```
