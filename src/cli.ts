#!/usr/bin/env node

import { Command } from 'commander';
import { apiCredentialHint, ApiError, TailscaleApiClient } from './api.js';
import { cleanup } from './cleanup.js';
import { resolveConfig, resolveCredential, runtime } from './core.js';
import { deploy, parseExposure } from './deploy.js';
import { findTailscale, tailscaleVersion, TailscaleLocal } from './tailscale.js';
import { manifest } from './manifest.js';
import { policyFromEnv, policySync } from './policy.js';
import type { Envelope } from './types.js';

const program = new Command();
program
  .name('tailsacle-cli')
  .description('Safe, zero-config Tailscale deployment CLI')
  .version('0.2.0')
  .option('--json', 'emit a stable JSON envelope');

function emit<T>(command: string, resolved: T, warnings: string[] = [], sideEffects: string[] = [], requiredPrivileges: string[] = []): void {
  const envelope: Envelope<T> = {
    ok: true,
    command,
    resolved,
    warnings,
    requiredPrivileges,
    sideEffects,
    retryable: false,
  };
  if (program.opts<{ json?: boolean }>().json) console.log(JSON.stringify(envelope, null, 2));
  else console.log(JSON.stringify(resolved, null, 2));
}

function fail(command: string, error: unknown): never {
  const e = error instanceof ApiError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: 'CLI_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false };
  const envelope: Envelope<never> = {
    ok: false,
    command,
    warnings: [],
    requiredPrivileges: [],
    sideEffects: [],
    retryable: e.retryable,
    error: { code: e.code, message: e.message },
  };
  if (program.opts<{ json?: boolean }>().json) console.error(JSON.stringify(envelope, null, 2));
  else console.error(`${e.code}: ${e.message}`);
  process.exitCode = e.retryable ? 75 : 1;
  throw error;
}

program
  .command('doctor')
  .description('Resolve credentials, runtime, local binary and API capability without remote side effects')
  .option('--detect-credentials')
  .option('--show-resolution')
  .action(async () => {
    try {
      const config = resolveConfig();
      const credential = resolveCredential();
      let binary: unknown = { found: false };
      try {
        binary = await tailscaleVersion();
      } catch (error) {
        binary = { found: false, error: error instanceof Error ? error.message : String(error) };
      }
      const warnings = [...config.warnings];
      if (!credential.found) warnings.push(credential.error === 'MULTIPLE_CREDENTIALS' ? 'CREDENTIAL_AMBIGUOUS: choose a credential explicitly' : 'CREDENTIAL_NOT_FOUND');
      if (apiCredentialHint() === 'missing') warnings.push('API_CREDENTIAL_NOT_CONFIGURED: deploy can still use TS_AUTH_KEY');
      emit('doctor', { config, credential, apiCredential: apiCredentialHint(), binary, runtime }, warnings);
    } catch (error) {
      fail('doctor', error);
    }
  });

program
  .command('deploy')
  .description('Install/configure Tailscale, join the tailnet, verify Running, and configure optional exposure')
  .option('--dry-run', 'resolve plan without remote or local side effects')
  .option('--yes', 'approve guarded operations')
  .option('--expose <target...>', 'local port/URL to expose; repeat or separate by spaces')
  .option('--funnel', 'use public Funnel instead of private Serve')
  .option('--bin <path>', 'explicit tailscale binary path')
  .action(async (options: { dryRun?: boolean; yes?: boolean; expose?: string[]; funnel?: boolean; bin?: string }) => {
    try {
      const config = resolveConfig();
      const result = await deploy(config, {
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes),
        expose: options.expose ?? [],
        funnel: Boolean(options.funnel),
        bin: options.bin,
      });
      emit('deploy', result, config.warnings, options.dryRun ? [] : ['authenticate node', 'configure Tailscale state', ...(result.exposures.length ? ['configure Serve/Funnel'] : [])], process.platform === 'win32' ? [] : ['root/admin may be required by tailscaled']);
    } catch (error) {
      fail('deploy', error);
    }
  });

program
  .command('up')
  .description('Alias for deploy without exposure configuration')
  .option('--dry-run')
  .option('--yes')
  .action(async (options: { dryRun?: boolean; yes?: boolean }) => {
    try {
      const config = resolveConfig();
      const result = await deploy(config, { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes), expose: [], funnel: false });
      emit('up', result, config.warnings);
    } catch (error) {
      fail('up', error);
    }
  });

