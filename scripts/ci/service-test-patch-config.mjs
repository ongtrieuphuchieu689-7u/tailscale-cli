#!/usr/bin/env node
// scripts/ci/service-test-patch-config.mjs
// Strip JSONC comments from a service config and patch args/fields.
//
// Usage:
//   node scripts/ci/service-test-patch-config.mjs \
//     --in  <path/to/service.jsonc> \
//     --out <path/to/service.json> \
//     --listen <port> \
//     --target <host:port>
//
// Produces a plain JSON file suitable for `tailsacle-cli service install --file`.

import { readFileSync, writeFileSync } from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) {
    console.error(`[patch-config] missing required argument: ${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

const inFile = arg("--in");
const outFile = arg("--out");
const listenPort = arg("--listen");
const target = arg("--target");

const raw = readFileSync(inFile, "utf8")
  // strip single-line comments
  .replace(/\/\/.*$/gm, "")
  // strip block comments
  .replace(/\/\*[\s\S]*?\*\//gm, "");

const cfg = JSON.parse(raw);
cfg.args = ["relay", "--listen", listenPort, "--target", target];

writeFileSync(outFile, JSON.stringify(cfg, null, 2));
console.log(`[patch-config] wrote ${outFile}`);
console.log(`[patch-config] args: ${cfg.args.join(" ")}`);
