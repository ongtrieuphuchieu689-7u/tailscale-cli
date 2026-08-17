#!/usr/bin/env bash
# Google Colab — expose `opencode serve` on the public internet through a
# Tailscale Funnel, wired up with tailsacle-cli (zero-config).
#
# What this cell does:
#   1. installs Node.js 22+ (Colab ships without a usable Node by default)
#   2. installs opencode-ai and tailsacle-cli from the npm registry
#   3. writes an opencode permission config that approves EVERYTHING
#      ("permission": "allow") — the headless equivalent of `opencode --auto`;
#      `opencode serve` has no --auto flag, so the config (plus the
#      OPENCODE_PERMISSION env fallback) is what makes serve never block or
#      prompt for any tool (bash/edit/read/glob/grep/webfetch/...).
#   4. starts `opencode serve` in the background on port $OPCODE_PORT
#   5. downloads the stable tailscale + tailscaled binaries (no apt needed)
#   6. joins the tailnet and publishes the Funnel with
#      `deploy --funnel --expose 443=<port> --yes --apply-policy --enable-https`
#      (auto-provisions tagOwners, the funnel node attribute and tailnet HTTPS,
#      then verifies public DNS + live TLS endpoint)
#   7. prints the public Funnel URL pointing at opencode serve
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

# -------------------------------------------------- 2. install opencode-ai ---
echo "==> Installing opencode-ai (global)"
npm install -g opencode-ai
opencode --version

# ------------------------------------------------- 3. full permissions (-auto) ---
# `opencode serve` is headless: there is no one to answer permission prompts and
# no --auto flag (--auto exists only on `tui`/`run`). The headless equivalent is
# `permission: "allow"` which auto-approves every tool — nothing is blocked,
# exactly like `opencode --auto`. We write it both globally and per-project,
# and set the OPENCODE_PERMISSION env var as a belt-and-braces fallback.
echo "==> Configuring opencode permissions = allow (no prompts, no blocks)"
mkdir -p "$HOME/.config/opencode"
cat > "$HOME/.config/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
JSON
if [[ ! -f "$(pwd)/opencode.json" ]]; then
  cat > "$(pwd)/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
JSON
fi
export OPENCODE_PERMISSION='{"*":"allow"}'

# ------------------------------------------------ 4. start opencode serve ---
echo "==> Starting opencode serve on 127.0.0.1:${OPCODE_PORT}"
nohup opencode serve --port "$OPCODE_PORT" --hostname 127.0.0.1 \
  > /tmp/opencode-serve.log 2>&1 &
OPCODE_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${OPCODE_PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! kill -0 "$OPCODE_PID" 2>/dev/null; then
  echo "ERROR: opencode serve exited; log:" >&2
  tail -n 40 /tmp/opencode-serve.log >&2
  exit 1
fi
echo "==> opencode serve is up (pid ${OPCODE_PID}); log: /tmp/opencode-serve.log"

# ------------------------------------------------- 5. install tailsacle-cli ---
echo "==> Installing tailsacle-cli (global)"
npm install -g tailsacle-cli
export PATH="$(npm prefix -g)/bin:$PATH"
echo "==> Downloading stable tailscale + tailscaled binaries"
tailsacle-cli update-bin

# --------------------------------------- 6. join tailnet + publish Funnel ---
echo "==> Joining tailnet and publishing Funnel (this verifies DNS + TLS)"
export TS_PROFILE TS_HOSTNAME
if [[ -n "${TS_TAILNET:-}" ]]; then export TS_TAILNET; fi
# --yes            skip confirmations
# --apply-policy   auto-provision missing tagOwners + funnel node attribute
# --enable-https   enable tailnet-wide HTTPS (required for Funnel)
# --funnel         expose publicly, not just on the tailnet (Serve)
ENVELOPE="$(tailsacle-cli deploy \
  --funnel \
  --expose "443=${OPCODE_PORT}" \
  --yes --apply-policy --enable-https \
  --json)"

# ----------------------------------------------- 7. print the public URL ---
URLS="$(printf '%s' "$ENVELOPE" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const env = JSON.parse(raw);
    const seen = new Set();
    const walk = (value) => {
      if (typeof value === "string" && /^https:\/\//.test(value)) {
        if (!seen.has(value)) { seen.add(value); console.log(value); }
        return;
      }
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) walk(child);
      }
    };
    walk(env);
  });
')"
if [[ -z "$URLS" ]]; then
  echo "WARNING: no https URL found in the deploy envelope:" >&2
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
echo "  opencode pid    : $OPCODE_PID (log /tmp/opencode-serve.log)"
echo "  daemon          : tailsacle-cli daemon status"
echo "  stop            : tailsacle-cli daemon stop; kill $OPCODE_PID"