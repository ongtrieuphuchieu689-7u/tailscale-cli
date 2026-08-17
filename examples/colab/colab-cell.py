# One-cell Colab launcher for examples/colab/opencode-funnel-colab.sh
#
# Paste this whole file into ONE cell and run it — no separate Python step.
# It loads the Tailscale credential from the Colab Secrets panel (key icon)
# and then runs the funnel script (fetched from the repo, always the latest).
#
# Why a Python cell? userdata.get() talks to the Colab UI over the kernel
# message channel; a bash/python3 subprocess has no such channel and times
# out ("Secrets can only be fetched when running from the Colab UI"). So the
# secrets must be read here, in the kernel, and handed to bash via the env.

from google.colab import userdata
import os, subprocess, urllib.request

for name in ("TS_AUTH_KEY", "TS_CLIENT_SECRET", "TS_OAUTH_CLIENT_ID",
             "TS_OAUTH_CLIENT_SECRET", "TS_ACCESS_TOKEN", "TS_API_KEY",
             "TS_TAILNET"):
    try:
        os.environ[name] = userdata.get(name)
    except Exception:
        pass  # secret not set -> skip

if not any(os.environ.get(k) for k in (
    "TS_AUTH_KEY", "TS_CLIENT_SECRET", "TS_OAUTH_CLIENT_SECRET",
    "TS_ACCESS_TOKEN", "TS_API_KEY")):
    print("ERROR: no Tailscale credential found. Add one to the Secrets "
          "panel (key icon, left sidebar) with an EXACT name — TS_CLIENT_SECRET, "
          "TS_AUTH_KEY, TS_OAUTH_CLIENT_SECRET, TS_ACCESS_TOKEN or TS_API_KEY — "
          "grant this notebook access, then re-run this cell.")
    raise SystemExit(1)

script = urllib.request.urlopen(
    "https://raw.githubusercontent.com/ongtrieuphuchieu689-7u/tailscale-cli/main/examples/colab/opencode-funnel-colab.sh"
).read().decode()
subprocess.run(["/bin/bash", "-c", script], check=True)