program
  .command('status')
  .description('Show local Tailscale status')
  .action(async () => {
    try {
      const bin = await findTailscale();
      const local = new TailscaleLocal(bin);
      emit('status', await local.status());
    } catch (error) {
      fail('status', error);
    }
  });

program
  .command('funnel')
  .description('Configure Tailscale Funnel for a target')
  .argument('<target>')
  .option('--https <port>')
  .option('--path <path>')
  .action(async (target: string, options: { https?: string; path?: string }) => {
    try {
      const bin = await findTailscale();
      const local = new TailscaleLocal(bin);
      const args = ['--bg'];
      if (options.https) {
        const port = Number(options.https);
        if (![443, 8443, 10000].includes(port)) throw new Error('FUNNEL_PORT_UNSUPPORTED: use 443, 8443, or 10000');
        args.push(`--https=${port}`);
      }
      if (options.path) args.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
      await local.funnel([...args, target]);
      emit('funnel', { target, public: true, https: options.https ? Number(options.https) : 443, path: options.path ?? '/' });
    } catch (error) {
      fail('funnel', error);
    }
  });

program
  .command('serve')
  .description('Configure Tailscale Serve for a target')
  .argument('<target>')
  .option('--https <port>')
  .option('--http <port>')
  .option('--tcp <port>')
  .option('--path <path>')
  .action(async (target: string, options: { https?: string; http?: string; tcp?: string; path?: string }) => {
    try {
      const bin = await findTailscale();
      const local = new TailscaleLocal(bin);
      const args = ['--bg'];
      if (options.https) args.push(`--https=${Number(options.https)}`);
      else if (options.http) args.push(`--http=${Number(options.http)}`);
      else if (options.tcp) args.push(`--tcp=${Number(options.tcp)}`);
      if (options.path) args.push(`--set-path=${options.path.startsWith('/') ? options.path : `/${options.path}`}`);
      await local.serve([...args, target]);
      emit('serve', { target, public: false, path: options.path ?? '/' });
    } catch (error) {
      fail('serve', error);
    }
  });

program
  .command('dns')
  .description('Read tailnet DNS settings')
  .action(async () => {
    try {
      const config = resolveConfig();
      const api = new TailscaleApiClient(config);
      emit('dns', await api.getDns());
    } catch (error) {
      fail('dns', error);
    }
  });

program
  .command('policy')
  .description('Diff, validate and guarded-sync a HuJSON policy file')
  .option('--file <path>')
  .option('--sync')
  .option('--dry-run')
  .option('--yes')
  .action(async (options: { file?: string; sync?: boolean; dryRun?: boolean; yes?: boolean }) => {
    try {
      const config = resolveConfig();
      const file = options.file ?? policyFromEnv();
      if (!file) throw new Error('POLICY_FILE_REQUIRED: pass --file or TS_POLICY_FILE');
      const result = await policySync(config, file, { dryRun: Boolean(options.dryRun ?? !options.sync), yes: Boolean(options.yes) });
      emit('policy', result, [], result.written ? ['policy write', 'policy backup'] : []);
    } catch (error) {
      fail('policy', error);
    }
  });

program
  .command('cleanup')
  .description('Find and safely remove matching offline devices')
  .option('--dry-run')
  .option('--yes')
  .action(async (options: { dryRun?: boolean; yes?: boolean }) => {
    try {
      const config = resolveConfig();
      const result = await cleanup(config, { dryRun: Boolean(options.dryRun), yes: Boolean(options.yes) });
      emit('cleanup', result, result.candidates.length ? ['destructive: exact candidates only'] : [], result.deleted.length ? result.deleted.map((id) => `delete device ${id}`) : []);
    } catch (error) {
      fail('cleanup', error);
    }
  });

program
  .command('agent-manifest')
  .description('Print the machine-readable agent contract')
  .action(() => {
    console.log(JSON.stringify(manifest, null, 2));
  });

program
  .option('--update-bin')
  .action(() => {
    if (process.argv.length <= 2) program.help();
  });

void program.parseAsync().catch(() => {
  if (!process.exitCode) process.exitCode = 1;
});

void parseExposure;
