#!/usr/bin/env zx

import { $, echo } from 'zx';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');
const SKILLS_CACHE = join(ROOT, 'resources', 'skills', 'preinstalled-cache');

/**
 * Forcefully remove a directory, handling Windows permission issues.
 * On Windows, .git directories often have read-only files that need
 * their permissions changed before deletion.
 */
function forcefulRmSync(targetPath) {
  if (!existsSync(targetPath)) return;

  try {
    // First attempt: normal deletion
    rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') {
      // Second attempt: recursively remove read-only attributes on Windows
      try {
        removeReadOnlyRecursive(targetPath);
        rmSync(targetPath, { recursive: true, force: true });
      } catch (finalErr) {
        echo`Warning: Could not fully remove ${targetPath}: ${finalErr.message}`;
        // Non-fatal: continue with the build
      }
    } else {
      throw err;
    }
  }
}

/**
 * Recursively remove read-only attribute from all files in a directory (Windows).
 */
function removeReadOnlyRecursive(dirPath) {
  if (!existsSync(dirPath)) return;

  const stat = statSync(dirPath);

  // Remove read-only flag (make writable)
  try {
    chmodSync(dirPath, 0o666);
  } catch (e) {
    // Ignore chmod errors, try to continue
  }

  if (stat.isDirectory()) {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      removeReadOnlyRecursive(join(dirPath, entry));
    }
  }
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug || !item.repo || !item.repoPath) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        // Some Windows images expose bsdtar instead of tar.
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir, maxRetries = 3) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;

  // Configure git for better network reliability on Windows
  await $`git -C ${gitCheckoutDir} config http.postBuffer 524288000`;
  await $`git -C ${gitCheckoutDir} config http.lowSpeedLimit 0`;
  await $`git -C ${gitCheckoutDir} config http.lowSpeedTime 999999`;

  // Retry fetch on network errors
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        echo`   Fetch attempt ${attempt} failed, retrying... (${err.message})`;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  if (lastError) {
    throw new Error(`Failed to fetch after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  // Use execFileSync to avoid zx quote issues with array arguments on Windows
  execFileSync('git', ['-C', gitCheckoutDir, 'archive', '--format=tar', `--output=${archiveFileName}`, 'FETCH_HEAD', ...archivePaths], {
    stdio: 'inherit',
    cwd: checkoutDir
  });
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
forcefulRmSync(TMP_ROOT);
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const groups = groupByRepoRef(manifestSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;

  // Check if skills are cached locally first
  const allSkillsCached = group.entries.every(entry => {
    const cachedSkillDir = join(SKILLS_CACHE, entry.slug);
    return existsSync(cachedSkillDir) && existsSync(join(cachedSkillDir, 'SKILL.md'));
  });

  let commit;
  if (allSkillsCached) {
    echo`   ✅ Using cached skills (skip GitHub download)`;
    commit = 'cached-local';
  } else {
    commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
    echo`   commit ${commit}`;
  }

  for (const entry of group.entries) {
    const cachedSkillDir = join(SKILLS_CACHE, entry.slug);
    const sourceDir = allSkillsCached ? cachedSkillDir : join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    // Cache skill for future builds if not using cached source
    if (!allSkillsCached) {
      rmSync(cachedSkillDir, { recursive: true, force: true });
      mkdirSync(dirname(cachedSkillDir), { recursive: true });
      cpSync(sourceDir, cachedSkillDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });
      echo`   💾 Cached ${entry.slug} for future builds`;
    }

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
forcefulRmSync(TMP_ROOT);
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
