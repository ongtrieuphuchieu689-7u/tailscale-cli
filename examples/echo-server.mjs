#!/usr/bin/env node
// Echo HTTP server — returns a JSON description of every request it receives
// (method, path, query, headers, body, client address). No dependencies.
//
// Usage: node echo-server.mjs --port 8080

import { createServer } from "node:http";

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(argValue("port", process.env.PORT ?? "8080"));

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const payload = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      httpVersion: req.httpVersion,
      headers: req.headers,
      body: body.length ? body : null,
      remoteAddress: req.socket.remoteAddress,
      receivedAt: new Date().toISOString(),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(`${JSON.stringify(payload, null, 2)}\n`);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`echo server listening on http://127.0.0.1:${port}`);
});
