import net from "node:net";

export interface RelayOptions {
  listenPort: number;
  targetHost: string;
  targetPort: number;
  listenHost?: string;
  onConnection?: (clientAddr: string) => void;
  onError?: (error: Error) => void;
}

export interface RelayInstance {
  server: net.Server;
  close: () => Promise<void>;
  connectionsCount: () => Promise<number>;
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
