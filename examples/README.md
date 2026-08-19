# Examples — thực hành tailsacle-cli với Tailscale

Bộ ví dụ dùng **`tailsacle-cli`** (npm: `tailsacle-cli@latest`) chạy trên
GitHub Actions runner tạm thời để triển khai các tình huống Tailscale thực tế:
mỗi workflow tự cài CLI, join tailnet, expose dịch vụ và giữ node sống trong
một khoảng thời gian để bạn truy cập từ máy đã join tailnet (desktop, laptop,
máy ảo…).

> Node là **ephemeral** — bị Tailscale xoá ngay khi job kết thúc. Mọi lệnh
> trong workflow đều dùng CLI, không cần cài Tailscale thủ công trên runner.

---

## 1. Các tình huống và workflow thực tế

| Tình huống | Workflow (bản chính thức) | Bản mẫu trong examples | Script đi kèm |
|---|---|---|---|
| **Echo HTTP server** qua tailnet — serve HTTP (MagicDNS) + TCP forwarder (IP trực tiếp) | [tailscale-echo-server.yml](../.github/workflows/tailscale-echo-server.yml) | [tailscale-echo-server.yml](./workflows/tailscale-echo-server.yml) | [echo-server.mjs](./echo-server.mjs) |
| **PostgreSQL** nhẹ (Docker) qua tailnet — truy cập bằng psql/DBeaver qua IP hoặc MagicDNS | [tailscale-postgres.yml](../.github/workflows/tailscale-postgres.yml) | [tailscale-postgres.yml](./workflows/tailscale-postgres.yml) | — |
| **TCP Relay / Trạm trung chuyển Postgres** — chuyển tiếp traffic TCP sang server khác | [tailscale-tcp-relay.yml](../.github/workflows/tailscale-tcp-relay.yml) | [tailscale-tcp-relay.yml](./workflows/tailscale-tcp-relay.yml) | — |
| **Matrix Test: HTTP + Postgres Relay + Serve + Funnel** — chạy song song các job kiểm thử | [tailscale-relay-matrix.yml](../.github/workflows/tailscale-relay-matrix.yml) | [tailscale-relay-matrix.yml](./workflows/tailscale-relay-matrix.yml) | — |

> ⚠️ **Ghi nhận trạng thái kiểm thử:**
> - **TCP Postgres Relay (local & Docker)**: Đã kiểm thử thành công (xác thực handshake MD5/SCRAM qua relay).
> - **HTTP Relay qua Node.js**: Đã kiểm thử thành công trong workflow matrix test.
> - **Public Funnel TCP Relay (`10000:port`) từ Internet vào trạm trung chuyển Postgres**: **Chưa kiểm thử thực địa từ client Internet ngoài tailnet** (được cung cấp sẵn trong workflow `tailscale-relay-matrix.yml` với input `enable_funnel=true` để kiểm thử thêm).

## 2. Lệnh `tailsacle-cli` được dùng

| Lệnh | Ý nghĩa | Dùng trong |
|---|---|---|
| `tailsacle-cli up --yes --apply-policy --no-ssh --json` | Join tailnet: tạo auth key qua OAuth trust credential (`TS_CLIENT_SECRET`), chạy `tailscale up`, tự cấp `tagOwners`/`nodeAttrs` nếu thiếu | tất cả workflow |
| `tailsacle-cli relay --listen <port> --target <host:port>` | Chạy trạm trung chuyển TCP/HTTP relay proxy, forward trực tiếp traffic sang host/port khác | tcp-relay, relay-matrix |
| `tailsacle-cli relay --target-host <host> --map 5432:5432 --map 5433:5433` | Chạy trạm trung chuyển chuyển tiếp cùng lúc nhiều cổng trong 1 tiến trình duy nhất | multi-port relay |
| `tailsacle-cli relay --file examples/relays.sample.jsonc` | Chạy trạm trung chuyển đọc toàn bộ danh sách service và mapping từ file cấu hình | service / daemon |
| `tailsacle-cli serve "http://127.0.0.1:8080" --http 80 --json` | Expose HTTP qua Serve — **route theo Host header**, truy cập bằng MagicDNS name (`http://<hostname>.<tailnet>.ts.net/`) | echo-server |
| `tailsacle-cli serve "tcp://127.0.0.1:8080" --tcp 8080 --json` | TCP forwarder raw — không cần Host matching, **truy cập bằng IP trực tiếp** (`http://<100.x.x.x>:8080/` hoặc `psql -h <100.x.x.x>`) | echo-server + postgres + relay |
| `tailsacle-cli funnel --tcp 10000:<local_port> --yes` | Expose cổng TCP công khai ra Internet thông qua Funnel | relay-matrix |
| `tailsacle-cli status --json` | Lấy tailnet IP + MagicDNS name của node (để in access info) | tất cả workflow |

