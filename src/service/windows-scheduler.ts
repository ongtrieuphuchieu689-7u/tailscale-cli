import { spawnSync } from "node:child_process";
import { registryAdd, registryRemove, registryList } from "./registry.js";
import { cliEntrypoint, nodeExecutable } from "./linux.js";
import type {
  InstallOptions,
  LogOptions,
  ServiceConfig,
  ServiceInfo,
  ServiceInstallResult,
  ServiceManager,
  ServiceStatus,
} from "./types.js";

const TASK_PREFIX = "tailsacle-cli\\";

export function taskPathFor(name: string): string {
  return `${TASK_PREFIX}${name}`;
}

function schtasks(args: string[], tolerateFailure = false): string {
  const result = spawnSync("schtasks", args, { encoding: "utf8" });
  if (result.status !== 0 && !tolerateFailure) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      `SERVICE_SCHTASKS_FAILED: schtasks ${args.join(" ")} failed${
        stderr ? `: ${stderr}` : ""
      }`,
    );
  }
  return (result.stdout ?? "").trim();
}

function taskCommand(config: ServiceConfig): string {
  const execArgs = config.script
    ? [config.script, ...config.args]
    : [cliEntrypoint(), ...config.args];
  const inner = [nodeExecutable(), ...execArgs].join(" ");
  return `cmd /c "cd /d ${config.workingDir} && ${inner}"`;
}

function taskExists(name: string): boolean {
  const result = spawnSync("schtasks", ["/query", "/tn", taskPathFor(name)], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export class WindowsSchedulerManager implements ServiceManager {
  async install(
    config: ServiceConfig,
    opts: InstallOptions = {},
  ): Promise<ServiceInstallResult> {
    if (taskExists(config.name)) {
      throw new Error(
        `SERVICE_ALREADY_EXISTS: scheduled task "${taskPathFor(config.name)}" already exists`,
      );
    }
    const args = [
      "/create",
      "/tn",
      taskPathFor(config.name),
      "/tr",
      taskCommand(config),
      "/sc",
      "onlogon",
      "/f",
    ];
    schtasks(args);
    const info: ServiceInfo = {
      name: config.name,
      status: "unknown",
      platform: "win32",
      scope: "user",
      unitPath: taskPathFor(config.name),
      installedAt: new Date().toISOString(),
    };
    await registryAdd(info);
    return {
      installed: true,
      name: config.name,
      platform: "win32",
      scope: "user",
      unitPath: taskPathFor(config.name),
      status: "unknown",
    };
  }

  async uninstall(name: string): Promise<void> {
    const info = registryList().find((e) => e.name === name);
    if (!info) {
      throw new Error(`SERVICE_NOT_FOUND: service "${name}" is not registered`);
    }
    schtasks(["/delete", "/tn", taskPathFor(name), "/f"], true);
    await registryRemove(name);
  }

  async start(name: string): Promise<void> {
    schtasks(["/run", "/tn", taskPathFor(name)]);
  }

  async stop(name: string): Promise<void> {
    schtasks(["/end", "/tn", taskPathFor(name)], true);
  }

  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  async status(name: string): Promise<ServiceStatus> {
    const result = spawnSync(
      "schtasks",
      ["/query", "/tn", taskPathFor(name), "/fo", "LIST", "/v"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `SERVICE_NOT_FOUND: task "${taskPathFor(name)}" not found`,
      );
    }
    const output = result.stdout ?? "";
    const statusMatch = /Status:\s*(.+)/.exec(output);
    const raw = statusMatch?.[1]?.trim() ?? "";
    let status: ServiceStatus["status"];
    if (raw.startsWith("Running")) status = "running";
    else if (raw.startsWith("Ready") || raw.startsWith("Disabled")) {
      status = "stopped";
    } else if (raw && raw !== "Unknown") status = "error";
    else status = "unknown";
    return { name, status };
  }

  async logs(name: string, opts: LogOptions): Promise<void> {
    const result = spawnSync(
      "schtasks",
      ["/query", "/tn", taskPathFor(name), "/fo", "LIST", "/v"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `SERVICE_NOT_FOUND: task "${taskPathFor(name)}" not found`,
      );
    }
    const lines = (result.stdout ?? "").split("\n");
    console.log(lines.slice(-Math.max(1, opts.lines)).join("\n"));
    if (opts.follow) {
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          const current = spawnSync(
            "schtasks",
            ["/query", "/tn", taskPathFor(name), "/fo", "LIST", "/v"],
            { encoding: "utf8" },
          );
          if (current.status === 0) {
            console.log(
              (current.stdout ?? "")
                .split("\n")
                .filter((l) => /Status:|Last Run Time|Last Result/.test(l))
                .join("\n"),
            );
          }
        }, 5000);
        process.once("SIGINT", () => {
          clearInterval(poll);
          resolve();
        });
        process.once("SIGTERM", () => {
          clearInterval(poll);
          resolve();
        });
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
