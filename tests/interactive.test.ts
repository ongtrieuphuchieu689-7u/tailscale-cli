import { describe, expect, it } from "vitest";
import { confirm, promptCredential } from "../src/interactive.js";
import { credentialEnvName, maskSecret } from "../src/core.js";

describe("non-TTY confirmation safety", () => {
  it("returns false instead of prompting when stdin is not a TTY", async () => {
    expect(await confirm("destroy everything?", false)).toBe(false);
  });

  it("honours --yes and TS_CLI_YES without a TTY", async () => {
    const previous = process.env.TS_CLI_YES;
    process.env.TS_CLI_YES = "1";
    try {
      expect(await confirm("destroy everything?", false)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TS_CLI_YES;
      else process.env.TS_CLI_YES = previous;
    }
  });
});

describe("credential env resolution", () => {
  it("accepts a trust credential stored under any env name", () => {
    const env = { CI_TAILSCALE_TRUST: "tskey-client-abc123-wxyz9876qwer" };
    expect(credentialEnvName(env)).toBe("CI_TAILSCALE_TRUST");
    expect(credentialEnvName(env, "CI_TAILSCALE_TRUST")).toBe(
      "CI_TAILSCALE_TRUST",
    );
  });

  it("rejects a --credential-env name that is not a trust credential", () => {
    expect(
      credentialEnvName(
        { TS_ACCESS_TOKEN: "tskey-api-xxx" },
        "TS_ACCESS_TOKEN",
      ),
    ).toBeUndefined();
    expect(credentialEnvName({}, "MISSING")).toBeUndefined();
  });

  it("maskSecret never reveals more than a fragment", () => {
    expect(maskSecret("tskey-client-long-secret-value-12345")).not.toContain(
      "long-secret-value",
    );
    expect(maskSecret("short")).toBe("***");
  });
});

describe("interactive credential prompt", () => {
  it("returns undefined instead of prompting when stdin is not a TTY", async () => {
    expect(await promptCredential()).toBeUndefined();
  });

  it("returns undefined when TS_CLI_YES is set", async () => {
    const previous = process.env.TS_CLI_YES;
    process.env.TS_CLI_YES = "1";
    try {
      expect(await promptCredential()).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.TS_CLI_YES;
      else process.env.TS_CLI_YES = previous;
    }
  });
});
