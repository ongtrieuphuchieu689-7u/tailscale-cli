#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { apiCredentialHint, ApiError, TailscaleApiClient } from "./api.js";
import { cleanup } from "./cleanup.js";
import {
  credentialEnvName,
  maskSecret,
  resolveAuth,
  resolveConfig,
  resolveCredential,
  runtime,
} from "./core.js";
import { deploy as deployCommand } from "./deploy.js";
import {
  findTailscale,
  tailscaleVersion,
  TailscaleLocal,
} from "./tailscale.js";
import {
  installWindowsMsi,
  latestStableInfo,
  latestWindowsInstallInfo,
  updateCacheBinary,
} from "./binary.js";
import { ensureDaemon, inspectDaemon, daemonStatus, stopUserspaceDaemon } from "./daemon.js";
import { manifest } from "./manifest.js";
import {
  ensureFunnelAccess,
  ensureHttpsEnabled,
  funnelCovered,
  policyFromEnv,
  policySync,
} from "./policy.js";
import type { ResolvedConfig } from "./types.js";
import { confirm } from "./interactive.js";
import type { Envelope } from "./types.js";

function packageVersion(): string {
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const pkg = JSON.parse(
      readFileSync(resolvePath(here, "..", "package.json"), "utf8"),
    ) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // Fall through to a safe default when package.json is not reachable.
  }
  return "0.0.0";
}

const program = new Command();
program
  .name("tailsacle-cli")
  .description("Safe, zero-config Tailscale deployment CLI")
  .version(packageVersion())
  .option("--json", "emit a stable JSON envelope")
  .option(
    "--credential-env <name>",
    "use the Tailscale trust credential found in this env var (overrides auto-detection)",
  )
  .option(
    "--profile <profile>",
    "override the active profile (ci|container|vm|windows|funnel-app|subnet-router|exit-node|dev)",
  )
  .option(
    "--client-secret <secret>",
    "OAuth client secret (overrides TS_CLIENT_SECRET for this run; visible in process listings)",
  )
  .option(
    "--client-id <id>",
    "OAuth client id (overrides TS_CLIENT_ID for this run; visible in process listings)",
  );

program.hook("preAction", () => applyCredentialFlags());

interface CliOptions {
  json?: boolean;
  credentialEnv?: string;
  profile?: string;
  clientSecret?: string;
  clientId?: string;
}

function applyCredentialFlags(): void {
  const opts = program.opts<CliOptions>();
  if ((opts.clientSecret || opts.clientId) && opts.credentialEnv) {
    throw new Error(
      "CREDENTIAL_SELECTION_CONFLICT: choose either --credential-env or --client-secret/--client-id, not both",
    );
  }
  if (opts.clientSecret) {
    process.env.TS_CLIENT_SECRET = opts.clientSecret;
    console.error(
      "CLIENT_SECRET_VIA_FLAG: passing credentials on the command line is visible in process listings; prefer TS_CLIENT_SECRET",
    );
  }
  if (opts.clientId) process.env.TS_CLIENT_ID = opts.clientId;
}

function configEnv(): NodeJS.ProcessEnv {
  const profile = program.opts<CliOptions>().profile;
  if (!profile) return process.env;
  const valid = [
    "ci",
    "container",
    "vm",
    "windows",
    "funnel-app",
    "subnet-router",
    "exit-node",
    "dev",
  ];
  if (!valid.includes(profile))
    throw new Error(`PROFILE_INVALID: expected one of ${valid.join(", ")}`);
  return { ...process.env, TS_PROFILE: profile };
}

function resolvedCredentialEnv(): string | undefined {
  const opts = program.opts<CliOptions>();
  if (opts.credentialEnv) {
    const value = process.env[opts.credentialEnv]?.trim();
    if (!value)
      throw new Error(
        `CREDENTIAL_ENV_MISSING: env ${opts.credentialEnv} is not set`,
      );
    if (!value.startsWith("tskey-client-"))
      throw new Error(
        `CREDENTIAL_FORMAT_UNSUPPORTED: env ${opts.credentialEnv} is not a tskey-client- trust credential`,
      );
    return opts.credentialEnv;
  }
  return credentialEnvName();
}

function envTagOwner(): string[] | undefined {
  const value = process.env.TS_TAG_OWNER?.trim();
  if (!value) return undefined;
  return value
    .split(",")
    .map((owner) => owner.trim())
    .filter(Boolean);
}

