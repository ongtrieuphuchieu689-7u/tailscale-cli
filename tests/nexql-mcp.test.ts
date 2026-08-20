import { describe, it, expect } from "vitest";
import net from "node:net";
import {
  maskConnString,
  connStringWithoutPassword,
  passwordFromConnString,
  maskToken,
  randomToken,
  preflightTcpCheck,
} from "../src/nexql-mcp.js";

describe("nexql-mcp helpers", () => {
  it("should mask the password in a connection string", () => {
    expect(
      maskConnString("postgres://postgres:secret123@127.0.0.1:5432/postgres"),
    ).toBe("postgres://postgres:***@127.0.0.1:5432/postgres");
  });

  it("should strip the password for argv-safe connection strings", () => {
    expect(
      connStringWithoutPassword(
        "postgres://postgres:secret123@127.0.0.1:5432/postgres",
      ),
    ).toBe("postgres://postgres@127.0.0.1:5432/postgres");
  });

  it("should extract the password from a connection string", () => {
    expect(
      passwordFromConnString(
        "postgres://postgres:secret123@127.0.0.1:5432/postgres",
      ),
    ).toBe("secret123");
    expect(
      passwordFromConnString("postgres://postgres@127.0.0.1:5432/db"),
    ).toBe(undefined);
  });

  it("should mask and generate tokens safely", () => {
    expect(maskToken("")).toBe("***");
    expect(maskToken("ab")).toBe("***");
    expect(maskToken("abcdefghijklmnopqrstuvwxyz")).toBe("abcde…xyz");
    const t = randomToken();
    expect(t).toHaveLength(32);
    expect(randomToken(16)).toHaveLength(16);
    expect(t).not.toBe(randomToken());
  });

  it("should resolve preflight TCP checks for reachable and unreachable targets", async () => {
    const server = net.createServer();
    await new Promise<void>((res) =>
      server.listen(0, "127.0.0.1", () => res()),
    );
    const port = (server.address() as net.AddressInfo).port;
    const ok = await preflightTcpCheck({
      host: "127.0.0.1",
      port,
      timeoutMs: 2_000,
    });
    expect(ok.port).toBe(port);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    await new Promise<void>((res) => server.close(() => res()));

    await expect(
      preflightTcpCheck({ host: "127.0.0.1", port, timeoutMs: 500 }),
    ).rejects.toThrow(/NEXQL_MCP_DB_UNREACHABLE/);
  });
});
