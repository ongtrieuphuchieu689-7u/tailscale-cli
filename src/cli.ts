#!/usr/bin/env node

import { Command } from 'commander';
import { apiCredentialHint, ApiError, TailscaleApiClient } from './api.js';
import { cleanup } from './cleanup.js';
import { resolveConfig, resolveCredential, runtime } from './core.js';
import { deploy } from './deploy.js';
import { findTailscale, tailscaleVersion, TailscaleLocal } from './tailscale.js';
import { manifest } from './manifest.js';
import { ensureFunnelAccess, ensureHttpsEnabled, policyFromEnv, policySync } from './policy.js';
import type { Envelope } from './types.js';

const program = new Command();
program.name('tailsacle-cli').description('Safe, zero-config Tailscale deployment CLI').version('0.2.0').option('--json', 'emit a stable JSON envelope');

function emit<T>(command: string, resolved: T, warnings: string[] = [], sideEffects: string[] = [], requiredPrivileges: string[] = []): void {
  const envelope: Envelope<T> = { ok: true, command, resolved, warnings, requiredPrivileges, sideEffects, retryable: false };
  if (program.opts<{ json?: boolean }>().json) console.log(JSON.stringify(envelope, null, 2));
  else console.log(JSON.stringify(resolved, null, 2));
}

function fail(command: string, error: unknown): never {
  const detail = error instanceof ApiError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: 'CLI_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false };
  const envelope: Envelope<never> = { ok: false, command, warnings: [], requiredPrivileges: [], sideEffects: [], retryable: detail.retryable, error: { code: detail.code, message: detail.message } };
  if (program.opts<{ json?: boolean }>().json) console.error(JSON.stringify(envelope, null, 2));
  else console.error(`${detail.code}: ${detail.message}`);
  process.exitCode = detail.retryable ? 75 : 1;
  throw error;
}

program.command('doctor').description('Resolve credentials, runtime, local binary and API capability without remote side effects').option('--detect-credentials').option('--show-resolution').action(async () => {
  try {
    const config = resolveConfig();
    const credential = resolveCredential();
    let binary: unknown = { found: false };
    try { binary = await tailscaleVersion(); } catch (error) { binary = { found: false, error: error instanceof Error ? error.message : String(error) }; }
    const warnings = [...config.warnings];
    if (!credential.found) warnings.push(credential.error === 'MULTIPLE_CREDENTIALS' ? 'CREDENTIAL_AMBIGUOUS: choose a credential explicitly' : 'CREDENTIAL_NOT_FOUND');
    if (apiCredentialHint() === 'missing') warnings.push('API_CREDENTIAL_NOT_CONFIGURED: deploy can still use TS_AUTH_KEY');
    emit('doctor', { config, credential, apiCredential: apiCredentialHint(), binary, runtime }, warnings);
  } catch (error) { fail('doctor', error); }
});

program.command('deploy').description('Join the tailnet and optionally configure Serve/Funnel').option('--dry-run').option('--yes').option('--expose <target...>').option('--funnel').option('--bin <path>').action(async (options: { dryRun?: boolean; yes?: boolean; expose?: string[]; funnel?: boolean; bin?: string }) => {
  try {
    const config = resolveConfig();
    const result = await deploy(config, { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes), expose: options.expose ?? [], funnel: Boolean(options.funnel), ...(options.bin ? { bin: options.bin } : {}) });
    emit('deploy', result, [...config.warnings, ...result.warnings], options.dryRun ? [] : ['authenticate node', 'configure Tailscale state', ...(result.exposures.length ? ['configure Serve/Funnel'] : []), ...(result.warnings.length ? ['update tailnet policy'] : [])], process.platform === 'win32' ? [] : ['root/admin may be required by tailscaled']);
  } catch (error) { fail('deploy', error); }
});

program.command('up').description('Alias for deploy without exposure configuration').option('--dry-run').option('--yes').action(async (options: { dryRun?: boolean; yes?: boolean }) => {
  try { emit('up', await deploy(resolveConfig(), { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes), expose: [], funnel: false })); }
  catch (error) { fail('up', error); }
});

program.command('status').description('Show local Tailscale status').action(async () => {
  try { emit('status', await new TailscaleLocal(await findTailscale()).status()); }
  catch (error) { fail('status', error); }
});