function emit<T>(
  command: string,
  resolved: T,
  warnings: string[] = [],
  sideEffects: string[] = [],
  requiredPrivileges: string[] = [],
  start = performance.now(),
): void {
  const envelope: Envelope<T> = {
    ok: true,
    command,
    resolved,
    durationMs: Math.round(performance.now() - start),
    warnings,
    requiredPrivileges,
    sideEffects,
    retryable: false,
  };
  if (program.opts<{ json?: boolean }>().json)
    console.log(JSON.stringify(envelope, null, 2));
  else console.log(JSON.stringify(resolved, null, 2));
}

function fail(
  command: string,
  error: unknown,
  start = performance.now(),
): never {
  const detail =
    error instanceof ApiError
      ? {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          status: error.status,
        }
      : {
          code: "CLI_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
          status: undefined,
        };
  const envelope: Envelope<never> = {
    ok: false,
    command,
    durationMs: Math.round(performance.now() - start),
    warnings: [],
    requiredPrivileges: [],
    sideEffects: [],
    retryable: detail.retryable,
    error: {
      code: detail.code,
      message: detail.message,
      ...(detail.status ? { status: detail.status } : {}),
    },
  };
  if (program.opts<{ json?: boolean }>().json)
    console.error(JSON.stringify(envelope, null, 2));
  else console.error(`${detail.code}: ${detail.message}`);
  process.exitCode = detail.retryable ? 75 : exitCodeFor(error);
  throw error;
}

function exitCodeFor(error: unknown): number {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 4;
    if (error.retryable) return 75;
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH|CREDENTIAL/.test(message)) return 3;
  if (/TAILSCALE_BINARY|BIN_|CHECKSUM/.test(message)) return 5;
  if (/TAILSCALE_NOT_RUNNING|AUTH_KEY/.test(message)) return 6;
  if (/FUNNEL|SERVE|VERIFY|TLS|DNS_PUBLIC/.test(message)) return 7;
  if (/POLICY/.test(message)) return 8;
  if (/PRIVILEGE|PERMISSION_DENIED|root|administrator/i.test(message)) return 9;
  return 1;
}

function credentialFromOptions(): ReturnType<typeof resolveCredential> {
  const opts = program.opts<CliOptions>();
  if (!opts.credentialEnv) return resolveCredential();
  const value = process.env[opts.credentialEnv]?.trim();
  if (!value)
    return {
      found: false,
      candidates: [opts.credentialEnv],
      error: "CREDENTIAL_ENV_MISSING",
    };
  if (!value.startsWith("tskey-client-"))
    return {
      found: false,
      candidates: [opts.credentialEnv],
      error: "CREDENTIAL_FORMAT_UNSUPPORTED",
    };
  return {
    found: true,
    source: opts.credentialEnv,
    masked: maskSecret(value),
    candidates: [],
  };
}

function authFromOptions(): ReturnType<typeof resolveAuth> {
  const opts = program.opts<CliOptions>();
  if (!opts.credentialEnv) return resolveAuth(configEnv());
  const value = process.env[opts.credentialEnv]?.trim();
  if (!value)
    return {
      found: false,
      candidates: [opts.credentialEnv],
      error: "CREDENTIAL_ENV_MISSING",
    };
  if (!value.startsWith("tskey-client-"))
    return {
      found: false,
      candidates: [opts.credentialEnv],
      error: "CREDENTIAL_FORMAT_UNSUPPORTED",
    };
  return {
    found: true,
    auth: {
      kind: "oauth-trust",
      source: opts.credentialEnv,
      masked: maskSecret(value),
    },
    candidates: [],
  };
}

async function probeScope(
  fn: () => Promise<unknown>,
): Promise<"ok" | "missing-scope" | "error"> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status))
      return "missing-scope";
    return "error";
  }
}

