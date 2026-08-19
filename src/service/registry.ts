import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join as joinPath, dirname } from "node:path";
import os from "node:os";
import type { ServiceInfo } from "./types.js";

export function registryPath(): string {
  return joinPath(
    process.env.HOME ?? os.homedir(),
    ".tailsacle-cli",
    "services.json",
  );
}

let writeQueue: Promise<unknown> = Promise.resolve();

export function registryList(): ServiceInfo[] {
  const filePath = registryPath();
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed as ServiceInfo[];
    return [];
  } catch {
    return [];
  }
}

export async function registryAdd(info: ServiceInfo): Promise<ServiceInfo[]> {
  return enqueueWrite(() => {
    const entries = registryList().filter((e) => e.name !== info.name);
    entries.push(info);
    return entries;
  });
}

export async function registryRemove(name: string): Promise<ServiceInfo[]> {
  return enqueueWrite(() => {
    const entries = registryList().filter((e) => e.name !== name);
    return entries;
  });
}

function enqueueWrite(mutate: () => ServiceInfo[]): Promise<ServiceInfo[]> {
  const next = writeQueue.then(async () => {
    const entries = mutate();
    const filePath = registryPath();
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
    renameSync(tmp, filePath);
    return entries;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}

export function registryFind(name: string): ServiceInfo | undefined {
  return registryList().find((e) => e.name === name);
}
