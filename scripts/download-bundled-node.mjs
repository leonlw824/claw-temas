#!/usr/bin/env zx

import { $, echo, fs } from 'zx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = '22.16.0';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const DOWNLOADS_CACHE = path.join(ROOT_DIR, 'resources', 'downloads');

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64', 'win32-arm64'],
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_node_extract');
  const cachedArchive = path.join(DOWNLOADS_CACHE, target.filename);
  const workingArchive = path.join(ROOT_DIR, target.filename);
  const downloadUrl = `${BASE_URL}/${target.filename}`;

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  await fs.remove(targetDir);
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);
  await fs.ensureDir(DOWNLOADS_CACHE);

  try {
    // Check if we have a cached download in resources/downloads
    if (await fs.pathExists(cachedArchive)) {
      echo(chalk.green`✅ 发现缓存文件: ${cachedArchive}`);
      echo(chalk.blue`📂 复制缓存文件到工作目录...`);
      await fs.copyFile(cachedArchive, workingArchive);
    } else {
      // Download
      echo`⬇️ Downloading: ${downloadUrl}`;
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
      const buffer = await response.arrayBuffer();

      // Save to working directory
      await fs.writeFile(workingArchive, Buffer.from(buffer));

      // Cache for future use
      echo(chalk.blue`💾 缓存文件到 resources/downloads...`);
      await fs.copyFile(workingArchive, cachedArchive);
    }

    echo`📂 Extracting...`;
    if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${workingArchive.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    } else {
      await $`unzip -q -o ${workingArchive} -d ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, 'node.exe');
    const outputNode = path.join(targetDir, 'node.exe');
    if (await fs.pathExists(expectedNode)) {
      await fs.move(expectedNode, outputNode, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 node.exe not found in expected directory, searching...`);
      const files = await glob('**/node.exe', { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], outputNode, { overwrite: true });
      } else {
        throw new Error('Could not find node.exe in extracted files.');
      }
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    // Cleanup - only remove working archive and temp dir, keep cached file
    await fs.remove(workingArchive);
    await fs.remove(tempDir);
    echo(chalk.gray`🗑️ 清理临时文件（保留缓存文件）`);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all Windows targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (TARGETS[currentId]) {
    echo(chalk.cyan`💻 Detected Windows system: ${currentId}`);
    await setupTarget(currentId);
  } else {
    echo(chalk.cyan`🎯 Defaulting to Windows multi-arch Node.js download`);
    for (const id of PLATFORM_GROUPS.win) {
      await setupTarget(id);
    }
  }
}

echo(chalk.green`\n🎉 Done!`);
