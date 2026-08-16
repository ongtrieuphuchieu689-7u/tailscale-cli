import { execFile, spawn } from "node:child_process";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      "DAEMON_CLIENT: /dev/net/tun is missing, so TUN mode cannot work; a userspace-networking tailscaled is the fallback",
    );
  }
  warnings.push(
    'TAILSCALED_NOT_RUNNING: tailscaled is not running; start it with "sudo systemctl enable --now tailscaled" (or "sudo tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock" on containers/devcontainers)',
  );
  return { running: false, warnings, actions: [] };
}

function daemonArgs(): string[] {
  const socket =
    process.env.TS_TAILSCALE_SOCKET ?? "/var/run/tailscale/tailscaled.sock";
  const state =
    process.env.TS_TAILSCALED_STATE ?? "/var/lib/tailscale/tailscaled.state";
  return [
    "--tun=userspace-networking",
    `--state=${state}`,
    `--socket=${socket}`,
  ];
}

async function startUserspaceDaemon(): Promise<{
  started: boolean;
  command: string;
}> {
  const args = daemonArgs();
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const command: string[] | undefined = root
    ? ["tailscaled", ...args]
    : process.env.CI
      ? undefined
      : ["sudo", "tailscaled", ...args];
  if (!command)
    return { started: false, command: `tailscaled ${args.join(" ")}` };
  const child = spawn(command[0]!, command.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    // The daemon may exit immediately when privileges are missing.
  });
  child.unref();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(500);
    if (await tryRun("pgrep", ["-x", "tailscaled"]))
      return { started: true, command: command.join(" ") };
  }
  return { started: false, command: command.join(" ") };
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

  if (!existsSync("/dev/net/tun")) {
    const userspace = await startUserspaceDaemon();
    if (userspace.started) {
      return {
        running: true,
        warnings: [
          `DAEMON_USERSPACE: started a userspace-networking tailscaled (socket ${process.env.TS_TAILSCALE_SOCKET ?? "/var/run/tailscale/tailscaled.sock"}); no /dev/net/tun is required`,
        ],
        actions: [userspace.command],
      };
    }
    if (process.env.CI)
      return {
        running: false,
        warnings: [
          ...inspected.warnings,
          "DAEMON_USERSPACE_SKIPPED: CI detected; not auto-starting a userspace daemon. Provide tailscaled via the runner image or start it explicitly",
        ],
        actions,
      };
    return {
      running: false,
      warnings: [
        ...inspected.warnings,
        `DAEMON_USERSPACE_FAILED: could not start a userspace daemon (${userspace.command}); start it manually with the exact command above`,
      ],
      actions,
    };
  }
  return { running: false, warnings: inspected.warnings, actions };
}