async function deepDoctor(
  config: ResolvedConfig,
  options: { credentialEnvName?: string },
): Promise<{
  scopes: Record<string, string>;
  httpsEnabled?: boolean;
  funnelReady?: boolean;
  magicDNS?: boolean;
  daemon: { running: boolean; actions: string[] };
  isRoot: boolean;
}> {
  const api = new TailscaleApiClient(
    config,
    process.env,
    options.credentialEnvName,
  );
  const beacon: Record<string, string> = {};
  if (!api.hasCredentials()) beacon.error = "CREDENTIAL_NOT_FOUND";
  const result: {
    scopes: Record<string, string>;
    httpsEnabled?: boolean;
    funnelReady?: boolean;
    magicDNS?: boolean;
    daemon: { running: boolean; actions: string[] };
    isRoot: boolean;
  } = {
    scopes: beacon,
    daemon: await inspectDaemon(),
    isRoot:
      typeof process.getuid === "function" ? process.getuid() === 0 : false,
  };
  if (!api.hasCredentials()) return result;

  result.scopes.devicesCore = await probeScope(() => api.listDevices());
  result.scopes.policyFile = await probeScope(() => api.getPolicy());
  const dnsScope = await probeScope(async () => {
    const dns = await api.getDns();
    const preferences = dns.preferences as { magicDNS?: boolean } | undefined;
    result.magicDNS = preferences?.magicDNS === true;
  });
  result.scopes.dns = dnsScope;
  result.scopes.all = await probeScope(async () => {
    const settings = await api.getTailnetSettings();
    if (settings.httpsEnabled !== undefined)
      result.httpsEnabled = settings.httpsEnabled;
  });
  if (result.scopes.policyFile === "ok") {
    try {
      const policy = await api.getPolicy();
      result.funnelReady = funnelCovered(policy.json, config.tags);
    } catch {
      // funnelReady stays undefined when the read fails.
    }
  }
  return result;
}

