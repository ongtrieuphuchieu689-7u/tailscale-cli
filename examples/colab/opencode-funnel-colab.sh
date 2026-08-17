#!/usr/bin/env bash
# Google Colab — expose `opencode serve` on the public internet through a
# Tailscale Funnel, powered by the `tailscale-cli-opencode` CLI (zero-config).
#
# What this cell does:
#   1. installs Node.js 22+ (Colab ships without a usable Node by default)
#   2. installs tailsacle-cli from the npm registry (provides the
#      `tailscale-cli-opencode` bin)
#   3. delegates EVERYTHING else to a single `tailscale-cli-opencode` run:
#      - resolves/installs opencode via `npx -y opencode-ai` (--install)
#      - writes `"permission": "allow"` (the headless equivalent of
#        `opencode --auto`) so serve never blocks or prompts for any tool
#        (bash/edit/read/glob/grep/webfetch/...)
#      - starts `opencode serve` in the background on --port
#      - joins the tailnet and publishes the Funnel on public port 443,
#        auto-provisioning tagOwners, the funnel node attribute and tailnet
#        HTTPS (--apply-policy --enable-https)
#      - verifies public DNS + live TLS endpoint before reporting success
#   4. prints the public Funnel URL pointing at opencode serve
#
# Paste this whole file into one Colab cell (or run it from a Colab terminal).
# Requires the server runtime; a GPU/TPU runtime works too.
set -euo pipefail

# ---------------------------------------------------------------- settings ---
# Local port opencode serve listens on (Funnel public port is always 443).
OPCODE_PORT="${OPCODE_PORT:-3000}"
# Node hostname on the tailnet -> public URL becomes
# https://<TS_HOSTNAME>.<tailnet>.ts.net/
TS_HOSTNAME="${TS_HOSTNAME:-colab-opencode}"
# Tailnet/domain; unset = default tailnet of the credential.
TS_TAILNET="${TS_TAILNET:-}"
# Profile; funnel-app is non-ephemeral (ephemeral nodes never publish Funnel DNS).
TS_PROFILE="${TS_PROFILE:-funnel-app}"
# Optional basic auth for the public URL (strongly recommended).
# OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:-}"

# ------------------------------------------------------------- credentials ---
# One of these must be set in the Colab "secrets"/env before running:
#   TS_AUTH_KEY="tskey-auth-..."
#   TS_OAUTH_CLIENT_ID=...  +  TS_OAUTH_CLIENT_SECRET=...
#   TS_API_KEY=...          (OAuth trust credentials are preferred)
if [[ -z "${TS_AUTH_KEY:-}" && -z "${TS_OAUTH_CLIENT_SECRET:-}" && -z "${TS_API_KEY:-}" ]]; then
  echo "ERROR: set one of TS_AUTH_KEY, TS_OAUTH_CLIENT_SECRET, or TS_API_KEY (see examples/colab/README.md)" >&2
  exit 1
fi

# ------------------------------------------------------------- 1. Node.js ---
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | tr -d 'v' | cut -d. -f1)" -lt 22 ]]; then
  echo "==> Installing Node.js 22+ (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "==> node $(node -v) / npm $(npm -v)"

# -------------------------------------------------- 2. install tailsacle-cli ---
echo "==> Installing tailsacle-cli (global; provides tailscale-cli-opencode)"
npm install -g tailsacle-cli
export PATH="$(npm prefix -g)/bin:$PATH"

# ---------------------- 3. deploy via the tailscale-cli-opencode CLI flow ---
# --install         force `npx -y opencode-ai` (no manual opencode install)
# --yes             skip confirmations
# --apply-policy    auto-provision missing tagOwners + funnel node attribute
# --enable-https    enable tailnet-wide HTTPS (required for Funnel)
# --json            envelope on stdout: the CLI starts opencode serve on
#                   --port, joins the tailnet, funnels public 443 -> local
#                   port, verifies DNS + TLS, and reports the URLs
echo "==> Starting opencode serve + publishing Funnel (verifies DNS + TLS)"
export TS_PROFILE TS_HOSTNAME
if [[ -n "${TS_TAILNET:-}" ]]; then export TS_TAILNET; fi
ENVELOPE="$(tailscale-cli-opencode \
  --port "$OPCODE_PORT" \
  --install \
  --yes --apply-policy --enable-https \
  --json 2>/dev/null || true)"

# ------------------------------------------------- 4. print the public URL ---
URLS="$(printf '%s' "$ENVELOPE" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let env;
    try { env = JSON.parse(raw); }
    catch { console.error(raw || "no output from tailscale-cli-opencode"); process.exit(1); }
    if (env.ok !== true) {
      console.error(JSON.stringify(env, null, 2));
      process.exit(1);
    }
    for (const url of env.resolved?.urls ?? []) console.log(url);
  });
')" || {
  echo "ERROR: tailscale-cli-opencode failed (envelope above)" >&2
  exit 1
}
if [[ -z "$URLS" ]]; then
  echo "WARNING: no URL found in the opencode envelope:" >&2
  printf '%s\n' "$ENVELOPE" >&2
  exit 1
fi

echo
echo "=============================================================="
echo " opencode serve is LIVE on the public internet:"
while IFS= read -r url; do
  echo "   $url"
done <<< "$URLS"
echo "=============================================================="
echo
echo "open your browser on any device on the internet — no VPN needed."
echo "The first request may need up to ~1-2 min for Tailscale cert issuance."
echo
echo "Local state:"
echo "  stop : tailscale-cli-opencode --stop (tears down serve + tailscaled)"
echo "  log  : ~/.cache/tailsacle-cli/bin/opencode-serve.log"
