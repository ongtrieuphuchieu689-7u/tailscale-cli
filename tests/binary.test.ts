import { describe, expect, it } from "vitest";
import { detectArch, cacheBinDir, cacheBinPath } from "../src/binary.js";

describe("binary detection and cache layout", () => {
  it("maps Node arch names to Tailscale tarball arch names", () => {
    expect(detectArch()).toMatch(
      /^(amd64|arm64|arm|386|riscv64|mips64le|loong64)$/,
    );
  });

  it("honours TS_BIN_DIR for the cache directory", () => {
    const previous = process.env.TS_BIN_DIR;
    process.env.TS_BIN_DIR = "/tmp/opencode/tsbin";
    try {
      expect(cacheBinDir()).toBe("/tmp/opencode/tsbin");
      expect(cacheBinPath()).toMatch(/[\\/]tailscale(\.exe)?$/);
    } finally {
      if (previous === undefined) delete process.env.TS_BIN_DIR;
      else process.env.TS_BIN_DIR = previous;
    }
  });
});
