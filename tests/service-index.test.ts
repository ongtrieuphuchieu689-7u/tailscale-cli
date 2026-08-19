import { describe, it, expect, vi } from "vitest";

describe("service platform dispatch", () => {
  const platforms = [
    "linux",
    "win32",
    "darwin",
    "freebsd",
    "aix",
    "sunos",
    "haiku",
    "openbsd",
    "netbsd",
  ] as const;

  for (const platform of platforms) {
    it(`${platform} dispatch`, async () => {
      vi.resetModules();
      vi.stubGlobal("process", { ...process, platform });
      const { getServiceManager, getSchedulerManager } =
        await import("../src/service/index.js");
      if (platform === "linux") {
        const manager = getServiceManager();
        expect(manager.constructor.name).toBe("LinuxServiceManager");
      } else if (platform === "win32") {
        const manager = getServiceManager();
        expect(manager.constructor.name).toBe("WindowsServiceManager");
        const scheduler = getSchedulerManager();
        expect(scheduler.constructor.name).toBe("WindowsSchedulerManager");
      } else {
        expect(() => getServiceManager()).toThrow(
          /SERVICE_PLATFORM_UNSUPPORTED/,
        );
        expect(() => getSchedulerManager()).toThrow(
          /SERVICE_PLATFORM_UNSUPPORTED/,
        );
      }
      vi.unstubAllGlobals();
    });
  }
});