program
  .command("doctor")
  .description(
    "Resolve credentials, runtime, local binary and API capability without remote side effects",
  )
  .option("--detect-credentials")
  .option("--show-resolution")
  .option("--deep", "run read-only API capability probes (no side effects)")
  .action(async (options: { deep?: boolean }) => {
    const start = performance.now();
    try {
      const config = resolveConfig(configEnv());
      const credential = credentialFromOptions();
      const auth = authFromOptions();
      let binary: unknown = { found: false };
      try {
        binary = await tailscaleVersion(undefined, { download: false });
      } catch (error) {
        binary = {
          found: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const warnings = [...config.warnings];
      if (!auth.found)
        warnings.push(
          auth.error === "MULTIPLE_CREDENTIALS"
            ? "CREDENTIAL_AMBIGUOUS: choose a credential explicitly with --credential-env"
            : "CREDENTIAL_NOT_FOUND",
        );
      if (apiCredentialHint() === "missing")
        warnings.push(
          "API_CREDENTIAL_NOT_CONFIGURED: deploy can still use TS_AUTH_KEY",
        );
      let deep: Record<string, unknown> | undefined;
      if (options.deep) {
        const credentialEnv = resolvedCredentialEnv();
        deep = await deepDoctor(config, {
          ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
        });
        const scopes = deep.scopes as Record<string, string>;
        if (deep.httpsEnabled === false)
          warnings.push(
            "HTTPS_DISABLED: tailnet HTTPS is disabled; Funnel/Serve will not work until it is enabled",
          );
        if (deep.funnelReady === false)
          warnings.push(
            "FUNNEL_ATTR_MISSING: the funnel node attribute is not set for the deployment tags; run a funnel flow with --apply-policy",
          );
        if (scopes.devicesCore === "missing-scope")
          warnings.push("API_SCOPE_MISSING: devices:core scope is not granted");
        if (scopes.policyFile === "missing-scope")
          warnings.push(
            "API_SCOPE_MISSING: policy_file scope is not granted (funnel/tag provisioning will fail)",
          );
        if (scopes.dns === "missing-scope")
          warnings.push("API_SCOPE_MISSING: dns scope is not granted");
        if (scopes.all === "missing-scope")
          warnings.push(
            "API_SCOPE_MISSING: all scope is not granted (tailnet HTTPS cannot be enabled)",
          );
      }
      emit(
        "doctor",
        {
          config,
          credential,
          auth,
          apiCredential: apiCredentialHint(),
          binary,
          runtime,
          ...(deep ? { deep } : {}),
        },
        warnings,
        [],
        [],
        start,
      );
    } catch (error) {
      fail("doctor", error, start);
    }
  });

program
  .command("deploy")
  .description("Join the tailnet and optionally configure Serve/Funnel")
  .option("--dry-run")
  .option("--yes")
  .option("--expose <target...>")
  .option("--funnel")
  .option("--apply-policy")
  .option("--enable-https")
  .option("--cleanup")
  .option("--bin <path>")
  .option(
    "--key-expiry <value>",
    "auth-key expiry: max (documented 90-day ceiling), unlimited, or seconds",
  )
  .option(
    "--tag-owner <owner...>",
    "owner(s) for auto-provisioned tagOwners (otherwise derived from a single existing owner set)",
  )
  .action(
    async (options: {
      dryRun?: boolean;
      yes?: boolean;
      expose?: string[];
      funnel?: boolean;
      applyPolicy?: boolean;
      enableHttps?: boolean;
      cleanup?: boolean;
      bin?: string;
      keyExpiry?: string;
      tagOwner?: string[];
    }) => {
      const start = performance.now();
      try {
        if (options.keyExpiry) process.env.TS_KEY_EXPIRY = options.keyExpiry;
        const credentialEnv = resolvedCredentialEnv();
        const tagOwner = options.tagOwner ?? envTagOwner();
        const config = resolveConfig(configEnv());
        const result = await deployCommand(config, {
          dryRun: Boolean(options.dryRun),
          yes: Boolean(options.yes),
          expose: options.expose ?? [],
          funnel: Boolean(options.funnel),
          applyPolicy: Boolean(options.applyPolicy),
          enableHttps: Boolean(options.enableHttps),
          cleanup: Boolean(options.cleanup),
          ...(options.bin ? { bin: options.bin } : {}),
          ...(tagOwner?.length ? { tagOwner } : {}),
          ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
        });
        emit(
          "deploy",
          result,
          [...config.warnings, ...result.warnings],
          options.dryRun
            ? []
            : [
                "authenticate node",
                "configure Tailscale state",
                ...(result.exposures.length ? ["configure Serve/Funnel"] : []),
                ...(result.warnings.length ? ["update tailnet policy"] : []),
              ],
          process.platform === "win32"
            ? []
            : ["root/admin may be required by tailscaled"],
          start,
        );
      } catch (error) {
        fail("deploy", error, start);
      }
    },
  );

program
  .command("up")
  .description("Alias for deploy without exposure configuration")
  .option("--dry-run")
  .option("--yes")
  .option("--apply-policy")
  .option("--cleanup")
  .option(
    "--key-expiry <value>",
    "auth-key expiry: max (documented 90-day ceiling), unlimited, or seconds",
  )
  .option(
    "--tag-owner <owner...>",
    "owner(s) for auto-provisioned tagOwners (otherwise derived from a single existing owner set)",
  )
  .action(
    async (options: {
      dryRun?: boolean;
      yes?: boolean;
      applyPolicy?: boolean;
      cleanup?: boolean;
      keyExpiry?: string;
      tagOwner?: string[];
    }) => {
      const start = performance.now();
      try {
        if (options.keyExpiry) process.env.TS_KEY_EXPIRY = options.keyExpiry;
        const credentialEnv = resolvedCredentialEnv();
        const tagOwner = options.tagOwner ?? envTagOwner();
        const result = await deployCommand(resolveConfig(configEnv()), {
          dryRun: Boolean(options.dryRun),
          yes: Boolean(options.yes),
          expose: [],
          funnel: false,
          applyPolicy: Boolean(options.applyPolicy),
          cleanup: Boolean(options.cleanup),
          ...(tagOwner?.length ? { tagOwner } : {}),
          ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
        });
        emit(
          "up",
          result,
          result.warnings,
          options.dryRun
            ? []
            : [
                "authenticate node",
                "configure Tailscale state",
                ...(result.cleanup && result.cleanup.deleted.length
                  ? ["delete offline devices"]
                  : []),
              ],
          process.platform === "win32"
            ? []
            : ["root/admin may be required by tailscaled"],
          start,
        );
      } catch (error) {
        fail("up", error, start);
      }
    },
  );

program
  .command("status")
  .description("Show local Tailscale status")
  .action(async () => {
    const start = performance.now();
    try {
      emit(
        "status",
        await new TailscaleLocal(await findTailscale()).status(),
        [],
        [],
        [],
        start,
      );
    } catch (error) {
      fail("status", error, start);
    }
  });

program
  .command("update-bin")
  .description(
    "Download the latest stable Tailscale client into the package cache (never overwrites package-managed binaries)",
  )
  .option("--yes")
  .option("--dry-run")
  .option("--force")
  .option("--skip-checksum")
  .option("--track <track>")
  .action(
    async (options: {
      yes?: boolean;
      dryRun?: boolean;
      force?: boolean;
      skipChecksum?: boolean;
      track?: string;
    }) => {
      const start = performance.now();
      try {
        if (options.track && options.track !== "stable")
          throw new Error(
            "BIN_TRACK_UNSUPPORTED: only the stable track is supported",
          );
        if (process.platform === "win32") {
          if (options.dryRun) {
            const info = await latestWindowsInstallInfo();
            emit(
              "update-bin",
              { latest: info.version, msi: info.msi, dryRun: true },
              [
                "WINDOWS_MSI_BOOTSTRAP: the package downloads and silently installs the MSI; an Administrator shell is required",
              ],
              [],
              [],
              start,
            );
            return;
          }
          const result = await installWindowsMsi({
            ...(options.skipChecksum ? { skipChecksum: true } : {}),
          });
          const warnings = [
            ...(options.skipChecksum
              ? [
                  "BIN_CHECKSUM_SKIPPED: --skip-checksum disables the MSI download integrity check",
                ]
              : []),
            "WINDOWS_MSI_INSTALLED: Tailscale MSI installed silently",
          ];
          emit(
            "update-bin",
            {
              installed: true,
              version: result.version,
              msi: result.msi,
              cachedPath: result.cachedPath,
            },
            warnings,
            ["download Tailscale MSI", "install Tailscale MSI silently"],
            ["windows administrator"],
            start,
          );
          return;
        }
        if (options.dryRun) {
          const info = await latestStableInfo();
          emit(
            "update-bin",
            { latest: info.version, dryRun: true },
            [],
            [],
            [],
            start,
          );
          return;
        }
        const result = await updateCacheBinary({
          ...(options.force ? { force: true } : {}),
          ...(options.skipChecksum ? { skipChecksum: true } : {}),
        });
        emit(
          "update-bin",
          result,
          options.skipChecksum
            ? [
                "BIN_CHECKSUM_SKIPPED: --skip-checksum disables the download integrity check",
              ]
            : [],
          ["download Tailscale client into cache", "update cache binary"],
          [],
          start,
        );
      } catch (error) {
        fail("update-bin", error, start);
      }
    },
  );

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function funnelDnsName(
  local: TailscaleLocal,
): Promise<string | undefined> {
  try {
    const statusJson = await local.runJson<{ Name?: string }>([
      "funnel",
      "status",
    ]);
    if (typeof statusJson?.Name === "string")
      return statusJson.Name.replace(/\.$/, "");
  } catch {
    // status unavailable; fall back to local status.
  }
  try {
    const statusJson = await local.runJson<{ Self?: { DNSName?: string } }>([
      "status",
    ]);
    const dns = statusJson?.Self?.DNSName;
    return dns ? dns.replace(/\.$/, "") : undefined;
  } catch {
    return undefined;
  }
}

async function funnelPublicDnsPropagated(
  hostname: string,
  timeoutSeconds: number,
): Promise<{ ok: boolean; attempts: number }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      const json = (await response.json()) as {
        Answer?: { type: number; data: string }[];
      };
      if ((json.Answer ?? []).some((record) => record.type === 1))
        return { ok: true, attempts };
    } catch {
      // DNS-over-HTTPS unavailable; fall back to the system resolver next round.
    }
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { stdout } = await promisify(execFile)(
        "getent",
        ["ahostsv4", hostname],
        { timeout: 5000 },
      );
      if (stdout.trim()) return { ok: true, attempts };
    } catch {
      // no getent or hostname not resolvable yet.
    }
    await sleepMs(10_000);
  }
  return { ok: false, attempts };
}

