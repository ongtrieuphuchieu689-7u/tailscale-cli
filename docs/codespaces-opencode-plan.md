# Codespaces + OpenCode: kế hoạch tối giản

## Quyết định

Không dùng `.devcontainer/devcontainer.json`, không thêm nhiều hook/script. Chỉ có **một script duy nhất** chạy khi Codespace start, được người dùng gọi từ startup command của Codespace hoặc terminal profile.

File duy nhất cần thêm:

```text
scripts/start-codespace-opencode.sh
```

Không commit `opencode.jsonc` runtime, password, auth file hoặc log. Script tự tạo config runtime trong `.codespace/` và `.gitignore` phải bỏ qua thư mục này.

## Secrets tối thiểu

Cấu hình trong GitHub Codespaces Secrets:

```text
TS_CLIENT_SECRET       # Tailscale trust credential tskey-client-...
TS_TAILNET             # tailnet mặc định dạng *.ts.net
OPENCODE_SERVER_PASSWORD
```

Tùy chọn:

```text
OPENCODE_SERVER_USERNAME
OPENCODE_MODEL
OPENCODE_VERSION
TS_TAGS
TS_TAG_OWNER
OPENCODE_PROVIDER
```

Không ghi secret vào `opencode.jsonc`, command line, log hoặc Step Summary. `OPENCODE_SERVER_PASSWORD` chỉ được truyền qua environment cho `opencode serve`.

## Cách chạy startup command

Codespace không tự chạy file này nếu không có startup command. Chọn một trong hai cách đơn giản:

```bash
bash scripts/start-codespace-opencode.sh
```

hoặc cấu hình command khởi động Codespace/user shell gọi đúng script. Không cần devcontainer config.

## Một script phải làm toàn bộ

Thứ tự bắt buộc, mỗi bước idempotent:

1. Kiểm tra `node`, `npm`, `curl`; tạo `.codespace` với quyền `700`.
2. Cài `opencode-ai` và `tailsacle-cli` nếu chưa có; dùng `OPENCODE_VERSION` khi được truyền, mặc định `latest`.
3. Tạo `.codespace/opencode.jsonc` từ template runtime.
4. Detect provider/model từ env, không ghi API key vào file.
5. Chạy `tailscale-cli doctor --deep --json`; nếu thiếu credential thì fail rõ.
6. Bảo đảm node dùng profile `funnel-app`, `TS_EPHEMERAL=false`, hostname deterministic.
7. Start/reuse `opencode serve` trên `127.0.0.1:4096`, Basic Auth bằng `OPENCODE_SERVER_PASSWORD`.
8. Chạy `tailscale-cli funnel http://127.0.0.1:4096 --https 443 --yes --apply-policy --enable-https --verify-timeout 180 --json`.
9. In public URL sau khi DNS + TLS verification pass.
10. Nếu process OpenCode chết, script fail rõ; bản đầu không cần supervisor phức tạp.

## OpenCode runtime config

Config tối thiểu, ưu tiên tương thích version:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "${OPENCODE_MODEL}",
  "autoupdate": false,
  "server": { "port": 4096 },
  "permission": {
    "read": "allow",
    "edit": "ask",
    "bash": "ask",
    "webfetch": "allow",
    "*.env": "deny",
    "*.secret": "deny",
    "git push *": "deny"
  }
}
```

Không cấu hình `plan`/`build` custom ở bản đầu: OpenCode đã có built-in **Plan** và **Build**, chuyển mode trong UI hoặc qua CLI `--agent`. Không bật `--auto` mặc định vì server được expose public.

## Provider strategy tối giản

Không hard-code nhiều provider vào config. OpenCode tự hỗ trợ provider qua Models.dev; script chỉ kiểm tra provider env theo thứ tự:

```text
OPENCODE_MODEL
→ ANTHROPIC_API_KEY + anthropic/default model
→ OPENAI_API_KEY + openai/default model
→ OPENROUTER_API_KEY + openrouter/default model
→ fail với hướng dẫn set một provider key
```

Credentials provider được OpenCode quản lý theo cơ chế `/connect`/auth file; script không echo hoặc persist raw key trong repo. `OPENCODE_PROVIDER` có thể override provider selection.

## Password và Funnel

- `OPENCODE_SERVER_PASSWORD` là bắt buộc.
- Username mặc định `opencode`, override bằng `OPENCODE_SERVER_USERNAME`.
- Bind `127.0.0.1`, không bind `0.0.0.0`.
- Funnel chỉ được báo thành công sau khi `tailsacle-cli` verify public DNS và TLS endpoint.
- Codespace dừng hoặc sleep thì public URL không còn hoạt động.
- Không dùng GitHub forwarded port làm đường public chính; forwarded port chỉ là fallback debug.

## Acceptance checklist

- Chạy đúng một lệnh: `bash scripts/start-codespace-opencode.sh`.
- Codespace mới chỉ cần set ba secrets tối thiểu.
- Script chạy lại không tạo duplicate policy/node/exposure.
- OpenCode truy cập được qua HTTPS Funnel + Basic Auth.
- Plan/Build dùng built-in OpenCode, không custom config dễ lệch version.
- Không lộ credential trong log, config hoặc process arguments ngoài password env của server.
- Fail rõ khi thiếu quyền/credential/provider.

## Tài liệu tham khảo

- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode Config](https://opencode.ai/docs/config/)
- [OpenCode Agents](https://opencode.ai/docs/agents/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [OpenCode Models](https://opencode.ai/docs/models/)
- [OpenCode Permissions](https://opencode.ai/docs/permissions/)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode Network](https://opencode.ai/docs/network/)
- [GitHub Codespaces Secrets](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces)
- [Codespaces port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
