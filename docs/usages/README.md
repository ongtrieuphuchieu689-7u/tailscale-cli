# Tổng quan & Mục lục Lệnh CLI (`docs/usages/`)

Tài liệu chi tiết cho từng lệnh (subcommand) của `tailsacle-cli` (và `tscli`, `tailscale-cli-opencode`). Mỗi file mô tả đầy đủ bảng tham số, cấu hình, ví dụ thực tế và cấu trúc JSON output.

---

## 📑 Danh mục Lệnh

| Lệnh (Subcommand) | File Chi tiết | Mục đích & Chức năng chính |
| :--- | :--- | :--- |
| **`doctor`** | [`doctor.md`](./doctor.md) | Chẩn đoán môi trường, phát hiện credential, kiểm tra quyền API & binary Tailscale không gây side-effect. |
| **`deploy`** | [`deploy.md`](./deploy.md) | Triển khai node toàn diện: resolve auth, join tailnet, auto-provision policy/HTTPS, configure Serve/Funnel. |
| **`up`** | [`up.md`](./up.md) | Join tailnet nhanh gọn sử dụng auth key có sẵn hoặc tự sinh từ trust credential. |
| **`status`** | [`status.md`](./status.md) | Xem trạng thái kết nối Tailscale cục bộ, IP Tailnet, MagicDNS và nguồn gốc credential. |
| **`update-bin`** | [`update-bin.md`](./update-bin.md) | Tải và cập nhật nhị phân Tailscale chính thức vào cache an toàn (SHA256 verified) hoặc cài đặt MSI trên Windows. |
| **`funnel`** | [`funnel.md`](./funnel.md) | Expose dịch vụ công khai ra Internet (Funnel) kèm xác thực DNS và TLS thật trước khi trả về URL. |
| **`serve`** | [`serve.md`](./serve.md) | Chia sẻ dịch vụ nội bộ bên trong mạng Tailnet (HTTP route hoặc TCP raw forwarder). |
| **`relay`** | [`relay.md`](./relay.md) | Trạm trung chuyển TCP relay proxy hiệu năng cao (đơn cổng, đa cổng, file config, IPv6, keepalive). |
| **`relay-mcp-postgres`** | [`relay-mcp-postgres.md`](./relay-mcp-postgres.md) | TCP Relay PostgreSQL kết hợp máy chủ NexQL HTTP MCP phục vụ AI Agent truy vấn live schema. |
| **`dns`** | [`dns.md`](./dns.md) | Đọc cấu hình DNS tailnet, nameservers và hỗ trợ bật MagicDNS có kiểm soát. |
| **`policy`** | [`policy.md`](./policy.md) | Đồng bộ ACL policy Tailnet an toàn: fetch → diff → validate → backup → ETag-protected write. |
| **`cleanup`** | [`cleanup.md`](./cleanup.md) | Quét và dọn dẹp các thiết bị offline khớp chính xác hostname/tags sau xác nhận bảo vệ. |
| **`service`** | [`service.md`](./service.md) | Quản lý vòng đời chạy ngầm 24/7: Linux systemd (system/user), Windows SCM, Windows Task Scheduler. |
| **`daemon`** | [`daemon.md`](./daemon.md) | Kiểm tra và quản lý tiến trình userspace `tailscaled` do CLI khởi chạy. |
| **`agent-manifest`** | [`agent-manifest.md`](./agent-manifest.md) | Xuất schema hợp đồng định dạng JSON (manifest v2) phục vụ AI Agent và CI/CD. |
| **`opencode`** | [`opencode.md`](./opencode.md) | Tự động cài đặt, serve opencode full permission và publish ra Internet qua Tailscale Funnel. |

---

## 🛡️ Nguyên tắc Chung (Guardrails)

- **Không bao giờ lộ Secret:** Mọi mật khẩu, token, API key đều được che giấu (`***`) trong log console và JSON envelope.
- **Hỗ trợ Tự động hóa (`--json`):** Mọi lệnh đều hỗ trợ xuất envelope JSON chuẩn: `{ ok, command, durationMs, resolved, warnings, error }`.
- **Hỗ trợ File Cấu hình:** Nhận file `tailscale-cli.config.json` hoặc `--config <path>` làm giá trị mặc định.