interface FunnelOptions {
  https?: string;
  tcp?: string;
  path?: string;
  expose?: string[];
  yes?: boolean;
  applyPolicy?: boolean;
  enableHttps?: boolean;
  verifyTimeout?: number;
}

function parseFunnelExpose(value: string): {
  https: number;
  path?: string;
  target: string;
} {
  const eq = value.trim().split("=", 2);
  const localPort = eq[1] ? Number(eq[1].trim()) : undefined;
  const left = eq[0]!.replace(/^[,;]\s*/, "");
  const slash = left.indexOf("/");
  const https = Number(slash >= 0 ? left.slice(0, slash) : left);
  if (!Number.isFinite(https) || ![443, 8443, 10000].includes(https))
    throw new Error(
      "FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000",
    );
  if (!localPort || !Number.isFinite(localPort))
    throw new Error(
      `FUNNEL_EXPOSE_INVALID: ${value} (expected "443=3000" or "443/api=3001")`,
    );
  const path =
    slash >= 0
      ? left.slice(slash).startsWith("/")
        ? left.slice(slash)
        : `/${left.slice(slash)}`
      : undefined;
  return {
    https,
    ...(path ? { path } : {}),
    target: `http://127.0.0.1:${localPort}`,
  };
}

program
  .command("funnel")
  .description(
    "Configure Tailscale Funnel for a target (auto-detects target and verifies public DNS)",
  )
  .argument(
    "[target]",
    "local target such as 3000, localhost:8080 or http://127.0.0.1:3000 (defaults to $PORT)",
  )
  .option("--https <port>", "public HTTPS port (443, 8443 or 10000)")
  .option("--tcp <public:local>", "TCP funnel instead of HTTPS")
  .option("--path <path>")
  .option(
    "--expose <target...>",
    'repeatable expose targets, e.g. "443=3000" or "443/api=3001"',
  )
  .option("--yes")
  .option("--apply-policy")
  .option("--enable-https")
  .option("--verify-timeout <sec>", "DNS propagation timeout")
  .action(async (target: string | undefined, options: FunnelOptions) => {
    const start = performance.now();
    try {
      const config = resolveConfig(configEnv());
      const local = new TailscaleLocal(await findTailscale());
      const credentialEnvNameResolved = resolvedCredentialEnv();
      const httpsPort = options.https ? Number(options.https) : 443;
      if (options.https && ![443, 8443, 10000].includes(httpsPort))
        throw new Error(
          "FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000",
        );

      const warnings: string[] = [];
      if (config.ephemeral)
        throw new Error(
          "FUNNEL_EPHEMERAL: the node is ephemeral so Funnel will never publish public DNS; set TS_EPHEMERAL=false (or use TS_PROFILE=funnel-app which defaults to non-ephemeral) and re-run",
        );
      const daemon = await ensureDaemon();
      if (!daemon.running) warnings.push(...daemon.warnings);
      const exposed = (options.expose ?? [])
        .filter(Boolean)
        .map(parseFunnelExpose);
      let resolvedTarget = target;
      const verifySeconds = options.verifyTimeout
        ? Number(options.verifyTimeout)
        : 120;
      if (options.tcp) {
        const [publicPort, localPort] = options.tcp
          .replace(/\s/g, "")
          .split(":");
        if (!publicPort || !localPort)
          throw new Error(
            "FUNNEL_TCP_INVALID: --tcp expects public:local, e.g. 10000:5432",
          );
        await local.funnel([
          "--bg",
          `--tcp=${publicPort}`,
          `tcp://127.0.0.1:${localPort}`,
        ]);
        const name = await funnelDnsName(local);
        const verify = name
          ? await funnelPublicDnsPropagated(name, verifySeconds)
          : { ok: false as const, attempts: 0 };
        if (!verify.ok)
          throw new Error(
            `FUNNEL_DNS_NOT_PUBLISHED: no public DNS record for ${name ?? "the funnel hostname"} within ${verifySeconds}s (tried ${verify.attempts} times)`,
          );
        emit(
          "funnel",
          {
            target: `tcp://127.0.0.1:${localPort}`,
            localTarget: `tcp://127.0.0.1:${localPort}`,
            public: true,
            tcp: Number(publicPort),
            publicPort: Number(publicPort),
            ...(name
              ? {
                  endpoint: `${name}:${publicPort}`,
                  url: `${name}:${publicPort}`,
                }
              : {}),
            verified: true,
            dnsPropagated: true,
            dnsAttempts: verify.attempts,
          },
          warnings,
          ["configure Funnel (TCP)", "verify public listener & DNS"],
          [],
          start,
        );
        return;
      }
      if (!exposed.length) {
        resolvedTarget =
          target ??
          (process.env.PORT
            ? `http://127.0.0.1:${process.env.PORT}`
            : undefined);
        if (!resolvedTarget)
          throw new Error(
            "FUNNEL_TARGET_REQUIRED: pass a target, --expose, or set $PORT",
          );
        if (!target)
          warnings.push(
            `FUNNEL_TARGET_DEFAULTED: used $PORT=${process.env.PORT} as the local target; override with a positional target or --expose`,
          );
      }

      if (options.yes && options.enableHttps) {
        const https = await ensureHttpsEnabled(config, {
          yes: true,
          ...(credentialEnvNameResolved
            ? { credentialEnvName: credentialEnvNameResolved }
            : {}),
        });
        warnings.push(...https.warnings);
      }
      const runFunnel = async (extra: string[]): Promise<void> => {
        await local.funnel(["--bg", ...extra]);
      };
      try {
        if (exposed.length) {
          for (const exposure of exposed) {
            const cmd: string[] = [`--https=${exposure.https}`];
            if (exposure.path) cmd.push(`--set-path=${exposure.path}`);
            await runFunnel(cmd.concat(exposure.target));
          }
        } else {
          const cmd: string[] = [`--https=${httpsPort}`];
          if (options.path)
            cmd.push(
              `--set-path=${options.path.startsWith("/") ? options.path : `/${options.path}`}`,
            );
          await runFunnel(cmd.concat(resolvedTarget as string));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/funnel.*(not available|node attribute not set)/i.test(message) ||
          !options.yes
        )
          throw error;
        if (!options.applyPolicy)
          throw new Error(
            "FUNNEL_ATTR_REQUIRED: the funnel node attribute is missing; re-run with --apply-policy to auto-add it on the tailnet",
          );
        warnings.push(
          "SIDE_EFFECT_PLAN: adding the funnel node attribute for the deployment tags before retrying",
        );
        const provisioned = await ensureFunnelAccess(config, config.tags, {
          yes: true,
          ...(credentialEnvNameResolved
            ? { credentialEnvName: credentialEnvNameResolved }
            : {}),
        });
        warnings.push(...provisioned.warnings);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            if (exposed.length) {
              for (const exposure of exposed) {
                const cmd: string[] = [`--https=${exposure.https}`];
                if (exposure.path) cmd.push(`--set-path=${exposure.path}`);
                await runFunnel(cmd.concat(exposure.target));
              }
            } else {
              const cmd: string[] = [`--https=${httpsPort}`];
              if (options.path)
                cmd.push(
                  `--set-path=${options.path.startsWith("/") ? options.path : `/${options.path}`}`,
                );
              await runFunnel(cmd.concat(resolvedTarget as string));
            }
            break;
          } catch (retryError) {
            if (attempt === 3) throw retryError;
            await sleepMs(3000);
          }
        }
      }

      const name = await funnelDnsName(local);
      const verify = name
        ? await funnelPublicDnsPropagated(name, verifySeconds)
        : { ok: false as const, attempts: 0 };
      if (!verify.ok)
        throw new Error(
          `FUNNEL_DNS_NOT_PUBLISHED: no public DNS record for ${name ?? "the funnel hostname"} within ${verifySeconds}s (tried ${verify.attempts} times)`,
        );
      const baseUrl = name ? `https://${name}` : undefined;
      const pathFor = (value: string | undefined): string => value ?? "/";
      const exposures = exposed.length
        ? exposed.map((exposure) => ({
            publicPort: exposure.https,
            path: pathFor(exposure.path),
            localTarget: exposure.target,
            ...(baseUrl ? { url: `${baseUrl}${pathFor(exposure.path)}` } : {}),
          }))
        : [
            {
              publicPort: httpsPort,
              path: pathFor(options.path),
              localTarget: resolvedTarget as string,
              ...(baseUrl ? { url: `${baseUrl}${pathFor(options.path)}` } : {}),
            },
          ];
      emit(
        "funnel",
        {
          target: exposed.length ? exposed[0]!.target : resolvedTarget,
          public: true,
          ...(exposed.length === 0
            ? {
                https: httpsPort,
                path: pathFor(options.path),
                ...(baseUrl ? { url: exposures[0]!.url } : {}),
              }
            : {}),
          exposures,
          dnsPropagated: true,
          dnsAttempts: verify.attempts,
        },
        warnings,
        [
          "configure Funnel",
          ...(warnings.some((w) => w.startsWith("PROVISIONED"))
            ? ["update tailnet policy", "enable HTTPS"]
            : []),
        ],
        [],
        start,
      );
    } catch (error) {
      fail("funnel", error, start);
    }
  });

