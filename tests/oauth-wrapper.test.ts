import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";
import { startOAuthWrapper } from "../src/oauth-wrapper.js";

const CLIENT_ID = "mcp-client";
const CLIENT_SECRET = "a-very-secret-client-secret-value";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

describe("oauth-wrapper authorization codes", () => {
  let server: ReturnType<typeof startOAuthWrapper>;
  let base: string;

  beforeAll(async () => {
    server = startOAuthWrapper({
      port: 0,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      publicUrl: "https://mcp-postgres.tailadac87.ts.net",
      token: CLIENT_SECRET,
    });
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once("listening", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function authorize(challenge: string): Promise<string> {
    const url = new URL(`${base}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    // manual: the 302 points at the real claude.ai callback, which we must
    // not actually reach.
    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    const code = new URL(location).searchParams.get("code");
    expect(code).toBeTruthy();
    return code!;
  }

  // Regression: codes were built from two Math.random() calls, which V8's
  // xorshift128+ makes predictable. They must be CSPRNG values with enough
  // entropy and be safe to carry in a URL query string.
  it("issues unguessable, URL-safe authorization codes", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const code = await authorize(
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      );
      // base64url alphabet only — must not need percent-encoding.
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 random bytes ~= 256 bits; the old form was ~10 base36 chars.
      expect(code.length).toBeGreaterThanOrEqual(40);
      codes.add(code);
    }
    // All distinct — no collisions, so no code reuse across grants.
    expect(codes.size).toBe(25);
  });

  it("still rejects PKCE-less and non-allowlisted requests", async () => {
    const noPkce = new URL(`${base}/authorize`);
    noPkce.searchParams.set("client_id", CLIENT_ID);
    noPkce.searchParams.set("redirect_uri", REDIRECT);
    expect((await fetch(noPkce)).status).toBe(400);

    const badRedirect = new URL(`${base}/authorize`);
    badRedirect.searchParams.set("client_id", CLIENT_ID);
    badRedirect.searchParams.set("redirect_uri", "https://evil.example/cb");
    badRedirect.searchParams.set("code_challenge", "abc");
    badRedirect.searchParams.set("code_challenge_method", "S256");
    expect((await fetch(badRedirect)).status).toBe(400);

    const badClient = new URL(`${base}/authorize`);
    badClient.searchParams.set("client_id", "someone-else");
    badClient.searchParams.set("redirect_uri", REDIRECT);
    badClient.searchParams.set("code_challenge", "abc");
    badClient.searchParams.set("code_challenge_method", "S256");
    expect((await fetch(badClient)).status).toBe(401);
  });
});
