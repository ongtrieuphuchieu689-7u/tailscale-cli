import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { cacheBinPath, ensureBinary } from "./binary.js";

const execFileAsync = promisify(execFile);

export interface LocalCommandResult<T = unknown> {
  stdout: string;
  stderr: string;
  code: number;
  json?: T;
}

export interface BinaryInfo {
  path: string;
  version: string;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function findTailscale(
  explicit?: string,
  options: { download?: boolean } = {},
): Promise<string> {
  const candidates = [
    explicit,
    process.env.TS_TAILSCALE_BIN,
    cacheBinPath(),
    process.platform === "win32" ? "tailscale.exe" : "tailscale",
    process.platform === "win32"
      ? resolvePath(
          process.env.ProgramFiles ?? "C:\\Program Files",
          "Tailscale",
          "tailscale.exe",
        )
      : "/usr/bin/tailscale",
    process.platform === "win32"
      ? resolvePath(
          process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
          "Tailscale",
          "tailscale.exe",
        )
      : "/usr/local/bin/tailscale",
  ].filter((v): v is string => !!v);

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ["version"], {
        timeout: 10_000,
        windowsHide: true,
      });
      if (
        existsSync(candidate) ||
        candidate === "tailscale" ||
        candidate === "tailscale.exe"
      )
        return candidate;
      if (stdout.trim()) return candidate;
    } catch {
      continue;
    }
  }

  if (options.download !== false) {
    try {
      const downloaded = await ensureBinary();
      return downloaded.path;
    } catch (downloadError) {
      throw new Error(
        `TAILSCALE_BINARY_NOT_FOUND: no system binary and auto-download failed (${downloadError instanceof Error ? downloadError.message : String(downloadError)}); set TS_TAILSCALE_BIN or install Tailscale`,
      );
    }
  }

  throw new Error(
    "TAILSCALE_BINARY_NOT_FOUND: install Tailscale or set TS_TAILSCALE_BIN",
  );
}

export async function tailscaleVersion(
  bin?: string,
  options: { download?: boolean } = {},
): Promise<BinaryInfo> {
  const path = await findTailscale(bin, options);
  const { stdout, stderr } = await execFileAsync(path, ["version"], {
    timeout: 10_000,
    windowsHide: true,
  });
  const version =
    (stdout || stderr)
      .split(/\r?\n/)
      .find((line) => /\d+\.\d+\.\d+/.test(line))
      ?.trim() ?? "unknown";
  return { path, version };
}

export class TailscaleLocal {
  readonly bin: string;

  constructor(bin: string) {
    this.bin = bin;
  }

  async run(
    args: string[],
    options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<LocalCommandResult> {
    const { stdout, stderr } = await execFileAsync(this.bin, args, {
      timeout: options.timeoutMs ?? 60_000,
      windowsHide: true,
      env: { ...process.env, ...options.env },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  }

  async runJson<T>(
    args: string[],
    options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<T> {
    const result = await this.run([...args, "--json"], options);
    const parsed = parseJson<T>(result.stdout);
    if (parsed === undefined)
      throw new Error(`TAILSCALE_INVALID_JSON: ${result.stdout.slice(0, 400)}`);
    return parsed;
  }

  async status<T = Record<string, unknown>>(): Promise<T> {
    return this.runJson<T>(["status"]);
  }

  async up(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    await this.run(["up", ...args], { env, timeoutMs: 120_000 });
  }

  async update(yes = false): Promise<void> {
    await this.run(yes ? ["update", "--yes"] : ["update"], {
      timeoutMs: 180_000,
    });
  }

  async set(args: string[]): Promise<void> {
    await this.run(["set", ...args], { timeoutMs: 30_000 });
  }

  async serve(args: string[]): Promise<void> {
    await this.run(["serve", ...args], { timeoutMs: 60_000 });
  }

  async funnel(args: string[]): Promise<void> {
    await this.run(["funnel", ...args], { timeoutMs: 60_000 });
  }
}