program
  .command("serve")
  .description("Configure Tailscale Serve for a target")
  .argument("<target>")
  .option("--https <port>")
  .option("--http <port>")
  .option("--tcp <port>")
  .option("--path <path>")
  .action(
    async (
      target: string,
      options: { https?: string; http?: string; tcp?: string; path?: string },
    ) => {
      const start = performance.now();
      try {
        const local = new TailscaleLocal(await findTailscale());
        const args = ["--bg"];
        if (options.https) args.push(`--https=${Number(options.https)}`);
        else if (options.http) args.push(`--http=${Number(options.http)}`);
        else if (options.tcp) args.push(`--tcp=${Number(options.tcp)}`);
        if (options.path)
          args.push(
            `--set-path=${options.path.startsWith("/") ? options.path : `/${options.path}`}`,
          );
        await local.serve([...args, target]);
        emit(
          "serve",
          { target, public: false, path: options.path ?? "/" },
          [],
          ["configure Serve"],
          [],
          start,
        );
      } catch (error) {
        fail("serve", error, start);
      }
    },
  );

program
  .command("dns")
  .description("Read tailnet DNS settings; optionally enable MagicDNS")
  .option("--enable-magicdns")
  .option("--yes")
  .action(async (options: { enableMagicdns?: boolean; yes?: boolean }) => {
    const start = performance.now();
    try {
      const api = new TailscaleApiClient(
        resolveConfig(configEnv()),
        process.env,
        resolvedCredentialEnv(),
      );
      if (options.enableMagicdns) {
        const approved = await confirm(
          "Enable MagicDNS on the tailnet?",
          Boolean(options.yes),
        );
        if (!approved)
          throw new Error(
            "DNS_MAGICDNS_CONFIRMATION_REQUIRED: pass --yes to enable MagicDNS",
          );
        await api.enableMagicDns();
        emit(
          "dns",
          { magicDNSEnabled: true },
          [],
          ["enable MagicDNS"],
          [],
          start,
        );
        return;
      }
      emit("dns", await api.getDns(), [], [], [], start);
    } catch (error) {
      fail("dns", error, start);
    }
  });

