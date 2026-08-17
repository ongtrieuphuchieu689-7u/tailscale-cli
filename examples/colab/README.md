# Google Colab: opencode serve qua Tailscale Funnel

Chạy **opencode serve** ngay trong Google Colab và truy cập từ bất kỳ đâu trên
internet qua một Funnel URL công khai — dùng `tailsacle-cli` (zero-config) để
join tailnet, auto-provision (tagOwners / funnel node attribute / tailnet HTTPS)
và verify DNS + TLS trước khi báo thành công.

## Cách dùng

1. Mở một notebook Google Colab (Server/GPU/TPU runtime đều được).
2. Tạo credentials trên [login.tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys)
   (OAuth trust credential `tskey-client-…` được khuyến nghị) hoặc một node auth
   key `tskey-auth-…`.
3. Lưu credential vào **Secrets của Colab** (icon 🔑 bên trái, giống GitHub
   Secrets — private, không bị lộ khi share notebook):
   - `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET` (OAuth trust credential —
     dùng một mình `TS_CLIENT_SECRET` cũng được), **hoặc**
   - `TS_AUTH_KEY`, **hoặc**
   - `TS_API_KEY`
4. Dán cell Python này (load secrets thành env, giống như GitHub Actions inject
   env từ secrets) rồi chạy **trước** cell bash:

   ```python
   from google.colab import userdata
   import os

   for name in ("TS_AUTH_KEY", "TS_OAUTH_CLIENT_ID",
                "TS_OAUTH_CLIENT_SECRET", "TS_API_KEY", "TS_TAILNET"):
       try:
           os.environ[name] = userdata.get(name)
       except Exception:
           pass  # secret chưa đặt thì bỏ qua
   ```

5. Dán toàn bộ nội dung `opencode-funnel-colab.sh` vào **một cell** và chạy.

Script in ra Funnel URL dạng:

```
https://colab-opencode.<tailnet>.ts.net/
```

Mở URL đó trên trình duyệt của bất kỳ thiết bị nào (không cần VPN). Hoặc dùng
API HTTP của opencode serve (xem https://opencode.ai/docs/server) để gọi từ code.

> Bạn cũng có thể chạy script trong **terminal của Colab**
> (`chmod +x opencode-funnel-colab.sh && ./opencode-funnel-colab.sh`).

## Toàn quyền cho opencode — tương đương `--auto`

`opencode serve` là headless nên **không có** flag `--auto` (flag đó chỉ có trên
`tui`/`run`). Tương đương headless của `--auto` là cấu hình permissions:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
```

`"permission": "allow"` auto-approve **mọi** tool (`bash`, `edit`, `read`,
`glob`, `grep`, `webfetch`, …) — không prompt, không chặn gì, đúng như `--auto`.
Script ghi cấu hình này vào cả `~/.config/opencode/opencode.json` (global) lẫn
`opencode.json` (project) và set thêm env `OPENCODE_PERMISSION='{"*":"allow"}'`
như lớp fallback, nên `opencode serve` chạy nền không bao giờ bị treo vì chờ
phê duyệt.

Lưu ý: `deny` rules (nếu có trong các config khác, ví dụ agent/subagent) vẫn
được tôn trọng — giống `--auto`.

## Biến môi trường tùy chọn

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `OPCODE_PORT` | `3000` | Cổng local mà `opencode serve` lắng nghe |
| `TS_HOSTNAME` | `colab-opencode` | Hostname của node; URL = `https://<TS_HOSTNAME>.<tailnet>.ts.net/` |
| `TS_TAILNET` | (mặc định của credential) | Tailnet, ví dụ `mycorp.ts.net` |
| `TS_PROFILE` | `funnel-app` | Profile; `funnel-app` là non-ephemeral (node ephemeral không publish Funnel DNS) |
| `OPENCODE_SERVER_PASSWORD` | (trống) | Basic auth cho URL công khai — **nên đặt** vì Funnel URL là public |

Nếu đặt `OPENCODE_SERVER_PASSWORD`, script hiện chưa tự inject — export nó trước
khi chạy cell, hoặc tự thêm `OPENCODE_SERVER_PASSWORD=...` vào lệnh `opencode
serve`.

## Lần đầu đăng nhập model

`opencode` cần credential của AI provider. Chạy một lần trong terminal của
Colab:

```bash
opencode auth login
```

(chọn provider, dán API key). Sau đó chạy lại cell.

## Xác minh / dừng

```bash
tailsacle-cli daemon status     # trạng thái tailscaled userspace
tailsacle-cli daemon stop       # dừng tailscaled userspace do CLI khởi động
kill $(pgrep -f "opencode serve")   # dừng opencode serve
```

## Gỡ lỗi

- `tail -f /tmp/opencode-serve.log` — log của `opencode serve`.
- Script in ra full JSON envelope khi deploy; nếu có warning/error, đọc mã lỗi
  (`FUNNEL_*`, `PROVISIONED_*`, …) trong envelope.
- Nếu Funnel URL trả về chứng chỉ chưa sẵn sàng, chờ 1–2 phút rồi tải lại
  (Tailscale cấp cert tự động; `deploy --funnel` đã verify DNS + TLS trước khi
  in URL).