export interface ServiceRestartPolicy {
  onFailure: boolean;
  delaySeconds: number;
  maxRetries: number;
}

export interface ServiceLogConfig {
  dir: string;
  maxSizeMb: number;
  keepFiles: number;
}

export interface ServiceConfig {
  name: string;
  description?: string | undefined;
  user: string;
  workingDir: string;
  script?: string | undefined;
  args: string[];
  env: Record<string, string>;
  restart: ServiceRestartPolicy;
  log?: ServiceLogConfig | undefined;
}

export type ServiceStatusState = "running" | "stopped" | "error" | "unknown";

export interface ServiceStatus {
  name: string;
  status: ServiceStatusState;
  pid?: number | undefined;
  uptimeSeconds?: number | undefined;
  restartCount?: number | undefined;
}

export type ServiceScope = "system" | "user";

export interface ServiceInfo extends ServiceStatus {
  platform: string;
  scope: ServiceScope;
  unitPath?: string | undefined;
  configPath?: string | undefined;
  logDir?: string | undefined;
  installedAt: string;
}

export interface ServiceInstallResult {
  installed: boolean;
  name: string;
  platform: string;
  scope: ServiceScope;
  unitPath?: string | undefined;
  status: string;
  pid?: number | undefined;
  portsListening?: number[] | undefined;
}

export interface LogOptions {
  lines: number;
  follow: boolean;
}

export interface InstallOptions {
  user?: boolean | undefined;
  scheduler?: boolean | undefined;
}

export interface ServiceManager {
  install(
    config: ServiceConfig,
    opts?: InstallOptions | undefined,
  ): Promise<ServiceInstallResult>;
  uninstall(name: string): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  status(name: string): Promise<ServiceStatus>;
  logs(name: string, opts: LogOptions): Promise<void>;
  list(): Promise<ServiceInfo[]>;
}
