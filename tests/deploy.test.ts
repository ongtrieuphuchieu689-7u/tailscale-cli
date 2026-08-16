import { describe, expect, it } from 'vitest';
import { parseExposure, resolveExposures } from '../src/deploy.js';

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