Các lệnh khác (dùng trong trường hợp mở rộng, xem [docs/usage.md](../docs/usage.md)):

| Lệnh | Tình huống |
|---|---|
| `tailsacle-cli relay -l 5432 -t 100.x.y.z:5432 --serve` | Chạy relay chuyển tiếp Postgres sang máy khác và tự động bật Serve trong tailnet |
| `tailsacle-cli relay --file ./relays.json` | Khởi chạy service trạm trung chuyển nhiều port từ file JSON |
| `tailsacle-cli funnel <target> --json` | Public HTTPS/TCP ra internet (Funnel) — verify public DNS + TLS thật trước khi báo URL |
| `tailsacle-cli dns --enable-magicdns --yes` | Bật MagicDNS cho tailnet |
| `tailsacle-cli policy --file policy.hujson --apply --yes` | Đồng bộ ACL policy có bảo vệ (diff → validate → backup → ETag) |
| `tailsacle-cli cleanup --hostname <name> --yes` | Xoá an toàn device offline khớp chính xác |
| `tailsacle-cli deploy --expose 443=3000 --funnel --yes` | Deploy một lượt: join + expose + funnel |
| `tailsacle-cli doctor --deep --json` | Kiểm tra không side-effect trước khi deploy |

## 3. Chạy workflow

Cần chuẩn bị một lần: thêm **repo secret** `TS_CLIENT_SECRET` (OAuth trust
credential dạng `tskey-client-…`) — CLI tự suy ra client ID từ credential, không
cần thêm gì khác.

```bash
npm install --global tailsacle-cli@latest

# Echo server, giữ node 60 phút, HTTP :80 + TCP forwarder :8080
gh workflow run tailscale-echo-server.yml -f duration_minutes=60

# PostgreSQL, giữ node 120 phút, expose port 5432
gh workflow run tailscale-postgres.yml -f duration_minutes=120

# TCP Relay chuyển tiếp PostgreSQL sang máy đích
gh workflow run tailscale-tcp-relay.yml -f duration_minutes=30

# Chạy Matrix Workflow kiểm thử song song HTTP + Postgres Relay và Serve/Funnel
gh workflow run tailscale-relay-matrix.yml -f duration_minutes=20 -f enable_funnel=true
```

Access info (IP, MagicDNS name, lệnh kết nối) được in trong **step summary**
của run — mở run trên GitHub để xem. Node sống trong `duration_minutes` rồi bị
xoá.

## 4. Kinh nghiệm từ test thực tế (quan trọng)

1. **Serve HTTP route theo Host header, không theo IP** — `http://<100.x.x.x>:80/`
   sẽ timeout; IP access phải qua TCP forwarder (`serve --tcp`).
2. **Runner/codespace chạy userspace tailscaled (không TUN)** — kernel không
   route được tới `100.x`, nên `curl` tới node khác (hoặc chính nó) timeout.
   Chỉ thiết bị có TUN thật (desktop, laptop) mới truy cập được. `tailscale
   ping` vẫn hoạt động vì chạy nội bộ trong tailscaled.
3. **`docker exec` cần `-i`** để forward stdin (ví dụ `psql` nhận SQL qua
   heredoc).
4. **Chờ Postgres sẵn sàng bằng `SELECT 1`**, không dùng `pg_isready` —
   `pg_isready` trả về 0 ngay khi server accept kết nối, nhưng database/role
   chưa chắc đã được tạo xong (race trong init của `postgres:16-alpine`).
5. **Khi dispatch workflow mới, concurrency `cancel-in-progress: true` sẽ kill
   run đang chạy** (và xoá node đang sống) — chỉ dispatch khi không còn dùng
   node cũ.
6. Credential mặc định `testuser`/`pgtest123`/`testdb` trong workflow postgres
   chỉ để kiểm thử nhanh trên node ephemeral riêng tư.