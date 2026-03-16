/**
 * Task Configuration Management
 * Manages tasks and their lifecycle
 * Tasks are stored in ~/.openclaw/tasks/ directory
 */

import { readFile, writeFile, mkdir, access, readdir } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import * as logger from './logger';

// ── Types ────────────────────────────────────────────────────────

export type TaskStatus = 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
export type TaskType = 'file' | 'app';

export interface TaskExecutionNode {
  nodeId: string;
  agentId: string;
  status: 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'stopped';
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  rollbackFeedback?: string; // Feedback from successor node when rollback was requested
}

export interface TaskExecutionState {
  taskId: string;
  status: TaskStatus;
  currentNodes: string[];
  completedNodes: string[];
  failedNodes: string[];
  nodeResults: Record<string, TaskExecutionNode>;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskConfig {
  id: string;
  name: string;
  description: string;
  teamId: string;
  type: TaskType;
  workspacePath?: string;
  status: TaskStatus;
  version: number; // Execution version, increments on each re-run
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  logs?: string[];
  executionState?: TaskExecutionState;
}

export interface TaskSnapshot {
  id: string;
  name: string;
  description: string;
  teamId: string;
  type: TaskType;
  workspacePath?: string;
  status: TaskStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  logs?: string[];
  executionState?: TaskExecutionState;
}

export interface TasksListSnapshot {
  tasks: TaskSnapshot[];
}

export interface TaskStatistics {
  total: number;
  waiting: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
}

// ── Constants ────────────────────────────────────────────────────

const TASKS_DIR = 'tasks';
const METADATA_FILE = 'metadata.json';

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

function getTasksDir(): string {
  return join(getOpenClawConfigDir(), TASKS_DIR);
}

function getTaskDir(taskId: string): string {
  return join(getTasksDir(), taskId);
}

function getTaskMetadataPath(taskId: string): string {
  return join(getTaskDir(taskId), METADATA_FILE);
}

function getTaskWorkspacePath(taskId: string): string {
  return getTaskDir(taskId);
}

async function readTaskFile(taskId: string): Promise<TaskConfig | null> {
  try {
    const metadataPath = getTaskMetadataPath(taskId);
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as TaskConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeTaskFile(task: TaskConfig): Promise<void> {
  const taskDir = getTaskDir(task.id);
  await ensureDir(taskDir);
  const metadataPath = getTaskMetadataPath(task.id);
  await writeFile(metadataPath, JSON.stringify(task, null, 2), 'utf-8');
}

async function deleteTaskFile(taskId: string): Promise<void> {
  try {
    const taskDir = getTaskDir(taskId);
    // 删除整个任务文件夹
    const { rm } = await import('fs/promises');
    await rm(taskDir, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function listTaskFiles(): Promise<string[]> {
  const tasksDir = getTasksDir();
  if (!(await fileExists(tasksDir))) {
    return [];
  }

  const entries = await readdir(tasksDir, { withFileTypes: true });
  // 只返回文件夹名称
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
}

// ── Task Management ──────────────────────────────────────────────

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function listTasksSnapshot(): Promise<TasksListSnapshot> {
  const taskIds = await listTaskFiles();

  const tasks: TaskSnapshot[] = [];
  for (const taskId of taskIds) {
    const task = await readTaskFile(taskId);
    if (task) {
      tasks.push({
        id: task.id,
        name: task.name,
        description: task.description,
        teamId: task.teamId,
        type: task.type,
        workspacePath: task.workspacePath,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        result: task.result,
        logs: task.logs,
        executionState: task.executionState,
      });
    }
  }

  // Sort by creation date (newest first)
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { tasks };
}

export async function createTask(
  name: string,
  description: string,
  teamId: string,
  type: TaskType,
): Promise<TasksListSnapshot> {
  const taskId = generateTaskId();
  const now = new Date().toISOString();
  const workspacePath = getTaskWorkspacePath(taskId);

  // Load team configuration to initialize nodes
  const { getTeam } = await import('./team-config');
  const team = await getTeam(teamId);
  const { nodes } = team.workflow;

  // Initialize all nodes as waiting
  const nodeResults: Record<string, TaskExecutionNode> = {};
  for (const node of nodes) {
    nodeResults[node.id] = {
      nodeId: node.id,
      agentId: node.agentId,
      status: 'waiting',
    };
  }

  // Initialize execution state
  const executionState: TaskExecutionState = {
    taskId,
    status: 'waiting',
    currentNodes: [],
    completedNodes: [],
    failedNodes: [],
    nodeResults,
  };

  const newTask: TaskConfig = {
    id: taskId,
    name,
    description,
    teamId,
    type,
    workspacePath,
    status: 'waiting',
    version: 1,
    createdAt: now,
    updatedAt: now,
    logs: [],
    executionState,
  };

  await writeTaskFile(newTask);
  logger.info('Task created', { taskId, name, type, workspacePath, nodeCount: nodes.length });

  return listTasksSnapshot();
}

export async function deleteTask(taskId: string): Promise<TasksListSnapshot> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  await deleteTaskFile(taskId);
  logger.info('Task deleted', { taskId });

  return listTasksSnapshot();
}

export async function getTaskStatistics(): Promise<TaskStatistics> {
  const snapshot = await listTasksSnapshot();
  const tasks = snapshot.tasks;

  return {
    total: tasks.length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    stopped: tasks.filter((t) => t.status === 'stopped').length,
  };
}

export async function getTaskLogs(taskId: string): Promise<string[]> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  // Read logs from workspace log file
  if (task.workspacePath) {
    try {
      const logPath = join(task.workspacePath, 'logs', `${taskId}.log`);
      if (await fileExists(logPath)) {
        const logContent = await readFile(logPath, 'utf-8');
        // Split by newlines and filter empty lines
        return logContent.split('\n').filter(line => line.trim() !== '');
      }
    } catch (error) {
      logger.warn('Failed to read task logs from file', { taskId, error });
    }
  }

  // Fallback to task.logs if workspace path not available or file doesn't exist
  return task.logs || [];
}

// ── Task Execution Management ────────────────────────────────────

export async function getTask(taskId: string): Promise<TaskConfig> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  return task;
}

export async function updateTaskExecutionState(
  taskId: string,
  executionState: TaskExecutionState
): Promise<void> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  task.executionState = executionState;
  task.status = executionState.status;
  task.startedAt = executionState.startedAt;
  task.completedAt = executionState.completedAt;
  task.updatedAt = new Date().toISOString();

  // Extract result from the last completed node (excluding END node)
  if (executionState.status === 'completed' && executionState.completedNodes.length > 0) {
    // Find the last completed node that is not the END node
    const lastActualNodeId = executionState.completedNodes
      .filter(nodeId => nodeId !== '__END__')
      .pop();

    if (lastActualNodeId) {
      const lastNodeResult = executionState.nodeResults[lastActualNodeId];
      if (lastNodeResult && lastNodeResult.output) {
        task.result = lastNodeResult.output;
      }
    }
  }

  await writeTaskFile(task);
  logger.info('Task execution state updated', { taskId, status: executionState.status });
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<void> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  task.status = status;
  task.updatedAt = new Date().toISOString();

  if (status === 'running' && !task.startedAt) {
    task.startedAt = new Date().toISOString();
  }

  if ((status === 'completed' || status === 'failed' || status === 'stopped') && !task.completedAt) {
    task.completedAt = new Date().toISOString();
  }

  await writeTaskFile(task);
  logger.info('Task status updated', { taskId, status });
}

export async function incrementTaskVersion(taskId: string): Promise<void> {
  const task = await readTaskFile(taskId);

  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  // Increment version (initialize to 1 if not set for backwards compatibility)
  task.version = (task.version || 0) + 1;

  // Reset execution-related fields for fresh run
  task.status = 'waiting';
  task.startedAt = undefined;
  task.completedAt = undefined;
  task.result = undefined;
  task.updatedAt = new Date().toISOString();

  await writeTaskFile(task);
  logger.info('Task version incremented', { taskId, version: task.version });
}
