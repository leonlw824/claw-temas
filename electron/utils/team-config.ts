/**
 * Team Configuration Management
 * Manages team workflows and their execution
 * Teams are stored in ~/.openclaw/teams/ directory
 */

import { readFile, writeFile, mkdir, access, readdir, unlink } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import * as logger from './logger';

// ── Types ────────────────────────────────────────────────────────

export interface TeamNode {
  id: string;
  agentId: string;
  position: { x: number; y: number };
}

export interface TeamEdge {
  id: string;
  source: string;
  target: string;
  description?: string;
  sourcePort?: string;
  targetPort?: string;
  rollback?: boolean;  // Enable rollback - allows target node to send work back to source
}

export interface TeamWorkflow {
  nodes: TeamNode[];
  edges: TeamEdge[];
}

export interface TeamConfig {
  id: string;
  name: string;
  workflow: TeamWorkflow;
  createdAt: string;
  updatedAt: string;
}

export interface TeamSnapshot {
  id: string;
  name: string;
  workflow: TeamWorkflow;
  createdAt: string;
  updatedAt: string;
}

export interface TeamsListSnapshot {
  teams: TeamSnapshot[];
}

// ── Constants ────────────────────────────────────────────────────

const TEAMS_DIR = 'teams';
const TEAM_FILE_EXTENSION = '.json';

// ── File I/O ─────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getTeamsDir(): string {
  return join(getOpenClawConfigDir(), TEAMS_DIR);
}

function getTeamFilePath(teamId: string): string {
  return join(getTeamsDir(), `${teamId}${TEAM_FILE_EXTENSION}`);
}

async function readTeamFile(teamId: string): Promise<TeamConfig | null> {
  try {
    const filePath = getTeamFilePath(teamId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as TeamConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeTeamFile(team: TeamConfig): Promise<void> {
  await ensureDir(getTeamsDir());
  const filePath = getTeamFilePath(team.id);
  await writeFile(filePath, JSON.stringify(team, null, 2), 'utf-8');
}

async function deleteTeamFile(teamId: string): Promise<void> {
  try {
    const filePath = getTeamFilePath(teamId);
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function listTeamFiles(): Promise<string[]> {
  const teamsDir = getTeamsDir();
  if (!(await fileExists(teamsDir))) {
    return [];
  }

  const files = await readdir(teamsDir);
  return files
    .filter(file => file.endsWith(TEAM_FILE_EXTENSION))
    .map(file => file.slice(0, -TEAM_FILE_EXTENSION.length));
}

// ── Team Management ──────────────────────────────────────────────

function generateTeamId(): string {
  return `team-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function listTeamsSnapshot(): Promise<TeamsListSnapshot> {
  const teamIds = await listTeamFiles();

  const teams: TeamSnapshot[] = [];
  for (const teamId of teamIds) {
    const team = await readTeamFile(teamId);
    if (team) {
      teams.push({
        id: team.id,
        name: team.name,
        workflow: team.workflow,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      });
    }
  }

  // Sort by creation date (newest first)
  teams.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { teams };
}

export async function createTeam(name: string, workflow: TeamWorkflow): Promise<TeamsListSnapshot> {
  const teamId = generateTeamId();
  const now = new Date().toISOString();

  const newTeam: TeamConfig = {
    id: teamId,
    name,
    workflow,
    createdAt: now,
    updatedAt: now,
  };

  await writeTeamFile(newTeam);
  logger.info('Team created', { teamId, name });

  return listTeamsSnapshot();
}

export async function updateTeam(
  teamId: string,
  updates: { name?: string; workflow?: TeamWorkflow },
): Promise<TeamsListSnapshot> {
  const team = await readTeamFile(teamId);

  if (!team) {
    throw new Error(`Team "${teamId}" not found`);
  }

  const now = new Date().toISOString();

  if (updates.name !== undefined) {
    team.name = updates.name;
  }
  if (updates.workflow !== undefined) {
    team.workflow = updates.workflow;
  }
  team.updatedAt = now;

  await writeTeamFile(team);
  logger.info('Team updated', { teamId });

  return listTeamsSnapshot();
}

export async function deleteTeam(teamId: string): Promise<TeamsListSnapshot> {
  const team = await readTeamFile(teamId);

  if (!team) {
    throw new Error(`Team "${teamId}" not found`);
  }

  await deleteTeamFile(teamId);
  logger.info('Team deleted', { teamId });

  return listTeamsSnapshot();
}

export async function getTeam(teamId: string): Promise<TeamSnapshot> {
  const team = await readTeamFile(teamId);

  if (!team) {
    throw new Error(`Team "${teamId}" not found`);
  }

  return {
    id: team.id,
    name: team.name,
    workflow: team.workflow,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}
