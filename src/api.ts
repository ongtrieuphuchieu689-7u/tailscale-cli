import type { Device, DnsSettings, PolicyDocument, ResolvedConfig } from './types.js';

const API_BASE = 'https://api.tailscale.com/api/v2';
const OAUTH_TOKEN_URL = `${API_BASE}/oauth/token`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code = 'TAILSCALE_API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

type TokenSource = 'bearer' | 'basic' | 'oauth';

interface AuthState {
  source: TokenSource;
  token?: string;
  clientId?: string;
  clientSecret?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface AuthKeyCreateOptions {
  reusable: boolean;
  ephemeral: boolean;
  preauthorized: boolean;
  tags: string[];
  expirySeconds?: number;
}

export interface CreatedAuthKey {
  key: string;
  id?: string;
  expires?: string;
  capabilities?: unknown;
}

export interface PolicySnapshot {
  content: string;
  etag?: string;
  json?: PolicyDocument;
}

function envFirst(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TailscaleApiClient {
  private readonly config: ResolvedConfig;
  private readonly auth: AuthState;
  private oauthToken?: { value: string; expiresAt: number; key: string };

  constructor(config: ResolvedConfig, env: NodeJS.ProcessEnv = process.env) {
    this.config = config;
    const accessToken = env.TS_ACCESS_TOKEN ?? env.TS_API_TOKEN;
    const apiKey = env.TS_API_KEY;
    const clientId = env.TS_OAUTH_CLIENT_ID;
    const clientSecret = env.TS_OAUTH_CLIENT_SECRET;

    if (accessToken) this.auth = { source: 'bearer', token: accessToken };
    else if (apiKey) this.auth = { source: 'basic', token: apiKey };
    else if (clientId && clientSecret) this.auth = { source: 'oauth', clientId, clientSecret };
    else this.auth = { source: 'bearer' };
  }

  hasCredentials(): boolean {
    return Boolean(this.auth.token || (this.auth.clientId && this.auth.clientSecret));
  }

  private async oauthAccessToken(scopes: string[], tags: string[]): Promise<string> {
    if (!this.auth.clientId || !this.auth.clientSecret) throw new ApiError('Tailscale OAuth credentials are missing', 401, 'CREDENTIAL_NOT_FOUND');
    const key = `${scopes.join(' ')}|${tags.join(',')}`;
    const now = Date.now();
    if (this.oauthToken && this.oauthToken.key === key && this.oauthToken.expiresAt > now + 30_000) return this.oauthToken.value;

    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scopes.length) body.set('scope', scopes.join(' '));
    if (tags.length) body.set('tags', tags.join(' '));

    const basic = Buffer.from(`${this.auth.clientId}:${this.auth.clientSecret}`, 'utf8').toString('base64');
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(`OAuth token request failed (${response.status}): ${text.slice(0, 300)}`, response.status, 'OAUTH_TOKEN_FAILED');
    const data = JSON.parse(text) as OAuthTokenResponse;
    const expiresIn = Math.max(60, data.expires_in ?? 3600);
    this.oauthToken = { value: data.access_token, expiresAt: now + expiresIn * 1000, key };
    return data.access_token;
  }

  private async request<T>(path: string, init: RequestInit = {}, scopes: string[] = [], tags: string[] = []): Promise<{ data: T; headers: Headers; status: number }> {
    const headers = new Headers(init.headers);
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    if (this.auth.source === 'oauth') {
      headers.set('Authorization', `Bearer ${await this.oauthAccessToken(scopes, tags)}`);
    } else if (this.auth.token) {
      if (this.auth.source === 'basic') {
        headers.set('Authorization', `Basic ${Buffer.from(`${this.auth.token}:`, 'utf8').toString('base64')}`);
      } else {
        headers.set('Authorization', `Bearer ${this.auth.token}`);
      }
    } else {
      throw new ApiError('No Tailscale API credential configured; set TS_API_KEY, TS_ACCESS_TOKEN, or TS_OAUTH_CLIENT_ID/TS_OAUTH_CLIENT_SECRET', 401, 'CREDENTIAL_NOT_FOUND');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
        const text = await response.text();
        if (response.ok) {
          if (!text) return { data: undefined as T, headers: response.headers, status: response.status };
          const contentType = response.headers.get('content-type') ?? '';
          const data = contentType.includes('json') ? JSON.parse(text) as T : text as T;
          return { data, headers: response.headers, status: response.status };
        }
        const message = (() => {
          try {
            const parsed = JSON.parse(text) as { message?: string };
            return parsed.message ?? text;
          } catch {
            return text;
          }
        })();
        const error = new ApiError(message.slice(0, 500), response.status);
        if (!error.retryable || attempt === 2) throw error;
        lastError = error;
        await sleep(250 * 2 ** attempt);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        lastError = error;
        if (attempt === 2) throw error;
        await sleep(250 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Tailscale API request failed');
  }

  private tailnet(): string {
    if (!this.config.tailnet || this.config.tailnet === '-') return '-';
    return encodePath(this.config.tailnet);
  }

  async listDevices(): Promise<Device[]> {
    const { data } = await this.request<{ devices?: Device[] }>(`/tailnet/${this.tailnet()}/devices`, {}, ['devices:core:read']);
    return data.devices ?? [];
  }

  async getDevice(id: string): Promise<Device> {
    const { data } = await this.request<Device>(`/device/${encodePath(id)}`, {}, ['devices:core:read']);
    return data;
  }

  async deleteDevice(id: string): Promise<void> {
    await this.request<void>(`/device/${encodePath(id)}`, { method: 'DELETE' }, ['devices:core']);
  }

  async createAuthKey(options: AuthKeyCreateOptions): Promise<CreatedAuthKey> {
    const body = {
      capabilities: {
        devices: {
          create: {
            reusable: options.reusable,
            ephemeral: options.ephemeral,
            preauthorized: options.preauthorized,
            tags: options.tags,
          },
        },
      },
      ...(options.expirySeconds ? { expirySeconds: options.expirySeconds } : {}),
    };
    const { data } = await this.request<CreatedAuthKey>(`/tailnet/${this.tailnet()}/keys`, { method: 'POST', body: JSON.stringify(body) }, ['auth_keys'], options.tags);
    if (!data.key) throw new ApiError('Tailscale API created a key but did not return its secret', 502, 'AUTH_KEY_NOT_RETURNED');
    return data;
  }

  async getPolicy(): Promise<PolicySnapshot> {
    const { data, headers } = await this.request<PolicyDocument>(`/tailnet/${this.tailnet()}/acl`, { headers: { Accept: 'application/json' } }, ['policy_file:read']);
    return { content: JSON.stringify(data, null, 2), json: data, etag: headers.get('etag') ?? undefined };
  }

  async validatePolicy(policy: PolicyDocument): Promise<unknown> {
    const { data } = await this.request<unknown>(`/tailnet/${this.tailnet()}/acl/validate`, { method: 'POST', body: JSON.stringify(policy) }, ['policy_file:read']);
    return data;
  }

  async updatePolicy(content: string, etag?: string): Promise<PolicySnapshot> {
    const headers: Record<string, string> = { 'Content-Type': 'application/hujson', Accept: 'application/json' };
    if (etag) headers['If-Match'] = etag;
    const { data, headers: responseHeaders } = await this.request<PolicyDocument>(`/tailnet/${this.tailnet()}/acl`, { method: 'POST', headers, body: content }, ['policy_file']);
    return { content: JSON.stringify(data, null, 2), json: data, etag: responseHeaders.get('etag') ?? undefined };
  }

  async getDns(): Promise<DnsSettings> {
    const [nameservers, preferences, searchpaths] = await Promise.all([
      this.request<unknown>(`/tailnet/${this.tailnet()}/dns/nameservers`, {}, ['dns:read']),
      this.request<unknown>(`/tailnet/${this.tailnet()}/dns/preferences`, {}, ['dns:read']),
      this.request<unknown>(`/tailnet/${this.tailnet()}/dns/searchpaths`, {}, ['dns:read']),
    ]);
    return { nameservers: nameservers.data, preferences: preferences.data, searchpaths: searchpaths.data };
  }
}

export function apiCredentialHint(): string {
  return envFirst('TS_API_KEY', 'TS_ACCESS_TOKEN', 'TS_OAUTH_CLIENT_ID') ? 'configured' : 'missing';
}
