import { describe, expect, it, vi } from "vitest";
import { funnelPublicDnsPropagated } from "../src/dns.js";

const googleUrl = "https://dns.google/resolve?name=app.example.ts.net&type=A";
const cloudflareUrl =
  "https://cloudflare-dns.com/dns-query?name=app.example.ts.net&type=A";

function stubFetch(answers: {
  google?: { type: number; data: string }[];
  cloudflare?: { type: number; data: string }[];
}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const answer = url.startsWith("https://cloudflare-dns.com/")
      ? answers.cloudflare
      : answers.google;
    return {
      json: async () => ({
        Status: answer ? 0 : 3,
        ...(answer ? { Answer: answer } : {}),
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("funnelPublicDnsPropagated", () => {
  it("succeeds when any DoH resolver serves the A record while another is negatively cached", async () => {
    const fetchMock = stubFetch({
      google: [],
      cloudflare: [{ type: 1, data: "199.38.181.54" }],
    });
    try {
      const result = await funnelPublicDnsPropagated("app.example.ts.net", 5);
      expect(result.ok).toBe(true);
      expect(result.attempts).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledWith(
        googleUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        cloudflareUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("succeeds on the first resolver when both agree the record exists", async () => {
    const fetchMock = stubFetch({
      google: [{ type: 1, data: "199.38.181.54" }],
      cloudflare: [{ type: 1, data: "199.38.181.54" }],
    });
    try {
      const result = await funnelPublicDnsPropagated("app.example.ts.net", 5);
      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails when every resolver has no A record within the deadline", async () => {
    stubFetch({ google: [], cloudflare: [] });
    try {
      const result = await funnelPublicDnsPropagated(
        "no-such-host-4f2e9c.invalid.ts.net",
        1,
      );
      expect(result.ok).toBe(false);
      expect(result.attempts).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not report a TXT/other record as an A record", async () => {
    stubFetch({
      google: [{ type: 16, data: "txt" }],
      cloudflare: [],
    });
    try {
      const result = await funnelPublicDnsPropagated(
        "no-such-host-4f2e9c.invalid.ts.net",
        1,
      );
      expect(result.ok).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