program.command('update-bin').description('Explicitly update the installed Tailscale client using its native updater').option('--yes').option('--dry-run').action(async (options: { yes?: boolean; dryRun?: boolean }) => {
  try {
    const bin = await findTailscale();
    const local = new TailscaleLocal(bin);
    const before = await tailscaleVersion(bin);
    if (options.dryRun) { emit('update-bin', { before, dryRun: true }); return; }
    await local.update(Boolean(options.yes));
    const after = await tailscaleVersion(bin);
    emit('update-bin', { before, after }, [], ['update Tailscale client']);
  } catch (error) { fail('update-bin', error); }
});

program.command('funnel').description('Configure Tailscale Funnel for a target').argument('<target>').option('--https <port>').option('--path <path>').option('--yes').action(async (target: string, options: { https?: string; path?: string; yes?: boolean }) => {
  try {
    const config = resolveConfig();
    const local = new TailscaleLocal(await findTailscale());
    const args = ['--bg'];
    if (options.https) { const port = Number(options.https); if (![443, 8443, 10000].includes(port)) throw new Error('FUNNEL_PORT_UNSUPPORTED: use 443, 8443, or 10000'); args.push(`--https=${port}`); }
    if (options.path) args.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
    const fullArgs = [...args, target];
    const run = () => local.funnel(fullArgs);
    const provisionWarnings: string[] = [];
    if (options.yes) {
      const https = await ensureHttpsEnabled(config, { yes: true });
      provisionWarnings.push(...https.warnings);
    }
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/funnel.*(not available|node attribute not set)/i.test(message) || !options.yes) throw error;
      const provisioned = await ensureFunnelAccess(config, config.tags, { yes: true });
      provisionWarnings.push(...provisioned.warnings);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await run();
          break;
        } catch (retryError) {
          if (attempt === 3) throw retryError;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }
    emit('funnel', { target, public: true, https: options.https ? Number(options.https) : 443, path: options.path ?? '/' }, provisionWarnings, ['configure Funnel', ...(provisionWarnings.length ? ['update tailnet policy', 'enable HTTPS'] : [])]);
  } catch (error) { fail('funnel', error); }
});

program.command('serve').description('Configure Tailscale Serve for a target').argument('<target>').option('--https <port>').option('--http <port>').option('--tcp <port>').option('--path <path>').action(async (target: string, options: { https?: string; http?: string; tcp?: string; path?: string }) => {
  try {
    const local = new TailscaleLocal(await findTailscale());
    const args = ['--bg'];
    if (options.https) args.push(`--https=${Number(options.https)}`);
    else if (options.http) args.push(`--http=${Number(options.http)}`);
    else if (options.tcp) args.push(`--tcp=${Number(options.tcp)}`);
    if (options.path) args.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
    await local.serve([...args, target]);
    emit('serve', { target, public: false, path: options.path ?? '/' }, [], ['configure Serve']);
  } catch (error) { fail('serve', error); }
});

program.command('dns').description('Read tailnet DNS settings').action(async () => {
  try { emit('dns', await new TailscaleApiClient(resolveConfig()).getDns()); }
  catch (error) { fail('dns', error); }
});

program.command('policy').description('Diff, validate and guarded-sync a HuJSON policy file').option('--file <path>').option('--sync').option('--dry-run').option('--yes').action(async (options: { file?: string; sync?: boolean; dryRun?: boolean; yes?: boolean }) => {
  try {
    const file = options.file ?? policyFromEnv();
    if (!file) throw new Error('POLICY_FILE_REQUIRED: pass --file or TS_POLICY_FILE');
    const result = await policySync(resolveConfig(), file, { dryRun: Boolean(options.dryRun ?? !options.sync), yes: Boolean(options.yes) });
    emit('policy', result, [], result.written ? ['policy write', 'policy backup'] : []);
  } catch (error) { fail('policy', error); }
});

program.command('cleanup').description('Find and safely remove matching offline devices').option('--dry-run').option('--yes').action(async (options: { dryRun?: boolean; yes?: boolean }) => {
  try {
    const result = await cleanup(resolveConfig(), { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes) });
    emit('cleanup', result, result.candidates.length ? ['destructive: exact candidates only'] : [], result.deleted.map((id) => `delete device ${id}`));
  } catch (error) { fail('cleanup', error); }
});

program.command('agent-manifest').description('Print the machine-readable agent contract').action(() => console.log(JSON.stringify(manifest, null, 2)));

void program.parseAsync().catch(() => { if (!process.exitCode) process.exitCode = 1; });
