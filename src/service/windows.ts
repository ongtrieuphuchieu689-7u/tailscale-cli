import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watchFile } from "node:fs";
import { join as joinPath } from "node:path";
import { cliEntrypoint, nodeExecutable } from "./linux.js";
import { registryAdd, registryRemove, registryList } from "./registry.js";
import { maskEnv } from "./config.js";
import type {
  InstallOptions,
  LogOptions,
  ServiceConfig,
  ServiceInfo,
  ServiceInstallResult,
  ServiceManager,
  ServiceStatus,
} from "./types.js";

let nodeWindowsModule: typeof import("node-windows") | undefined;

async function loadNodeWindows(): Promise<typeof import("node-windows")> {
  if (nodeWindowsModule) return nodeWindowsModule;
  if (process.platform !== "win32") {
    throw new Error(
      "SERVICE_PLATFORM_UNSUPPORTED: Windows service manager requires win32",
    );
  }
  try {
    nodeWindowsModule = await import("node-windows");
    return nodeWindowsModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SERVICE_WINDOWS_NATIVE_REQUIRED: node-windows is unavailable (${detail}); install tailsacle-cli with its dependencies or use "service install --scheduler" (Task Scheduler, no admin needed)`,
    );
  }
}

function windowsServiceDir(name: string): string {
  return joinPath(
    process.env.ProgramData ?? "C:\\ProgramData",
    "tailsacle-cli",
    "services",
    name,
  );
}

function isElevatedPowerShell(): boolean {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout?.trim() === "True";
}

export function isAdminUser(): boolean {
  if (process.platform !== "win32") return false;
  try {
    return isElevatedPowerShell();
  } catch {
    return false;
  }
}

function quoteForPwsh(value: string): string {
  return value.replace(/'/g, "''");
}

export function elevateCommand(): string[] {
  const argList = process.argv
    .slice(1)
    .map((a) => `'${quoteForPwsh(a)}'`)
    .join(",");
  return [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${process.execPath}' -ArgumentList ${argList} -Verb RunAs`,
  ];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWinSwXml(
  config: ServiceConfig,
  opts: { nodePath: string; cliPath: string },
): string {
  const execArgs = config.script
    ? [config.script, ...config.args]
    : [opts.cliPath, ...config.args];
  const envLines = Object.entries(config.env)
    .map(
      ([key, value]) =>
        `    <env name="${xmlEscape(key)}" value="${xmlEscape(value)}" />`,
    )
    .join("\n");
  return `<service>
  <id>${xmlEscape(config.name)}</id>
  <name>${xmlEscape(config.name)}</name>
  <description>${xmlEscape(config.description ?? "")}</description>
  <executable>${xmlEscape(opts.nodePath)}</executable>
  <arguments>${xmlEscape(execArgs.join(" "))}</arguments>
  <workingdirectory>${xmlEscape(config.workingDir)}</workingdirectory>
  <logpath>${xmlEscape(config.log?.dir ?? joinPath(windowsServiceDir(config.name), "logs"))}</logpath>
  <log mode="roll-by-size" sizeThreshold="${config.log?.maxSizeMb ?? 10}" keepFiles="${config.log?.keepFiles ?? 5}" />
  <onfailure action="restart" delay="${config.restart.delaySeconds * 1000}" />
  <resetfailure>1 hour</resetfailure>
${envLines ? `${envLines}\n` : ""}</service>
`;
}

function scQuery(name: string): string {
  const result = spawnSync("sc", ["query", name], { encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "") : "";
}

export function parseScStatus(name: string, output: string): ServiceStatus {
  if (!output) return { name, status: "unknown" };
  const stateMatch = /STATE\s*:\s*\d+\s+(\w+)/.exec(output);
  const pidMatch = /PID\s*:\s*(\d+)/.exec(output);
  const state = stateMatch?.[1] ?? "";
  let status: ServiceStatus["status"];
  if (state === "RUNNING") status = "running";
  else if (state === "STOPPED") status = "stopped";
  else status = "unknown";
  const pid = pidMatch ? Number(pidMatch[1]) : undefined;
  return {
    name,
    status,
    pid: pid && pid > 0 ? pid : undefined,
  };
}

export class WindowsServiceManager implements ServiceManager {
  async install(
    config: ServiceConfig,
    opts: InstallOptions = {},
  ): Promise<ServiceInstallResult> {
    const serviceDir = windowsServiceDir(config.name);
    mkdirSync(serviceDir, { recursive: true });
    const nw = await loadNodeWindows();
    const cliPath = cliEntrypoint();
    const nodePath = nodeExecutable();
    const logDir = config.log?.dir ?? joinPath(serviceDir, "logs");
    const svc = new nw.Service({
      name: config.name,
      description: config.description ?? "",
      script: cliPath,
      scriptOptions: config.args.join(" "),
      workingdir: config.workingDir,
      env: Object.entries(config.env).map(([key, value]) => ({
        name: key,
        value,
      })),
      logpath: logDir,
      maxLogSizeInKb: (config.log?.maxSizeMb ?? 10) * 1024,
      logMode: "roll",
      nodeOptions: "",
      wait: 2,
      grow: 0.25,
    });
    await new Promise<void>((resolve, reject) => {
      svc.on("install", () => resolve());
      svc.on("error", (error: Error) =>
        reject(new Error(`SERVICE_WINDOWS_INSTALL_FAILED: ${error.message}`)),
      );
      svc.install();
    });
    const status = await this.status(config.name);
    const info: ServiceInfo = {
      name: config.name,
      status: status.status,
      pid: status.pid,
      platform: "win32",
      scope: "system",
      unitPath: serviceDir,
      logDir,
      installedAt: new Date().toISOString(),
    };
    await registryAdd(info);
    return {
      installed: true,
      name: config.name,
      platform: "win32",
      scope: "system",
      unitPath: serviceDir,
      status: status.status,
      pid: status.pid,
    };
  }

  async uninstall(name: string): Promise<void> {
    const info = registryList().find((e) => e.name === name);
    if (!info) {
      throw new Error(`SERVICE_NOT_FOUND: service "${name}" is not registered`);
    }
    const nw = await loadNodeWindows();
    const svc = new nw.Service({ name });
    await new Promise<void>((resolve, reject) => {
      svc.on("uninstall", () => resolve());
      svc.on("error", (error: Error) =>
        reject(new Error(`SERVICE_WINDOWS_UNINSTALL_FAILED: ${error.message}`)),
      );
      svc.uninstall();
    });
    await registryRemove(name);
  }

  async start(name: string): Promise<void> {
    const nw = await loadNodeWindows();
    const svc = new nw.Service({ name });
    await new Promise<void>((resolve, reject) => {
      svc.on("start", () => resolve());
      svc.on("error", (error: Error) =>
        reject(new Error(`SERVICE_WINDOWS_START_FAILED: ${error.message}`)),
      );
      svc.start();
    });
  }

  async stop(name: string): Promise<void> {
    const nw = await loadNodeWindows();
    const svc = new nw.Service({ name });
    await new Promise<void>((resolve, reject) => {
      svc.on("stop", () => resolve());
      svc.on("error", (error: Error) =>
        reject(new Error(`SERVICE_WINDOWS_STOP_FAILED: ${error.message}`)),
      );
      svc.stop();
    });
  }

  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  async status(name: string): Promise<ServiceStatus> {
    const output = scQuery(name);
    if (!output) {
      throw new Error(`SERVICE_NOT_FOUND: service "${name}" is not installed`);
    }
    return parseScStatus(name, output);
  }

  async logs(name: string, opts: LogOptions): Promise<void> {
    const info = registryList().find((e) => e.name === name);
    const logDir =
      info?.logDir ??
      (info?.unitPath
        ? joinPath(info.unitPath, "logs")
        : joinPath(windowsServiceDir(name), "logs"));
    const outFile = joinPath(logDir, `${name}.out.log`);
    const errFile = joinPath(logDir, `${name}.err.log`);
    const tail = (filePath: string): void => {
      if (!existsSync(filePath)) {
        console.log(`[tailsacle-service] no log file yet: ${filePath}`);
        return;
      }
      const fd = readFileSync(filePath, "utf8");
      const lines = fd.split("\n").slice(-opts.lines);
      console.log(lines.join("\n"));
    };
    tail(outFile);
    tail(errFile);
    if (opts.follow) {
      await new Promise<void>((resolve) => {
        const watch = (filePath: string): void => {
          if (!existsSync(filePath)) return;
          watchFile(filePath, { interval: 1000 }, () => {
            tail(filePath);
          });
        };
        watch(outFile);
        watch(errFile);
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
      });
    }
  }

  async list(): Promise<ServiceInfo[]> {
    return registryList().map((info) => ({
      ...info,
      platform: "win32",
    }));
  }
}

export function maskedEnvWindows(
  config: ServiceConfig,
): Record<string, string> {
  return maskEnv(config.env);
}
