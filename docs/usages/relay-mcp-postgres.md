# Lệnh `relay-mcp-postgres`

Khởi chạy trạm trung chuyển TCP Relay tới các cơ sở dữ liệu PostgreSQL đồng thời cung cấp máy chủ NexQL HTTP MCP Server (`http://<bind>:<port>/mcp`) để các AI Agent (Cursor, Claude Desktop, Antigravity, OpenCode) có thể đọc live schema và truy vấn bất kỳ cơ sở dữ liệu nào qua mạng Tailnet.

---

## 1. Cú pháp & Bảng Tham số

```bash
tailsacle-cli relay-mcp-postgres [options]
```

| Cờ (Flag) | Kiểu | Mặc định | Ý nghĩa & Hành vi |
| :--- | :--- | :---: | :--- |
| `-l, --listen <port>` | `number` | `undefined` | Cổng TCP relay cục bộ lắng nghe (ví dụ `15433`). Dùng kèm với `--target`. |
| `-t, --target <host:port>` | `string` | `undefined` | Địa chỉ đích PostgreSQL (ví dụ `192.168.50.79:5433` hoặc `[fd7a::1]:5432`). |
| `-m, --map <mapping...>` | `string[]` | `[]` | Ánh xạ cổng linh hoạt: `listen:target`, `listen:host:target`, hoặc `[listenHost]:listenPort:[targetHost]:targetPort`. |
| `-f, --file <path>` | `string` | `undefined` | Đường dẫn file cấu hình JSON/JSONC chứa mảng các relay (hỗ trợ comment `//` và cấu hình user/pass riêng cho từng DB). |
| `--host <address>` | `string` | `0.0.0.0` | IP mặc định các cổng relay TCP lắng nghe (`0.0.0.0` cho Tailnet/LAN, `127.0.0.1` cho nội bộ). |
| `--target-host <address>` | `string` | `127.0.0.1` | Host đích mặc định khi cú pháp mapping ở dạng rút gọn `listenPort:targetPort`. |
| `--mcp-port <port>` | `number` | `8787` | Cổng HTTP lắng nghe của máy chủ MCP (`nexql-mcp`). Endpoint là `http://<bind>:<mcp-port>/mcp`. |
| `--mcp-bind <address>` | `string` | `127.0.0.1` | Địa chỉ IP máy chủ MCP lắng nghe (`0.0.0.0` để AI Agent trên Tailnet có thể gọi qua mạng). |
| `--token <token>` | `string` | (auto token) | Bearer token xác thực khi gọi MCP (hoặc đọc từ env `NEXQL_MCP_HTTP_TOKEN`). Luôn được mask trong output. |
| `--user <user>` | `string` | `postgres` | Tên đăng nhập PostgreSQL của endpoint chính (Primary DB). |
| `--password <password>` | `string` | (env `PGPASSWORD`) | Mật khẩu PostgreSQL của endpoint chính. **Tuyệt đối không in ra argv hay process listing.** |
| `--database <database>` | `string` | `postgres` | Database mặc định của endpoint chính để `nexql-mcp` kết nối ban đầu. |
| `--primary-fallback` | `boolean` | `false` | Tự động chuyển Primary MCP sang DB kế tiếp nếu `mapping[0]` bị tắt/unreachable lúc khởi động. |
| `--allow-partial` | `boolean` | `false` | Chế độ **Degraded Mode**: nếu một số cổng bị trùng (`EADDRINUSE`), các cổng relay hợp lệ còn lại vẫn tiếp tục chạy. |
| `--connect-timeout <ms>` | `number` | `5000` | Thời gian chờ tối đa khi kết nối tới máy chủ DB đích trước khi báo lỗi và đóng socket êm. |
| `--db-retry-interval <ms>`| `number` | `5000` | Khoảng thời gian (ms) supervisor thử kết nối lại `nexql-mcp` khi máy chủ PostgreSQL đích tạm thời tắt. |
| `--mcp-ready-timeout <ms>`| `number` | `30000` | Thời gian tối đa chờ `nexql-mcp` khởi động và vượt qua bài kiểm tra nonce handshake. |
| `--log <path>` | `string` | `undefined` | File lưu trữ nhật ký log của `nexql-mcp`. |
| `--serve` | `boolean` | `false` | Tự động cấu hình `tailscale serve` cho các cổng relay vào trong Tailnet. |
| `--funnel` | `boolean` | `false` | Tự động cấu hình `tailscale funnel` công khai ra Internet (yêu cầu `--serve`). |
| `--json` | `boolean` | `false` | Xuất kết quả dưới dạng JSON envelope chuẩn. |

---

## 2. Ví dụ Sử dụng Nhanh

```bash
# Chạy Multi-DB Relay từ file cấu hình, mở MCP cổng 8787 cho Tailnet:
tailsacle-cli relay-mcp-postgres \
  --file ./relays.jsonc \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "$MCP_TOKEN" \
  --allow-partial \
  --primary-fallback
```

Xem chi tiết đầy đủ tại: **[`docs/relay-mcp-postgres.md`](../relay-mcp-postgres.md)**.
