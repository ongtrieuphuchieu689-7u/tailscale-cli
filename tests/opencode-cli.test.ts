import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runOpenCodeFlow = vi.fn();
const stopOpenCodeFlow = vi.fn();

vi.mock("../src/opencode.js", () => ({
  DEFAULT_OPENCODE_PORT: 3000,
  runOpenCodeFlow,
  stopOpenCodeFlow,
}));

vi.mock("../src/core.js", () => ({
  loadConfigFile: () => undefined,
  resolveConfig: () => ({}),
}));

const realArgv = process.argv;
const realExitCode = process.exitCode;

/** Import the CLI entrypoint with the given args; it self-parses on import. */
async function runCli(args: string[]): Promise<void> {
  process.argv = ["node", "opencode-cli", ...args];
  vi.resetModules();
  await import("../src/opencode-cli.js");
  // program.parseAsync() is intentionally floating in the entrypoint; give the
  // action microtask/macrotask turns to settle.
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("opencode --stop", () => {
  beforeEach(() => {
    runOpenCodeFlow.mockReset();
    stopOpenCodeFlow.mockReset();
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = realArgv;
    process.exitCode = realExitCode;
    vi.restoreAllMocks();
  });

  it("stops and returns without starting the deploy flow", async () => {
    stopOpenCodeFlow.mockResolvedValue({
      serve: { stopped: true, pid: 1, message: "stopped" },
      daemon: { stopped: true, pid: 2, message: "stopped" },
    });

    await runCli(["--stop", "--json"]);

    expect(stopOpenCodeFlow).toHaveBeenCalledTimes(1);
    expect(runOpenCodeFlow).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  // Regression: the catch called fail() — which only records the envelope and
  // exit code — without returning, so control fell through into the full
  // install / serve / join / funnel flow. A "stop" that publishes the node to
  // the public internet is the worst possible outcome here.
  it("never falls through to the deploy flow when stopping fails", async () => {
    stopOpenCodeFlow.mockRejectedValue(new Error("EPIPE: stdout closed"));

    await runCli(["--stop", "--json"]);

    expect(stopOpenCodeFlow).toHaveBeenCalledTimes(1);
    expect(runOpenCodeFlow).not.toHaveBeenCalled();
    // The failure must still be reported.
    expect(process.exitCode).toBe(1);
  });
});
