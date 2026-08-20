import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomFillSync } from "node:crypto";
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import net from "node:net";
import { cacheBinDir } from "./binary.js";

const execFileAsync = promisify(execFile);

/**
 * Windows npm shims (nexql-mcp.cmd, npx.cmd) can only be launched through a
 * shell; execFile/spawn reject .cmd files without one.
 */
function shellForWin32(): { shell?: boolean } {
  return process.platform === "win32" ? { shell: true } : {};
}

export interface NexqlMcpRunner {
  kind: "path" | "npx";
  command: string[];
  version?: string;
  installedBy: "found" | "npx-resolved";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryVersion(command: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(
      command[0]!,
      command.slice(1),
      {
        timeout: 60_000,
        windowsHide: true,
        ...shellForWin32(),
      },
    );
    const text = `${stdout}\n${stderr}`.trim();
    if (!text) return undefined;
    return text.split(/\r?\n/)[0]!.trim();
  } catch {
    return undefined;
  }
}

/**
 * Locates the nexql-mcp runner: a real `nexql-mcp` on PATH is preferred,
 * otherwise `npx -y nexql-mcp` is resolved from the npm registry cache.
 */
export async function resolveNexqlMcpRunner(): Promise<NexqlMcpRunner> {
  const pathVersion = await tryVersion(["nexql-mcp", "--version"]);
  if (pathVersion)
    return {
      kind: "path",
      command: ["nexql-mcp"],
      version: pathVersion,
      installedBy: "found",
    };
  const npxVersion = await tryVersion(["npx", "-y", "nexql-mcp", "--version"]);
  if (npxVersion)
    return {
      kind: "npx",
      command: ["npx", "-y", "nexql-mcp"],
      version: npxVersion,
      installedBy: "npx-resolved",
    };
  throw new Error(
    "NEXQL_MCP_NOT_FOUND: nexql-mcp is not installed and npx could not resolve it; install Node.js 22+ with npm, or re-run with --install",
  );
}

/**
 * Preflight TCP reachability check against a host:port (e.g. a DB target or a
 * relay listen port). Resolves with latency or throws a
 * NEXQL_MCP_DB_UNREACHABLE error when the target does not accept connections
 * within timeoutMs.
 */
export async function preflightTcpCheck(options: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<{ host: string; port: number; latencyMs: number }> {
  const { host, port, timeoutMs = 5_000 } = options;
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const socket = net.connect({ host, port });
    const done = (fn: () => void): void => {
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => {
      done(() =>
        reject(
          new Error(
            `NEXQL_MCP_DB_UNREACHABLE: target ${host}:${port} did not accept connections within ${timeoutMs}ms`,
          ),
        ),
      );
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      done(() =>
        resolvePromise({ host, port, latencyMs: Date.now() - started }),
      );
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      done(() =>
        reject(
          new Error(
            `NEXQL_MCP_DB_UNREACHABLE: target ${host}:${port} failed to connect (${err.message})`,
          ),
        ),
      );
    });
  });
}

/**
 * Masks the password (and any user:pass segment) inside a libpq / URL
 * connection string so it can be safely emitted or persisted.
 */
export function maskConnString(value: string): string {
  return value.replace(
    /(\w+:\/\/[^/@:]+:)[^@/]+(@)/,
    (_, head: string, tail: string) => `${head}***${tail}`,
  );
}

/**
 * Extracts the password from a libpq connection string (postgres://user:pass@host:port/db),
 * or returns undefined when no password is embedded.
 */
export function passwordFromConnString(value: string): string | undefined {
  const match = value.match(/\/\/[^/@:]+:([^@/]+)@/);
  return match?.[1];
}

/**
 * Returns a copy of the connection string with the embedded password removed
 * (postgres://user@host:port/db), so the password never appears in argv or
 * process listings; it is supplied via the PGPASSWORD env var instead.
 */
export function connStringWithoutPassword(value: string): string {
  return value.replace(/(\/\/[^/@:]+):[^@/]+@/, "$1@");
}

export interface NexqlMcpHttpRecord {
  pid: number;
  command: string;
  httpPort: number;
  startedAt: string;
  runnerVersion?: string;
}

function nexqlPidFile(): string {
  return join(cacheBinDir(), "nexql-mcp.pid.json");
}

