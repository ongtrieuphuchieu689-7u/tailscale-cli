import os from "node:os";
import type { CredentialResolution, Profile, ResolvedConfig } from "./types.js";

const namedCredentialEnv = [
  "TS_TRUST_CREDENTIAL",
  "TS_API_TRUST",
  "TAILSCALE_TRUST_CREDENTIAL",
  "TAILSCALE_API_TRUST",
] as const;

export function maskSecret(value: string): string {
  return value.length < 10 ? "***" : `${value.slice(0, 5)}…${value.slice(-3)}`;
}

export function credentialEnvName(
  env: NodeJS.ProcessEnv = process.env,
  preferredName?: string,
): string | undefined {
  if (preferredName) {
    const value = env[preferredName]?.trim();
    return value?.startsWith("tskey-client-") ? preferredName : undefined;
  }
  const resolved = resolveCredential(env);
  return resolved.found ? resolved.source : undefined;
}

export function resolveCredential(
  env: NodeJS.ProcessEnv = process.env,
): CredentialResolution {
  const exactTrustMatches = Object.entries(env).filter(([, value]) =>
    value?.startsWith("tskey-client-"),
  );
  const explicit = env.TS_CLIENT_SECRET?.trim();
  const named = namedCredentialEnv.find((name) => Boolean(env[name]?.trim()));
  const selected = explicit
    ? (["TS_CLIENT_SECRET", explicit] as const)
    : named
      ? ([named, env[named]!.trim()] as const)
      : exactTrustMatches.length === 1
        ? ([exactTrustMatches[0]![0], exactTrustMatches[0]![1]!] as const)
        : undefined;

  const candidates = exactTrustMatches.map(([name]) => name);
  if (exactTrustMatches.length > 1 && !explicit && !named) {
    return { found: false, candidates, error: "MULTIPLE_CREDENTIALS" };
  }
  if (!selected) {
    return { found: false, candidates, error: "CREDENTIAL_NOT_FOUND" };
  }
  return {
    found: true,
    source: selected[0],
    masked: maskSecret(selected[1]),
    candidates: explicit
      ? candidates.filter((name) => name !== "TS_CLIENT_SECRET")
      : candidates,
  };
}

function bool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function number(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "tailscale-node"
  );
}

function profileFromEnvironment(env: NodeJS.ProcessEnv): Profile {
  const configured = env.TS_PROFILE as Profile | undefined;
  if (configured) return configured;
  if (env.CI || env.GITHUB_ACTIONS) return "ci";
  if (env.KUBERNETES_SERVICE_HOST || env.CONTAINER) return "container";
  if (process.platform === "win32") return "windows";
  return "dev";
}

export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const profile = profileFromEnvironment(env);
  const ephemeral = bool(
    env.TS_EPHEMERAL,
    profile === "ci" || profile === "container",
  );
  const tags = (env.TS_TAGS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const warnings: string[] = [];
  if (!tags.length && ["container", "ci", "vm", "funnel-app"].includes(profile))
    warnings.push(
      "NO_TAGS_CONFIGURED: reusable infrastructure should normally use a tag",
    );
  if (env.TS_TAILNET === undefined)
    warnings.push('TAILNET_DEFAULTED: using tailnet "-"');
  if (
    env.TS_TAILNET !== undefined &&
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.ts\.net$/.test(env.TS_TAILNET)
  )
    warnings.push(
      `TAILNET_DOMAIN_UNUSUAL: "${env.TS_TAILNET}" is not a default *.ts.net tailnet; Funnel DNS and HTTPS rely on a Tailscale-hosted domain`,
    );

  let hostname = slug(env.TS_HOSTNAME || os.hostname());
  if (!env.TS_HOSTNAME && profile === "ci") {
    const runId =
      env.GITHUB_RUN_ID || env.CI_BUILD_ID || env.CIRCLE_WORKFLOW_ID || "";
    if (runId) hostname = `${slug(os.hostname())}-${runId}`.slice(0, 63);
  }

  const reusable = bool(
    env.TS_REUSABLE,
    !ephemeral &&
      (profile === "vm" || profile === "windows" || profile === "funnel-app"),
  );
  if (env.TS_REUSABLE === undefined && reusable)
    warnings.push(
      "REUSABLE_KEY_DEFAULTED: auth key created for this long-lived node is reusable until it expires",
    );

  return {
    profile,
    tailnet: env.TS_TAILNET?.trim() || "-",
    hostname,
    tags,
    ssh: bool(env.TS_SSH, true),
    keyExpiry: env.TS_KEY_EXPIRY?.trim() || "max",
    preauthorized: bool(env.TS_PREAUTHORIZED, true),
    reusable,
    ephemeral,
    acceptDns: bool(env.TS_ACCEPT_DNS, true),
    acceptRoutes: bool(
      env.TS_ACCEPT_ROUTES,
      profile === "subnet-router" || profile === "exit-node",
    ),
    cleanupAfter: number(env.TS_CLEANUP_OFFLINE_AFTER, 3600),
    source: {
      profile: env.TS_PROFILE ? "TS_PROFILE" : "runtime",
      hostname: env.TS_HOSTNAME
        ? "TS_HOSTNAME"
        : profile === "ci"
          ? "os.hostname+run"
          : "os.hostname",
      tags: env.TS_TAGS ? "TS_TAGS" : "default",
      keyExpiry: env.TS_KEY_EXPIRY ? "TS_KEY_EXPIRY" : "default",
    },
    warnings,
  };
}

export const runtime = Object.freeze({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cwd: process.cwd(),
});
