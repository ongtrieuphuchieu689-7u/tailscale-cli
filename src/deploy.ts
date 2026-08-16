import type { Device, DeploymentResult, Exposure, ResolvedConfig } from './types.js';
import { TailscaleApiClient } from './api.js';
import { findTailscale, tailscaleVersion, TailscaleLocal } from './tailscale.js';

const MAX_AUTH_KEY_SECONDS = 90 * 24 * 60 * 60;

function truthy(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeTag(tag: string): string {
  return tag.startsWith('tag:') ? tag : `tag:${tag}`;
}

export function parseExposure(value: string): Exposure {
  const [left, rawPath] = value.split('#', 2);
  const path = rawPath ? (rawPath.startsWith('/') ? rawPath : `/${rawPath}`) : undefined;
  const normalized = left.trim();
  const target = normalized.includes('://') ? normalized : `http://127.0.0.1:${normalized}`;
  if (target.includes('://') && !/^https?:\/\/|^tcp:\/\/|^https\+insecure:\/\//.test(target)) {
    throw new Error(`EXPOSE_INVALID_TARGET: ${normalized}`);
  }
  const portMatch = normalized.match(/:(\d+)(?:\/|$)/) ?? normalized.match(/^(\d+)$/);
  const https = portMatch ? Number(portMatch[1]) : undefined;
  return { target, public: false, path, https };
}

export function resolveExposures(values: string[], publicFunnel: boolean): Exposure[] {
  return values.filter(Boolean).map((value) => ({ ...parseExposure(value), public: publicFunnel }));
}

function buildUpArgs(config: ResolvedConfig): string[] {
  const args = [
    `--hostname=${config.hostname}`,
    `--accept-dns=${config.acceptDns}`,
    `--accept-routes=${config.acceptRoutes}`,
    config.ssh ? '--ssh' : '--ssh=false',
  ];

  if (config.profile === 'exit-node') args.push('--advertise-exit-node');
  if (config.profile === 'subnet-router' && process.env.TS_ADVERTISE_ROUTES) args.push(`--advertise-routes=${process.env.TS_ADVERTISE_ROUTES}`);
  if (config.profile === 'funnel-app') args.push('--advertise-connector');
  if (process.platform === 'win32' && truthy(process.env.TS_UNATTENDED)) args.push('--unattended');
  return args;
}

function deviceFromStatus(status: unknown): Device | Record<string, unknown> {
  if (!status || typeof status !== 'object') return { status };
  const data = status as Record<string, unknown>;
  const self = data.Self;
  if (self && typeof self === 'object') {
    const item = self as Record<string, unknown>;
    return {
      id: String(item.ID ?? ''),
      name: typeof item.DNSName === 'string' ? item.DNSName : undefined,
      dnsName: typeof item.DNSName === 'string' ? item.DNSName : undefined,
      hostname: typeof item.HostName === 'string' ? item.HostName : undefined,
      os: typeof item.OS === 'string' ? item.OS : undefined,
      online: true,
    } satisfies Device;
  }
  return data;
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

export async function deploy(config: ResolvedConfig, options: { dryRun: boolean; yes: boolean; expose: string[]; funnel: boolean; bin?: string }): Promise<DeploymentResult> {
  const binary = await tailscaleVersion(options.bin);
  const exposures = resolveExposures(options.expose, options.funnel);
  if (options.dryRun) {
    return { binary, device: { dryRun: true, config }, authKeySource: process.env.TS_AUTH_KEY ? 'provided' : 'created', exposures };
  }

  const local = new TailscaleLocal(binary.path);
  let authKey = process.env.TS_AUTH_KEY;
  let authKeySource: 'provided' | 'created' = 'provided';

  if (!authKey) {
    const api = new TailscaleApiClient(config);
    if (!api.hasCredentials()) throw new Error('AUTH_KEY_NOT_CONFIGURED: set TS_AUTH_KEY or configure TS_API_KEY/TS_ACCESS_TOKEN/OAuth client credentials');
    const tags = config.tags.map(normalizeTag);
    const created = await api.createAuthKey({
      reusable: config.reusable,
      ephemeral: config.ephemeral,
      preauthorized: config.preauthorized,
      tags,
      expirySeconds: MAX_AUTH_KEY_SECONDS,
    });
    authKey = created.key;
    authKeySource = 'created';
  }

  const args = buildUpArgs(config);
  if (authKeySource === 'provided' && config.tags.length) args.push(`--advertise-tags=${config.tags.map(normalizeTag).join(',')}`);
  args.push(`--auth-key=${authKey}`);
  await local.up(args, redactEnv(process.env));

  const status = await local.status<Record<string, unknown>>();
  const state = typeof status.BackendState === 'string' ? status.BackendState : undefined;
  if (state !== 'Running') throw new Error(`TAILSCALE_NOT_RUNNING: BackendState=${state ?? 'unknown'}`);

  for (const exposure of exposures) {
    const cmdArgs = ['--bg'];
    if (exposure.path) cmdArgs.push(`--set-path=${exposure.path}`);
    if (exposure.https) {
      if (exposure.public && ![443, 8443, 10000].includes(exposure.https)) throw new Error('FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000');
      cmdArgs.push(`--https=${exposure.https}`);
    }
    if (exposure.public) await local.funnel([...cmdArgs, exposure.target]);
    else await local.serve([...cmdArgs, exposure.target]);
  }

  const verifiedStatus = await local.status<Record<string, unknown>>();
  return { binary, device: deviceFromStatus(verifiedStatus), authKeySource, exposures };
}