program
  .command("policy")
  .description("Diff, validate and guarded-sync a HuJSON policy file")
  .option("--file <path>")
  .option("--sync")
  .option("--dry-run")
  .option("--yes")
  .action(
    async (options: {
      file?: string;
      sync?: boolean;
      dryRun?: boolean;
      yes?: boolean;
    }) => {
      const start = performance.now();
      try {
        const file = options.file ?? policyFromEnv();
        if (!file)
          throw new Error(
            "POLICY_FILE_REQUIRED: pass --file or TS_POLICY_FILE",
          );
        const credentialEnv = resolvedCredentialEnv();
        const result = await policySync(resolveConfig(configEnv()), file, {
          dryRun: Boolean(options.dryRun ?? !options.sync),
          yes: Boolean(options.yes),
          ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
        });
        emit(
          "policy",
          result,
          [],
          result.written ? ["policy write", "policy backup"] : [],
          [],
          start,
        );
      } catch (error) {
        fail("policy", error, start);
      }
    },
  );

program
  .command("cleanup")
  .description("Find and safely remove matching offline devices")
  .option("--dry-run")
  .option("--yes")
  .action(async (options: { dryRun?: boolean; yes?: boolean }) => {
    const start = performance.now();
    try {
      const credentialEnv = resolvedCredentialEnv();
      const result = await cleanup(resolveConfig(configEnv()), {
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes),
        ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
      });
      emit(
        "cleanup",
        result,
        result.candidates.length ? ["destructive: exact candidates only"] : [],
        result.deleted.map((id) => `delete device ${id}`),
        [],
        start,
      );
    } catch (error) {
      fail("cleanup", error, start);
    }
  });

