import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  daemonStatus,
  readTrackedDaemon,
  stopUserspaceDaemon,
  trackedUserspaceSocket,
} from "../src/daemon.js";

async function withBinDir(fn: () => Promise<void>): Promise<void> {
  const previous = process.env.TS_BIN_DIR;
  const dir = await mkdtemp(join(tmpdir(), "tscli-dmn-"));
  process.env.TS_BIN_DIR = dir;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.TS_BIN_DIR;
    else process.env.TS_BIN_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

function pidFile(): string {
  return join(process.env.TS_BIN_DIR!, "daemon.pid.json");
}

async function writePid(pid: number): Promise<void> {
  await writeFile(
    pidFile(),
    `${JSON.stringify({
      pid,
      socket: "/tmp/sock/tailscaled.sock",
      command: "tailscaled --tun=userspace-networking",
      startedAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
}

describe("userspace daemon lifecycle tracking", () => {
  it("returns undefined when no pidfile exists", async () => {
    await withBinDir(async () => {
      expect(readTrackedDaemon()).toBeUndefined();
    });
  });

  it("parses a recorded pidfile", async () => {
    await withBinDir(async () => {
      await writePid(12345);
      expect(readTrackedDaemon()).toMatchObject({
        pid: 12345,
        socket: "/tmp/sock/tailscaled.sock",
      });
    });
  });

  it("refuses to stop a pid that is not a userspace tailscaled and clears the stale pidfile", async () => {
    await withBinDir(async () => {
      await writePid(process.pid);
      const result = await stopUserspaceDaemon();
      expect(result.stopped).toBe(false);
      expect(result.message).toContain("UNTRACKED_PID");
      await expect(readTrackedDaemon()).toBeUndefined();
    });
  });

  it("reports trackedAlive false for a stale non-tailscaled pid", async () => {
    await withBinDir(async () => {
      await writePid(process.pid);
      const status = await daemonStatus();
      expect(status.trackedAlive).toBe(false);
    });
  });

  it("stops a tracked userspace-tailscaled process and clears the pidfile", async () => {
    await withBinDir(async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          "setInterval(() => {}, 1000)",
          "tailscaled",
          "--tun=userspace-networking",
        ],
        { stdio: "ignore" },
      );
      const pid = child.pid!;
      await writePid(pid);
      const result = await stopUserspaceDaemon();
      if (process.platform === "win32") {
        // Userspace daemons are only started and tracked off-Windows; on
        // Windows the process command line cannot be verified so the pid is
        // treated as untracked (and the stale pidfile is cleared).
        expect(result.stopped).toBe(false);
        expect(result.message).toContain("UNTRACKED_PID");
      } else {
        expect(result.stopped).toBe(true);
        expect(result.pid).toBe(pid);
      }
      await expect(readTrackedDaemon()).toBeUndefined();
    });
  });

  it("returns the tracked socket only while the userspace daemon is alive", async () => {
    await withBinDir(async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          "setInterval(() => {}, 1000)",
          "tailscaled",
          "--tun=userspace-networking",
        ],
        { stdio: "ignore" },
      );
      const pid = child.pid!;
      await writePid(pid);
      if (process.platform === "win32") {
        await expect(trackedUserspaceSocket()).resolves.toBeUndefined();
      } else {
        await expect(trackedUserspaceSocket()).resolves.toBe(
          "/tmp/sock/tailscaled.sock",
        );
        const result = await stopUserspaceDaemon();
        expect(result.stopped).toBe(true);
        await expect(trackedUserspaceSocket()).resolves.toBeUndefined();
      }
    });
  });
});
