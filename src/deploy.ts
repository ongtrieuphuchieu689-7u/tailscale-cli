import type {
  Device,
  DeploymentResult,
  Exposure,
  ResolvedConfig,
} from "./types.js";
import { ApiError, TailscaleApiClient } from "./api.js";
import type { CreatedAuthKey } from "./api.js";
import { tailscaleVersion, TailscaleLocal } from "./tailscale.js";
import { cleanup as runCleanup } from "./cleanup.js";
import { ensureDeployTags, ensureHttpsEnabled } from "./policy.js";
import { ensureDaemon } from "./daemon.js";

const MAX_AUTH_KEY_SECONDS = 90 * 24 * 60 * 60;
const MAX_AUTH_KEY_WARNING =
  "KEY_EXPIRY_MAX: using the documented Tailscale auth-key limit of 90 days; this is the auth-key expiry used to join, not the node key-expiry policy";

export function resolveKeyExpiry(configured: string): number {
  const raw = (configured ?? "").trim().toLowerCase();
  if (raw === "" || raw === "max" || raw === "unlimited")
    return MAX_AUTH_KEY_SECONDS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(
      'KEY_EXPIRY_INVALID: TS_KEY_EXPIRY must be "max" or a positive number of seconds',
    );
  return seconds;
}

function truthy(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ["1", "true", "yes", "on"].includes(value.toLowerCase())
  );
}

function normalizeTag(tag: string): string {
  return tag.startsWith("tag:") ? tag : `tag:${tag}`;
}

export function parseExposure(value: string): Exposure {
  const [first, rawPath] = value.trim().split("#", 2);
  const rawTarget = first ?? "";
  const path = rawPath
    ? rawPath.startsWith("/")
      ? rawPath
      : `/${rawPath}`
    : undefined;
  const normalized = rawTarget.trim();
  let target: string;

  if (/^\d+$/.test(normalized)) target = `http://127.0.0.1:${normalized}`;
  else if (/^(?:https?|tcp|https\+insecure):\/\//.test(normalized))
    target = normalized;
  else if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(normalized))
    target = `http://${normalized}`;
  else throw new Error(`EXPOSE_INVALID_TARGET: ${normalized}`);

  const portMatch = target.match(/:(\d+)(?:\/|$)/);
  return {
    target,
    public: false,
    ...(path ? { path } : {}),
    ...(portMatch ? { https: Number(portMatch[1]) } : {}),
  };
}

export function resolveExposures(
  values: string[],
  publicFunnel: boolean,
): Exposure[] {
  return values
    .filter(Boolean)
    .map((value) => ({ ...parseExposure(value), public: publicFunnel }));
}

function buildUpArgs(config: ResolvedConfig): string[] {
  const args = [
    `--hostname=${config.hostname}`,
    `--accept-dns=${config.acceptDns}`,
    `--accept-routes=${config.acceptRoutes}`,
    config.ssh ? "--ssh" : "--ssh=false",
  ];
  if (config.profile === "exit-node") args.push("--advertise-exit-node");
  if (config.profile === "subnet-router" && process.env.TS_ADVERTISE_ROUTES)
    args.push(`--advertise-routes=${process.env.TS_ADVERTISE_ROUTES}`);
  if (config.profile === "funnel-app") args.push("--advertise-connector");
  if (process.platform === "win32" && truthy(process.env.TS_UNATTENDED))
    args.push("--unattended");
  return args;
}

function deviceFromStatus(status: unknown): Device | Record<string, unknown> {
  if (!status || typeof status !== "object") return { status };
  const data = status as Record<string, unknown>;
  const self = data.Self;
  if (!self || typeof self !== "object") return data;
  const item = self as Record<string, unknown>;
  const device: Device = { id: String(item.ID ?? ""), online: true };
  if (typeof item.DNSName === "string") {
    device.name = item.DNSName;
    device.dnsName = item.DNSName;
  }
  if (typeof item.HostName === "string") device.hostname = item.HostName;
  if (typeof item.OS === "string") device.os = item.OS;
  return device;
}

function redactEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.TS_API_KEY;
  delete copy.TS_ACCESS_TOKEN;
  delete copy.TS_CLIENT_SECRET;
  delete copy.TS_OAUTH_CLIENT_SECRET;
  delete copy.TS_AUTH_KEY;
  return copy;
}

function isTagProvisionError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("tags") &&
    (message.includes("invalid") ||
      message.includes("not permitted") ||
      message.includes("must have tags"))
  );
}

