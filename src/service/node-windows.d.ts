declare module "node-windows" {
  export interface ServiceEnvEntry {
    name: string;
    value: string;
  }

  export interface ServiceConfig {
    name: string;
    description?: string;
    script?: string;
    scriptOptions?: string;
    workingdir?: string;
    env?: ServiceEnvEntry[];
    logpath?: string;
    maxLogSizeInKb?: number;
    logMode?: string;
    nodeOptions?: string;
    wait?: number;
    grow?: number;
  }

  export class Service {
    constructor(config: ServiceConfig);
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
    on(event: "install" | "uninstall" | "start" | "stop", cb: () => void): this;
    on(event: "error", cb: (error: Error) => void): this;
  }

  export function isAdminUser(): boolean;
}
