import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { tcpConnect, verifyEndpointReachable } from "../src/verify.js";

describe("tcpConnect", () => {
  it("resolves when a listener accepts the connection", async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(
        tcpConnect("127.0.0.1", port, 2000),
      ).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("rejects when nothing listens on the port", async () => {
    await expect(tcpConnect("127.0.0.1", 1, 500)).rejects.toThrow();
  });
});

describe("verifyEndpointReachable", () => {
  it("verifies a TCP endpoint against a live listener", async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const result = await verifyEndpointReachable(
        "127.0.0.1",
        [port],
        "tcp",
        5,
      );
      expect(result.ok).toBe(true);
      expect(result.verifiedPorts).toEqual([port]);
      expect(result.attempts).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it("fails when the TLS endpoint never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    try {
      const result = await verifyEndpointReachable(
        "unreachable.example.ts.net",
        [443],
        "tls",
        1,
      );
      expect(result.ok).toBe(false);
      expect(result.verifiedPorts).toEqual([]);
      expect(result.attempts).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats any HTTP response as a verified TLS+HTTP endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    try {
      const result = await verifyEndpointReachable(
        "app.example.ts.net",
        [443],
        "tls",
        1,
      );
      expect(result.ok).toBe(true);
      expect(result.verifiedPorts).toEqual([443]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});