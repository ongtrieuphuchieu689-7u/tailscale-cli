# Hướng dẫn Toàn diện & Ví dụ `relay-mcp-postgres`

Tài liệu này cung cấp hướng dẫn đầy đủ, chi tiết từng tham số (arguments), tình huống triển khai (1 DB, nhiều DB, CLI vs File cấu hình, Tailscale, Background Service) và cách kết nối từ AI Agents (Cursor, Claude Desktop, Antigravity, OpenCode) cũng như Direct TCP Clients (psql, DBeaver, Prisma).

---

## 1. Bảng Tham số (Arguments & Options) Đầy đủ

Lệnh: `tailsacle-cli relay-mcp-postgres [options]` (hoặc `tscli relay-mcp-postgres [options]`)

| Cờ (Flag) | Kiểu & Mặc định | Ý nghĩa & Hành vi chi tiết |
| :--- | :--- | :--- |
| `-l, --listen <port>` | `number` | Cổng TCP relay cục bộ lắng nghe (ví dụ `15433`). Dùng kèm với `--target`. |
| `-t, --target <host:port>` | `string` | Địa chỉ đích PostgreSQL (ví dụ `192.168.50.79:5433` hoặc `[fd7a::1]:5432`). |
| `-m, --map <mapping...>` | `string[]` (lặp lại) | Ánh xạ cổng linh hoạt: `listen:target`, `listen:host:target`, hoặc `[listenHost]:listenPort:[targetHost]:targetPort`. |
| `-f, --file <path>` | `string` (file JSON/JSONC) | Đường dẫn file cấu hình JSON/JSONC chứa mảng các relay (hỗ trợ comment `//` và cấu hình user/pass riêng cho từng DB). |
| `--host <address>` | `string` (mặc định `0.0.0.0`) | Địa chỉ IP mặc định mà các cổng relay TCP sẽ lắng nghe (`0.0.0.0` để mở cho mạng Tailnet/LAN; `127.0.0.1` nếu chỉ dùng nội bộ máy). |
| `--target-host <address>` | `string` (mặc định `127.0.0.1`) | Host đích mặc định khi cú pháp mapping ở dạng rút gọn `listenPort:targetPort`. |
| `--mcp-port <port>` | `number` (mặc định `8787`) | Cổng HTTP lắng nghe của máy chủ MCP (`nexql-mcp`). Endpoint chuẩn là `http://<bind>:<mcp-port>/mcp`. |
| `--mcp-bind <address>` | `string` (mặc định `127.0.0.1`) | Địa chỉ IP máy chủ MCP lắng nghe. **Đặt `0.0.0.0` để các AI Agent trên máy khác trong Tailnet có thể gọi MCP qua mạng.** |
| `--token <token>` | `string` (tự sinh ngẫu nhiên) | Bearer token xác thực khi gọi MCP. Có thể đọc từ env `NEXQL_MCP_HTTP_TOKEN`. Luôn được mask trong output. |
| `--user <user>` | `string` (mặc định `postgres`) | Tên đăng nhập PostgreSQL của endpoint chính (Primary DB). |
| `--password <password>` | `string` (hoặc env `PGPASSWORD`) | Mật khẩu PostgreSQL của endpoint chính. **Tuyệt đối không in ra argv hay process listing.** |
| `--database <database>` | `string` (mặc định `postgres`) | Database mặc định của endpoint chính để `nexql-mcp` kết nối ban đầu. |
| `--primary-fallback` | `boolean` (cờ bật/tắt) | Cho phép tự động chuyển Primary MCP sang DB kế tiếp nếu `mapping[0]` bị tắt/unreachable lúc khởi động. |
| `--allow-partial` | `boolean` (cờ bật/tắt) | Chế độ **Degraded Mode**: nếu một số cổng bị trùng (`EADDRINUSE`), các cổng relay hợp lệ còn lại vẫn tiếp tục chạy bình thường. |
| `--connect-timeout <ms>` | `number` (mặc định `5000`) | Thời gian chờ tối đa khi kết nối tới máy chủ DB đích trước khi báo lỗi và đóng socket êm. |
| `--db-retry-interval <ms>`| `number` (mặc định `5000`) | Khoảng thời gian (ms) supervisor thử kết nối lại `nexql-mcp` khi máy chủ PostgreSQL đích tạm thời tắt hoặc chưa khởi động xong. |
| `--mcp-ready-timeout <ms>`| `number` (mặc định `30000`)| Thời gian tối đa chờ `nexql-mcp` khởi động và vượt qua bài kiểm tra nonce handshake. |
| `--log <path>` | `string` | File lưu trữ nhật ký log của `nexql-mcp` (mặc định nằm trong thư mục cache nhị phân của công cụ). |
| `--serve` | `boolean` | Tự động cấu hình `tailscale serve` cho các cổng relay vào trong Tailnet. |
| `--funnel` | `boolean` | Tự động cấu hình `tailscale funnel` công khai ra ngoài Internet (yêu cầu bật `--serve`). |
| `--json` | `boolean` | Xuất kết quả dưới dạng JSON envelope chuẩn phục vụ tự động hóa. |

---

## 2. Các Trường hợp & Tình huống Triển khai Thực tế

### Trường hợp 1: Cấu hình nhanh 1 Database bằng Dòng lệnh (CLI)

Chuyển tiếp cổng cục bộ `15433` tới Postgres đích `192.168.50.79:5433`, mở MCP trên cổng `8787` cho Tailnet:

