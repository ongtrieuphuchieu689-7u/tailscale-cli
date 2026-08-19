#!/usr/bin/env node
// scripts/ci/service-test-echo-server.mjs
// Start a TCP echo server and keep it running in the background.
// Usage: node scripts/ci/service-test-echo-server.mjs [--port 19999]
// The process stays alive until killed (run with & on bash, Start-Process on pwsh).

import { createServer } from "node:net";

const port = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? Number(process.argv[i + 1]) : 19999;
})();

const server = createServer((sock) => sock.pipe(sock));
server.listen(port, "127.0.0.1", () => {
  console.log(`[echo-server] listening on 127.0.0.1:${port}`);
});
server.on("error", (err) => {
  console.error(`[echo-server] error: ${err.message}`);
  process.exit(1);
});