program
  .command("agent-manifest")
  .description("Print the machine-readable agent contract")
  .action(async () => {
    const start = performance.now();
    const opts = program.opts<{ json?: boolean }>();
    if (opts.json) emit("agent-manifest", manifest, [], [], [], start);
    else console.log(JSON.stringify(manifest, null, 2));
  });

program
  .command("daemon")
  .description("Inspect or stop the local tailscaled daemon")
  .argument(
    "<action>",
    "status (report the daemon and any userspace instance this tool started) or stop (stop only a userspace tailscaled tracked in the daemon pidfile)",
  )
  .action(async (action: string) => {
    const start = performance.now();
    try {
      if (action === "stop") {
        const result = await stopUserspaceDaemon();
        emit(
          "daemon",
          { action, ...result },
          result.stopped ? [] : [result.message],
          result.stopped ? ["stop tracked userspace tailscaled"] : [],
          [],
          start,
        );
        return;
      }
      if (action !== "status")
        throw new Error(
          `DAEMON_ACTION_INVALID: expected "status" or "stop", got "${action}"`,
        );
      const status = await daemonStatus();
      emit(
        "daemon",
        {
          action,
          running: status.running,
          tracked: status.tracked,
          trackedAlive: status.trackedAlive,
        },
        status.warnings,
        status.actions,
        [],
        start,
      );
    } catch (error) {
      fail("daemon", error, start);
    }
  });

const rawArgs = process.argv.slice(2);

void (async () => {
  if (rawArgs.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
    const { interactiveMenu } = await import("./menu.js");
    const argv = await interactiveMenu();
    if (!argv.length) return;
    console.log(
      `\n# Equivalent non-interactive command:\n$ tailsacle-cli ${argv.join(" ")}\n`,
    );
    const { spawn } = await import("node:child_process");
    const invoked = process.argv[1] ?? "";
    const child = spawn(process.execPath, [invoked, ...argv], {
      stdio: "inherit",
      env: process.env,
    });
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code && code !== 0 && !process.exitCode) process.exitCode = code;
        resolve();
      });
    });
    return;
  }
  await program.parseAsync(process.argv).catch(() => {
    if (!process.exitCode) process.exitCode = 1;
  });
})();
