import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TailscaleLocal } from "../src/tailscale.js";

async function fakeTailscaleBin(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tscli-shim-"));
  const shim = join(
    dir,
    process.platform === "win32" ? "tailscale.cmd" : "tailscale",
  );
  const script =
    process.platform === "win32"
      ? "@echo off\r\nfor %%A in (%*) do @echo %%A\r\n"
      : "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n";
  await writeFile(shim, script);
  await chmod(shim, 0o755);
  return shim;
}

describe("TailscaleLocal --socket pass-through", () => {
  it("prefixes --socket from options.env when set", async () => {
    const shim = await fakeTailscaleBin();
    const local = new TailscaleLocal(shim);
    const result = await local.run(["status"], {
      env: { TS_TAILSCALE_SOCKET: "/tmp/env-sock/tailscaled.sock" },
    });
    expect(result.stdout.split("\n")[0]).toBe(
      "--socket=/tmp/env-sock/tailscaled.sock",
    );
    expect(result.stdout.split("\n")[1]).toBe("status");
  });

  it("falls back to process.env.TS_TAILSCALE_SOCKET when options.env is absent", async () => {
    const previous = process.env.TS_TAILSCALE_SOCKET;
    process.env.TS_TAILSCALE_SOCKET = "/tmp/shared-sock/tailscaled.sock";
    try {
      const shim = await fakeTailscaleBin();
      const result = await new TailscaleLocal(shim).run(["status"]);
      expect(result.stdout.split("\n")[0]).toBe(
        "--socket=/tmp/shared-sock/tailscaled.sock",
      );
    } finally {
      if (previous === undefined) delete process.env.TS_TAILSCALE_SOCKET;
      else process.env.TS_TAILSCALE_SOCKET = previous;
    }
  });

  it("passes args through unchanged when no socket is configured", async () => {
    const previous = process.env.TS_TAILSCALE_SOCKET;
    if (previous !== undefined) delete process.env.TS_TAILSCALE_SOCKET;
    try {
      const shim = await fakeTailscaleBin();
      const result = await new TailscaleLocal(shim).run(["status"]);
      expect(result.stdout.split("\n")[0]).toBe("status");
    } finally {
      if (previous !== undefined) process.env.TS_TAILSCALE_SOCKET = previous;
    }
  });
});
