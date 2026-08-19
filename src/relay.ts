import net from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export interface RelayMapping {
  listenPort: number;
  targetHost: string;
  targetPort: number;
  listenHost?: string | undefined;
  serve?: boolean | undefined;
  funnel?: boolean | undefined;
}

export interface RelayOptions {
  listenPort: number;
  targetHost: string;
  targetPort: number;
  listenHost?: string | undefined;
  onConnection?: ((clientAddr: string) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}

export interface RelayInstance {
  server: net.Server;
  close: () => Promise<void>;
  connectionsCount: () => Promise<number>;
}

export interface MultiRelayInstance {
  relays: Array<{
    mapping: RelayMapping;
    instance: RelayInstance;
  }>;
  close: () => Promise<void>;
}

export function parseRelayMapping(
  mapStr: string,
  defaultTargetHost = "127.0.0.1",
): RelayMapping {
  // Accepted formats:
  // 1) "5432:5433" -> listen 5432, target defaultTargetHost:5433
  // 2) "5432:192.168.50.79:5433" -> listen 5432, target 192.168.50.79:5433
  // 3) "0.0.0.0:5432:192.168.50.79:5433" -> listen 0.0.0.0:5432, target 192.168.50.79:5433
  const parts = mapStr.trim().split(":");
  if (parts.length === 2) {
    const listenPort = Number(parts[0]!.trim());
    const targetPort = Number(parts[1]!.trim());
    if (!Number.isFinite(listenPort) || !Number.isFinite(targetPort)) {
      throw new Error(
        `RELAY_MAP_INVALID: invalid ports in mapping "${mapStr}"`,
      );
    }
    return {
      listenPort,
      targetHost: defaultTargetHost,
      targetPort,
    };
  }
  if (parts.length === 3) {
    const listenPort = Number(parts[0]!.trim());
    const targetHost = parts[1]!.trim();
    const targetPort = Number(parts[2]!.trim());
    if (
      !Number.isFinite(listenPort) ||
      !targetHost ||
      !Number.isFinite(targetPort)
    ) {
      throw new Error(
        `RELAY_MAP_INVALID: invalid mapping "${mapStr}" (expected listen:targetHost:targetPort)`,
      );
    }
    return {
      listenPort,
      targetHost,
      targetPort,
    };
  }
  if (parts.length === 4) {
    const listenHost = parts[0]!.trim();
    const listenPort = Number(parts[1]!.trim());
    const targetHost = parts[2]!.trim();
    const targetPort = Number(parts[3]!.trim());
    if (
      !listenHost ||
      !Number.isFinite(listenPort) ||
      !targetHost ||
      !Number.isFinite(targetPort)
    ) {
      throw new Error(
        `RELAY_MAP_INVALID: invalid mapping "${mapStr}" (expected listenHost:listenPort:targetHost:targetPort)`,
      );
    }
    return {
      listenHost,
      listenPort,
      targetHost,
      targetPort,
    };
  }
  throw new Error(`RELAY_MAP_INVALID: unrecognized mapping format "${mapStr}"`);
}

export function loadRelayConfigFile(filePath: string): RelayMapping[] {
  const resolved = resolvePath(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(
      `RELAY_CONFIG_FILE_NOT_FOUND: file not found at ${resolved}`,
    );
  }
  const raw = readFileSync(resolved, "utf8");
  const cleaned = raw.replace(/\/\/[^\n]*/g, "").replace(/,\s*([\]}])/g, "$1");
  const parsed = JSON.parse(cleaned) as unknown;

  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        "relays" in parsed &&
        Array.isArray((parsed as Record<string, unknown>).relays)
      ? (parsed as { relays: unknown[] }).relays
      : [parsed];

  const mappings: RelayMapping[] = [];
  for (const item of rawList) {
    if (typeof item === "string") {
      mappings.push(parseRelayMapping(item));
    } else if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const listenPort = Number(obj.listen ?? obj.listenPort ?? obj.port);
      let targetHost = String(obj.targetHost ?? obj.host ?? "127.0.0.1");
      let targetPort = Number(obj.targetPort ?? obj.target);
      if (typeof obj.target === "string" && obj.target.includes(":")) {
        const parts = obj.target.split(":");
        targetHost = parts[0]!.trim();
        targetPort = Number(parts[1]!.trim());
      }
      if (!Number.isFinite(listenPort) || !Number.isFinite(targetPort)) {
        throw new Error(
          `RELAY_CONFIG_ITEM_INVALID: invalid listen or target port in ${JSON.stringify(item)}`,
        );
      }
      mappings.push({
        listenPort,
        targetHost,
        targetPort,
        listenHost: obj.listenHost ? String(obj.listenHost) : undefined,
        serve: Boolean(obj.serve),
        funnel: Boolean(obj.funnel),
      });
    }
  }
  return mappings;
}

export function startRelay(options: RelayOptions): Promise<RelayInstance> {
  return new Promise((resolve, reject) => {
    const {
      listenPort,
      targetHost,
      targetPort,
      listenHost = "0.0.0.0",
      onConnection,
      onError,
    } = options;

    const server = net.createServer((clientSocket) => {
      const clientAddr = `${clientSocket.remoteAddress ?? "unknown"}:${clientSocket.remotePort ?? 0}`;
      if (onConnection) {
        onConnection(clientAddr);
      }

      const targetSocket = net.connect({
        host: targetHost,
        port: targetPort,
      });

      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);

      const handleErr = (err: Error) => {
        if (onError) onError(err);
        clientSocket.destroy();
        targetSocket.destroy();
      };

      clientSocket.on("error", handleErr);
      targetSocket.on("error", handleErr);

      clientSocket.on("close", () => {
        targetSocket.destroy();
      });
      targetSocket.on("close", () => {
        clientSocket.destroy();
      });
    });

    server.once("error", (err) => {
      reject(err);
    });

    server.listen(listenPort, listenHost, () => {
      resolve({
        server,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
        connectionsCount: () =>
          new Promise<number>((res, rej) => {
            server.getConnections((err, count) =>
              err ? rej(err) : res(count),
            );
          }),
      });
    });
  });
}

export async function startMultiRelay(
  mappings: RelayMapping[],
  callbacks?: {
    onConnection?: (mapping: RelayMapping, clientAddr: string) => void;
    onError?: (mapping: RelayMapping, error: Error) => void;
  },
): Promise<MultiRelayInstance> {
  const started: Array<{ mapping: RelayMapping; instance: RelayInstance }> = [];
  try {
    for (const m of mappings) {
      const instance = await startRelay({
        listenPort: m.listenPort,
        targetHost: m.targetHost,
        targetPort: m.targetPort,
        listenHost: m.listenHost ?? "0.0.0.0",
        onConnection: (addr) => callbacks?.onConnection?.(m, addr),
        onError: (err) => callbacks?.onError?.(m, err),
      });
      started.push({ mapping: m, instance });
    }
    return {
      relays: started,
      close: async () => {
        await Promise.all(started.map((s) => s.instance.close()));
      },
    };
  } catch (error) {
    // Cleanup any previously started relays if one fails to bind
    await Promise.all(started.map((s) => s.instance.close().catch(() => {})));
    throw error;
  }
}
