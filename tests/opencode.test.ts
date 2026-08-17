import { describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_OPENCODE_PORT,
  OPENCODE_PERMISSION_CONFIG,
  deriveUrls,
  readOpenCodeServeRecord,
  resolveOpenCodeRunner,
  tryVersion,
  writePermissionConfig,
} from "../src/opencode.js";
import { cacheBinDir } from "../src/binary.js";
import type { Exposure } from "../src/types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "opencode-test-"));
}

describe("opencode permission config (headless --auto equivalent)", () => {
  it("emits permission allow for every tool", () => {
    expect(JSON.parse(OPENCODE_PERMISSION_CONFIG)).toEqual({
      $schema: "https://opencode.ai/config.json",
      permission: "allow",
    });
  });

  it("writes the config file when missing and never overwrites an existing one", () => {
    const dir = tempDir();
    try {
      const target = join(dir, "opencode.json");
      const first = writePermissionConfig(target);
      expect(first.written).toEqual([target]);
      expect(first.existing).toEqual([]);
      expect(readFileSync(target, "utf8")).toBe(OPENCODE_PERMISSION_CONFIG);

      writeFileSync(target, '{"keep": true}\n', "utf8");
      const second = writePermissionConfig(target);
      expect(second.written).toEqual([]);
      expect(second.existing).toEqual([target]);
      expect(readFileSync(target, "utf8")).toBe('{"keep": true}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to the global config plus a project opencode.json", () => {
    const dir = tempDir();
    const project = join(dir, "opencode.json");
    const home = join(dir, "home");
    const previousCwd = process.cwd();
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("XDG_CACHE_HOME", join(dir, "cache"));
      process.chdir(dir);
      const result = writePermissionConfig();
      expect(result.written).toContain(project);
      expect(result.written).toContain(
        join(home, ".config", "opencode", "opencode.json"),
      );
    } finally {
      process.chdir(previousCwd);
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("opencode runner resolution", () => {
  it("prefers an opencode binary on PATH", async () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, "bin"), { recursive: true });
      const bin = join(dir, "bin", "opencode");
      writeFileSync(bin, "#!/bin/sh\necho 'opencode v9.9.9'\n", "utf8");
      chmodSync(bin, 0o755);
      vi.stubEnv("PATH", join(dir, "bin"));
      const runner = await resolveOpenCodeRunner();
      expect(runner.kind).toBe("path");
      expect(runner.command).toEqual(["opencode"]);
      expect(runner.installedBy).toBe("found");
      expect(runner.version).toMatch(/9\.9\.9/);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws OPENCODE_NOT_FOUND when neither opencode nor npx is available", async () => {
    const dir = tempDir();
    try {
      vi.stubEnv("PATH", dir);
      await expect(resolveOpenCodeRunner()).rejects.toThrow(
        "OPENCODE_NOT_FOUND",
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--install skips the PATH binary and resolves through npx", async () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, "bin"), { recursive: true });
      const bin = join(dir, "bin", "opencode");
      writeFileSync(bin, "#!/bin/sh\necho 'opencode v1.0.0'\n", "utf8");
      chmodSync(bin, 0o755);
      const npx = join(dir, "bin", "npx");
      writeFileSync(
        npx,
        '#!/bin/sh\nif [ "$1" = "-y" ]; then echo \'opencode v2.0.0\'; fi\n',
        "utf8",
      );
      chmodSync(npx, 0o755);
      vi.stubEnv("PATH", join(dir, "bin"));
      const runner = await resolveOpenCodeRunner({ install: true });
      expect(runner.kind).toBe("npx");
      expect(runner.installedBy).toBe("npx-resolved");
      expect(runner.version).toMatch(/2\.0\.0/);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("funnel URL derivation", () => {
  const exposures: Exposure[] = [
    { target: "http://127.0.0.1:3000", public: true, https: 443 },
  ];

  it("builds https URLs from the public FQDN and exposure paths", () => {
    expect(deriveUrls("myhost.mycorp.ts.net", exposures, 443)).toEqual([
      "https://myhost.mycorp.ts.net/",
    ]);
    expect(
      deriveUrls(
        "myhost.mycorp.ts.net",
        [
          {
            target: "http://127.0.0.1:3000",
            public: true,
            https: 443,
            path: "api",
          },
          { target: "http://127.0.0.1:3001", public: true, https: 8443 },
        ],
        443,
      ),
    ).toEqual([
      "https://myhost.mycorp.ts.net/api",
      "https://myhost.mycorp.ts.net/",
    ]);
  });

  it("deduplicates repeated paths", () => {
    const urls = deriveUrls("h.ts.net", [...exposures, ...exposures], 443);
    expect(urls).toEqual(["https://h.ts.net/"]);
  });

  it("returns an empty list when the DNS name is unknown", () => {
    expect(deriveUrls(undefined, exposures, 443)).toEqual([]);
  });

  it("falls back to the port when no public exposure carries a path", () => {
    expect(
      deriveUrls(
        "h.ts.net",
        [{ target: "http://127.0.0.1:3000", public: false }],
        443,
      ),
    ).toEqual(["https://h.ts.net:443"]);
  });
});

describe("serve pidfile record", () => {
  it("persists and round-trips the tracked serve record via TS_BIN_DIR", () => {
    const dir = tempDir();
    try {
      vi.stubEnv("TS_BIN_DIR", dir);
      expect(readOpenCodeServeRecord()).toBeUndefined();
      const file = join(cacheBinDir(), "opencode.pid.json");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          pid: 1234,
          command: "opencode serve --port 3000",
          port: 3000,
          startedAt: "2026-08-17T00:00:00.000Z",
        }),
        "utf8",
      );
      const record = readOpenCodeServeRecord();
      expect(record?.pid).toBe(1234);
      expect(record?.port).toBe(DEFAULT_OPENCODE_PORT);
      expect(record?.command).toContain("serve");
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for an unparseable pidfile", () => {
    const dir = tempDir();
    try {
      vi.stubEnv("TS_BIN_DIR", dir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "opencode.pid.json"), "not json", "utf8");
      expect(readOpenCodeServeRecord()).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tryVersion", () => {
  it("returns undefined when the command cannot run", async () => {
    const dir = tempDir();
    try {
      vi.stubEnv("PATH", dir);
      expect(
        await tryVersion(["opencode-missing-binary-test", "--version"]),
      ).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
