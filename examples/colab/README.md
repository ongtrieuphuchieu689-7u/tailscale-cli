# Google Colab: opencode serve qua Tailscale Funnel

Chạy **opencode serve** ngay trong Google Colab và truy cập từ bất kỳ đâu trên
internet qua một Funnel URL công khai — dùng bin `tailscale-cli-opencode`
(zero-config, có sẵn trong gói `tailsacle-cli`) để resolve/install opencode,
join tailnet, auto-provision (tagOwners / funnel node attribute / tailnet HTTPS)
và verify DNS + TLS trước khi báo thành công.

## Cách dùng

**Cách 1 (khuyến nghị — một cell):** mở notebook có sẵn
[`opencode-funnel-colab.ipynb`](opencode-funnel-colab.ipynb) trong Colab
(File → Upload notebook, hoặc
colab.research.google.com/github/ongtrieuphuchieu689-7u/tailscale-cli/blob/main/examples/colab/opencode-funnel-colab.ipynb),
đặt credential vào 🔑 Secrets, rồi chỉ cần chạy cell code duy nhất — nó tự đọc
secrets bằng `userdata.get()` và chạy script funnel luôn. Cũng có thể dán nội
dung [`colab-cell.py`](colab-cell.py) vào một cell trống của notebook bất kỳ.

**Cách 3 (ngắn nhất — một lệnh duy nhất):** nếu notebook là riêng tư (không
share), chỉ cần một cell `%%bash` chứa một dòng — dán thẳng credential vào
lệnh, mọi thứ khác (cài CLI, opencode, config, serve, funnel, verify) tự động:

```bash
%%bash
TS_CLIENT_SECRET="tskey-client-…" npx -y -p tailsacle-cli tailscale-cli-opencode --install --yes --apply-policy --enable-https --json
```

(Thay `TS_CLIENT_SECRET` bằng `TS_AUTH_KEY`/`TS_OAUTH_CLIENT_SECRET`/`TS_ACCESS_TOKEN`/`TS_API_KEY` nếu dùng credential đó.) Nhược điểm: secret hiển thị trong notebook — không dùng khi share notebook; Cách 1 (🔑 Secrets) an toàn hơn.

**Cách 2 (hai cell):** như dưới đây.

1. Mở một notebook Google Colab (Server/GPU/TPU runtime đều được).
2. Tạo credentials trên [login.tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys)
   (OAuth trust credential `tskey-client-…` được khuyến nghị) hoặc một node auth
   key `tskey-auth-…`.
3. Lưu credential vào **Secrets của Colab** (icon 🔑 bên trái, giống GitHub
   Secrets — private, không bị lộ khi share notebook). **Tên secret phải đúng
   chính xác** một trong các tên dưới (Colab không tự inject vào cell bash —
   bước 4 làm việc đó):
   - `TS_CLIENT_SECRET` (OAuth trust credential `tskey-client-…` — dùng một
     mình được, client ID tự suy ra), **hoặc**
   - `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET`, **hoặc**
   - `TS_AUTH_KEY`, **hoặc**
   - `TS_ACCESS_TOKEN` / `TS_API_KEY`
4. **BẮT BUỘC:** dán cell Python này vào một cell, chạy **trước** cell bash
   (env set trong cell Python sẽ truyền vào cell `%%bash`; nếu bỏ qua bước này
   cell bash báo lỗi "no Tailscale credential found"):

   ```python
   from google.colab import userdata
   import os

   for name in ("TS_CLIENT_SECRET", "TS_AUTH_KEY", "TS_OAUTH_CLIENT_ID",
                "TS_OAUTH_CLIENT_SECRET", "TS_ACCESS_TOKEN", "TS_API_KEY",
                "TS_TAILNET"):
       try:
           os.environ[name] = userdata.get(name)
       except Exception:
           pass  # secret chưa đặt thì bỏ qua
   ```

