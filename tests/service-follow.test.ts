import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followLogFiles } from "../src/service/follow.js";

/**
 * fs.watchFile() registers a libuv stat handle that keeps the Node event loop
 * alive until unwatchFile() is called. `service logs --follow` used to resolve
 * its Ctrl-C handler without unwatching, so the CLI hung forever afterwards.
 */
function statWatchers(): string[] {
  return process.getActiveResourcesInfo().filter((r) => r === "StatWatcher");
}

describe("followLogFiles", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tmpLog(name: string, contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "tscli-follow-"));
    dirs.push(dir);
    const file = join(dir, name);
    writeFileSync(file, contents);
    return file;
  }

  it("releases every watcher when interrupted, so the process can exit", async () => {
    const a = tmpLog("out.log", "one\n");
    const b = tmpLog("err.log", "two\n");

    expect(statWatchers()).toHaveLength(0);

    const seen: string[] = [];
    const following = followLogFiles([a, b], (p) => seen.push(p), 20);

    // Both files are being watched.
    await new Promise((r) => setTimeout(r, 30));
    expect(statWatchers()).toHaveLength(2);

    // Changes are reported.
    writeFileSync(a, "one\ntwo\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toContain(a);

    process.emit("SIGINT");
    await following;

    // The whole point: no leaked stat handles blocking process exit.
    await new Promise((r) => setTimeout(r, 50));
    expect(statWatchers()).toHaveLength(0);
  });

  it("also releases watchers on SIGTERM", async () => {
    const a = tmpLog("out.log", "one\n");
    const following = followLogFiles([a], () => {}, 20);
    await new Promise((r) => setTimeout(r, 30));
    expect(statWatchers()).toHaveLength(1);

    process.emit("SIGTERM");
    await following;
    await new Promise((r) => setTimeout(r, 50));
    expect(statWatchers()).toHaveLength(0);
  });

  it("skips files that do not exist yet", async () => {
    const a = tmpLog("out.log", "one\n");
    const missing = join(a, "..", "nope.log");

    const following = followLogFiles([a, missing], () => {}, 20);
    await new Promise((r) => setTimeout(r, 30));
    expect(statWatchers()).toHaveLength(1);

    process.emit("SIGINT");
    await following;
    await new Promise((r) => setTimeout(r, 50));
    expect(statWatchers()).toHaveLength(0);
  });
});
