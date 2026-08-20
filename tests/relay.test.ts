import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { writeFileSync, unlinkSync } from "node:fs";
import {
  startRelay,
  startMultiRelay,
  parseRelayMapping,
  loadRelayConfigFile,
  type RelayInstance,
  type MultiRelayInstance,
} from "../src/relay.js";

describe("TCP Relay", () => {
  let echoServer1: net.Server | undefined;
  let echoServer2: net.Server | undefined;
  let relay: RelayInstance | undefined;
  let multiRelay: MultiRelayInstance | undefined;
  const tempFiles: string[] = [];

  afterEach(async () => {
    if (relay) {
      await relay.close();
      relay = undefined;
    }
    if (multiRelay) {
      await multiRelay.close();
      multiRelay = undefined;
    }
    if (echoServer1) {
      await new Promise<void>((res) => echoServer1!.close(() => res()));
      echoServer1 = undefined;
    }
    if (echoServer2) {
      await new Promise<void>((res) => echoServer2!.close(() => res()));
      echoServer2 = undefined;
    }
    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
    tempFiles.length = 0;
  });

  it("should forward TCP packets between client and target", async () => {
    let receivedPayload = "";
    echoServer1 = net.createServer((sock) => {
      sock.on("data", (chunk) => {
        receivedPayload += chunk.toString();
        sock.write("ECHO:" + chunk.toString());
      });
    });

    await new Promise<void>((res) =>
      echoServer1!.listen(0, "127.0.0.1", () => res()),
    );
    const targetPort = (echoServer1.address() as net.AddressInfo).port;

    relay = await startRelay({
      listenPort: 0,
      targetHost: "127.0.0.1",
      targetPort,
      listenHost: "127.0.0.1",
    });

    const relayPort = (relay.server.address() as net.AddressInfo).port;

    const client = net.connect({ host: "127.0.0.1", port: relayPort });
    let clientResponse = "";

    await new Promise<void>((resolve, reject) => {
      client.on("connect", () => {
        client.write("HELLO_POSTGRES");
      });
      client.on("data", (data) => {
        clientResponse += data.toString();
        client.end();
      });
      client.on("end", () => resolve());
      client.on("error", reject);
    });

    expect(receivedPayload).toBe("HELLO_POSTGRES");
    expect(clientResponse).toBe("ECHO:HELLO_POSTGRES");
  });

  it("should parse mapping strings accurately", () => {
    const m1 = parseRelayMapping("5432:5433", "192.168.50.79");
    expect(m1).toEqual({
      listenPort: 5432,
      targetHost: "192.168.50.79",
      targetPort: 5433,
    });

    const m2 = parseRelayMapping("5432:10.0.0.1:5434");
    expect(m2).toEqual({
      listenPort: 5432,
      targetHost: "10.0.0.1",
      targetPort: 5434,
    });

    const m3 = parseRelayMapping("127.0.0.1:5432:10.0.0.1:5435");
    expect(m3).toEqual({
      listenHost: "127.0.0.1",
      listenPort: 5432,
      targetHost: "10.0.0.1",
      targetPort: 5435,
    });
  });

  it("should load mappings from json/jsonc config files", () => {
    const tempFile = "temp-relay-test-config.json";
    tempFiles.push(tempFile);
    writeFileSync(
      tempFile,
      JSON.stringify([
        { listen: 5432, target: "192.168.50.79:5432" },
        {
          listen: 5433,
          targetHost: "192.168.50.79",
          targetPort: 5433,
          serve: true,
        },
        {
          listen: 5431,
          target: "localhost:5432",
          user: "app",
          password: "secret-db-pw",
          database: "appdb",
        },
      ]),
    );

    const loaded = loadRelayConfigFile(tempFile);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]!.listenPort).toBe(5432);
    expect(loaded[0]!.targetPort).toBe(5432);
    expect(loaded[1]!.listenPort).toBe(5433);
    expect(loaded[1]!.targetPort).toBe(5433);
    expect(loaded[1]!.serve).toBe(true);
    expect(loaded[2]!.listenPort).toBe(5431);
    expect(loaded[2]!.targetHost).toBe("localhost");
    expect(loaded[2]!.targetPort).toBe(5432);
    expect(loaded[2]!.user).toBe("app");
    expect(loaded[2]!.password).toBe("secret-db-pw");
    expect(loaded[2]!.database).toBe("appdb");
  });

  it("should run multi-relay for multiple ports simultaneously", async () => {
    echoServer1 = net.createServer((sock) => {
      sock.write("PORT1_OK");
    });
    echoServer2 = net.createServer((sock) => {
      sock.write("PORT2_OK");
    });

    await new Promise<void>((res) =>
      echoServer1!.listen(0, "127.0.0.1", () => res()),
    );
    await new Promise<void>((res) =>
      echoServer2!.listen(0, "127.0.0.1", () => res()),
    );

    const targetPort1 = (echoServer1.address() as net.AddressInfo).port;
    const targetPort2 = (echoServer2.address() as net.AddressInfo).port;

    multiRelay = await startMultiRelay([
      {
        listenPort: 0,
        targetHost: "127.0.0.1",
        targetPort: targetPort1,
        listenHost: "127.0.0.1",
      },
      {
        listenPort: 0,
        targetHost: "127.0.0.1",
        targetPort: targetPort2,
        listenHost: "127.0.0.1",
      },
    ]);

    expect(multiRelay.relays).toHaveLength(2);
    const relayPort1 = (
      multiRelay.relays[0]!.instance.server.address() as net.AddressInfo
    ).port;
    const relayPort2 = (
      multiRelay.relays[1]!.instance.server.address() as net.AddressInfo
    ).port;

    // Test port 1
    const res1 = await new Promise<string>((resolve) => {
      const c = net.connect({ host: "127.0.0.1", port: relayPort1 });
      c.on("data", (d) => {
        resolve(d.toString());
        c.end();
      });
    });
    expect(res1).toBe("PORT1_OK");

    // Test port 2
    const res2 = await new Promise<string>((resolve) => {
      const c = net.connect({ host: "127.0.0.1", port: relayPort2 });
      c.on("data", (d) => {
        resolve(d.toString());
        c.end();
      });
    });
    expect(res2).toBe("PORT2_OK");
  });
});
