import { TailscaleApiClient } from './api.js';
import type { Device, ResolvedConfig } from './types.js';
import { confirm } from './interactive.js';

function normalized(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isOffline(device: Device, afterSeconds: number): boolean {
  if (device.online === true) return false;
  if (!device.lastSeen) return false;
  const seen = Date.parse(device.lastSeen);
  return Number.isFinite(seen) && Date.now() - seen >= afterSeconds * 1000;
}

function protectedDevice(device: Device): boolean {
  const protectedNames = (process.env.TS_PROTECTED_DEVICES ?? '').split(',').map((v) => normalized(v.trim())).filter(Boolean);
  const values = [normalized(device.id), normalized(device.name), normalized(device.hostname), normalized(device.dnsName)];
  return protectedNames.some((name) => values.includes(name));
}

function matchesDeployment(device: Device, config: ResolvedConfig): boolean {
  if (protectedDevice(device)) return false;
  const wantedHostname = normalized(config.hostname);
  const hostExact = (device.hostname ?? '').toLowerCase().replace(/\.$/, '') === config.hostname.toLowerCase();
  const dnsLabel = (device.dnsName ?? '').toLowerCase().replace(/\.$/, '');
  const dnsExact = dnsLabel === config.hostname.toLowerCase() || dnsLabel.startsWith(`${config.hostname.toLowerCase()}.`);
  const nameExact = normalized(device.name) === wantedHostname;
  const hostnameMatch = hostExact || dnsExact || nameExact;
  const tags = new Set((device.tags ?? []).map((tag) => tag.replace(/^tag:/, '').toLowerCase()));
  const wantedTags = config.tags.map((tag) => tag.replace(/^tag:/, '').toLowerCase());
  const tagMatch = wantedTags.length > 0 && wantedTags.every((tag) => tags.has(tag));
  return wantedTags.length ? hostnameMatch && tagMatch : hostnameMatch;
}

export async function cleanup(config: ResolvedConfig, options: { dryRun: boolean; yes: boolean; credentialEnvName?: string }): Promise<{ candidates: Device[]; deleted: string[] }> {
  const api = new TailscaleApiClient(config, process.env, options.credentialEnvName);
  const devices = await api.listDevices();
  const candidates = devices.filter((device) => isOffline(device, config.cleanupAfter) && matchesDeployment(device, config));
  if (options.dryRun || candidates.length === 0) return { candidates, deleted: [] };

  const summary = candidates.map((device) => `${device.id} ${device.name ?? device.hostname ?? ''}`.trim()).join('\n');
  const approved = await confirm(`Delete these offline devices?\n${summary}`, options.yes);
  if (!approved) throw new Error('CLEANUP_CONFIRMATION_REQUIRED: use --yes in CI or confirm in a TTY');

  const deleted: string[] = [];
  for (const device of candidates) {
    await api.deleteDevice(device.id);
    deleted.push(device.id);
  }
  return { candidates, deleted };
}
