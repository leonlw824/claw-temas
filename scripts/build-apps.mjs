#!/usr/bin/env node
/**
 * Build and deploy extension apps
 * Builds plugins from plugins/ to dist-apps/ and deploys to ~/.openclaw/apps/
 */
import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLUGINS_DIR = join(__dirname, '../plugins');
const DIST_APPS_DIR = join(__dirname, '../dist-apps');

// Get app ID from command line or build all
const targetApp = process.argv[2];

function buildPlugin(pluginName) {
  const pluginDir = join(PLUGINS_DIR, pluginName);
  const packageJsonPath = join(pluginDir, 'package.json');

  if (!existsSync(packageJsonPath)) {
    console.log(`⏭️  Skipping ${pluginName} (not a plugin)`);
    return false;
  }

  console.log(`\n📦 Building plugin: ${pluginName}`);

  try {
    // Install dependencies if needed
    if (!existsSync(join(pluginDir, 'node_modules'))) {
      console.log('  Installing dependencies...');
      execSync('pnpm install', { cwd: pluginDir, stdio: 'inherit' });
    }

    // Build the plugin
    console.log('  Building...');
    execSync('pnpm build', { cwd: pluginDir, stdio: 'inherit' });

    // Copy manifest.json to dist
    const manifestSrc = join(pluginDir, 'manifest.json');
    const distDir = join(DIST_APPS_DIR, pluginName);
    const manifestDest = join(distDir, 'manifest.json');

    if (existsSync(manifestSrc)) {
      copyFileSync(manifestSrc, manifestDest);
      console.log('  ✅ Copied manifest.json');
    }

    console.log(`✅ Built ${pluginName} successfully`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to build ${pluginName}:`, err.message);
    return false;
  }
}

function main() {
  // Create dist-apps directory if it doesn't exist
  if (!existsSync(DIST_APPS_DIR)) {
    mkdirSync(DIST_APPS_DIR, { recursive: true });
  }

  if (targetApp) {
    // Build specific app
    if (!existsSync(join(PLUGINS_DIR, targetApp))) {
      console.error(`❌ Plugin not found: ${targetApp}`);
      process.exit(1);
    }
    buildPlugin(targetApp);
  } else {
    // Build all plugins
    console.log('🚀 Building all extension apps...\n');

    const plugins = readdirSync(PLUGINS_DIR).filter((name) => {
      const pluginPath = join(PLUGINS_DIR, name);
      return statSync(pluginPath).isDirectory();
    });

    if (plugins.length === 0) {
      console.log('No plugins found in plugins/ directory');
      return;
    }

    let successCount = 0;
    for (const plugin of plugins) {
      if (buildPlugin(plugin)) {
        successCount++;
      }
    }

    console.log(`\n🎉 Built ${successCount}/${plugins.length} plugins successfully`);
  }
}

main();
