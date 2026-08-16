import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';

const execFileAsync = promisify(execFile);

export const STABLE_INDEX_URL = 'https://pkgs.tailscale.com/stable/?mode=json';
export const STABLE_BASE = 'https://pkgs.tailscale.com/stable';

export interface BinaryDownloadInfo {
  version: string;
  tarball: string;
  sha256: string;
  url: string;
  sha256Url: string;
  cachedPath: string;
}

export function cacheBinDir(): string {
  if (process.env.TS_BIN_DIR?.trim()) return resolve(process.env.TS_BIN_DIR.trim());
  const base = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? os.homedir(), 'tailscale-cli', 'bin')
    : join(process.env.XDG_CACHE_HOME || join(os.homedir(), '.cache'), 'tailsacle-cli', 'bin');
  return base;
}

export function cacheBinPath(): string {
  return resolve(cacheBinDir(), process.platform === 'win32' ? 'tailscale.exe' : 'tailscale');
}

export function detectArch(): string {
  switch (os.arch()) {
    case 'x64': return 'amd64';
    case 'arm64': return 'arm64';
    case 'arm': return 'arm';
    case 'ia32': return '386';
    default: return os.arch().toLowerCase();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`BIN_DOWNLOAD_HTTP_${response.status}: ${url}`);
  return response.text();
}

export async function latestStableInfo(): Promise<{ version: string; tarball: string; sha256: string; url: string; sha256Url: string }> {
  const index = JSON.parse(await fetchText(STABLE_INDEX_URL)) as { Version?: string; Tarballs?: Record<string, string> };
  const version = index.Version;
  const arch = detectArch();
  const tarball = index.Tarballs?.[arch];
  if (!version || !tarball) throw new Error('BIN_INDEX_INCOMPLETE: could not determine the latest stable build');
  const sha256Raw = (await fetchText(`${STABLE_BASE}/${tarball}.sha256`)).trim().split(/\s+/)[0];
  if (!sha256Raw || !/^[0-9a-f]{64}$/i.test(sha256Raw)) throw new Error('BIN_SHA256_INVALID: checksum file did not contain a valid SHA256');
  const sha256 = sha256Raw;
  return { version, tarball, sha256, url: `${STABLE_BASE}/${tarball}`, sha256Url: `${STABLE_BASE}/${tarball}.sha256` };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`BIN_DOWNLOAD_HTTP_${response.status}: ${url}`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

function sha256sum(file: string): Promise<string> {
  return readFile(file).then((data) => createHash('sha256').update(data).digest('hex'));
}

async function extractTarball(tarballPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const tarArgs = ['-xzf', tarballPath, '-C', destDir];
  const { stdout, stderr } = await execFileAsync('tar', tarArgs, { timeout: 120_000, windowsHide: true });
  if (stderr && !stderr.includes('Removing leading')) throw new Error(`BIN_EXTRACT_FAILED: ${stderr.slice(0, 300)}`);
  void stdout;
}

async function findFile(dir: string, basename: string, depth = 0): Promise<string | undefined> {
  if (depth > 4) return undefined;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === basename) return join(dir, entry.name);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findFile(join(dir, entry.name), basename, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export async function downloadStable(options: { skipChecksum?: boolean } = {}): Promise<BinaryDownloadInfo> {
  const info = await latestStableInfo();
  const dir = cacheBinDir();
  await mkdir(dir, { recursive: true });
  const tmpDir = await new Promise<string>((resolvePromise) => {
    const p = join(dir, `.tmp-${process.pid}-${Date.now()}`);
    resolvePromise(p);
  });
  await mkdir(tmpDir, { recursive: true });
  const tarballPath = join(tmpDir, info.tarball);
  try {
    await downloadFile(info.url, tarballPath);
    const actual = await sha256sum(tarballPath);
    if (!options.skipChecksum && actual.toLowerCase() !== info.sha256.toLowerCase()) {
      throw new Error(`BIN_CHECKSUM_MISMATCH: expected ${info.sha256} got ${actual}`);
    }
    await extractTarball(tarballPath, join(tmpDir, 'x'));
    const names = process.platform === 'win32' ? ['tailscale.exe'] : ['tailscale', 'tailscaled'];
    for (const name of names) {
      const src = await findFile(join(tmpDir, 'x',), name);
      if (!src) continue;
      const versioned = join(dir, `${name}-${info.version}`);
      if (existsSync(versioned)) await rm(versioned, { force: true });
      await rename(src, versioned);
      if (process.platform !== 'win32') await chmod(versioned, 0o755);
    }
    const link = cacheBinPath();
    const linkTarget = join(dir, `${process.platform === 'win32' ? 'tailscale.exe' : 'tailscale'}-${info.version}`);
    if (existsSync(link)) await rm(link, { force: true });
    await symlink(linkTarget, link);
    return { ...info, cachedPath: link };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function cacheBinaryVersion(): Promise<string | undefined> {
  const link = cacheBinPath();
  if (!existsSync(link)) return undefined;
  const dir = cacheBinDir();
  const entries = await readdir(dir);
  const versioned = entries.map((name) => name.match(/^tailscale(?:\.exe)?-([0-9.]+)$/)?.[1]).filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versioned[versioned.length - 1];
}

async function runVersion(path: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['version'], { timeout: 10_000, windowsHide: true });
    return (stdout || stderr).split(/\r?\n/).find((line) => /\d+\.\d+\.\d+/.test(line))?.trim();
  } catch {
    return undefined;
  }
}

export async function updateCacheBinary(options: { force?: boolean; skipChecksum?: boolean } = {}): Promise<{ cached: boolean; before?: string; after?: string; info?: BinaryDownloadInfo }> {
  const before = await cacheBinaryVersion();
  const currentPath = cacheBinPath();
  if (!options.force) {
    const current = await runVersion(currentPath);
    if (current) return { cached: true, before: current, after: current };
  }
  const info = await downloadStable({ ...(options.skipChecksum ? { skipChecksum: options.skipChecksum } : {}) });
  const after = await runVersion(info.cachedPath);
  return { cached: true, info, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

export async function ensureBinary(): Promise<{ path: string; version: string; source: 'cache' | 'download' }> {
  if (process.platform === 'win32') {
    throw new Error('BIN_WINDOWS_MANUAL: install Tailscale with the MSI installer (Administrator) or set TS_TAILSCALE_BIN');
  }
  await downloadStable();
  const version = await runVersion(cacheBinPath());
  if (!version) throw new Error('TAILSCALE_BINARY_FAILED: downloaded binary did not run');
  return { path: cacheBinPath(), version, source: 'download' };
}