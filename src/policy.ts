import { existsSync } from 'node:fs';
import { readFile, copyFile } from 'node:fs/promises';
import { TailscaleApiClient } from './api.js';
import type { ResolvedConfig } from './types.js';
import { confirm } from './interactive.js';

export interface PolicySyncResult {
  changed: boolean;
  validated: boolean;
  written: boolean;
  etag?: string;
  backup?: string;
  diff: string;
}

function simpleDiff(before: string, after: string): string {
  if (before === after) return '';
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines: string[] = [];
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`-${a[i]}`);
    if (b[i] !== undefined) lines.push(`+${b[i]}`);
  }
  return lines.join('\n');
}

export async function policySync(config: ResolvedConfig, file: string, options: { dryRun: boolean; yes: boolean }): Promise<PolicySyncResult> {
  if (!existsSync(file)) throw new Error(`POLICY_FILE_NOT_FOUND: ${file}`);
  const desired = await readFile(file, 'utf8');
  if (!desired.trim()) throw new Error('POLICY_FILE_EMPTY');

  const api = new TailscaleApiClient(config);
  const current = await api.getPolicy();
  const diff = simpleDiff(current.content, desired);
  if (!diff) return { changed: false, validated: true, written: false, etag: current.etag, diff: '' };

  await api.validatePolicyText(desired);
  if (options.dryRun) return { changed: true, validated: true, written: false, etag: current.etag, diff };

  const approved = await confirm('Apply the policy diff to the tailnet?', options.yes);
  if (!approved) throw new Error('POLICY_CONFIRMATION_REQUIRED: use --yes in CI or confirm in a TTY');

  const backup = `${file}.bak`;
  await copyFile(file, backup);
  await api.updatePolicy(desired, current.etag);
  const verified = await api.getPolicy();
  if (!verified.json) throw new Error('POLICY_VERIFY_FAILED: API returned no policy');
  return { changed: true, validated: true, written: true, etag: verified.etag, backup, diff };
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TS_POLICY_FILE || env.TS_POLICY;
}
