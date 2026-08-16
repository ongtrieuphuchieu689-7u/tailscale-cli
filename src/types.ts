export type Profile = 'ci' | 'container' | 'vm' | 'windows' | 'dev' | 'funnel-app' | 'subnet-router' | 'exit-node';
export type OutputFormat = 'pretty' | 'json';
export interface ResolvedConfig { profile: Profile; tailnet: string; hostname: string; tags: string[]; ssh: boolean; keyExpiry: string; preauthorized: boolean; reusable: boolean; ephemeral: boolean; acceptDns: boolean; acceptRoutes: boolean; cleanupAfter: number; source: Record<string,string>; warnings: string[]; }
export interface CredentialResolution { found: boolean; source?: string; masked?: string; candidates: string[]; error?: string; }
export interface Envelope<T> { ok: boolean; command: string; resolved?: T; warnings: string[]; requiredPrivileges: string[]; sideEffects: string[]; retryable: boolean; error?: {code:string; message:string}; }
