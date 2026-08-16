import { TailscaleApiClient } from "./api.js";
import type { CleanupCandidate, Device, ResolvedConfig } from "./types.js";
import { confirm } from "./interactive.js";

function normalized(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isOffline(device: Device, afterSeconds: number): boolean {
  if (device.online === true) return false;
  if (!device.lastSeen) return false;
  const seen = Date.parse(device.lastSeen);
  return Number.isFinite(seen) && Date.now() - seen >= afterSeconds * 1000;
}

function protectedDevice(device: Device): boolean {
  const protectedNames = (process.env.TS_PROTECTED_DEVICES ?? "")
    .split(",")
    .map((v) => normalized(v.trim()))
    .filter(Boolean);
  const values = [
    normalized(device.id),
    normalized(device.name),
    normalized(device.hostname),
    normalized(device.dnsName),
  ];
  return protectedNames.some((name) => values.includes(name));
}

export function matchReason(
  device: Device,
  config: ResolvedConfig,
): string | undefined {
  const wantedHostname = normalized(config.hostname);
  const hostExact =
    (device.hostname ?? "").toLowerCase().replace(/\.$/, "") ===
    config.hostname.toLowerCase();
  const dnsLabel = (device.dnsName ?? "").toLowerCase().replace(/\.$/, "");
  const dnsExact =
    dnsLabel === config.hostname.toLowerCase() ||
    dnsLabel.startsWith(`${config.hostname.toLowerCase()}.`);
  const nameExact = normalized(device.name) === wantedHostname;
  const hostnameMatch = hostExact || dnsExact || nameExact;
  if (!hostnameMatch) return undefined;
  const tags = new Set(
    (device.tags ?? []).map((tag) => tag.replace(/^tag:/, "").toLowerCase()),
  );
  const wantedTags = config.tags.map((tag) =>
    tag.replace(/^tag:/, "").toLowerCase(),
  );
  const tagMatch =
    wantedTags.length === 0 || wantedTags.every((tag) => tags.has(tag));
  if (!tagMatch) return undefined;
  return wantedTags.length
    ? `hostname ${config.hostname} (exact) + tags ${wantedTags.join(", ")}`
    : `hostname ${config.hostname} (exact, no tag constraint)`;
}

export async function cleanup(
  config: ResolvedConfig,
  options: { dryRun: boolean; yes: boolean; credentialEnvName?: string },
): Promise<{ candidates: CleanupCandidate[]; deleted: string[] }> {
  const api = new TailscaleApiClient(
    config,
    process.env,
    options.credentialEnvName,
  );
  const devices = await api.listDevices();
  const candidates: CleanupCandidate[] = [];
  for (const device of devices) {
    if (!isOffline(device, config.cleanupAfter)) continue;
    if (protectedDevice(device)) continue;
    const match = matchReason(device, config);
    if (!match) continue;
    const seen = device.lastSeen ? Date.parse(device.lastSeen) : Number.NaN;
    candidates.push({
      id: device.id,
      ...(device.hostname ? { hostname: device.hostname } : {}),
      ...(device.name ? { name: device.name } : {}),
      ...(device.dnsName ? { dnsName: device.dnsName } : {}),
      ...(device.tags ? { tags: device.tags } : {}),
      ...(device.lastSeen ? { lastSeen: device.lastSeen } : {}),
      offlineSinceSeconds: Number.isFinite(seen)
        ? Math.round((Date.now() - seen) / 1000)
        : 0,
      match,
    });
  }
  if (options.dryRun || candidates.length === 0)
    return { candidates, deleted: [] };

  const summary = candidates
    .map(
      (candidate) =>
        `${candidate.id} ${candidate.name ?? candidate.hostname ?? ""} (${candidate.match})`,
    )
    .join("\n");
  const approved = await confirm(
    `Delete these offline devices?\n${summary}`,
    options.yes,
  );
  if (!approved)
    throw new Error(
      "CLEANUP_CONFIRMATION_REQUIRED: use --yes in CI or confirm in a TTY",
    );

  const deleted: string[] = [];
  for (const candidate of candidates) {
    await api.deleteDevice(candidate.id);
    deleted.push(candidate.id);
  }
  return { candidates, deleted };
}
