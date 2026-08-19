#!/usr/bin/env node
// scripts/ci/service-test-verify-relay.mjs
// Verify a TCP relay is forwarding traffic correctly by sending a probe
// message and checking the echo response.
//
// Usage:
//   node scripts/ci/service-test-verify-relay.mjs \
//     --port <relay-listen-port> \
//     [--timeout 5000]

import { connect } from "node:net";

const portIdx = process.argv.indexOf("--port");
if (portIdx === -1) {
  console.error("[verify-relay] missing required argument: --port");
  process.exit(1);
}
const port = Number(process.argv[portIdx + 1]);

const timeoutIdx = process.argv.indexOf("--timeout");
const timeoutMs = timeoutIdx !== -1 ? Number(process.argv[timeoutIdx + 1]) : 5000;

const PROBE = "HELLO_FROM_SERVICE_TEST\n";

const client = connect(port, "127.0.0.1", () => {
  console.log(`[verify-relay] connected to 127.0.0.1:${port}, sending probe...`);
  client.write(PROBE);
});

client.on("data", (data) => {
  const msg = data.toString();
  console.log("[verify-relay] received:", msg.trim());
  if (msg.includes(PROBE.trim())) {
    console.log("[verify-relay] VERIFICATION_SUCCESSFUL");
    client.destroy();
    process.exit(0);
  }
});

client.on("error", (err) => {
  console.error(`[verify-relay] connection error: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.error(`[verify-relay] timeout after ${timeoutMs}ms — relay did not echo probe`);
  process.exit(1);
}, timeoutMs);
