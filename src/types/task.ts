/**
 * Task Types
 * Frontend types for task management
 */

export type TaskStatus = 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
export type TaskType = 'file' | 'app';

export interface Task {
  id: string;
  name: string;
  description: string;
  teamId: string;
  type: TaskType;
  workspacePath?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  logs?: string[];
  executionState?: TaskExecutionState;
}

export interface CreateTaskData {
  name: string;
  description: string;
  teamId: string;
  type: TaskType;
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

/**
 * Task Execution Types
 */
export interface TaskExecutionNode {
  nodeId: string;           // 团队节点ID
  agentId: string;          // 员工ID
  status: 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'stopped';
  startedAt?: string;
  completedAt?: string;
  output?: string;          // 执行输出结果
  error?: string;           // 错误信息
}

export interface TaskExecutionState {
  taskId: string;
  status: TaskStatus;
  currentNodes: string[];   // 当前正在执行的节点ID
  completedNodes: string[]; // 已完成节点
  failedNodes: string[];    // 失败节点
  nodeResults: Record<string, TaskExecutionNode>; // 节点执行结果
  startedAt?: string;
  completedAt?: string;
}
