#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { apiCredentialHint, ApiError, TailscaleApiClient } from './api.js';
import { cleanup } from './cleanup.js';
import { credentialEnvName, maskSecret, resolveConfig, resolveCredential, runtime } from './core.js';
import { deploy as deployCommand } from './deploy.js';
import { findTailscale, tailscaleVersion, TailscaleLocal } from './tailscale.js';
import { latestStableInfo, updateCacheBinary } from './binary.js';
import { manifest } from './manifest.js';
import { ensureFunnelAccess, ensureHttpsEnabled, policyFromEnv, policySync } from './policy.js';
import type { Envelope } from './types.js';

function packageVersion(): string {
  try {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const pkg = JSON.parse(readFileSync(resolvePath(here, '..', 'package.json'), 'utf8')) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // Fall through to a safe default when package.json is not reachable.
  }
  return '0.0.0';
}

const program = new Command();
program.name('tailsacle-cli').description('Safe, zero-config Tailscale deployment CLI').version(packageVersion()).option('--json', 'emit a stable JSON envelope').option('--credential-env <name>', 'use the Tailscale trust credential found in this env var (overrides auto-detection)');

interface CliOptions {
  json?: boolean;
  credentialEnv?: string;
}

function resolvedCredentialEnv(): string | undefined {
  const opts = program.opts<CliOptions>();
  if (opts.credentialEnv) {
    const value = process.env[opts.credentialEnv]?.trim();
    if (!value) throw new Error(`CREDENTIAL_ENV_MISSING: env ${opts.credentialEnv} is not set`);
    if (!value.startsWith('tskey-client-')) throw new Error(`CREDENTIAL_FORMAT_UNSUPPORTED: env ${opts.credentialEnv} is not a tskey-client- trust credential`);
    return opts.credentialEnv;
  }
  return credentialEnvName();
}

function emit<T>(command: string, resolved: T, warnings: string[] = [], sideEffects: string[] = [], requiredPrivileges: string[] = [], start = performance.now()): void {
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
  if (program.opts<{ json?: boolean }>().json) console.log(JSON.stringify(envelope, null, 2));
  else console.log(JSON.stringify(resolved, null, 2));
}

function fail(command: string, error: unknown, start = performance.now()): never {
  const detail = error instanceof ApiError
    ? { code: error.code, message: error.message, retryable: error.retryable, status: error.status }
    : { code: 'CLI_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false, status: undefined };
  const envelope: Envelope<never> = {
    ok: false,
    command,
    durationMs: Math.round(performance.now() - start),
    warnings: [],
    requiredPrivileges: [],
    sideEffects: [],
    retryable: detail.retryable,
    error: { code: detail.code, message: detail.message, ...(detail.status ? { status: detail.status } : {}) },
  };
  if (program.opts<{ json?: boolean }>().json) console.error(JSON.stringify(envelope, null, 2));
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

function doctorCredential(): ReturnType<typeof resolveCredential> {
  const opts = program.opts<CliOptions>();
  if (!opts.credentialEnv) return resolveCredential();
  const value = process.env[opts.credentialEnv]?.trim();
  if (!value) return { found: false, candidates: [opts.credentialEnv], error: 'CREDENTIAL_ENV_MISSING' };
  if (!value.startsWith('tskey-client-')) return { found: false, candidates: [opts.credentialEnv], error: 'CREDENTIAL_FORMAT_UNSUPPORTED' };
  return { found: true, source: opts.credentialEnv, masked: maskSecret(value), candidates: [] };
}

program.command('doctor').description('Resolve credentials, runtime, local binary and API capability without remote side effects').option('--detect-credentials').option('--show-resolution').action(async () => {
  const start = performance.now();
  try {
    const config = resolveConfig();
    const credential = doctorCredential();
    let binary: unknown = { found: false };
    try { binary = await tailscaleVersion(undefined, { download: false }); } catch (error) { binary = { found: false, error: error instanceof Error ? error.message : String(error) }; }
    const warnings = [...config.warnings];
    if (!credential.found) warnings.push(credential.error === 'MULTIPLE_CREDENTIALS' ? 'CREDENTIAL_AMBIGUOUS: choose a credential explicitly with --credential-env' : 'CREDENTIAL_NOT_FOUND');
    if (apiCredentialHint() === 'missing') warnings.push('API_CREDENTIAL_NOT_CONFIGURED: deploy can still use TS_AUTH_KEY');
    emit('doctor', { config, credential, apiCredential: apiCredentialHint(), binary, runtime }, warnings, [], [], start);
  } catch (error) { fail('doctor', error, start); }
});

program.command('deploy').description('Join the tailnet and optionally configure Serve/Funnel').option('--dry-run').option('--yes').option('--expose <target...>').option('--funnel').option('--apply-policy').option('--enable-https').option('--cleanup').option('--bin <path>').action(async (options: { dryRun?: boolean; yes?: boolean; expose?: string[]; funnel?: boolean; applyPolicy?: boolean; enableHttps?: boolean; cleanup?: boolean; bin?: string }) => {
  const start = performance.now();
  try {
    const config = resolveConfig();
    const credentialEnv = resolvedCredentialEnv();
    const result = await deployCommand(config, {
      dryRun: Boolean(options.dryRun),
      yes: Boolean(options.yes),
      expose: options.expose ?? [],
      funnel: Boolean(options.funnel),
      applyPolicy: Boolean(options.applyPolicy),
      enableHttps: Boolean(options.enableHttps),
      cleanup: Boolean(options.cleanup),
      ...(options.bin ? { bin: options.bin } : {}),
      ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}),
    });
    emit('deploy', result, [...config.warnings, ...result.warnings], options.dryRun ? [] : ['authenticate node', 'configure Tailscale state', ...(result.exposures.length ? ['configure Serve/Funnel'] : []), ...(result.warnings.length ? ['update tailnet policy'] : [])], process.platform === 'win32' ? [] : ['root/admin may be required by tailscaled'], start);
  } catch (error) { fail('deploy', error, start); }
});