export function readNexqlMcpHttpRecord(): NexqlMcpHttpRecord | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(nexqlPidFile(), "utf8"),
    ) as Partial<NexqlMcpHttpRecord>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid))
      return undefined;
    return {
      pid: parsed.pid,
      command: String(parsed.command ?? ""),
      httpPort: Number(parsed.httpPort ?? 0),
      startedAt: String(parsed.startedAt ?? ""),
      ...(typeof parsed.runnerVersion === "string"
        ? { runnerVersion: parsed.runnerVersion }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function writeNexqlMcpHttpRecord(record: NexqlMcpHttpRecord): void {
  const file = nexqlPidFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function clearNexqlMcpHttpRecord(pid: number): void {
  const current = readNexqlMcpHttpRecord();
  if (current && current.pid === pid) {
    try {
      rmSync(nexqlPidFile());
    } catch {
      // best-effort cleanup
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tcpAcceptUp(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await preflightTcpCheck({ host: "127.0.0.1", port, timeoutMs: 1_000 });
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

async function mcpInitializeProbe(
  port: number,
  token?: string,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "tailsacle-cli", version: "1" },
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    // Any HTTP response (including 401/404) proves the server is alive.
    if (response.ok) {
      const text = await response.text();
      return text.includes("jsonrpc") || text.length > 0;
    }
    return true;
  } catch {
    return false;
  }
}

export async function startNexqlMcpHttp(options: {
  runner: NexqlMcpRunner;
  connectionString: string;
  httpPort: number;
  token: string;
  logPath: string;
  bind?: string;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
}): Promise<{
  pid: number;
  command: string;
  version?: string;
  waitForExit: Promise<void>;
}> {
  const { runner, connectionString, httpPort, token, logPath, env } = options;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  // The bearer token is passed only through the NEXQL_MCP_HTTP_TOKEN env var
  // (never in argv/process listings); nexql-mcp reads it from env when the
  // --http-token flag is absent. The DB password likewise travels only via
  // PGPASSWORD, so the argv connection string carries no password.
  const password = passwordFromConnString(connectionString);
  const args = [
    ...runner.command.slice(1),
    connStringWithoutPassword(connectionString),
    "--http",
    "--http-port",
    String(httpPort),
    ...(options.bind ? ["--bind", options.bind] : []),
  ];
  const command = [runner.command[0]!, ...args];
  const logDir = dirname(logPath);
  mkdirSync(logDir, { recursive: true });
  const logStream = openSync(logPath, "a");
  const child = spawn(runner.command[0]!, args, {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
    ...shellForWin32(),
    env: {
      ...process.env,
      ...env,
      NEXQL_MCP_HTTP_TOKEN: token,
      ...(password === undefined ? {} : { PGPASSWORD: password }),
    },
  });

  let exited:
    { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  child.on("error", (err) => {
    exited = { code: -1, signal: null };
    void err;
  });

  // Resolves whenever the spawned nexql-mcp process terminates (DB down, crash,
  // or graceful stop) so a supervisor can respawn it.
  const waitForExit = new Promise<void>((resolveExit) => {
    child.on("exit", () => resolveExit());
    child.on("error", () => resolveExit());
  });

  const deadline = Date.now() + readyTimeoutMs;
  let up = false;
  while (Date.now() < deadline) {
    if (exited) {
      child.kill("SIGKILL");
      throw new Error(
        `NEXQL_MCP_EXITED_EARLY: nexql-mcp exited before becoming ready (code=${exited.code ?? "null"}, signal=${exited.signal ?? "null"}); log: ${logPath}`,
      );
    }
    if (await tcpAcceptUp(httpPort, 1_000)) {
      if (await mcpInitializeProbe(httpPort, token)) {
        up = true;
        break;
      }
    }
    await sleep(500);
  }

  if (!up || !child.pid || !isAlive(child.pid)) {
    child.kill("SIGKILL");
    throw new Error(
      `NEXQL_MCP_SERVE_FAILED: nexql-mcp did not answer on 127.0.0.1:${httpPort} within ${readyTimeoutMs}ms; log: ${logPath}`,
    );
  }

  writeNexqlMcpHttpRecord({
    pid: child.pid,
    command: maskConnString(command.join(" ")),
    httpPort,
    startedAt: new Date().toISOString(),
    ...(runner.version ? { runnerVersion: runner.version } : {}),
  });
  return {
    pid: child.pid,
    command: command.join(" "),
    ...(runner.version ? { version: runner.version } : {}),
    waitForExit,
  };
}

export async function stopNexqlMcpHttp(): Promise<{
  stopped: boolean;
  pid?: number;
  message: string;
}> {
  const tracked = readNexqlMcpHttpRecord();
  if (!tracked)
    return {
      stopped: false,
      message:
        "NO_TRACKED_NEXQL_MCP: no nexql-mcp started by this tool is tracked (tracked in the nexql-mcp pidfile)",
    };
  const { pid } = tracked;
  if (!isAlive(pid)) {
    clearNexqlMcpHttpRecord(pid);
    return {
      stopped: false,
      pid,
      message:
        "ALREADY_STOPPED: tracked nexql-mcp is not running; cleared the pidfile",
    };
  }
  if (process.platform === "win32") {
    // The tracked pid is the shell/cmd wrapper when the runner is a .cmd
    // shim; taskkill /T kills the whole process tree (serve + wrapper).
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 20_000,
      });
    } catch {
      // fall through to the alive check below
    }
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      return {
        stopped: false,
        pid,
        message: `KILL_FAILED: could not signal pid ${pid} (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    if (!isAlive(pid)) {
      clearNexqlMcpHttpRecord(pid);
      return { stopped: true, pid, message: `stopped nexql-mcp (pid ${pid})` };
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // fall through to the alive check below
  }
  await sleep(500);
  if (!isAlive(pid)) {
    clearNexqlMcpHttpRecord(pid);
    return {
      stopped: true,
      pid,
      message: `stopped nexql-mcp (pid ${pid}, after SIGKILL)`,
    };
  }
  clearNexqlMcpHttpRecord(pid);
  return {
    stopped: false,
    pid,
    message: `KILL_FAILED: pid ${pid} survived SIGTERM and SIGKILL`,
  };
}

export function maskToken(value: string): string {
  if (!value) return "***";
  return value.length < 10 ? "***" : `${value.slice(0, 5)}…${value.slice(-3)}`;
}

export function randomToken(length = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  randomFillSync(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}