5. Mở một **cell trống** trong notebook, dán **toàn bộ** nội dung
   `opencode-funnel-colab.sh` vào rồi chạy. Dòng đầu tiên của file đã là
   `%%bash` (Colab cell magic) nên không cần sửa gì — nếu xoá dòng này, Colab
   sẽ chạy cell như Python và báo lỗi.

Script chỉ là wrapper mỏng: cài Node 22+ và `tailsacle-cli`, rồi giao toàn bộ
việc còn lại cho **một lệnh** `tailscale-cli-opencode --port … --install --yes
--apply-policy --enable-https --json` — opencode được resolve qua npx, permission
config được ghi, serve chạy nền, Funnel publish ở public port 443, và DNS + TLS
được verify trước khi in URL.

Script in ra Funnel URL dạng:

```
https://colab-opencode.<tailnet>.ts.net/
```

Mở URL đó trên trình duyệt của bất kỳ thiết bị nào (không cần VPN). Hoặc dùng
API HTTP của opencode serve (xem https://opencode.ai/docs/server) để gọi từ code.

> Bạn cũng có thể chạy script trong **terminal của Colab**
> (`chmod +x opencode-funnel-colab.sh && ./opencode-funnel-colab.sh`) — dòng
> `%%bash` chỉ là magic của cell nên khi chạy trực tiếp nó fail vô hại (in ra
> `fg: no job control` rồi script vẫn chạy bình thường).

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
`tailscale-cli-opencode` ghi cấu hình này vào cả `~/.config/opencode/opencode.json`
(global) lẫn `opencode.json` (project) và set thêm env
`OPENCODE_PERMISSION='{"*":"allow"}'` như lớp fallback, nên `opencode serve`
chạy nền không bao giờ bị treo vì chờ phê duyệt. Dùng `--opencode-config <path>`
nếu muốn chỉ định file khác.

Lưu ý: `deny` rules (nếu có trong các config khác, ví dụ agent/subagent) vẫn
được tôn trọng — giống `--auto`.

## Biến môi trường tùy chọn

| Biến                       | Mặc định                  | Ý nghĩa                                                                          |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `OPCODE_PORT`              | `3000`                    | Cổng local mà `opencode serve` lắng nghe                                         |
| `TS_HOSTNAME`              | `colab-opencode`          | Hostname của node; URL = `https://<TS_HOSTNAME>.<tailnet>.ts.net/`               |
| `TS_TAILNET`               | (mặc định của credential) | Tailnet, ví dụ `mycorp.ts.net`                                                   |
| `TS_PROFILE`               | `funnel-app`              | Profile; `funnel-app` là non-ephemeral (node ephemeral không publish Funnel DNS) |
| `OPENCODE_SERVER_PASSWORD` | (trống)                   | Basic auth cho URL công khai — **nên đặt** vì Funnel URL là public               |

Nếu đặt `OPENCODE_SERVER_PASSWORD`, export nó trước khi chạy cell — env này được
thừa hưởng bởi tiến trình `opencode serve` do CLI khởi động.

## Lần đầu đăng nhập model

`opencode` cần credential của AI provider. Chạy một lần trong terminal của
Colab:

```bash
opencode auth login
```

(chọn provider, dán API key). Sau đó chạy lại cell.

## Xác minh / dừng

```bash
tailscale-cli-opencode --stop    # dừng opencode serve + tailscaled userspace
tailsacle-cli daemon status      # trạng thái tailscaled userspace
```

## Gỡ lỗi

- `tail -f ~/.cache/tailsacle-cli/bin/opencode-serve.log` — log của
  `opencode serve`.
- Chạy lại lệnh CLI trực tiếp với `--json` để xem full JSON envelope; nếu có
  warning/error, đọc mã lỗi (`FUNNEL_*`, `OPENCODE_*`, `PROVISIONED_*`, …).
- Nếu Funnel URL trả về chứng chỉ chưa sẵn sàng, chờ 1–2 phút rồi tải lại
  (Tailscale cấp cert tự động; CLI đã verify DNS + TLS trước khi in URL).