program.command('up').description('Alias for deploy without exposure configuration').option('--dry-run').option('--yes').option('--apply-policy').option('--cleanup').action(async (options: { dryRun?: boolean; yes?: boolean; applyPolicy?: boolean; cleanup?: boolean }) => {
  const start = performance.now();
  try {
      const credentialEnv = resolvedCredentialEnv();
      emit('up', await deployCommand(resolveConfig(), { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes), expose: [], funnel: false, applyPolicy: Boolean(options.applyPolicy), cleanup: Boolean(options.cleanup), ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}) }), [], [], [], start);
    }
  catch (error) { fail('up', error, start); }
});

program.command('status').description('Show local Tailscale status').action(async () => {
  const start = performance.now();
  try { emit('status', await new TailscaleLocal(await findTailscale()).status(), [], [], [], start); }
  catch (error) { fail('status', error, start); }
});

program.command('update-bin').description('Download the latest stable Tailscale client into the package cache (never overwrites package-managed binaries)').option('--yes').option('--dry-run').option('--force').option('--skip-checksum').option('--track <track>').action(async (options: { yes?: boolean; dryRun?: boolean; force?: boolean; skipChecksum?: boolean; track?: string }) => {
  const start = performance.now();
  try {
    if (options.track && options.track !== 'stable') throw new Error('BIN_TRACK_UNSUPPORTED: only the stable track is supported');
    if (process.platform === 'win32') {
      const bin = await findTailscale();
      const local = new TailscaleLocal(bin);
      const before = await tailscaleVersion(bin);
      if (options.dryRun) { emit('update-bin', { before, dryRun: true }, ['WINDOWS_NATIVE_UPDATER: using the installed Tailscale updater because portable binaries are not supported'], [], [], start); return; }
      await local.update(Boolean(options.yes));
      const after = await tailscaleVersion(bin);
      emit('update-bin', { before, after }, ['WINDOWS_NATIVE_UPDATER: fallback path'], ['update Tailscale client'], [], start);
      return;
    }
    if (options.dryRun) {
      const info = await latestStableInfo();
      emit('update-bin', { latest: info.version, dryRun: true }, [], [], [], start);
      return;
    }
    const result = await updateCacheBinary({ ...(options.force ? { force: true } : {}), ...(options.skipChecksum ? { skipChecksum: true } : {}) });
    emit('update-bin', result, [], ['download Tailscale client into cache', 'update cache binary'], [], start);
  } catch (error) { fail('update-bin', error, start); }
});

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function funnelPublicDnsPropagated(hostname: string, timeoutSeconds: number): Promise<{ ok: boolean; attempts: number }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, { signal: controller.signal });
      clearTimeout(timer);
      const json = await response.json() as { Answer?: { type: number; data: string }[] };
      if ((json.Answer ?? []).some((record) => record.type === 1)) return { ok: true, attempts };
    } catch {
      // DNS-over-HTTPS unavailable; fall back to the system resolver next round.
    }
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { stdout } = await promisify(execFile)('getent', ['ahostsv4', hostname], { timeout: 5000 });
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

