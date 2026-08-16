#!/usr/bin/env node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const token = process.env.GITHUB_TOKEN || process.env.GH_PACKAGES_TOKEN;
const registry = process.env.GH_PACKAGES_REGISTRY || 'https://npm.pkg.github.com';
const scope = '@ongtrieuphuchieu689-7u';

if (!token) {
  console.error('[publish-github] GITHUB_TOKEN is required');
  process.exit(1);
}

const pick = (k) => (k in pkg ? { [k]: pkg[k] } : {});
const scoped = {
  name: `${scope}/tailsacle-cli`,
  version: pkg.version,
  ...pick('description'),
  ...pick('license'),
  ...pick('type'),
  ...pick('engines'),
  bin: pkg.bin,
  main: pkg.main,
  types: pkg.types,
  exports: pkg.exports,
  dependencies: pkg.dependencies,
  keywords: pkg.keywords,
  files: pkg.files,
  repository: pkg.repository,
};

const dir = mkdtempSync(join(tmpdir(), 'ghpkg-'));
try {
  for (const f of pkg.files) {
    cpSync(join(root, f), join(dir, f), { recursive: true });
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(scoped, null, 2) + '\n');
  const npmrc = join(dir, '.npmrc');
  writeFileSync(
    npmrc,
    `//npm.pkg.github.com/:_authToken=${token}\n${scope}:registry=${registry}\n`
  );
  const args = process.argv.includes('--dry-run') ? ['publish', '--dry-run', '--userconfig', npmrc] : ['publish', '--userconfig', npmrc];
  const res = spawnSync('npm', args, { cwd: dir, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
  console.log(`[publish-github] published ${scoped.name}@${scoped.version} to ${registry}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}