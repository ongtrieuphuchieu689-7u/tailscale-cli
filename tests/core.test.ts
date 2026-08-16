import { describe, expect, it } from 'vitest';
import { maskSecret, resolveConfig, resolveCredential } from '../src/core.js';

describe('credential resolution', () => {
  it('prefers explicit credential and masks it', () => {
    const result = resolveCredential({ TS_CLIENT_SECRET: 'tskey-client-abcdefghijklmnop', OTHER: 'tskey-client-secondary' });
    expect(result.found).toBe(true);
    expect(result.source).toBe('TS_CLIENT_SECRET');
    expect(result.masked).toBe('tskey…nop');
    expect(result.candidates).toEqual(['OTHER']);
  });

  it('rejects ambiguous environment scan', () => {
    const result = resolveCredential({ A: 'tskey-client-one', B: 'tskey-client-two' });
    expect(result.found).toBe(false);
    expect(result.error).toBe('MULTIPLE_CREDENTIALS');
  });

  it('returns a masked value without exposing the secret', () => {
    expect(maskSecret('super-secret-value')).toBe('super…lue');
  });
});

describe('config resolution', () => {
  it('uses container defaults', () => {
    const config = resolveConfig({ CONTAINER: '1', TS_HOSTNAME: 'My App', TS_TAGS: 'prod,web' });
    expect(config.profile).toBe('container');
    expect(config.hostname).toBe('my-app');
    expect(config.tags).toEqual(['prod', 'web']);
    expect(config.ephemeral).toBe(true);
    expect(config.acceptRoutes).toBe(false);
  });

  it('defaults ssh, preauthorized and accept-dns to true when env is absent', () => {
    const config = resolveConfig({ CI: 'true', TS_HOSTNAME: 'node-a' });
    expect(config.ssh).toBe(true);
    expect(config.preauthorized).toBe(true);
    expect(config.acceptDns).toBe(true);
    expect(config.keyExpiry).toBe('max');
  });

  it('defaults reusable + warns for long-lived vm profiles', () => {
    const config = resolveConfig({ TS_PROFILE: 'vm', TS_HOSTNAME: 'web-01', TS_TAGS: 'prod' });
    expect(config.reusable).toBe(true);
    expect(config.warnings).toContain('REUSABLE_KEY_DEFAULTED: auth key created for this long-lived node is reusable until it expires');
  });

  it('appends a run id to CI hostnames when TS_HOSTNAME is absent', () => {
    const config = resolveConfig({ CI: 'true', GITHUB_RUN_ID: '98765', TS_TAGS: 'ci' });
    expect(config.hostname.endsWith('-98765')).toBe(true);
    expect(config.hostname.length).toBeLessThanOrEqual(63);
    expect(config.source.hostname).toBe('os.hostname+run');
  });
});
