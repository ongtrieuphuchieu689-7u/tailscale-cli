import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

export interface DaemonState {
  running: boolean;
  warnings: string[];
  actions: string[];
}

async function tryRun(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function inspectDaemon(): Promise<DaemonState> {
  if (process.platform === "win32") {
    const serviceUp = await tryRun("sc", ["query", "Tailscale"]);
    if (serviceUp) return { running: true, warnings: [], actions: [] };
    return {
      running: false,
      warnings: [
        'DAEMON_WINDOWS: the Tailscale Windows service is not running; start it in an Administrator shell with "net start Tailscale"',
      ],
      actions: [],
    };
  }

  if (await tryRun("systemctl", ["is-active", "tailscaled"]))
    return { running: true, warnings: [], actions: [] };
  if (await tryRun("pgrep", ["-x", "tailscaled"]))
    return { running: true, warnings: [], actions: [] };

  const warnings: string[] = [];
  if (!existsSync("/dev/net/tun")) {
    warnings.push(
      "DAEMON_CLIENT: /dev/net/tun is missing, so TUN mode cannot work; use userspace networking (tailscaled --tun=userspace-networking)",
    );
  }
  warnings.push(
    'TAILSCALED_NOT_RUNNING: tailscaled is not running; start it with "sudo systemctl enable --now tailscaled" (or "sudo tailscaled --tun=userspace-networking" on containers/devcontainers)',
  );
  return { running: false, warnings, actions: [] };
}

export async function ensureDaemon(): Promise<DaemonState> {
  const inspected = await inspectDaemon();
  if (inspected.running) return inspected;
  if (process.platform === "win32") return inspected;

  const actions: string[] = [];
  if (await tryRun("sudo", ["systemctl", "enable", "--now", "tailscaled"])) {
    actions.push("sudo systemctl enable --now tailscaled");
    return { running: true, warnings: [], actions };
  }
  return { running: false, warnings: inspected.warnings, actions };
}
