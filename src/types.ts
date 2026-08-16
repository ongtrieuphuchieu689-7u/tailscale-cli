export type Profile =
  | "ci"
  | "container"
  | "vm"
  | "windows"
  | "dev"
  | "funnel-app"
  | "subnet-router"
  | "exit-node";
export type OutputFormat = "pretty" | "json";

export interface ResolvedConfig {
  profile: Profile;
  tailnet: string;
  hostname: string;
  tags: string[];
  ssh: boolean;
  keyExpiry: string;
  preauthorized: boolean;
  reusable: boolean;
  ephemeral: boolean;
  acceptDns: boolean;
  acceptRoutes: boolean;
  cleanupAfter: number;
  source: Record<string, string>;
  warnings: string[];
}

export interface CredentialResolution {
  found: boolean;
  source?: string;
  masked?: string;
  candidates: string[];
  error?: string;
}

export interface CleanupCandidate {
  id: string;
  hostname?: string;
  name?: string;
  dnsName?: string;
  tags?: string[];
  lastSeen?: string;
  offlineSinceSeconds: number;
  match: string;
}

export interface Envelope<T> {
  ok: boolean;
  command: string;
  durationMs: number;
  resolved?: T;
  warnings: string[];
  requiredPrivileges: string[];
  sideEffects: string[];
  retryable: boolean;
  error?: { code: string; message: string; status?: number; docsUrl?: string };
}

export interface Device {
  id: string;
  name?: string;
  hostname?: string;
  dnsName?: string;
  os?: string;
  user?: string;
  tags?: string[];
  lastSeen?: string;
  created?: string;
  authorized?: boolean;
  keyExpiryDisabled?: boolean;
  expires?: string;
  online?: boolean;
}

export type PolicyDocument = Record<string, unknown>;

export interface DnsSettings {
  nameservers: unknown;
  preferences: unknown;
  searchpaths: unknown;
}

export interface Exposure {
  target: string;
  public: boolean;
  path?: string;
  tcp?: number;
  https?: number;
}

export interface DeploymentResult {
  binary: { path: string; version: string };
  device: Device | Record<string, unknown>;
  authKeySource: "provided" | "created";
  exposures: Exposure[];
  warnings: string[];
  source: ResolvedConfig["source"];
  cleanup?: { candidates: string[]; deleted: string[]; skipped?: boolean };
}
