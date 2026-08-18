import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureDeployTags } from "../src/policy.js";
import type { ResolvedConfig } from "../src/types.js";

const config: ResolvedConfig = {
  profile: "funnel-app",
  tailnet: "-",
  hostname: "node-a",
  tags: [],
  ssh: true,
  keyExpiry: "max",
  preauthorized: true,
  reusable: true,
  ephemeral: false,
  acceptDns: true,
  acceptRoutes: false,
  cleanupAfter: 3600,
  source: {},
  warnings: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (body && typeof body === "object") headers.set("etag", '"e1"');
  return new Response(JSON.stringify(body), { status, headers });
}

function hujsonResponse(raw: string, etag: string): Response {
  return new Response(raw, {
    status: 200,
    headers: { "content-type": "application/hujson", etag },
  });
}

describe("ensureDeployTags", () => {
  it("uses the provided owner verbatim when writing tagOwners (no tag: prefix)", async () => {
    vi.stubEnv("TS_API_KEY", "tskey-api-test-key");
    vi.stubEnv("TS_CLIENT_SECRET", "");

    const basePolicy = { grants: [], nodeAttrs: [] };
    const provisionedPolicy = {
      grants: [],
      nodeAttrs: [],
      tagOwners: { "tag:web": ["alice@example.com"] },
    };
    const calls = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(basePolicy)) // getPolicy() current
      .mockReturnValueOnce(hujsonResponse('{\n  "grants": []\n}', '"e2"')) // getPolicyHuJson()
      .mockReturnValueOnce(jsonResponse({})) // validatePolicyText()
      .mockReturnValueOnce(jsonResponse({})) // updatePolicy()
      .mockReturnValueOnce(jsonResponse(provisionedPolicy)); // getPolicy() verify

    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => calls(),
    );
    vi.stubGlobal("fetch", fetcher);

    const workDir = mkdtempSync(join(tmpdir(), "tscli-policy-"));
    try {
      const result = await ensureDeployTags(config, ["web"], {
        yes: true,
        owner: ["alice@example.com"],
        backupDir: workDir,
      });

      expect(result.provisioned).toBe(true);
      expect(result.warnings.join("\n")).toContain(
        "added tagOwners for tag:web (alice@example.com)",
      );

      const postBody = fetcher.mock.calls
        .map(([input, init]) => ({ url: String(input), init }))
        .find(
          (c) =>
            c.init &&
            c.init.method === "POST" &&
            c.url.endsWith("/tailnet/-/acl"),
        );
      expect(postBody).toBeDefined();
      const body = String(postBody!.init!.body);
      expect(body).toContain('"tagOwners"');
      expect(body).toContain('"tag:web": ["alice@example.com"]');
      expect(body).not.toContain('["tag:alice@example.com"]');

      const backs = readdirSync(workDir).filter((name) =>
        name.startsWith("policy.provision-"),
      );
      expect(backs.length).toBe(1);
      const backupContent = readFileSync(join(workDir, backs[0]!), "utf8");
      expect(backupContent).toBe('{\n  "grants": []\n}');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("keeps the owner verbatim even when it already looks like a group reference", async () => {
    vi.stubEnv("TS_API_KEY", "tskey-api-test-key");
    vi.stubEnv("TS_CLIENT_SECRET", "");

    const basePolicy = { grants: [], nodeAttrs: [] };
    const provisionedPolicy = {
      grants: [],
      nodeAttrs: [],
      tagOwners: { "tag:web": ["group:ops"] },
    };
    const calls = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(basePolicy))
      .mockReturnValueOnce(hujsonResponse('{\n  "grants": []\n}', '"e2"'))
      .mockReturnValueOnce(jsonResponse({}))
      .mockReturnValueOnce(jsonResponse({}))
      .mockReturnValueOnce(jsonResponse(provisionedPolicy));

    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => calls(),
    );
    vi.stubGlobal("fetch", fetcher);

    const workDir = mkdtempSync(join(tmpdir(), "tscli-policy-"));
    try {
      await ensureDeployTags(config, ["web"], {
        yes: true,
        owner: ["group:ops"],
        backupDir: workDir,
      });

      const postBody = fetcher.mock.calls
        .map(([input, init]) => ({ url: String(input), init }))
        .find(
          (c) =>
            c.init &&
            c.init.method === "POST" &&
            c.url.endsWith("/tailnet/-/acl"),
        );
      expect(postBody).toBeDefined();
      const body = String(postBody!.init!.body);
      expect(body).toContain('"tag:web": ["group:ops"]');
      expect(body).not.toContain('"tag:tag:group:ops"');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
