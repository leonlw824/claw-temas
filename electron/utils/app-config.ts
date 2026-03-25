/**
 * Application Configuration Management
 * Scans ~/.openclaw/apps directory for installed extension apps
 */
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { getOpenClawConfigDir } from './paths';
import * as logger from './logger';

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
  type: 'component' | 'iframe';
  entry: string;
}

interface OpenClawConfigWithApps {
  apps?: Record<string, AppConfig>;
  [key: string]: unknown;
}

export interface AppSnapshot {
  apps: Record<string, AppConfig>;
}

/**
 * Get apps directory path
 */
export function getAppsDir(): string {
  return join(getOpenClawConfigDir(), 'apps');
}

/**
 * Scan apps directory and discover installed apps
 */
export async function scanAppsDirectory(): Promise<Record<string, AppConfig>> {
  const appsDir = getAppsDir();

  try {
    // Ensure apps directory exists
    await mkdir(appsDir, { recursive: true });

    // Read directory contents
    const entries = await readdir(appsDir, { withFileTypes: true });
    const apps: Record<string, AppConfig> = {};

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const appId = entry.name;
      const manifestPath = join(appsDir, appId, 'manifest.json');

      try {
        const manifestContent = await readFile(manifestPath, 'utf-8');
        const manifest: AppManifest = JSON.parse(manifestContent);

        apps[appId] = {
          name: manifest.name,
          type: manifest.type === 'component' ? 'internal' : 'external',
          enabled: true, // Default to enabled
          description: manifest.description,
          icon: manifest.icon,
          version: manifest.version,
          author: manifest.author,
        };
      } catch (error) {
        logger.warn(`Failed to read manifest for app ${appId}`, { error: String(error) });
      }
    }

    return apps;
  } catch (error) {
    logger.warn('Failed to scan apps directory', { error: String(error) });
    return {};
  }
}

/**
 * Sync apps from directory with config
 */
export async function syncAppsWithConfig(): Promise<void> {
  return withConfigLock(async () => {
    const scannedApps = await scanAppsDirectory();
    const config = await readOpenClawConfig() as OpenClawConfigWithApps;

    if (!config.apps) {
      config.apps = {};
    }

    // Merge scanned apps with config, preserving enabled state
    for (const [appId, scannedApp] of Object.entries(scannedApps)) {
      if (config.apps[appId]) {
        // App exists in config - preserve enabled state, update other fields
        config.apps[appId] = {
          ...scannedApp,
          enabled: config.apps[appId].enabled,
        };
      } else {
        // New app - add with default enabled state
        config.apps[appId] = scannedApp;
      }
    }

    // Remove apps from config that no longer exist in directory
    for (const appId of Object.keys(config.apps)) {
      if (!scannedApps[appId]) {
        delete config.apps[appId];
        logger.info(`Removed missing app from config: ${appId}`);
      }
    }

    await writeOpenClawConfig(config);
    logger.info('Synced apps with config', { appCount: Object.keys(config.apps).length });
  });
}

/**
 * List all installed apps
 */
export async function listApps(): Promise<AppSnapshot> {
  // Always sync before listing to ensure up-to-date info
  await syncAppsWithConfig();

  const config = await readOpenClawConfig() as OpenClawConfigWithApps;
  const apps = config.apps || {};
  return { apps };
}

/**
 * Install an app
 */
export async function installApp(
  appId: string,
  appConfig: AppConfig,
): Promise<AppSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithApps;

    if (!config.apps) {
      config.apps = {};
    }

    config.apps[appId] = appConfig;

    await writeOpenClawConfig(config);
    logger.info('Installed app', { appId, appConfig });

    return { apps: config.apps };
  });
}

/**
 * Uninstall an app
 */
export async function uninstallApp(appId: string): Promise<AppSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithApps;

    if (!config.apps || !config.apps[appId]) {
      throw new Error(`App "${appId}" not found`);
    }

    delete config.apps[appId];

    await writeOpenClawConfig(config);
    logger.info('Uninstalled app', { appId });

    return { apps: config.apps };
  });
}

/**
 * Enable/disable an app
 */
export async function toggleAppEnabled(
  appId: string,
  enabled: boolean,
): Promise<AppSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithApps;

    if (!config.apps || !config.apps[appId]) {
      throw new Error(`App "${appId}" not found`);
    }

    config.apps[appId].enabled = enabled;

    await writeOpenClawConfig(config);
    logger.info('Toggled app enabled', { appId, enabled });

    return { apps: config.apps };
  });
}

/**
 * Read app manifest file
 */
export async function readAppManifest(appId: string): Promise<AppManifest> {
  const appsDir = getAppsDir();
  const manifestPath = join(appsDir, appId, 'manifest.json');

  try {
    const content = await readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as AppManifest;
  } catch (error) {
    throw new Error(`Failed to read app manifest: ${String(error)}`);
  }
}

/**
 * Read app entry file content
 */
export async function readAppEntry(appId: string): Promise<string> {
  const manifest = await readAppManifest(appId);
  const appsDir = getAppsDir();
  const entryPath = join(appsDir, appId, manifest.entry);

  try {
    return await readFile(entryPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read app entry: ${String(error)}`);
  }
}