function parseFunnelExpose(value: string): { https: number; path?: string; target: string } {
  const eq = value.trim().split('=', 2);
  const localPort = eq[1] ? Number(eq[1].trim()) : undefined;
  const left = eq[0]!.replace(/^[,;]\s*/, '');
  const slash = left.indexOf('/');
  const https = Number(slash >= 0 ? left.slice(0, slash) : left);
  if (!Number.isFinite(https) || ![443, 8443, 10000].includes(https)) throw new Error('FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000');
  if (!localPort || !Number.isFinite(localPort)) throw new Error(`FUNNEL_EXPOSE_INVALID: ${value} (expected "443=3000" or "443/api=3001")`);
  const path = slash >= 0 ? (left.slice(slash).startsWith('/') ? left.slice(slash) : `/${left.slice(slash)}`) : undefined;
  return { https, ...(path ? { path } : {}), target: `http://127.0.0.1:${localPort}` };
}

program.command('funnel').description('Configure Tailscale Funnel for a target (auto-detects target and verifies public DNS)')
  .argument('[target]', 'local target such as 3000, localhost:8080 or http://127.0.0.1:3000 (defaults to $PORT)')
  .option('--https <port>', 'public HTTPS port (443, 8443 or 10000)').option('--tcp <public:local>', 'TCP funnel instead of HTTPS').option('--path <path>').option('--expose <target...>', 'repeatable expose targets, e.g. "443=3000" or "443/api=3001"').option('--yes').option('--apply-policy').option('--enable-https').option('--verify-timeout <sec>', 'DNS propagation timeout').action(async (target: string | undefined, options: FunnelOptions) => {
  const start = performance.now();
  try {
    const config = resolveConfig();
    const local = new TailscaleLocal(await findTailscale());
    const credentialEnvNameResolved = resolvedCredentialEnv();
    const httpsPort = options.https ? Number(options.https) : 443;
    if (options.https && ![443, 8443, 10000].includes(httpsPort)) throw new Error('FUNNEL_PORT_UNSUPPORTED: Funnel allows 443, 8443, or 10000');

    const warnings: string[] = [];
    if (config.ephemeral) throw new Error('FUNNEL_EPHEMERAL: the node is ephemeral so Funnel will never publish public DNS; set TS_EPHEMERAL=false (or use TS_PROFILE=funnel-app which defaults to non-ephemeral) and re-run');
    const exposed = (options.expose ?? []).filter(Boolean).map(parseFunnelExpose);
    let resolvedTarget = target;
    if (options.tcp) {
      const [publicPort, localPort] = options.tcp.replace(/\s/g, '').split(':');
      if (!publicPort || !localPort) throw new Error('FUNNEL_TCP_INVALID: --tcp expects public:local, e.g. 10000:5432');
      await local.funnel(['--bg', `--tcp=${publicPort}`, `tcp://127.0.0.1:${localPort}`]);
      emit('funnel', { target: `tcp://127.0.0.1:${localPort}`, public: true, tcp: Number(publicPort), https: undefined, path: undefined }, warnings, ['configure Funnel (TCP)'], [], start);
      return;
    }
    if (!exposed.length) {
      resolvedTarget = target ?? (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : undefined);
      if (!resolvedTarget) throw new Error('FUNNEL_TARGET_REQUIRED: pass a target, --expose, or set $PORT');
      if (!target) warnings.push(`FUNNEL_TARGET_DEFAULTED: used $PORT=${process.env.PORT} as the local target; override with a positional target or --expose`);
    }

    if (options.yes && options.enableHttps) {
      const https = await ensureHttpsEnabled(config, { yes: true, ...(credentialEnvNameResolved ? { credentialEnvName: credentialEnvNameResolved } : {}) });
      warnings.push(...https.warnings);
    }
    const runFunnel = async (extra: string[]): Promise<void> => { await local.funnel(['--bg', ...extra]); };
    try {
      if (exposed.length) {
        for (const exposure of exposed) {
          const cmd: string[] = [`--https=${exposure.https}`];
          if (exposure.path) cmd.push(`--set-path=${exposure.path}`);
          await runFunnel(cmd.concat(exposure.target));
        }
      } else {
        const cmd: string[] = [`--https=${httpsPort}`];
        if (options.path) cmd.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
        await runFunnel(cmd.concat(resolvedTarget as string));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/funnel.*(not available|node attribute not set)/i.test(message) || !options.yes) throw error;
      if (!options.applyPolicy) throw new Error('FUNNEL_ATTR_REQUIRED: the funnel node attribute is missing; re-run with --apply-policy to auto-add it on the tailnet');
      warnings.push('SIDE_EFFECT_PLAN: adding the funnel node attribute for the deployment tags before retrying');
      const provisioned = await ensureFunnelAccess(config, config.tags, { yes: true, ...(credentialEnvNameResolved ? { credentialEnvName: credentialEnvNameResolved } : {}) });
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
            if (options.path) cmd.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
            await runFunnel(cmd.concat(resolvedTarget as string));
          }
          break;
        } catch (retryError) {
          if (attempt === 3) throw retryError;
          await sleepMs(3000);
        }
      }
    }

    const verifySeconds = options.verifyTimeout ? Number(options.verifyTimeout) : 120;
    const name = await (async (): Promise<string | undefined> => {
      try {
        const statusJson = await local.runJson<Record<string, unknown>>(['funnel', 'status']);
        if (typeof statusJson?.Name === 'string') return statusJson.Name.replace(/\.$/, '');
      } catch {
        // status unavailable; fall back to local status.
      }
      const statusJson = await local.runJson<{ Self?: { DNSName?: string } }>(['status']);
      const dns = statusJson?.Self?.DNSName;
      return dns ? dns.replace(/\.$/, '') : undefined;
    })();
    const verify = name ? await funnelPublicDnsPropagated(name, verifySeconds) : { ok: false as const, attempts: 0 };
    if (!verify.ok) throw new Error(`FUNNEL_DNS_NOT_PUBLISHED: no public DNS record for ${name ?? 'the funnel hostname'} within ${verifySeconds}s (tried ${verify.attempts} times)`);
    emit('funnel', {
      target: exposed.length ? exposed[0]!.target : resolvedTarget,
      public: true,
      https: httpsPort,
      path: options.path ?? '/',
      ...(name ? { url: `https://${name}/` } : {}),
      dnsPropagated: true,
      dnsAttempts: verify.attempts,
    }, warnings, ['configure Funnel', ...(warnings.some((w) => w.startsWith('PROVISIONED')) ? ['update tailnet policy', 'enable HTTPS'] : [])], [], start);
  } catch (error) { fail('funnel', error, start); }
});

