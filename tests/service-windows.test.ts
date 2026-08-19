import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import {
  renderWinSwXml,
  parseScStatus,
  isAdminUser,
  elevateCommand,
} from "../src/service/windows.js";
import type { ServiceConfig } from "../src/service/types.js";

function config(): ServiceConfig {
  return {
    name: "win-relay",
    description: "win relay test",
    user: "current",
    workingDir: "C:\\work",
    args: ["relay", "--listen", "18888"],
    env: { A: "1" },
    restart: { onFailure: true, delaySeconds: 5, maxRetries: 3 },
    log: { dir: "C:\\logs", maxSizeMb: 10, keepFiles: 5 },
  };
}

describe("windows service manager", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("B4-1 refuses to load on non-win32 platforms", async () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "linux",
    });
    const mod = await import("../src/service/windows.js");
    const manager = new mod.WindowsServiceManager();
    await expect(manager.install(config())).rejects.toThrow(
      /SERVICE_PLATFORM_UNSUPPORTED/,
    );
  });

  it("renders a WinSW XML document with config fields", () => {
    const xml = renderWinSwXml(config(), {
      nodePath: "C:\\node\\node.exe",
      cliPath: "C:\\cli\\cli.js",
    });
    expect(xml).toContain("<service>");
    expect(xml).toContain("<id>win-relay</id>");
    expect(xml).toContain("<executable>C:\\node\\node.exe</executable>");
    expect(xml).toContain("<argument>C:\\cli\\cli.js</argument>");
    expect(xml).toContain("<argument>relay</argument>");
    expect(xml).toContain("<argument>--listen</argument>");
    expect(xml).toContain("<argument>18888</argument>");
    expect(xml).toContain('<env name="A" value="1" />');
    expect(xml).toContain("<logpath>C:\\logs</logpath>");
    expect(xml).toContain("<sizeThreshold>10240</sizeThreshold>");
    expect(xml).toContain('delay="5 sec"');
  });

  it("escapes XML special characters", () => {
    const cfg = {
      ...config(),
      name: "a<b",
      description: "a & b",
      env: { "a>1": 'x"y' },
    };
    const xml = renderWinSwXml(cfg, {
      nodePath: "C:\\node.exe",
      cliPath: "C:\\cli.js",
    });
    expect(xml).toContain("<id>a&lt;b</id>");
    expect(xml).toContain("<description>a &amp; b</description>");
    expect(xml).toContain('<env name="a&gt;1" value="x&quot;y" />');
  });

  it("B4-2 config passes script and args to the service XML", () => {
    const xml = renderWinSwXml(config(), {
      nodePath: "C:\\node.exe",
      cliPath: "C:\\cli.js",
    });
    expect(xml).toContain("<argument>C:\\cli.js</argument>");
    expect(xml).toContain("<argument>relay</argument>");
    expect(xml).toContain("<argument>18888</argument>");
  });

  it("B4-4 log dir is set in the WinSW XML", () => {
    const xml = renderWinSwXml(config(), {
      nodePath: "C:\\node.exe",
      cliPath: "C:\\cli.js",
    });
    expect(xml).toContain("C:\\logs");
  });

  it("parses sc query output for a running service", () => {
    const output = [
      "SERVICE_NAME: win-relay",
      "STATE              : 4  RUNNING",
      "PID                : 4321",
      "",
    ].join("\n");
    const status = parseScStatus("win-relay", output);
    expect(status.status).toBe("running");
    expect(status.pid).toBe(4321);
  });

  it("parses sc query output for a stopped service", () => {
    const output = [
      "SERVICE_NAME: win-relay",
      "STATE              : 1  STOPPED",
      "",
    ].join("\n");
    const status = parseScStatus("win-relay", output);
    expect(status.status).toBe("stopped");
    expect(status.pid).toBeUndefined();
  });

  it("returns unknown status for empty sc output", () => {
    const status = parseScStatus("win-relay", "");
    expect(status.status).toBe("unknown");
  });

  it("isAdminUser returns false off-win32 without spawning", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(isAdminUser()).toBe(false);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("elevateCommand builds a RunAs PowerShell command", () => {
    const cmd = elevateCommand();
    expect(cmd[0]).toBe("-NoProfile");
    expect(cmd[2]).toContain("Start-Process -FilePath");
    expect(cmd[2]).toContain("-Verb RunAs");
  });

  it("WindowsServiceManager status throws SERVICE_NOT_FOUND when sc query fails", async () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });
    const { WindowsServiceManager } = await import("../src/service/windows.js");
    const manager = new WindowsServiceManager();
    await expect(manager.status("ghost")).rejects.toThrow(/SERVICE_NOT_FOUND/);
  });

  it("install fails cleanly when node-windows is unavailable", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.doMock("node:module", () => ({
      createRequire: () => ({
        resolve: () => {
          throw new Error("Cannot find package 'node-windows'");
        },
      }),
    }));
    vi.resetModules();
    const { WindowsServiceManager } = await import("../src/service/windows.js");
    const manager = new WindowsServiceManager();
    await expect(manager.install(config())).rejects.toThrow(
      /SERVICE_WINDOWS_NATIVE_REQUIRED/,
    );
  });

  it("install drives winsw directly and registers the service", async () => {
    const tmpProgramData = `${process.cwd()}/.tmp-programdata-test`;
    rmSync(tmpProgramData, { recursive: true, force: true });

    // Fake node-windows package dir with a placeholder winsw.exe
    const fakeNodeWindowsRoot = `${tmpProgramData}/_node-windows`;
    const fakeWinSwDir = `${fakeNodeWindowsRoot}/bin/winsw`;
    mkdirSync(fakeWinSwDir, { recursive: true });
    // Write placeholder files so existsSync passes
    const { writeFileSync: wfs } = await import("node:fs");
    wfs(`${fakeWinSwDir}/winsw.exe`, "fake");
    wfs(`${fakeWinSwDir}/winsw.exe.config`, "<config/>");

    vi.doMock("node:module", () => ({
      createRequire: () => ({
        resolve: (id: string) => {
          if (id === "node-windows/package.json")
            return `${fakeNodeWindowsRoot}/package.json`;
          throw new Error(`Cannot find module '${id}'`);
        },
      }),
    }));
    vi.resetModules();
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.stubEnv("ProgramData", tmpProgramData);
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (String(cmd).endsWith(".exe")) {
        return { status: 0, stdout: "installed", stderr: "" };
      }
      if (cmd === "sc") {
        return {
          status: 0,
          stdout: "STATE              : 4  RUNNING",
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { WindowsServiceManager } = await import("../src/service/windows.js");
    const manager = new WindowsServiceManager();
    const result = await manager.install(config());
    expect(result.installed).toBe(true);
    expect(result.status).toBe("running");
    const winswCalls = mockSpawnSync.mock.calls.filter((c) =>
      String(c[0]).endsWith(".exe"),
    );
    expect(winswCalls.map((c) => c[1])).toEqual([["install"], ["start"]]);
    const xmlPath = `${tmpProgramData}/tailsacle-cli/services/win-relay/win-relay.xml`;
    expect(existsSync(xmlPath)).toBe(true);
    expect(readFileSync(xmlPath, "utf8")).toContain(
      "<argument>relay</argument>",
    );
    rmSync(tmpProgramData, { recursive: true, force: true });
    vi.doUnmock("node:module");
  });
});
