#!/usr/bin/env node
/**
 * Deploy built apps from dist-apps/ to ~/.openclaw/apps/
 */
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST_APPS_DIR = join(__dirname, '../dist-apps');
const OPENCLAW_APPS_DIR = join(homedir(), '.openclaw', 'apps');

// Get app ID from command line or deploy all
const targetApp = process.argv[2];

function deployApp(appName) {
  const srcDir = join(DIST_APPS_DIR, appName);
  const destDir = join(OPENCLAW_APPS_DIR, appName);

  if (!existsSync(srcDir)) {
    console.log(`⏭️  Skipping ${appName} (not built)`);
    return false;
  }

  try {
    console.log(`📦 Deploying ${appName}...`);

    // Create destination directory
    mkdirSync(destDir, { recursive: true });

    // Copy all files
    cpSync(srcDir, destDir, { recursive: true, force: true });

    console.log(`✅ Deployed ${appName} to ${destDir}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to deploy ${appName}:`, err.message);
    return false;
  }
}

function main() {
  // Create ~/.openclaw/apps directory if it doesn't exist
  if (!existsSync(OPENCLAW_APPS_DIR)) {
    mkdirSync(OPENCLAW_APPS_DIR, { recursive: true });
  }

  if (targetApp) {
    // Deploy specific app
    deployApp(targetApp);
  } else {
    // Deploy all built apps
    console.log('🚀 Deploying all built extension apps...\n');

    if (!existsSync(DIST_APPS_DIR)) {
      console.error('❌ dist-apps/ directory not found. Run build-apps first.');
      process.exit(1);
    }

    const apps = readdirSync(DIST_APPS_DIR).filter((name) => {
      const appPath = join(DIST_APPS_DIR, name);
      return statSync(appPath).isDirectory();
    });

    if (apps.length === 0) {
      console.log('No apps found in dist-apps/ directory');
      return;
    }

    let successCount = 0;
    for (const app of apps) {
      if (deployApp(app)) {
        successCount++;
      }
    }

    console.log(`\n🎉 Deployed ${successCount}/${apps.length} apps successfully`);
  }
}

main();
