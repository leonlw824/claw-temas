/**
 * Application Types
 */

export type AppType = 'internal' | 'external';

export interface AppConfig {
  name: string;
  type: AppType;
  enabled: boolean;
  description?: string;
  icon?: string;
  version?: string;
  author?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  icon?: string;
  entry: string;
}

export interface AppSnapshot {
  apps: Record<string, AppConfig>;
}