program.command('serve').description('Configure Tailscale Serve for a target').argument('<target>').option('--https <port>').option('--http <port>').option('--tcp <port>').option('--path <path>').action(async (target: string, options: { https?: string; http?: string; tcp?: string; path?: string }) => {
  const start = performance.now();
  try {
    const local = new TailscaleLocal(await findTailscale());
    const args = ['--bg'];
    if (options.https) args.push(`--https=${Number(options.https)}`);
    else if (options.http) args.push(`--http=${Number(options.http)}`);
    else if (options.tcp) args.push(`--tcp=${Number(options.tcp)}`);
    if (options.path) args.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
    await local.serve([...args, target]);
    emit('serve', { target, public: false, path: options.path ?? '/' }, [], ['configure Serve'], [], start);
  } catch (error) { fail('serve', error, start); }
});

program.command('dns').description('Read tailnet DNS settings').action(async () => {
  const start = performance.now();
  try { emit('dns', await new TailscaleApiClient(resolveConfig(), process.env, resolvedCredentialEnv()).getDns(), [], [], [], start); }
  catch (error) { fail('dns', error, start); }
});

program.command('policy').description('Diff, validate and guarded-sync a HuJSON policy file').option('--file <path>').option('--sync').option('--dry-run').option('--yes').action(async (options: { file?: string; sync?: boolean; dryRun?: boolean; yes?: boolean }) => {
  const start = performance.now();
  try {
    const file = options.file ?? policyFromEnv();
    if (!file) throw new Error('POLICY_FILE_REQUIRED: pass --file or TS_POLICY_FILE');
    const credentialEnv = resolvedCredentialEnv();
    const result = await policySync(resolveConfig(), file, { dryRun: Boolean(options.dryRun ?? !options.sync), yes: Boolean(options.yes), ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}) });
    emit('policy', result, [], result.written ? ['policy write', 'policy backup'] : [], [], start);
  } catch (error) { fail('policy', error, start); }
});

program.command('cleanup').description('Find and safely remove matching offline devices').option('--dry-run').option('--yes').action(async (options: { dryRun?: boolean; yes?: boolean }) => {
  const start = performance.now();
  try {
    const credentialEnv = resolvedCredentialEnv();
    const result = await cleanup(resolveConfig(), { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes), ...(credentialEnv ? { credentialEnvName: credentialEnv } : {}) });
    emit('cleanup', result, result.candidates.length ? ['destructive: exact candidates only'] : [], result.deleted.map((id) => `delete device ${id}`), [], start);
  } catch (error) { fail('cleanup', error, start); }
});

program.command('agent-manifest').description('Print the machine-readable agent contract').action(async () => {
  const start = performance.now();
  const opts = program.opts<{ json?: boolean }>();
  if (opts.json) emit('agent-manifest', manifest, [], [], [], start);
  else console.log(JSON.stringify(manifest, null, 2));
});

void program.parseAsync().catch(() => { if (!process.exitCode) process.exitCode = 1; });
