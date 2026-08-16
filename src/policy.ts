import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { TailscaleApiClient } from './api.js';
import type { PolicySnapshot } from './api.js';
import type { PolicyDocument, ResolvedConfig } from './types.js';
import { confirm } from './interactive.js';

export interface PolicySyncResult {
  changed: boolean;
  validated: boolean;
  written: boolean;
  etag?: string;
  backup?: string;
  diff: string;
}

export interface ProvisionResult {
  provisioned: boolean;
  warnings: string[];
}

const DEFAULT_TAG_OWNERS = ['autogroup:admin'];

function normalizeTag(tag: string): string {
  return tag.startsWith('tag:') ? tag : `tag:${tag}`;
}

function tagOwnersOf(policy: PolicyDocument | undefined): Record<string, string[]> {
  const value = policy?.tagOwners;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, string[]>;
}

interface NodeAttrEntry {
  target: string[];
  attr: string[];
}

function nodeAttrsOf(policy: PolicyDocument | undefined): NodeAttrEntry[] {
  const value = policy?.nodeAttrs;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is NodeAttrEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const target = (entry as { target?: unknown }).target;
    const attr = (entry as { attr?: unknown }).attr;
    return Array.isArray(target) && Array.isArray(attr);
  });
}

function withFunnelAttr(entries: NodeAttrEntry[], targets: string[]): NodeAttrEntry[] {
  const funnelEntry = entries.find((entry) => entry.attr.includes('funnel'));
  if (funnelEntry) {
    const missing = targets.filter((target) => !funnelEntry.target.includes(target));
    if (!missing.length) return entries;
    return entries.map((entry) => (entry === funnelEntry ? { ...entry, target: [...entry.target, ...missing] } : entry));
  }
  return [...entries, { target: targets, attr: ['funnel'] }];
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
  if (!diff) return { changed: false, validated: true, written: false, ...(current.etag ? { etag: current.etag } : {}), diff: '' };

  await api.validatePolicyText(desired);
  if (options.dryRun) return { changed: true, validated: true, written: false, ...(current.etag ? { etag: current.etag } : {}), diff };

  const approved = await confirm('Apply the policy diff to the tailnet?', options.yes);
  if (!approved) throw new Error('POLICY_CONFIRMATION_REQUIRED: use --yes in CI or confirm in a TTY');

  const backup = `${file}.bak`;
  await writeFile(backup, current.content, 'utf8');
  await api.updatePolicy(desired, current.etag);
  const verified = await api.getPolicy();
  if (!verified.json) throw new Error('POLICY_VERIFY_FAILED: API returned no policy');
  return { changed: true, validated: true, written: true, ...(verified.etag ? { etag: verified.etag } : {}), backup, diff };
}

export async function ensureHttpsEnabled(config: ResolvedConfig, options: { yes: boolean }): Promise<ProvisionResult> {
  const api = new TailscaleApiClient(config);
  if (!api.hasCredentials()) return { provisioned: false, warnings: [] };
  let httpsEnabled: boolean | undefined;
  try {
    httpsEnabled = (await api.getTailnetSettings()).httpsEnabled;
  } catch {
    httpsEnabled = undefined;
  }
  if (httpsEnabled === true) return { provisioned: false, warnings: [] };
  const approved = await confirm('Enable HTTPS certificates for the tailnet (required for Serve/Funnel)?', options.yes);
  if (!approved) throw new Error('HTTPS_ENABLE_CONFIRMATION_REQUIRED: pass --yes to enable HTTPS');
  await api.enableHttps();
  return { provisioned: true, warnings: ['ENABLED_HTTPS: enabled tailnet HTTPS certificates'] };
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TS_POLICY_FILE || env.TS_POLICY;
}

async function syncPolicy(config: ResolvedConfig, desired: PolicyDocument, current: PolicySnapshot): Promise<void> {
  const api = new TailscaleApiClient(config);
  const content = JSON.stringify(desired, null, 2);
  await api.validatePolicyText(content);
  const backup = `policy.provision-${Date.now()}.bak`;
  await writeFile(backup, current.content, 'utf8');
  await api.updatePolicy(content, current.etag);
  const verified = await api.getPolicy();
  if (!verified.json) throw new Error('POLICY_VERIFY_FAILED: API returned no policy');
}

export async function ensureDeployTags(config: ResolvedConfig, tags: string[], options: { yes: boolean }): Promise<ProvisionResult> {
  const normalized = tags.map(normalizeTag).filter(Boolean);
  if (!normalized.length) return { provisioned: false, warnings: [] };
  const api = new TailscaleApiClient(config);
  const current = await api.getPolicy();
  const tagOwners = tagOwnersOf(current.json);
  const missing = normalized.filter((tag) => !(tag in tagOwners));
  if (!missing.length) return { provisioned: false, warnings: [] };

  const desired: PolicyDocument = {
    ...current.json,
    tagOwners: { ...tagOwners, ...Object.fromEntries(missing.map((tag) => [tag, DEFAULT_TAG_OWNERS])) },
    nodeAttrs: withFunnelAttr(nodeAttrsOf(current.json), missing),
  };
  const approved = await confirm(`Auto-add tagOwners ${missing.join(', ')} (owned by ${DEFAULT_TAG_OWNERS.join(', ')}) and funnel access to the tailnet policy?`, options.yes);
  if (!approved) throw new Error('POLICY_PROVISION_CONFIRMATION_REQUIRED: pass --yes to auto-provision tags');
  await syncPolicy(config, desired, current);
  return {
    provisioned: true,
    warnings: [`PROVISIONED_TAGS: added tagOwners for ${missing.join(', ')} (${DEFAULT_TAG_OWNERS.join(', ')}) and funnel node attribute`],
  };
}

export async function ensureFunnelAccess(config: ResolvedConfig, tags: string[], options: { yes: boolean }): Promise<ProvisionResult> {
  const api = new TailscaleApiClient(config);
  const current = await api.getPolicy();
  const targets = tags.map(normalizeTag).filter(Boolean);
  const covered = targets.length
    ? nodeAttrsOf(current.json).some((entry) => entry.attr.includes('funnel') && targets.some((target) => entry.target.includes(target)))
    : nodeAttrsOf(current.json).some((entry) => entry.attr.includes('funnel') && entry.target.includes('autogroup:member'));
  if (covered) return { provisioned: false, warnings: [] };

  const nodeAttrs = targets.length ? withFunnelAttr(nodeAttrsOf(current.json), targets) : withFunnelAttr(nodeAttrsOf(current.json), ['autogroup:member']);
  const desired: PolicyDocument = { ...current.json, nodeAttrs };
  const approved = await confirm(`Auto-add funnel node attribute for ${(targets.length ? targets : ['autogroup:member']).join(', ')} to the tailnet policy?`, options.yes);
  if (!approved) throw new Error('POLICY_PROVISION_CONFIRMATION_REQUIRED: pass --yes to auto-enable funnel');
  await syncPolicy(config, desired, current);
  return { provisioned: true, warnings: [`PROVISIONED_FUNNEL: added funnel node attribute for ${(targets.length ? targets : ['autogroup:member']).join(', ')}`] };
}
