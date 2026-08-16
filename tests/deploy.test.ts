import { describe, expect, it } from 'vitest';
import { resolveKeyExpiry, parseExposure, resolveExposures } from '../src/deploy.js';

describe('key expiry resolution', () => {
  it('defaults to the server max lifetime', () => {
    expect(resolveKeyExpiry('max')).toBe(90 * 24 * 60 * 60);
    expect(resolveKeyExpiry('')).toBe(90 * 24 * 60 * 60);
  });

  it('accepts explicit seconds', () => {
    expect(resolveKeyExpiry('3600')).toBe(3600);
  });

  it('rejects invalid values', () => {
    expect(() => resolveKeyExpiry('soon')).toThrow('KEY_EXPIRY_INVALID');
    expect(() => resolveKeyExpiry('-5')).toThrow('KEY_EXPIRY_INVALID');
  });
});

describe('exposure parsing', () => {
  it('turns a port into a loopback HTTP target', () => {
    expect(parseExposure('3000')).toEqual({ target: 'http://127.0.0.1:3000', public: false, path: undefined, https: 3000 });
  });

  it('accepts localhost and paths', () => {
    expect(parseExposure('localhost:8080#api')).toEqual({ target: 'http://localhost:8080', public: false, path: '/api', https: 8080 });
  });

  it('rejects unsupported targets', () => {
    expect(() => parseExposure('ftp://example.com')).toThrow('EXPOSE_INVALID_TARGET');
  });

  it('marks funnel exposures as public', () => {
    expect(resolveExposures(['3000'], true)[0]?.public).toBe(true);
  });
});
