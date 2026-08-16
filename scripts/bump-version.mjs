#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('../package.json', import.meta.url));

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
}).formatToParts(new Date());
const get = (type) => parts.find((p) => p.type === type)?.value || '';
const next = `1.${get('year')}${get('month')}${get('day')}.1${get('hour')}${get('minute')}`; // 1.YYMMDD.1HHmm

const cmp = (a, b) => {
  const [am, ap] = a.split('.').slice(1).map(Number);
  const [bm, bp] = b.split('.').slice(1).map(Number);
  return am - bm || ap - bp;
};

const fail = (msg) => {
  console.error(`[bump-version] ${msg}`);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync(PKG, 'utf8'));
const prev = manifest.version;

if (cmp(next, prev) <= 0) {
  fail(
    `pending ${next} is not greater than current ${prev}; wait until the next VN minute (now ${get('hour')}:${get('minute')} Asia/Ho_Chi_Minh).`
  );
}

if (process.argv.includes('--verify')) {
  const pub = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm view tailsacle-cli version'], { encoding: 'utf8' })
    : spawnSync('npm', ['view', 'tailsacle-cli', 'version'], { encoding: 'utf8' });
  if (pub.error) fail(`could not run npm: ${pub.error.message}`);
  if (pub.status !== 0) fail(`could not query npmjs registry: ${(pub.stderr ?? '').trim()}`);
  const published = pub.stdout.trim();
  if (published && cmp(next, published) <= 0) {
    fail(`pending ${next} is not greater than published ${published}.`);
  }
}

manifest.version = next;
writeFileSync(PKG, JSON.stringify(manifest, null, 2) + '\n');
console.log(`version bumped ${prev} -> ${next} (${get('hour')}:${get('minute')} Asia/Ho_Chi_Minh)`);
