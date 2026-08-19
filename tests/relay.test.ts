import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { startRelay, type RelayInstance } from "../src/relay.js";

describe("TCP Relay", () => {
  let echoServer: net.Server | undefined;
  let relay: RelayInstance | undefined;

  afterEach(async () => {
    if (relay) {
      await relay.close();
      relay = undefined;
    }
    if (echoServer) {
      await new Promise<void>((res) => echoServer!.close(() => res()));
      echoServer = undefined;
    }
  });

  it("should forward TCP packets between client and target", async () => {
    // 1. Setup mock target server (echo)
    let receivedPayload = "";
    echoServer = net.createServer((sock) => {
      sock.on("data", (chunk) => {
        receivedPayload += chunk.toString();
        sock.write("ECHO:" + chunk.toString());
      });
    });

    await new Promise<void>((res) =>
      echoServer!.listen(0, "127.0.0.1", () => res()),
    );
    const targetPort = (echoServer.address() as net.AddressInfo).port;

    // 2. Start relay
    relay = await startRelay({
      listenPort: 0,
      targetHost: "127.0.0.1",
      targetPort,
      listenHost: "127.0.0.1",
    });

    const relayPort = (relay.server.address() as net.AddressInfo).port;

    // 3. Connect client to relay
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
});
