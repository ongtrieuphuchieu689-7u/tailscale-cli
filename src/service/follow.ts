import { existsSync, unwatchFile, watchFile } from "node:fs";

/**
 * Tail the given files until the process is interrupted.
 *
 * `onChange` is invoked with each watched path whenever the file changes.
 * Missing files are skipped.
 *
 * fs.watchFile() installs a libuv stat handle that stays active until the
 * matching unwatchFile() call, which keeps the Node event loop alive. Resolving
 * on SIGINT/SIGTERM without unwatching therefore left `service logs --follow`
 * unable to exit — Ctrl-C printed nothing and the process had to be killed
 * again. All watchers are released before this promise resolves.
 */
export function followLogFiles(
  paths: readonly string[],
  onChange: (path: string) => void,
  intervalMs = 1000,
): Promise<void> {
  const watchers: Array<[string, () => void]> = [];
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const listener = (): void => {
      onChange(filePath);
    };
    watchFile(filePath, { interval: intervalMs }, listener);
    watchers.push([filePath, listener]);
  }

  return new Promise<void>((resolve) => {
    const stop = (): void => {
      for (const [filePath, listener] of watchers) {
        unwatchFile(filePath, listener);
      }
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
