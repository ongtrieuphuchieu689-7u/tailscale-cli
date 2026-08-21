# Ví dụ Thực tế: PostgreSQL TCP Relays & NexQL HTTP MCP Server

Thư mục này chứa đầy đủ các file cấu hình và ví dụ mẫu cho lệnh `relay-mcp-postgres`.

## 📁 Danh sách File Ví dụ

1. **[`single-db.sh`](./single-db.sh)**: Script mẫu khởi chạy 1 PostgreSQL DB relay qua dòng lệnh CLI.
2. **[`multi-db.jsonc`](./multi-db.jsonc)**: File cấu hình JSONC cho nhiều cơ sở dữ liệu (Multi-DB) với cổng, tài khoản (`user`), mật khẩu (`password`), database và IPv6 riêng biệt.
3. **[`service-systemd.jsonc`](./service-systemd.jsonc)**: Cấu hình cài đặt chạy ngầm tự khởi động cho Linux (systemd user/system service).
4. **[`service-windows.jsonc`](./service-windows.jsonc)**: Cấu hình cài đặt chạy ngầm tự khởi động cho Windows (Task Scheduler hoặc Windows SCM).
5. **[`ai-agent-mcp-config.json`](./ai-agent-mcp-config.json)**: File cấu hình mẫu cho các AI Agent (Cursor, Claude Desktop, Antigravity, OpenCode) kết nối vào máy chủ MCP qua Tailscale.

---

## 🚀 Tóm tắt Lệnh Khởi chạy Nhanh

```bash
# Chạy với file cấu hình multi-db:
tailsacle-cli relay-mcp-postgres \
  --file ./multi-db.jsonc \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "my-secure-token" \
  --allow-partial \
  --primary-fallback

# Cài đặt thành background service trên Windows (không cần admin):
tailsacle-cli service install --file ./service-windows.jsonc --scheduler --yes

# Cài đặt thành background service trên Linux (rootless user):
tailsacle-cli service install --file ./service-systemd.jsonc --user --yes
```

Xem tài liệu đầy đủ tại **[`docs/relay-mcp-postgres.md`](../../docs/relay-mcp-postgres.md)**.