function resolveTags(config: ResolvedConfig): {
  tags: string[];
  autoTagged: boolean;
} {
  if (config.tags.length) return { tags: config.tags, autoTagged: false };
  if (config.profile === "dev") return { tags: [], autoTagged: false };
  const repo =
    process.env.GITHUB_REPOSITORY ||
    process.env.GITLAB_PROJECT_PATH ||
    process.env.CI_PROJECT_PATH;
  const base =
    process.env.TS_TAG_BASE?.trim() ||
    (repo
      ? repo
          .replace(/\//g, "-")
          .replace(/[^a-z0-9-]+/gi, "-")
          .toLowerCase()
      : config.profile === "ci"
        ? "tailsacle-cli"
        : config.hostname);
  const tag = `tag:${base.replace(/^-+|-+$/g, "") || "tailsacle-cli"}`;
  return { tags: [tag], autoTagged: true };
}

export async function deploy(
  config: ResolvedConfig,
  options: {
    dryRun: boolean;
    yes: boolean;
    expose: string[];
    funnel: boolean;
    applyPolicy?: boolean;
    enableHttps?: boolean;
    cleanup?: boolean;
    bin?: string;
    credentialEnvName?: string;
  },
): Promise<DeploymentResult> {
  const warnings: string[] = [];
  const binary = await tailscaleVersion(options.bin);
  const daemon = await ensureDaemon();
  if (!daemon.running) warnings.push(...daemon.warnings);
  else if (daemon.actions.length)
    warnings.push(`DAEMON_STARTED: ${daemon.actions.join("; ")}`);
  const exposures = resolveExposures(options.expose, options.funnel);
  const expirySeconds = resolveKeyExpiry(config.keyExpiry);
  if (config.source.keyExpiry === "default")
    warnings.push(MAX_AUTH_KEY_WARNING);
  const { tags: deploymentTags, autoTagged } = resolveTags(config);
  if (autoTagged)
    warnings.push(
      `AUTO_TAG: no TS_TAGS configured; using deterministic tag ${deploymentTags[0]} (override with TS_TAGS)`,
    );
  const tags = deploymentTags.map(normalizeTag);
  if (options.dryRun) {
    return {
      binary,
      device: { dryRun: true, config },
      authKeySource: process.env.TS_AUTH_KEY ? "provided" : "created",
      exposures,
      warnings,
      source: config.source,
    };
  }

  const local = new TailscaleLocal(binary.path);
  let authKey = process.env.TS_AUTH_KEY?.trim();
  let authKeySource: "provided" | "created" = "provided";

  if (authKey && !authKey.startsWith("tskey-auth-"))
    throw new Error(
      "AUTH_KEY_FORMAT_INVALID: TS_AUTH_KEY must start with tskey-auth-",
    );

  if (!authKey) {
    const api = new TailscaleApiClient(
      config,
      process.env,
      options.credentialEnvName,
    );
    if (!api.hasCredentials())
      throw new Error(
        "AUTH_KEY_NOT_CONFIGURED: set TS_AUTH_KEY or configure TS_API_KEY/TS_ACCESS_TOKEN/OAuth client credentials",
      );
    const createKey = (): Promise<CreatedAuthKey> =>
      api.createAuthKey({
        reusable: config.reusable,
        ephemeral: config.ephemeral,
        preauthorized: config.preauthorized,
        tags,
        expirySeconds,
      });
    try {
      const created = await createKey();
      authKey = created.key;
      authKeySource = "created";
    } catch (error) {
      if (!isTagProvisionError(error) || !options.yes || !options.applyPolicy)
        throw error;
      warnings.push(
        "SIDE_EFFECT_PLAN: auto-provisioning tagOwners for the requested tags before retrying the auth-key request",
      );
      try {
        const provisioned = await ensureDeployTags(config, tags, {
          yes: true,
          ...(options.credentialEnvName
            ? { credentialEnvName: options.credentialEnvName }
            : {}),
        });
        warnings.push(...provisioned.warnings);
      } catch {
        throw error;
      }
      const created = await createKey();
      authKey = created.key;
      authKeySource = "created";
    }
  }

  const args = buildUpArgs(config);
  if (authKeySource === "provided" && tags.length)
    args.push(`--advertise-tags=${tags.join(",")}`);
  args.push(`--auth-key=${authKey}`);
  await local.up(args, redactEnv(process.env));

  const status = await local.status<Record<string, unknown>>();
  const state =
    typeof status.BackendState === "string" ? status.BackendState : undefined;
  if (state !== "Running")
    throw new Error(
      `TAILSCALE_NOT_RUNNING: BackendState=${state ?? "unknown"}`,
    );

  if (exposures.length && options.yes && options.enableHttps) {
    const https = await ensureHttpsEnabled(config, {
      yes: true,
      ...(options.credentialEnvName
        ? { credentialEnvName: options.credentialEnvName }
        : {}),
    });
    warnings.push(...https.warnings);
  }

  for (const exposure of exposures) {
    const cmdArgs = ["--bg"];
    if (exposure.path) cmdArgs.push(`--set-path=${exposure.path}`);
    if (exposure.https) {
      if (exposure.public && ![443, 8443, 10000].includes(exposure.https))
        throw new Error(
          "FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000",
        );
      cmdArgs.push(`--https=${exposure.https}`);
    }
    if (exposure.public) await local.funnel([...cmdArgs, exposure.target]);
    else await local.serve([...cmdArgs, exposure.target]);
  }

  const device = deviceFromStatus(
    await local.status<Record<string, unknown>>(),
  );

  const cleanupResult = await (async (): Promise<
    DeploymentResult["cleanup"]
  > => {
    if (!options.cleanup || options.dryRun) return undefined;
    if (
      process.env.TS_NO_CLEANUP === "true" ||
      process.env.TS_NO_CLEANUP === "1"
    )
      return undefined;
    if (config.profile !== "ci" && config.profile !== "container")
      return undefined;
    try {
      const result = await runCleanup(config, {
        dryRun: false,
        yes: true,
        ...(options.credentialEnvName
          ? { credentialEnvName: options.credentialEnvName }
          : {}),
      });
      return {
        candidates: result.candidates.map((d) => d.id),
        deleted: result.deleted,
      };
    } catch {
      warnings.push(
        "CLEANUP_SKIPPED: no device cleanup permission; deploy succeeded without pruning offline devices",
      );
      return { candidates: [], deleted: [], skipped: true };
    }
  })();

  return {
    binary,
    device,
    authKeySource,
    exposures,
    warnings,
    source: config.source,
    ...(cleanupResult ? { cleanup: cleanupResult } : {}),
  };
}