```bash
PGPASSWORD="secretpassword" tailsacle-cli relay-mcp-postgres \
  --listen 15433 \
  --target 192.168.50.79:5433 \
  --user postgres \
  --database mydb \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "my-agent-token-12345"
```

---

### Trường hợp 2: Cấu hình Nhiều Database (Multi-DB) bằng Dòng lệnh

Sử dụng cờ lặp `--map` để mở nhiều cổng relay cùng lúc:

```bash
PGPASSWORD="default-password" tailsacle-cli relay-mcp-postgres \
  --map 15431:localhost:5432 \
  --map 15433:192.168.50.79:5433 \
  --map 15437:192.168.50.79:5437 \
  --map 15436:192.168.50.79:5436 \
  --primary-fallback \
  --allow-partial \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "my-agent-token-12345"
```

---

### Trường hợp 3: Cấu hình Bằng File JSONC (Nhiều DB với User/Password Riêng Biệt)

Khi các cơ sở dữ liệu có thông tin xác thực (`user`, `password`, `database`) khác nhau, tạo file cấu hình JSON/JSONC (ví dụ `relays.jsonc`):

```jsonc
// relays.jsonc - Danh sách các trạm chuyển tiếp PostgreSQL & thông số MCP
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
    "listen": 5437,
    "target": "192.168.50.79:5437",
    "user": "analytics_reader",
    "password": "analytics_pass%402026", // Mật khẩu có ký tự đặc biệt được decode an toàn
    "database": "warehouse_db"
  },
  {
    // Hỗ trợ địa chỉ IPv6 Tailnet bracketed
    "listen": 5436,
    "target": "[fd7a:115c:a1e0::cc01:16b1]:5436",
    "user": "postgres",
    "password": "tailnet_db_password",
    "database": "crm_db"
  }
]
```

Chạy với file cấu hình:
```bash
tailsacle-cli relay-mcp-postgres \
  --file ./relays.jsonc \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "my-secure-token-2026" \
  --allow-partial \
  --primary-fallback
```

---

### Trường hợp 4: Cài đặt Thành Service Chạy ngầm 24/7 (Windows & Linux)

Để hệ thống relay và MCP luôn chạy kể cả khi tắt terminal hoặc khởi động lại máy:

#### A. Trên Windows (Task Scheduler - Không cần quyền Administrator):
```cmd
tailsacle-cli service install --name pg-relay --file ./relays.jsonc --scheduler --yes
```

#### B. Trên Windows (Windows SCM Service - Yêu cầu Administrator):
```cmd
tailsacle-cli service install --name pg-relay --file ./relays.jsonc --yes
```

#### C. Trên Linux (systemd User Service - Không cần sudo):
```bash
tailsacle-cli service install --name pg-relay --file ./relays.jsonc --user --yes
```

#### D. Trên Linux (systemd System Service - Yêu cầu sudo):
```bash
sudo tailsacle-cli service install --name pg-relay --file ./relays.jsonc --yes
```

**Quản lý service:**
```bash
tailsacle-cli service status --name pg-relay --json
tailsacle-cli service logs --name pg-relay --follow
tailsacle-cli service restart --name pg-relay
tailsacle-cli service uninstall --name pg-relay --yes
```

---

## 3. Hướng dẫn Kết nối từ Client

### A. Cấu hình AI Agent Kết nối qua MCP (Claude Desktop, Cursor, Antigravity, OpenCode)

Nếu AI Agent nằm trên cùng máy hoặc máy khác trong mạng Tailnet (giả sử Tailscale IP máy relay là `100.69.183.44` hoặc MagicDNS `desktop-281kmlh.tailadac87.ts.net`):

Thêm vào file cấu hình MCP của client (`claude_desktop_config.json`, `.cursor/mcp.json`, hoặc `open-code.json`):

```json
{
  "mcpServers": {
    "tailscale-postgres": {
      "url": "http://100.69.183.44:8787/mcp",
      "headers": {
        "Authorization": "Bearer my-secure-token-2026"
      }
    }
  }
}
```

*AI Agent có thể dùng tool `setup_connection` của `nexql-mcp` để trỏ vào bất kỳ cổng DB nào đã được cấu hình relay (ví dụ cổng 5431, 5433, 5436, 5437) và truy vấn trực tiếp schema/dữ liệu.*

---

### B. Kết nối Direct TCP (psql, DBeaver, pgAdmin, Backend App)

Kết nối trực tiếp như một máy chủ PostgreSQL thông thường qua Tailscale IP hoặc MagicDNS:

```bash
# Kết nối DB local qua relay port 5431
psql "postgres://postgres:localpassword123@100.69.183.44:5431/postgres"

# Kết nối DB production qua relay port 5433
psql "postgres://app_user:app_secret_pass%40123@100.69.183.44:5433/production_db"

# Kết nối DB qua MagicDNS
psql "postgres://postgres:tailnet_db_password@desktop-281kmlh.tailadac87.ts.net:5436/crm_db"
```

Ví dụ cấu hình `DATABASE_URL` trong file `.env` của ứng dụng Node.js/Prisma:
```env
DATABASE_URL="postgresql://app_user:app_secret_pass%40123@100.69.183.44:5433/production_db?sslmode=disable"
```
*(Ghi chú: Đường truyền Tailscale đã được mã hóa ở tầng WireGuard L3 nên có thể dùng `sslmode=disable` hoặc `sslmode=require`).*
