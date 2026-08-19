import { LinuxServiceManager } from "./linux.js";
import { WindowsServiceManager } from "./windows.js";
import { WindowsSchedulerManager } from "./windows-scheduler.js";
import type { ServiceManager } from "./types.js";

export function getServiceManager(): ServiceManager {
  switch (process.platform) {
    case "linux":
      return new LinuxServiceManager();
    case "win32":
      return new WindowsServiceManager();
    case "darwin":
      throw new Error(
        "SERVICE_PLATFORM_UNSUPPORTED: macOS launchd support is planned but not implemented yet",
      );
    default:
      throw new Error(
        `SERVICE_PLATFORM_UNSUPPORTED: platform ${process.platform} is not supported`,
      );
  }
}

export function getSchedulerManager(): ServiceManager {
  if (process.platform !== "win32") {
    throw new Error(
      "SERVICE_PLATFORM_UNSUPPORTED: Task Scheduler (--scheduler) is only available on Windows",
    );
  }
  return new WindowsSchedulerManager();
}
