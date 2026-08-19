import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import {
  registryAdd,
  registryList,
  registryRemove,
  registryPath,
} from "../src/service/registry.js";
import type { ServiceInfo } from "../src/service/types.js";

const fakeHome = "/tmp/ts-service-registry-home";

function info(name: string): ServiceInfo {
  return {
    name,
    status: "running",
    pid: 1234,
    platform: "linux",
    scope: "user",
    unitPath: `/home/test/.config/systemd/user/${name}.service`,
    installedAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("service registry", () => {
  beforeEach(() => {
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("B2-4 returns [] when the registry file does not exist", () => {
    expect(registryList()).toEqual([]);
  });

  it("B2-1 writes a new service entry", async () => {
    await registryAdd(info("alpha"));
    const entries = registryList();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("alpha");
    expect(entries[0]!.unitPath).toContain("alpha.service");
  });

  it("B2-2 reads the list back", async () => {
    await registryAdd(info("alpha"));
    await registryAdd(info("beta"));
    const entries = registryList();
    expect(entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("B2-3 removes a service entry", async () => {
    await registryAdd(info("alpha"));
    await registryAdd(info("beta"));
    await registryRemove("alpha");
    const entries = registryList();
    expect(entries.map((e) => e.name)).toEqual(["beta"]);
  });

  it("B2-5 concurrent writes do not lose data", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => registryAdd(info(`svc-${i}`))),
    );
    const entries = registryList();
    expect(entries).toHaveLength(10);
    expect(new Set(entries.map((e) => e.name)).size).toBe(10);
  });

  it("registryPath points at the home directory registry file", () => {
    expect(registryPath()).toBe(`${fakeHome}/.tailsacle-cli/services.json`);
  });

  it("add replaces an existing entry with the same name", async () => {
    await registryAdd(info("alpha"));
    const updated = { ...info("alpha"), status: "stopped" as const };
    await registryAdd(updated);
    const entries = registryList();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("stopped");
  });

  it("registry file is valid JSON on disk", async () => {
    await registryAdd(info("alpha"));
    const raw = require("node:fs").readFileSync(registryPath(), "utf8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("resilient to a corrupt registry file", async () => {
    require("node:fs").mkdirSync(`${fakeHome}/.tailsacle-cli`, {
      recursive: true,
    });
    require("node:fs").writeFileSync(registryPath(), "{not json", "utf8");
    expect(registryList()).toEqual([]);
  });

  it("uses os.homedir() when HOME is not set", async () => {
    delete process.env.HOME;
    const p = registryPath();
    expect(p).toContain(os.homedir());
  });
});
